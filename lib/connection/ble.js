import { Buffer } from 'node:buffer'
import process from 'node:process'

import btClient from '@stoprocent/noble'

import { buildHandshake, isHandshakeFrame, parseHandshakeResponse, V2Session } from '../utils/ble-crypto.js'
import { BLE_STAGE_TIMEOUTS, UUID } from '../utils/ble-protocol.js'
import { decodeAny } from '../utils/decode.js'
import { getDeviceCapabilities } from '../utils/device-capabilities.js'
import { base64ToHex, generateCodeFromHexValues, hexToTwoItems, sleep } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { isValidPeripheral } from '../utils/validation.js'

const HYPHEN_REGEX = /-/g

process.env.NOBLE_REPORT_ALL_HCI_EVENTS = '1' // needed on Linux including Raspberry Pi

const H5075_UUID = 'ec88'
const H5101_UUID = '0001'

const POWER_ON_TIMEOUT = BLE_STAGE_TIMEOUTS.powerOn
const CONNECTION_TIMEOUT = BLE_STAGE_TIMEOUTS.connect
const WRITE_TIMEOUT = BLE_STAGE_TIMEOUTS.write
const HANDSHAKE_TIMEOUT = BLE_STAGE_TIMEOUTS.handshake
const SETTLE_DELAY = BLE_STAGE_TIMEOUTS.settle

/*
  The necessary commands to send and functions are taken from and credit to:
  https://www.npmjs.com/package/govee-led-client
*/

export default class BLEConnection {
  constructor(platform) {
    this.log = platform.log
    this.platform = platform
    this.btState = 'unknown'
    this.isScanning = false
    this.isConnecting = false
    this.activeConnection = null
    this.discoverCallback = null
    this.scanTimeoutId = null
    this.isShuttingDown = false

    // Store event handler references for cleanup
    this.eventHandlers = {
      stateChange: null,
      scanStart: null,
      scanStop: null,
      warning: null,
      discover: null,
    }

    this.setupEventListeners()
  }

  setupEventListeners() {
    try {
      // Store references to event handlers for later removal
      this.eventHandlers.stateChange = (state) => {
        if (this.isShuttingDown) {
          return
        }
        this.btState = state
        this.log.debug('[BLE] adapter state changed to: %s.', state)

        // If adapter loses power while operations are in progress, clean up
        if (state !== 'poweredOn') {
          this.handleAdapterPowerLoss()
        }
      }

      this.eventHandlers.scanStart = () => {
        if (this.isShuttingDown) {
          return
        }
        this.isScanning = true
        this.log.debug('[BLE] scanning started.')
      }

      this.eventHandlers.scanStop = () => {
        if (this.isShuttingDown) {
          return
        }
        this.isScanning = false
        this.log.debug('[BLE] scanning stopped.')
      }

      this.eventHandlers.warning = (message) => {
        if (this.isShuttingDown) {
          return
        }
        this.log.warn('[BLE] adapter warning: %s.', message)
      }

      this.eventHandlers.discover = (peripheral) => {
        if (this.isShuttingDown) {
          return
        }
        this.handleDiscoveredPeripheral(peripheral)
      }

      // Attach event listeners with error handling
      btClient.on('stateChange', this.eventHandlers.stateChange)
      btClient.on('scanStart', this.eventHandlers.scanStart)
      btClient.on('scanStop', this.eventHandlers.scanStop)
      btClient.on('warning', this.eventHandlers.warning)
      btClient.on('discover', this.eventHandlers.discover)

      // Handle Noble-specific errors without installing global process handlers
      btClient.on('error', (err) => {
        if (err.message && (err.message.includes('BLEManager') || err.message.includes('SIGABRT'))) {
          this.log.error('[BLE] native ble crash detected, ble functionality disabled for this session.')
          this.isShuttingDown = true
        }
      })
    } catch (err) {
      this.log.warn('[BLE] failed to setup event listeners:', err.message)
      // Don't throw - allow plugin to continue without BLE
    }
  }

  handleDiscoveredPeripheral(peripheral) {
    try {
      const { uuid, address, rssi, advertisement } = peripheral

      // Skip if not a valid Govee sensor
      if (!isValidPeripheral(peripheral)) {
        return
      }

      const { localName, manufacturerData } = advertisement
      if (!manufacturerData) {
        return
      }

      const streamUpdate = manufacturerData.toString('hex')
      this.log.debug('[BLE] sensor data from %s: %s.', address, streamUpdate)

      // Decode sensor values
      const decodedValues = decodeAny(streamUpdate)

      // Pass to callback if registered
      if (this.discoverCallback) {
        this.discoverCallback({
          uuid,
          address,
          model: localName,
          battery: decodedValues.battery,
          humidity: decodedValues.humidity,
          tempInC: decodedValues.tempInC,
          tempInF: decodedValues.tempInF,
          rssi,
        })
      }
    } catch (err) {
      this.log.debug('[BLE] error processing discovered peripheral: %s.', err.message)
    }
  }

  handleAdapterPowerLoss() {
    // Clean up any active operations if adapter loses power
    if (this.isScanning) {
      this.isScanning = false
      this.discoverCallback = null
    }

    if (this.activeConnection) {
      this.activeConnection = null
      this.isConnecting = false
    }

    if (this.scanTimeoutId) {
      clearTimeout(this.scanTimeoutId)
      this.scanTimeoutId = null
    }
  }

  async waitForPowerOn(timeout = POWER_ON_TIMEOUT) {
    if (this.btState === 'poweredOn') {
      return true
    }

    try {
      // noble applies the timeout itself and removes its own state listener when
      // it expires. Racing it against a second, shorter timer here just meant
      // noble kept waiting - and holding its listener - for another five seconds
      // after we had already given up.
      await btClient.waitForPoweredOnAsync(timeout)
      return true
    } catch (err) {
      this.log.warn('[BLE] failed to power on adapter: %s.', err.message)
      return false
    }
  }

  async updateDevice(accessory, params) {
    accessory.logDebug(`starting ble update with params [${JSON.stringify(params)}]`)

    // Ensure adapter is ready
    if (!(await this.waitForPowerOn())) {
      throw new Error(`${platformLang.bleWrongState} [${this.btState}]`)
    }

    // Pause sensor scanning if active
    const wasScanning = this.isScanning
    const savedDiscoverCallback = this.discoverCallback
    if (wasScanning) {
      accessory.logDebug('pausing sensor scan for device update')
      await this.stopDiscovery()
    }

    this.isConnecting = true
    let peripheral = null

    try {
      // Reset adapter to clear any stale connections
      btClient.reset()

      // Connect with timeout
      accessory.logDebug(`connecting to device at ${accessory.context.bleAddress}`)
      peripheral = await this.connectWithTimeout(accessory.context.bleAddress, CONNECTION_TIMEOUT)
      this.activeConnection = peripheral
      accessory.logDebug('connected successfully')

      // Discover services and characteristics
      accessory.logDebug('discovering services and characteristics')
      const { characteristics } = await peripheral.discoverAllServicesAndCharacteristicsAsync()

      // Find control characteristic
      const writeUuid = accessory.context.bleWriteUuid || UUID.WRITE_DEFAULT
      const characteristic = Object.values(characteristics).find(
        char => char.uuid.replace(HYPHEN_REGEX, '') === writeUuid,
      )

      if (!characteristic) {
        const discoveredUuids = Object.values(characteristics).map(c => c.uuid)
        accessory.logDebug(`discovered characteristics: ${JSON.stringify(discoveredUuids)}`)
        throw new Error('Control characteristic not found')
      }
      accessory.logDebug('found control characteristic')

      // Prepare command buffer
      const finalBuffer = this.prepareCommandBuffer(params)
      accessory.logDebug(`sending command: ${finalBuffer.toString('hex')}`)

      // Encrypted models refuse the plain frame. Because writes are
      // unacknowledged, they refuse it silently, so the handshake has to happen
      // here rather than being discovered by a failed write. It is per
      // connection: the frame counter resets with the link.
      let payload = finalBuffer
      if (getDeviceCapabilities(accessory.context.gvModel).bleEncryption === 'v2') {
        const session = await this.negotiateSession(accessory, characteristic, characteristics)
        payload = session.seal(finalBuffer)
        accessory.logDebug(`encrypted as: ${payload.toString('hex')}`)
      }

      // Write without response then allow time for the BLE controller to transmit before disconnecting
      await this.writeWithTimeout(characteristic, payload, WRITE_TIMEOUT)
      accessory.logDebug('command sent successfully')
      await sleep(SETTLE_DELAY)
    } catch (err) {
      accessory.logWarn(`BLE update failed: ${err.message}`)
      throw err
    } finally {
      // Always cleanup
      this.isConnecting = false
      this.activeConnection = null

      // Disconnect if connected
      if (peripheral) {
        try {
          accessory.logDebug('disconnecting from device')
          await peripheral.disconnectAsync()
          accessory.logDebug('disconnected')
        } catch (err) {
          accessory.logDebug(`disconnect error (non-critical): ${err.message}`)
        }
      }

      // Resume scanning if it was active before
      if (wasScanning && savedDiscoverCallback) {
        setTimeout(() => {
          this.startDiscovery(savedDiscoverCallback).catch(err =>
            this.log.debug('[BLE] failed to resume scanning: %s.', err.message),
          )
        }, 1000)
      }
    }
  }

  /**
   * Exchange a session key with an encrypted model.
   *
   * Unlike every other path in this client we need a reply, which arrives as a
   * notification on UUID.NOTIFY. Note that we deliberately do NOT subscribe:
   * these lights push notifications without the client ever writing the client
   * characteristic configuration descriptor, exactly as the official app does.
   * Calling subscribeAsync() here makes the descriptor write hang and the light
   * then drops the connection, so listening is both sufficient and required.
   *
   * The reply is authenticated - parseHandshakeResponse throws if the GCM tag
   * does not verify - which turns a wrong key into a real error rather than a
   * light that silently ignores every command.
   *
   * Returns a V2Session that wraps outgoing frames.
   */
  async negotiateSession(accessory, writeCharacteristic, characteristics) {
    const notifyCharacteristic = Object.values(characteristics).find(
      char => char.uuid.replace(HYPHEN_REGEX, '') === UUID.NOTIFY,
    )
    if (!notifyCharacteristic) {
      throw new Error('Notify characteristic not found, cannot negotiate encryption')
    }

    let resolveReply
    let rejectReply
    const reply = new Promise((resolve, reject) => {
      resolveReply = resolve
      rejectReply = reject
    })
    // Attach a handler immediately: if the write below throws, the timeout would
    // otherwise reject an unawaited promise and crash the process.
    reply.catch(() => {})

    const onData = (data) => {
      // The light also pushes state frames here; take only the handshake.
      if (isHandshakeFrame(data)) {
        resolveReply(data)
      }
    }
    notifyCharacteristic.on('data', onData)
    const timer = setTimeout(
      () => rejectReply(new Error('Encryption handshake timeout')),
      HANDSHAKE_TIMEOUT,
    )

    try {
      const { frame, txIvKey } = buildHandshake()
      accessory.logDebug(`sending handshake: ${frame.toString('hex')}`)
      await this.writeWithTimeout(writeCharacteristic, frame, WRITE_TIMEOUT)

      const response = await reply
      accessory.logDebug(`handshake reply: ${response.toString('hex')}`)

      const { devInfo, sku, mac } = parseHandshakeResponse(response)
      accessory.logDebug(`handshake verified for ${sku} at ${mac}`)

      return new V2Session({ txIvKey, devInfo })
    } finally {
      clearTimeout(timer)
      notifyCharacteristic.removeListener('data', onData)
    }
  }

  async connectWithTimeout(address, timeout) {
    let timeoutId
    try {
      return await Promise.race([
        btClient.connectAsync(address),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Connection timeout')), timeout)
        }),
      ])
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async writeWithTimeout(characteristic, buffer, timeout) {
    let timeoutId
    try {
      return await Promise.race([
        characteristic.writeAsync(buffer, true),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Write timeout')), timeout)
        }),
      ])
    } finally {
      clearTimeout(timeoutId)
    }
  }

  prepareCommandBuffer(params) {
    if (params.cmd === 'ptReal') {
      // Base64 action code
      return Buffer.from(
        hexToTwoItems(base64ToHex(params.data)).map(byte => `0x${byte}`),
      )
    }
    // Array of hex values
    return generateCodeFromHexValues([0x33, params.cmd, params.data], true)
  }

  async startDiscovery(callback) {
    // Skip if already connecting to a device
    if (this.isConnecting) {
      this.log.debug('[BLE] skipping sensor scan - device connection in progress.')
      return
    }

    // Skip if already scanning
    if (this.isScanning) {
      this.log.debug('[BLE] already scanning.')
      return
    }

    // Ensure adapter is ready
    if (!(await this.waitForPowerOn())) {
      throw new Error('bluetooth adapter not ready')
    }

    this.discoverCallback = callback

    try {
      // Wrap in additional try-catch for native crashes
      await btClient.startScanningAsync([H5075_UUID, H5101_UUID], true)
      this.log.debug('[BLE] started scanning for sensors.')
    } catch (err) {
      this.discoverCallback = null
      // Check for native BLE crashes
      if (err.message && (err.message.includes('BLEManager') || err.message.includes('SIGABRT'))) {
        this.log.error('[BLE] native ble crash detected, ble functionality disabled for this session.')
        this.isShuttingDown = true // Prevent further BLE operations
      }
      throw err
    }
  }

  async stopDiscovery() {
    this.discoverCallback = null

    if (this.scanTimeoutId) {
      clearTimeout(this.scanTimeoutId)
      this.scanTimeoutId = null
    }

    if (this.isScanning) {
      try {
        await btClient.stopScanningAsync()
        this.log.debug('[BLE] stopped scanning.')
      } catch (err) {
        this.log.debug('[BLE] error stopping scan: %s.', err.message)
      }
    }
  }

  // Comprehensive shutdown for clean termination
  shutdown() {
    this.log('[BLE] shutting down.')
    this.isShuttingDown = true

    // Remove all event listeners first to prevent any more events
    try {
      if (this.eventHandlers.stateChange) {
        btClient.removeListener('stateChange', this.eventHandlers.stateChange)
      }
      if (this.eventHandlers.scanStart) {
        btClient.removeListener('scanStart', this.eventHandlers.scanStart)
      }
      if (this.eventHandlers.scanStop) {
        btClient.removeListener('scanStop', this.eventHandlers.scanStop)
      }
      if (this.eventHandlers.warning) {
        btClient.removeListener('warning', this.eventHandlers.warning)
      }
      if (this.eventHandlers.discover) {
        btClient.removeListener('discover', this.eventHandlers.discover)
      }

      // Clear all event handler references
      this.eventHandlers = {}
    } catch (err) {
      this.log('[BLE] error removing event listeners: %s.', err.message)
    }

    // Clear any timeouts
    if (this.scanTimeoutId) {
      clearTimeout(this.scanTimeoutId)
      this.scanTimeoutId = null
    }

    // Stop scanning immediately (synchronous)
    try {
      if (btClient) {
        btClient.stopScanning()
      }
    } catch (err) {
      this.log('[BLE] error stopping scan during shutdown: %s.', err.message)
    }

    // Clear all state
    this.discoverCallback = null
    this.isScanning = false
    this.isConnecting = false
    this.activeConnection = null

    // Reset adapter to disconnect any connections
    try {
      btClient.reset()
    } catch (err) {
      this.log('[BLE] error resetting adapter during shutdown: %s.', err.message)
    }

    // Try to remove all listeners from Noble completely
    try {
      if (btClient.removeAllListeners) {
        btClient.removeAllListeners()
      }
    } catch (err) {
      this.log('[BLE] error removing all listeners during shutdown: %s.', err.message)
    }

    this.log('[BLE] shutdown complete.')
  }
}
