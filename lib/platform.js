import { Buffer } from 'node:buffer'
import { existsSync, mkdirSync, promises } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'

import storage from 'node-persist'
import PQueue from 'p-queue'

import awsClient from './connection/aws.js'
import httpClient from './connection/http.js'
import lanClient from './connection/lan.js'
import openApiClient from './connection/openapi.js'
import eveService from './fakegato/fakegato-history.js'
import { BLE_UPDATE_TIMEOUT } from './utils/ble-protocol.js'
import { buildCommand } from './utils/command-builder.js'
import { applyUserConfig } from './utils/config-parser.js'
import platformConsts from './utils/constants.js'
import platformChars from './utils/custom-chars.js'
import { applyDeviceContext } from './utils/device-context.js'
import { cloudListsWereFetched, planDeviceSetup, planRedundantAccessories } from './utils/device-merge.js'
import { resolveDeviceType } from './utils/dispatch.js'
import eveChars from './utils/eve-chars.js'
import {
  base64ToHex,
  hasProperty,
  parseError,
  pfxToCertAndKey,
  updateFailureError,
} from './utils/functions.js'
import platformLang from './utils/lang-en.js'
import { isFirstReport, logUnknownData } from './utils/report-unknown.js'
import { parseDeviceUpdate } from './utils/response-parser.js'

const require = createRequire(import.meta.url)
const plugin = require('../package.json')

const WHITESPACE_REGEX = /\s+/g
const DEVICE_ID_FORMAT_REGEX = /([a-z0-9]{2})(?=[a-z0-9])/gi

const devicesInHB = new Map()
const awsDevices = []
const awsDevicesToPoll = []
const httpDevices = []
const lanDevices = []
const openApiDevices = []

export default class {
  constructor(log, config, api) {
    if (!log || !api) {
      return
    }

    // Begin plugin initialisation
    try {
      this.api = api
      this.log = log

      // Configuration objects for accessories
      this.deviceConf = {}
      this.ignoredDevices = []

      // Periodic syncs currently running, so a slow one is not started twice
      this.syncsInFlight = new Set()

      // Make sure user is running Homebridge v1.5 or above
      if (!api.versionGreaterOrEqual?.('1.5.0')) {
        throw new Error(platformLang.hbVersionFail)
      }

      // Check the user has configured the plugin
      if (!config) {
        throw new Error(platformLang.pluginNotConf)
      }

      // Log some environment info for debugging
      this.log(
        '%s v%s | System %s | Node %s | HB v%s | HAPNodeJS v%s...',
        platformLang.initialising,
        plugin.version,
        process.platform,
        process.version,
        api.serverVersion,
        api.hap.HAPLibraryVersion(),
      )

      // Apply the user's configuration
      this.config = platformConsts.defaultConfig
      applyUserConfig(this, config)

      // Set up empty clients
      this.bleClient = false
      this.httpClient = false
      this.lanClient = false
      this.openApiClient = false

      // Set up the Homebridge events
      this.api.on('didFinishLaunching', () => this.pluginSetup())
      this.api.on('shutdown', () => this.pluginShutdown())
    } catch (err) {
      // Catch any errors during initialisation
      log.warn('***** %s [v%s]. *****', platformLang.disabling, plugin.version)
      log.warn('***** %s. *****', parseError(err, [platformLang.hbVersionFail, platformLang.pluginNotConf]))
    }
  }

  async pluginSetup() {
    // Plugin has finished initialising so now onto setup
    try {
      // Log that the plugin initialisation has been successful
      this.log('%s.', platformLang.initialised)

      // Homebridge already decides whether debug lines are shown, and it gets it
      // right in a child bridge too. This used to work it out for itself by
      // looking for `-D` in the plugin's own process arguments, which a child
      // bridge does not receive unless that bridge has its own debug setting
      // turned on - so debug logging silently disappeared for anyone running the
      // plugin in a child bridge with debug enabled globally.
      //
      // `debugWarn` has no equivalent on Homebridge's logger, so it goes out as
      // a debug line too rather than being invented here.
      this.log.debugWarn = (...args) => this.log.debug(...args)

      // Require any libraries that the plugin uses
      this.cusChar = new platformChars(this.api)
      this.eveChar = new eveChars(this.api)
      this.eveService = eveService(this.api)

      const cachePath = join(this.api.user.storagePath(), '/bwp91_cache')
      const persistPath = join(this.api.user.storagePath(), '/persist')

      // Create folders if they don't exist
      if (!existsSync(cachePath)) {
        mkdirSync(cachePath)
      }
      if (!existsSync(persistPath)) {
        mkdirSync(persistPath)
      }

      // Persist files are used to store device info that can be used by my other plugins
      try {
        this.storageData = storage.create({
          dir: cachePath,
          forgiveParseErrors: true,
        })
        await this.storageData.init()
        this.storageClientData = true
      } catch (err) {
        this.log.debugWarn('%s %s.', platformLang.storageSetupErr, parseError(err))
      }

      // Set up the LAN client and perform an initial scan for devices
      try {
        if (this.config.lanDisable) {
          throw new Error(platformLang.disabledInConfig)
        }
        this.lanClient = new lanClient(this)
        const devices = await this.lanClient.getDevices()
        devices.forEach(device => lanDevices.push(device))
        this.log('[LAN] %s.', platformLang.availableWithDevices(devices.length))
      } catch (err) {
        this.log.warn('[LAN] %s %s.', platformLang.disableClient, parseError(err, [
          platformLang.disabledInConfig,
        ]))
        this.lanClient = false
        Object.keys(this.deviceConf).forEach((id) => {
          delete this.deviceConf[id].customIPAddress
        })
      }

      // Set up the OpenAPI client if an API key has been provided and not disabled
      try {
        if (this.config.openApiDisable) {
          throw new Error(platformLang.disabledInConfig)
        }
        if (!this.config.apiKey) {
          throw new Error(platformLang.openApiNoKey)
        }
        this.openApiClient = new openApiClient(this)
        const devices = await this.openApiClient.getDevices()
        devices.forEach(device => openApiDevices.push(device))
        this.log('[OPENAPI] %s.', platformLang.availableWithDevices(devices.length))
      } catch (err) {
        this.log.warn('[OPENAPI] %s %s.', platformLang.disableClient, parseError(err, [
          platformLang.openApiNoKey,
          platformLang.disabledInConfig,
        ]))
        this.openApiClient = false
      }

      // Set up the HTTP client if Govee username and password have been provided
      try {
        if (!this.config.username || !this.config.password) {
          throw new Error(platformLang.noCreds)
        }
        const iotFile = join(persistPath, 'govee.pfx')

        const getDevices = async () => {
          const devices = await this.httpClient.getDevices()
          devices.forEach(device => httpDevices.push(device))
          this.log('[HTTP] %s.', platformLang.availableWithDevices(devices.length))
        }

        // Try and get access token from the cache to get a device list
        try {
          const storedData = await this.storageData.getItem('Govee_All_Devices_temp')
          const splitData = storedData?.split(':::')
          if (!Array.isArray(splitData) || splitData.length !== 7) {
            throw new Error(platformLang.accTokenNoExist)
          }
          if (splitData[2] !== this.config.username) {
            // Username has changed so throw error to generate new token
            throw new Error(platformLang.accTokenUserChange)
          }

          try {
            await promises.access(iotFile, 0)
          } catch (err) {
            throw new Error(platformLang.iotFileNoExist)
          }

          [
            this.accountTopic,
            this.accountToken,,
            this.accountId,
            this.iotEndpoint,
            this.iotPass,
            this.accountTokenTTR,
          ] = splitData

          this.log.debug('[HTTP] %s.', platformLang.accTokenFromCache)

          this.httpClient = new httpClient(this)
          await getDevices()
        } catch (err) {
          this.log.warn('[HTTP] %s %s.', platformLang.accTokenFail, parseError(err, [
            platformLang.accTokenUserChange,
            platformLang.accTokenNoExist,
            platformLang.iotFileNoExist,
          ]))

          this.httpClient = new httpClient(this)
          const data = await this.httpClient.login()

          this.accountId = data.accountId
          this.accountTopic = data.topic
          this.accountToken = data.token
          this.accountTokenTTR = data.tokenTTR
          this.clientId = data.client
          this.iotEndpoint = data.endpoint
          this.iotPass = data.iotPass

          // Save this to a file
          await promises.writeFile(iotFile, Buffer.from(data.iot, 'base64'))

          // Try and save these to the cache for future reference
          await this.persistAccountCache()
          await getDevices()
        }

        const iotFileData = await pfxToCertAndKey(iotFile, this.iotPass)
        if (this.config.awsDisable) {
          this.log.warn('[AWS] %s %s.', platformLang.disableClient, platformLang.disabledInConfig)
        } else {
          this.awsClient = new awsClient(this, iotFileData)
          this.log('[AWS] %s.', platformLang.available)
        }
      } catch (err) {
        if (err.message.includes('abnormal')) {
          err.message = platformLang.abnormalMessage
        }
        this.log.warn('[HTTP] %s %s.', platformLang.disableClient, parseError(err, [
          platformLang.abnormalMessage,
          platformLang.noCreds,
          platformLang.twoFARequired,
          platformLang.twoFACodeInvalid,
        ]))
        if (err.message.includes('Could not find openssl')) {
          this.log.warn(platformLang.noOpenssl)
        }
        this.log.warn('[AWS] %s %s.', platformLang.disableClient, platformLang.needHTTPClient)
        this.httpClient = false
        this.awsClient = false
      }

      // Set up the BLE client, if enabled
      try {
        if (this.config.bleDisable) {
          throw new Error(platformLang.disabledInConfig)
        }

        // See if the bluetooth client is available
        /*
          Noble sends the plugin into a crash loop if there is no bluetooth adapter available
          This if statement follows the logic of Noble up to the offending socket.bindRaw(device)
          Put inside a try/catch now to check for error and disable ble control for rest of plugin
        */
        if (['linux', 'freebsd', 'win32'].includes(process.platform)) {
          const { default: BluetoothHciSocket } = await import('@stoprocent/bluetooth-hci-socket')
          const socket = new BluetoothHciSocket()
          const device = process.env.NOBLE_HCI_DEVICE_ID
            ? Number.parseInt(process.env.NOBLE_HCI_DEVICE_ID, 10)
            : undefined
          socket.bindRaw(device)
        }
        try {
          await import('@stoprocent/noble')
        } catch (err) {
          throw new Error(platformLang.bleNoPackage)
        }
        const { default: BLEConnection } = await import('./connection/ble.js')
        this.bleClient = new BLEConnection(this)
        this.log('[BLE] %s.', platformLang.available)
      } catch (err) {
        // This error thrown from bluetooth-hci-socket does not contain an 'err.message'
        if (err.code === 'ERR_DLOPEN_FAILED') {
          err.message = 'ERR_DLOPEN_FAILED'
        }
        this.log.warn('[BLE] %s %s.', platformLang.disableClient, parseError(err, [
          platformLang.bleNoPackage,
          platformLang.disabledInConfig,
          'ENODEV, No such device',
          'ERR_DLOPEN_FAILED',
        ]))
        this.bleClient = false
        Object.keys(this.deviceConf).forEach((id) => {
          delete this.deviceConf[id].customAddress
        })
      }

      // Config changed from milliseconds to seconds, so convert if needed
      this.config.bleControlInterval = this.config.bleControlInterval >= 500
        ? this.config.bleControlInterval / 1000
        : this.config.bleControlInterval

      this.queue = new PQueue({
        concurrency: 1,
        interval: this.config.bleControlInterval * 1000,
        intervalCap: 1,
        // Sized from the BLE stage timeouts so the two cannot drift apart. This
        // is a backstop for a hung task, and must stay longer than the stages
        // it wraps - see BLE_UPDATE_TIMEOUT.
        timeout: BLE_UPDATE_TIMEOUT,
        throwOnTimeout: true,
      })

      // Work out what to set up. Govee describes the same device through up to
      // three lists, and how they combine is decided away from here so it can
      // be tested rather than hoped about
      const plan = planDeviceSetup({
        httpDevices,
        lanDevices,
        openApiDevices,
        ignoredDevices: this.ignoredDevices,
        ignoreMatter: this.config.ignoreMatter,
        deviceConf: this.deviceConf,
      })

      plan.skippedGroups.forEach(name => this.log.debug('[%s] %s.', name, platformLang.devIsGroup))
      plan.devices.forEach(device => this.initialiseDevice(device))

      const {
        bleSyncNeeded,
        httpSyncNeeded,
        httpDevicesWereInitialised,
        openApiDevicesWereInitialised,
        lanDevicesWereInitialised,
      } = plan

      if (!plan.anyInitialised) {
        throw new Error(platformLang.noDevs)
      }

      // Let go of any cached accessory that no longer belongs. Removing one
      // destroys the HomeKit scenes and automations it is part of, so the rules
      // for this live next to their tests
      planRedundantAccessories({
        accessories: [...devicesInHB.values()],
        httpDevices,
        lanDevices,
        openApiDevices,
        ignoredDevices: this.ignoredDevices,
        ignoreMatter: this.config.ignoreMatter,
        cloudListsFetched: cloudListsWereFetched(this.config, this),
      }).forEach(accessory => this.removeAccessory(accessory))

      // Set up the ble client sync needed for thermo sensor devices
      if (bleSyncNeeded) {
        try {
          // Check BLE is available
          if (!this.bleClient) {
            throw new Error(platformLang.bleNoPackage)
          }

          this.log('[BLE] enabling sync for thermo sensor devices.')

          this.refreshBLEInterval = setInterval(async () => {
            try {
              await this.runPeriodicSync('BLE', () => this.goveeBLESync())
            } catch (err) {
              this.log.warn('[BLE] sync failed: %s', parseError(err))
            }
          }, this.config.bleRefreshTime * 1000)
        } catch (err) {
          this.log.warn('[BLE] %s %s.', platformLang.bleScanDisabled, parseError(err, [platformLang.bleNoPackage]))
        }
      }

      // Set up the http client sync needed for leak and thermo sensor devices
      if (this.httpClient && httpSyncNeeded) {
        this.setupHTTPSync()
      }

      if (this.openApiClient && (openApiDevicesWereInitialised || httpDevicesWereInitialised)) {
        const openApiRefresh = (this.config.openApiRefreshTime || this.config.httpRefreshTime) * 1000
        this.goveeOpenApiSync()
        this.refreshOpenApiInterval = setInterval(
          () => this.runPeriodicSync('OPENAPI', () => this.goveeOpenApiSync()),
          openApiRefresh,
        )

        // Connect to OpenAPI MQTT for real-time event push
        try {
          await this.openApiClient.connectMQTT()
        } catch (err) {
          this.log.warn('[OPENAPI MQTT] %s.', parseError(err))
        }
      }

      // Set up the AWS client sync if there are any compatible devices
      if (this.awsClient && awsDevices.length > 0) {
        // Set up the AWS client
        await this.awsClient.connect()

        // No need for await as catches its own errors, we poll specific models that need it
        this.goveeAWSSync(true)
        this.refreshAWSInterval = setInterval(
          () => this.runPeriodicSync('AWS', () => this.goveeAWSSync()),
          60000,
        )
      }

      // Set up the LAN client device scanning and device status polling
      if (lanDevicesWereInitialised) {
        this.lanClient.startDevicesPolling()
        this.lanClient.startStatusPolling()
      }

      // Access a list of scene codes from the HTTP client
      if (this.httpClient) {
        try {
          const scenes = await this.httpClient.getTapToRuns()

          // If the TTR token had to be refreshed (eg. it was missing or expired
          // in the cache), write the new one back so the next startup is fixed
          if (this.httpClient.tokenTTRRefreshed) {
            this.accountTokenTTR = this.httpClient.tokenTTR
            this.httpClient.tokenTTRRefreshed = false
            await this.persistAccountCache()
            this.log.debug('[HTTP] refreshed TTR token saved to cache.')
          }

          scenes.forEach((scene) => {
            if (scene.oneClicks) {
              scene.oneClicks.forEach((oneClick) => {
                if (oneClick.iotRules) {
                  oneClick.iotRules.forEach((iotRule) => {
                    if (iotRule?.deviceObj?.sku) {
                      if (platformConsts.models.rgb.includes(iotRule.deviceObj.sku)) {
                        iotRule.rule.forEach((rule) => {
                          this.log.debugWarn(`[%s] [%s] ttr rule debug: ${JSON.stringify(rule)}.`, iotRule.deviceObj.name, oneClick.name)
                          try {
                            if (rule.iotMsg) {
                              const iotMsg = JSON.parse(rule.iotMsg)
                              if (iotMsg.msg?.cmd === 'ptReal') {
                                this.log('[%s] [%s] [AWS] %s', iotRule.deviceObj.name, oneClick.name, iotMsg.msg.data.command.join(','))
                              }
                            }
                            if (rule.blueMsg) {
                              const bleMsg = JSON.parse(rule.blueMsg)
                              if (bleMsg.type === 'scene') {
                                this.log('[%s] [%s] [BLE] %s', iotRule.deviceObj.name, oneClick.name, bleMsg.modeCmd)
                              }
                            }
                          } catch {
                            // Ignore malformed rule messages
                          }
                        })
                      }
                    }
                  })
                }
              })
            }
          })
        } catch (err) {
          this.log.warn('%s %s.', 'Could not retrieve TTRs as', parseError(err))
        }
      } else {
        this.log.debug('Skipping TTR retrieval as HTTP client not available')
      }

      // Log connection summary
      this.logConnectionSummary()

      // Setup successful
      this.log('%s.', platformLang.complete)
    } catch (err) {
      // Catch any errors during setup
      this.log.warn('***** %s [v%s]. *****', platformLang.disabling, plugin.version)
      this.log.warn('***** %s. *****', parseError(err, [platformLang.noDevs]))
      this.pluginShutdown()
    }
  }

  logConnectionSummary() {
    const connections = []
    const realtime = []
    const polling = []

    if (this.lanClient) {
      connections.push('LAN')
    }
    if (this.awsClient) {
      connections.push('AWS')
    }
    if (this.openApiClient) {
      connections.push('OpenAPI')
    }
    if (this.bleClient) {
      connections.push('BLE')
    }

    if (connections.length === 0) {
      return
    }

    // Count devices per connection type
    let lanCount = 0
    let awsCount = 0
    let openApiCount = 0
    let bleCount = 0
    let openApiPollCount = 0

    devicesInHB.forEach((accessory) => {
      if (accessory.context.useLanControl) {
        lanCount++
      }
      if (accessory.context.useAwsControl) {
        awsCount++
      }
      if (accessory.context.useOpenApiControl) {
        openApiCount++
      }
      if (accessory.context.useBleControl) {
        bleCount++
      }
      // OpenAPI polling only for devices without AWS
      if (accessory.context.useOpenApiControl && !accessory.context.useAwsControl) {
        openApiPollCount++
      }
    })

    // Real-time channels
    if (this.awsClient) {
      realtime.push(`AWS IoT MQTT (${awsCount} device(s))`)
    }
    if (this.openApiClient?.mqttConnected) {
      realtime.push(`OpenAPI MQTT (${openApiCount} device(s))`)
    }
    if (this.lanClient && lanCount > 0) {
      realtime.push(`LAN UDP (${lanCount} device(s))`)
    }

    // Polling intervals
    if (this.refreshAWSInterval) {
      polling.push(`AWS every 60s (${awsCount} device(s))`)
    }
    if (this.refreshHTTPInterval) {
      polling.push(`HTTP every ${this.config.httpRefreshTime}s (sensors)`)
    }
    if (this.refreshBLEInterval) {
      polling.push(`BLE every ${this.config.bleRefreshTime}s (${bleCount} sensors)`)
    }
    if (this.refreshOpenApiInterval && openApiPollCount > 0) {
      const openApiRefresh = this.config.openApiRefreshTime || this.config.httpRefreshTime
      const dailyEstimate = Math.round((86400 / openApiRefresh) * openApiPollCount)
      polling.push(`OpenAPI every ${openApiRefresh}s (${openApiPollCount} devices without AWS) ~${dailyEstimate} req/day`)
    }

    this.log('---- Connection Summary ----')
    this.log('Configured: %s', connections.join(', '))
    this.log('Send priority: %s', connections.join(' > '))
    if (realtime.length > 0) {
      this.log('Incoming (real-time): %s', realtime.join(', '))
    }
    if (polling.length > 0) {
      this.log('Incoming (polling): %s', polling.join(', '))
    }
    this.log('----------------------------')
  }

  async persistAccountCache() {
    // Persist the account details to the cache for future startups, so we can
    // skip a full login. Kept in one place so the TTR self-heal path can also
    // re-save once it has refreshed the (separate, shorter-lived) TTR token.
    try {
      await this.storageData.setItem(
        'Govee_All_Devices_temp',
        `${this.accountTopic}:::${this.accountToken}:::${this.config.username}:::${this.accountId}:::${this.iotEndpoint}:::${this.iotPass}:::${this.accountTokenTTR}`,
      )
    } catch (err) {
      this.log.warn('[HTTP] %s %s.', platformLang.accTokenStoreErr, parseError(err))
    }
  }

  pluginShutdown() {
    // A function that is called when the plugin fails to load or Homebridge restarts
    try {
      // Stop the refresh intervals
      if (this.refreshBLEInterval) {
        clearInterval(this.refreshBLEInterval)
        this.log('[BLE] refresh interval stopped.')
      }
      if (this.refreshHTTPInterval) {
        clearInterval(this.refreshHTTPInterval)
        this.log('[HTTP] refresh interval stopped.')

        // No need to await this since it catches its own errors
        this.httpClient.logout()
        this.log('[HTTP] logged out from session.')
      }
      if (this.refreshOpenApiInterval) {
        clearInterval(this.refreshOpenApiInterval)
        this.log('[OPENAPI] refresh interval stopped.')
      }
      if (this.openApiClient?.disconnectMQTT) {
        this.openApiClient.disconnectMQTT()
        this.log('[OPENAPI MQTT] disconnected.')
      }
      if (this.refreshAWSInterval) {
        clearInterval(this.refreshAWSInterval)
        this.log('[AWS] refresh interval stopped.')
      }

      // Close the LAN client
      if (this.lanClient?.close) {
        this.lanClient.close()
        this.log('[LAN] client closed.')
      }

      // Stop BLE operations immediately if the BLE client is running
      if (this.bleClient) {
        this.bleClient.shutdown()
        this.log('[BLE] stopped all BLE operations.')
      }
    } catch (err) {
      this.log.error('***** %s. *****', parseError(err))
    }
  }

  applyAccessoryLogging(accessory) {
    // Debug lines always go to Homebridge's debug logger, which prints them only
    // when debug is on - so there is nothing to decide here. Working it out from
    // the process arguments instead is what lost debug logging entirely for
    // anyone running the plugin in a child bridge.
    accessory.logDebug = msg => this.log.debug('[%s] %s.', accessory.displayName, msg)
    accessory.logDebugWarn = accessory.logDebug

    if (this.config.disableDeviceLogging) {
      accessory.log = () => {}
      accessory.logWarn = () => {}
      return
    }

    accessory.log = msg => this.log('[%s] %s.', accessory.displayName, msg)
    accessory.logWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
  }

  initialiseDevice(device) {
    // Get the correct device type instance for the device
    try {
      const deviceConf = this.deviceConf[device.device.toUpperCase()] || {}
      const uuid = this.api.hap.uuid.generate(device.device)
      const cached = devicesInHB.get(uuid)

      // Which handler this device gets is decided by the dispatch table, so
      // adding a device type does not mean editing this file
      const route = resolveDeviceType(device, deviceConf, cached?.context)

      if (!route) {
        // Not in any supported model list, but it could be added to the plugin
        this.log.warn(
          '[%s] %s:\n%s',
          device.deviceName,
          platformLang.devMaySupp,
          JSON.stringify(device),
        )
        return
      }

      if (route.skip === 'needsTemperatureSource') {
        // Standing in for a heater or cooler needs a temperature from somewhere
        // else, and without one there is nothing to show
        this.log.warn('[%s] %s.', device.deviceName, platformLang.heaterSimNoSensor)
        if (cached) {
          this.removeAccessory(cached)
        }
        return
      }

      const devInstance = route.handler

      let accessory
      if (route.externalCategory) {
        // A television has to be published as its own accessory rather than as
        // a tile on the bridge, so any tile from a previous setting goes first
        if (cached) {
          this.removeAccessory(cached)
        }
        accessory = this.addExternalAccessory(device, route.externalCategory)
      } else {
        accessory = cached || this.addAccessory(device)
      }

      // Final check the accessory now exists in Homebridge
      if (!accessory) {
        throw new Error(platformLang.accNotFound)
      }

      // Set the logging level for this device
      this.applyAccessoryLogging(accessory)

      applyDeviceContext(this, accessory, device, deviceConf, {
        awsDevices,
        awsDevicesToPoll,
        doAWSPolling: route.awsPolling,
      })

      accessory.control = new devInstance(this, accessory)

      // Log the device initialisation
      this.log(
        '[%s] %s [%s] [%s].',
        accessory.displayName,
        platformLang.devInit,
        device.device,
        device.model,
      )

      // Update any changes to the accessory to the platform
      if (!accessory.context.isExternal) {
        this.api.updatePlatformAccessories([accessory])
      }
      devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      // Catch any errors during device initialisation
      this.log.warn('[%s] %s %s.', device.deviceName, platformLang.devNotInit, parseError(err, [
        platformLang.accNotFound,
      ]))
    }
  }

  /**
   * Run a periodic sync, skipping this run if the previous one is still going.
   *
   * The intervals fire on a timer regardless of how long a sync takes, and the
   * http request timeout and the default refresh interval are both thirty
   * seconds. A single slow response therefore guaranteed the next sync started
   * before the last had finished, and those stacked up - piling more requests
   * onto an endpoint that was already struggling (#1256).
   */
  async runPeriodicSync(name, sync) {
    if (this.syncsInFlight.has(name)) {
      this.log.debugWarn('[%s] %s', name, platformLang.syncStillRunning)
      return
    }
    this.syncsInFlight.add(name)
    try {
      await sync()
    } finally {
      this.syncsInFlight.delete(name)
    }
  }

  setupHTTPSync() {
    this.runPeriodicSync('HTTP', () => this.goveeHTTPSync())
    this.refreshHTTPInterval = setInterval(
      () => this.runPeriodicSync('HTTP', () => this.goveeHTTPSync()),
      this.config.httpRefreshTime * 1000,
    )
  }

  async goveeAWSSync(allDevices = false) {
    const pollList = allDevices ? awsDevices : awsDevicesToPoll
    if (pollList.length === 0) {
      return
    }
    try {
      for (const deviceId of pollList) {
        // Generate the UUID from which we can match our Homebridge accessory
        const accessory = devicesInHB.get(this.api.hap.uuid.generate(deviceId))
        try {
          await this.awsClient.requestUpdate(accessory)
        } catch (err) {
          accessory.logDebugWarn(`[LAN] ${platformLang.syncFail} ${parseError(err)}`)
        }
      }
    } catch (err) {
      this.log.warn('[LAN] %s %s.', platformLang.syncFail, parseError(err))
    }
  }

  async goveeBLESync() {
    try {
      // Check if BLE client is ready before attempting discovery
      if (!this.bleClient) {
        throw new Error('BLE client not initialized')
      }

      await this.bleClient.startDiscovery((goveeReading) => {
        try {
          const accessory = [...devicesInHB.values()].find(acc => acc.context.bleAddress === goveeReading.address)
          if (accessory && !platformConsts.models.sensorMonitor.includes(accessory.context.gvModel)) {
            this.receiveDeviceUpdate(accessory, {
              temperature: goveeReading.tempInC * 100,
              temperatureF: goveeReading.tempInF * 100,
              humidity: goveeReading.humidity * 100,
              battery: goveeReading.battery,
              source: 'BLE',
            })
          } else if (accessory) {
            // A monitor's readings arrive over its own connection, so there is
            // nothing to do with this one and nothing for the owner to act on
            accessory.logDebug(`[BLE] ${platformLang.bleScanUnknown}`)
          } else if (isFirstReport(`ble-reading|${goveeReading.address}`)) {
            // A sensor broadcasts every few seconds, so say this once per session
            // rather than on every advertisement. Only an address that belongs to
            // this account is worth a warning - anything else may be a neighbour's
            // device, which the owner cannot do anything about.
            const line = `[BLE] ${platformLang.bleScanUnknown} [${goveeReading.address}].`
            if (this.hasBleSensor(goveeReading.address)) {
              this.log.warn(line)
            } else {
              this.log.debug(line)
            }
          }
        } catch (err) {
          this.log.warn('[BLE] error processing reading: %s', parseError(err))
        }
      })

      // Stop scanning after 5 seconds
      setTimeout(async () => {
        try {
          await this.bleClient.stopDiscovery()
        } catch (err) {
          this.log.warn('[BLE] %s %s.', platformLang.bleScanNoStop, parseError(err))
        }
      }, 5000)
    } catch (err) {
      this.log.warn('[BLE] %s %s.', platformLang.bleScanNoStart, parseError(err))
    }
  }

  async goveeHTTPSync() {
    try {
      // Obtain a refreshed device list
      const devices = await this.httpClient.getDevices(true)

      // A stalled leak-warning request must not hold every water sensor behind
      // it. Queue only those cloud requests so thermometer and monitor updates
      // still arrive immediately, while a poll stays gentle on Govee's API.
      const leakWarningQueue = new PQueue({ concurrency: 2 })
      await Promise.all(devices
        .filter(device => [...platformConsts.models.sensorLeak, ...platformConsts.models.sensorThermo, ...platformConsts.models.sensorMonitor].includes(device.sku))
        .map(async (device1) => {
          try {
            // Reformat the device id
            if (!device1.device.includes(':')) {
              // Eg converts abcd1234abcd1234 to AB:CD:12:34:AB:CD:12:34
              // For sensors with an add-on sensor like H5178
              // Eg converts abcd1234abcd1234_1 to AB:CD:12:34:AB:CD:12:34_1
              device1.device = device1.device.replace(DEVICE_ID_FORMAT_REGEX, '$&:').toUpperCase()
            }

            // Generate the UIID from which we can match our Homebridge accessory
            const uiid = this.api.hap.uuid.generate(device1.device)

            // Don't continue if the accessory doesn't exist
            if (!devicesInHB.has(uiid)) {
              return
            }

            // Retrieve the Homebridge accessory
            const accessory = devicesInHB.get(uiid)

            // Make sure the data we need for the device exists
            if (!device1.deviceExt || !device1.deviceExt.deviceSettings || !device1.deviceExt.lastDeviceData) {
              return
            }

            // Parse the data received
            let parsedSettings
            let parsedData
            try {
              parsedSettings = JSON.parse(device1.deviceExt.deviceSettings)
              parsedData = JSON.parse(device1.deviceExt.lastDeviceData)
            } catch {
              return
            }

            const toReturn = { source: 'HTTP' }
            if (platformConsts.models.sensorLeak.includes(device1.sku)) {
              accessory.logDebug(`raw data: ${JSON.stringify({ ...parsedData, ...parsedSettings })}`)

              // Keep the gateway details up to date for matching real-time leak
              // events relayed by the gateway over AWS (#1276)
              if (hasProperty(parsedSettings, 'sno') && parsedSettings.gatewayInfo?.device) {
                accessory.context.gatewaySno = parsedSettings.sno
                accessory.context.gatewayDevice = parsedSettings.gatewayInfo.device
              }

              // Leak Sensors - check to see of any warnings if the lastTime is above 0
              let hasUnreadLeak = false
              if (parsedData.lastTime > 0) {
                // Obtain the leak warning messages for this device
                const msgs = await leakWarningQueue.add(
                  () => this.httpClient.getLeakDeviceWarning(device1.device, device1.sku),
                )

                accessory.logDebug(`raw messages: ${JSON.stringify(msgs)}`)

                // Check to see if unread messages exist
                const unreadCount = msgs.filter(msg => !msg.read && msg.message.toLowerCase().replace(WHITESPACE_REGEX, '').startsWith('leakagealert'))
                if (unreadCount.length > 0) {
                  hasUnreadLeak = true
                }
              }

              // Generate the params to return
              toReturn.battery = parsedSettings.battery
              toReturn.leakDetected = hasUnreadLeak
              toReturn.online = parsedData.gwonline && parsedData.online
            } else if (platformConsts.models.sensorThermo.includes(device1.sku)) {
              // Some accounts report `tem` in hundredths of a degree Fahrenheit
              // rather than Celsius, which lands in HomeKit as a reading roughly
              // 90 degrees too high (#1269). The unit is not stated anywhere in
              // the response, so log the raw payload to work out what
              // distinguishes those accounts before converting anything.
              accessory.logDebug(`[HTTP] raw sensor data: ${JSON.stringify(parsedData)}`)

              if (hasProperty(parsedSettings, 'battery')) {
                toReturn.battery = parsedSettings.battery
              }
              if (hasProperty(parsedData, 'tem')) {
                toReturn.temperature = parsedData.tem
              }
              if (hasProperty(parsedData, 'hum')) {
                toReturn.humidity = parsedData.hum
              }
              if (hasProperty(parsedData, 'online')) {
                toReturn.online = parsedData.online
              }
            } else if (platformConsts.models.sensorMonitor.includes(device1.sku)) {
              // The H5106 normally reports over AWS, but some accounts never
              // receive those messages, leaving the readings at zero (#1322).
              // The HTTP device list carries the same readings, so use it as a
              // second source. Every field is guarded and the raw payload is
              // logged, since the format for this model is not confirmed on
              // every account
              accessory.logDebug(`[HTTP] raw sensor data: ${JSON.stringify(parsedData)}`)

              if (hasProperty(parsedSettings, 'battery')) {
                toReturn.battery = parsedSettings.battery
              }
              if (hasProperty(parsedData, 'tem')) {
                toReturn.temperature = parsedData.tem
              }
              if (hasProperty(parsedData, 'hum')) {
                toReturn.humidity = parsedData.hum
              }
              if (hasProperty(parsedData, 'online')) {
                toReturn.online = parsedData.online
              }
            }

            // Send the information to the update receiver function
            this.receiveDeviceUpdate(accessory, toReturn)
          } catch (err) {
            this.log.warn('[%s] %s %s.', device1.deviceName, platformLang.devNotRef, parseError(err))
          }
        }))
    } catch (err) {
      this.log.warn('[HTTP] %s %s.', platformLang.syncFail, parseError(err))
    }
  }

  async goveeOpenApiSync() {
    try {
      for (const [, accessory] of devicesInHB) {
        // Only poll devices that have OpenAPI control enabled
        if (!accessory?.context?.useOpenApiControl) {
          continue
        }
        // Skip devices that have AWS — they already get real-time MQTT push + 60s polling
        if (accessory.context.useAwsControl) {
          continue
        }
        try {
          await this.openApiClient.requestUpdate(accessory)
        } catch (err) {
          accessory.logDebugWarn(`[OPENAPI] ${platformLang.syncFail} ${parseError(err)}`)
        }
      }
    } catch (err) {
      this.log.warn('[OPENAPI] %s %s.', platformLang.syncFail, parseError(err))
    }
  }

  addAccessory(device) {
    // Add an accessory to Homebridge
    try {
      const uuid = this.api.hap.uuid.generate(device.device)
      const accessory = new this.api.platformAccessory(device.deviceName, uuid)
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(this.api.hap.Characteristic.Name, device.deviceName)
        .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, device.deviceName)
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, platformLang.brand)
        .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.device)
        .setCharacteristic(this.api.hap.Characteristic.Model, device.model)
        .setCharacteristic(this.api.hap.Characteristic.Identify, true)
      accessory.context.gvDeviceId = device.device
      accessory.context.gvModel = device.model
      this.api.registerPlatformAccessories(plugin.name, plugin.alias, [accessory])
      this.configureAccessory(accessory)
      this.log('[%s] %s.', device.deviceName, platformLang.devAdd)
      return accessory
    } catch (err) {
      // Catch any errors during add
      this.log.warn('[%s] %s %s.', device.deviceName, platformLang.devNotAdd, parseError(err))
      return false
    }
  }

  addExternalAccessory(device, category) {
    try {
      // Add the new accessory to Homebridge
      const accessory = new this.api.platformAccessory(
        device.deviceName,
        this.api.hap.uuid.generate(device.device),
        category,
      )

      // Set the accessory characteristics
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .setCharacteristic(this.api.hap.Characteristic.Name, device.deviceName)
        .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, device.deviceName)
        .setCharacteristic(this.api.hap.Characteristic.Manufacturer, platformLang.brand)
        .setCharacteristic(this.api.hap.Characteristic.SerialNumber, device.device)
        .setCharacteristic(this.api.hap.Characteristic.Model, device.model)
        .setCharacteristic(this.api.hap.Characteristic.Identify, true)

      // Mark the accessory as external so it is never passed to
      // updatePlatformAccessories, since Homebridge 2 adds any accessory passed
      // there to its cached list, and an external accessory has no associated
      // platform so every cache save then fails to serialize it
      accessory.context.isExternal = true

      // Register the accessory
      this.api.publishExternalAccessories(plugin.name, [accessory])
      this.log('[%s] %s.', device.name, platformLang.devAdd)

      // Return the new accessory
      this.configureAccessory(accessory)
      return accessory
    } catch (err) {
      // Catch any errors during add
      this.log.warn('[%s] %s %s.', device.deviceName, platformLang.devNotAdd, parseError(err))
      return false
    }
  }

  /**
   * Whether a bluetooth address belongs to one of this account's sensors.
   *
   * An undecodable broadcast is only worth putting in front of someone when it
   * came from a sensor of theirs, because a sensor is the one kind of device
   * whose readings arrive this way and so the one kind the plugin is failing.
   * The two cases this deliberately leaves quiet:
   *
   * - a light or appliance of theirs, which also broadcasts constantly but is
   *   controlled over aws/lan/ble and has nothing to gain from being decoded
   * - an address that is not on this account at all, which may be a neighbour's
   *   device and is not something the owner can act on
   */
  hasBleSensor(address) {
    if (!address) {
      return false
    }
    const wanted = String(address).toLowerCase()
    // Any list named sensor* counts, so a new sensor type is covered on the day
    // it is added rather than needing this list updated too
    const sensorModels = Object.keys(platformConsts.models)
      .filter(key => key.startsWith('sensor'))
      .flatMap(key => platformConsts.models[key])
    return [...devicesInHB.values()].some(
      accessory => String(accessory.context.bleAddress || '').toLowerCase() === wanted
        && sensorModels.includes(accessory.context.gvModel),
    )
  }

  configureAccessory(accessory) {
    // Set the correct firmware version if we can
    if (this.api && accessory.context.firmware) {
      accessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .updateCharacteristic(
          this.api.hap.Characteristic.FirmwareRevision,
          accessory.context.firmware,
        )
    }

    // Add the configured accessory to our global map
    devicesInHB.set(accessory.UUID, accessory)
  }

  updateAccessoryStatus(accessory, newStatus) {
    // Log the change, at a warning level if the device is reported offline
    if (newStatus) {
      accessory.log(platformLang.onlineHTTP)
    } else {
      accessory.logWarn(platformLang.offlineHTTP)
    }

    // Update the context item for the plugin UI
    accessory.context.isOnline = newStatus ? 'yes' : 'no'

    // Update any changes to the accessory to the platform
    if (!accessory.context.isExternal) {
      this.api.updatePlatformAccessories([accessory])
    }
    devicesInHB.set(accessory.UUID, accessory)
  }

  removeAccessory(accessory) {
    // Remove an accessory from Homebridge
    try {
      this.api.unregisterPlatformAccessories(plugin.name, plugin.alias, [accessory])
      devicesInHB.delete(accessory.UUID)
      this.log('[%s] %s.', accessory.displayName, platformLang.devRemove)
    } catch (err) {
      // Catch any errors during remove
      this.log.warn('[%s] %s %s.', accessory.displayName, platformLang.devNotRemove, parseError(err))
    }
  }

  async sendDeviceUpdate(accessory, params) {
    const data = buildCommand(params, accessory.context)
    let attempted = false
    let lastError

    // *********************************** //
    // ********* CONNECTION: LAN ********* //
    // *********************************** //
    // Check to see if we have the option to use LAN.
    if (accessory.context.useLanControl && data.lanParams) {
      attempted = true
      try {
        await this.lanClient.updateDevice(accessory, data.lanParams)
        return true
      } catch (err) {
        lastError = err
        accessory.logWarn(`${platformLang.notLANSent} ${parseError(err, [platformLang.lanDevNotFound])}`)
      }
    }

    // *********************************** //
    // ********* CONNECTION: AWS ********* //
    // *********************************** //
    // Check to see if we have the option to use AWS
    if (accessory.context.useAwsControl && data.awsParams) {
      attempted = true
      try {
        await this.awsClient.updateDevice(accessory, data.awsParams)
        return true
      } catch (err) {
        lastError = err
        // Print the reason to the log if in debug mode, it's not always necessarily an error
        accessory.logWarn(`${platformLang.notAWSSent} ${parseError(err, [platformLang.notAWSConn])}`)
      }
    }

    // *************************************** //
    // ********* CONNECTION: OPENAPI ********* //
    // *************************************** //
    // Check to see if we have the option to use OpenAPI
    if (accessory.context.useOpenApiControl && data.openApiParams) {
      attempted = true
      try {
        await this.openApiClient.updateDevice(accessory, data.openApiParams)
        return true
      } catch (err) {
        lastError = err
        // A refusal Govee reported about the device itself ("Device is offline")
        // is a state to relay, not a fault to debug, so drop the stack line -
        // the same treatment the LAN and AWS branches already give their own
        // expected conditions.
        accessory.logWarn(`[OPENAPI] ${platformLang.devNotUpdated} ${parseError(err, err.deviceRefusal ? [err.message] : [])}`)
      }
    }

    // No BLE fallback for this command — surface any earlier failure so HAP reverts
    if (!data.bleParams) {
      if (attempted) {
        throw updateFailureError(lastError, platformLang.noConnMethod)
      }
      return true
    }

    // We use a queue for BLE connections for different reasons
    // BLE: We don't want to send multiple commands at once, as it can cause issues
    return this.queue.add(async () => {
      // *********************************** //
      // ********* CONNECTION: BLE ********* //
      // *********************************** //
      // Try bluetooth if enabled, and we have the option to use it
      if (accessory.context.useBleControl && data.bleParams) {
        try {
          // Send the command to the bluetooth client to send
          await this.bleClient.updateDevice(accessory, data.bleParams)
          return true
        } catch (err) {
          // Bluetooth didn't work or not enabled
          lastError = err
          accessory.logDebugWarn(`${platformLang.notBLESent} ${parseError(err)}`)
        }
      }

      // Every method available for this command has now been tried and failed.
      // Report the last real reason rather than "no connection method
      // available" - there WAS one, it was tried, and something specific went
      // wrong. Saying otherwise sends the user to the connection-method docs
      // when the answer was "the device is offline" (#1324).
      throw updateFailureError(lastError, platformLang.noConnMethod)
    })
  }

  receiveUpdateLAN(accessoryId, params, ipAddress) {
    devicesInHB.forEach((accessory) => {
      if (accessory.context.gvDeviceId === accessoryId) {
        let update = false

        // Is LAN enabled for this accessory already?
        if (!accessory.context.useLanControl) {
          accessory.context.hasLanControl = true
          accessory.context.useLanControl = true
          update = true
        }

        // If we have an IP address, update the IP address
        if (accessory.context.ipAddress !== ipAddress) {
          accessory.context.ipAddress = ipAddress
          if (accessory.log) {
            accessory.log(`[LAN] ${platformLang.curIP} [${ipAddress}]`)
          }
          update = true
        }

        if (update) {
          if (!accessory.context.isExternal) {
            this.api.updatePlatformAccessories([accessory])
          }
          devicesInHB.set(accessory.UUID, accessory)
        }

        if (Object.keys(params).length > 0) {
          this.receiveDeviceUpdate(accessory, {
            source: 'LAN',
            state: params, // matches the structure of the AWS payload
          })
        }
      }
    })
  }

  receiveUpdateOpenAPI(accessoryId, params) {
    devicesInHB.forEach((accessory) => {
      if (accessory.context.gvDeviceId === accessoryId) {
        this.receiveDeviceUpdate(accessory, {
          source: 'OPENAPI',
          state: params,
        })
      }
    })
  }

  receiveUpdateAWS(payload) {
    const accessoryUUID = this.api.hap.uuid.generate(payload.device)
    const accessory = devicesInHB.get(accessoryUUID)
    if (accessory) {
      this.receiveDeviceUpdate(accessory, {
        source: 'AWS',
        ...payload,
      })
      return
    }

    // No matching accessory - the message may be from a wifi gateway (e.g. H5044)
    // relaying an update for one of its subdevices, such as a leak sensor (#1276)
    this.receiveUpdateAWSGateway(payload)
  }

  receiveUpdateAWSGateway(payload) {
    (payload?.op?.command || []).forEach((command) => {
      let hexString
      try {
        hexString = base64ToHex(command)
      } catch {
        return
      }

      // 0xEE34 is a gateway subdevice record, laid out as:
      // ee 34 [subdevice number] 02 00 64 1e 14 [seq] [unix time x4] [leak flags x4] 80 00 [checksum]
      if (!hexString.startsWith('ee34') || hexString.length < 36) {
        return
      }

      // The gateway also sends batches of other ee34 records, e.g. during its
      // periodic sync, whose flag bytes are not live leak states (#1314), so
      // only accept the real-time status type (0x02) with a current timestamp
      if (hexString.substring(6, 8) !== '02') {
        this.log.debug('[AWS] %s [%s].', platformLang.gwRecordType, hexString)
        return
      }
      const recordTime = Number.parseInt(hexString.substring(18, 26), 16)
      if (Math.abs(Math.round(Date.now() / 1000) - recordTime) > 600) {
        this.log.debug('[AWS] %s [%s].', platformLang.gwRecordStale, hexString)
        return
      }

      const subdeviceNo = Number.parseInt(hexString.substring(4, 6), 16)
      const leakDetected = hexString.substring(26, 34) !== '00000000'

      // Match the update to the leak sensor with this gateway and slot number
      devicesInHB.forEach((accessory) => {
        if (
          accessory.context.gatewayDevice === payload.device
          && accessory.context.gatewaySno === subdeviceNo
          && platformConsts.models.sensorLeak.includes(accessory.context.gvModel)
        ) {
          this.receiveDeviceUpdate(accessory, { source: 'AWS', leakDetected })
        }
      })
    })
  }

  receiveDeviceUpdate(accessory, params) {
    if (!accessory?.control?.externalUpdate) {
      return
    }

    accessory.logDebug(`[${params.source}] ${platformLang.receivingUpdate} ${JSON.stringify(params)}`)

    const data = parseDeviceUpdate(params, accessory.context)

    // The payload above logs the device's own status codes as base64 buried in
    // a large JSON blob, which is unreadable when working out what a device can
    // do. Decode them so a code like `aa 36 01 01` can be spotted by eye, and
    // matched to the `33 36 01 01` needed to set it. Codes with no handler yet
    // are exactly the ones worth seeing, so log them all rather than guessing
    // which are already understood
    const statusCodes = (Array.isArray(data.commands) ? data.commands : [])
      .map((command) => {
        try {
          return base64ToHex(command)
        } catch {
          return ''
        }
      })
      .filter(hexString => hexString.startsWith('aa'))
      .map(hexString => hexString.replace(/../g, '$& ').trim())
    if (statusCodes.length > 0) {
      accessory.logDebug(`[${params.source}] ${platformLang.statusCodes}:\n  ${statusCodes.join('\n  ')}`)
    }

    // Log if kelvin was out of range before clamping
    if (data.kelvinOutOfRange) {
      accessory.logDebug(`govee provided a kelvin out of range [${params.state?.colorTemInKelvin}]`)
      delete data.kelvinOutOfRange
    }

    // Skip the reading if we can't tell whether govee sent celsius or fahrenheit
    if (data.temperatureUnitUnknown) {
      accessory.logDebugWarn(platformLang.openApiTempUnitUnknown)
      delete data.temperatureUnitUnknown
    }

    // Check if we actually parsed anything useful (more than just the source property)
    if (Object.keys(data).length > 1) {
      try {
        accessory.control.externalUpdate(data)
      } catch (err) {
        this.log.warn('[%s] %s %s.', accessory.displayName, platformLang.devNotUpdated, parseError(err))
      }
    } else {
      // Nothing in the payload was understood. This is the most useful thing a
      // user can send in when asking for a device or a function to be added, so
      // it is reported in full rather than hidden behind debug logging.
      logUnknownData(accessory, {
        kind: 'payload',
        source: params.source,
        raw: params,
      })
    }
  }
}
