import dgram from 'node:dgram'

import { parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

const commands = { scan: 'scan', deviceStatus: 'devStatus' }
const multicastIp = '239.255.255.250'
const scanCommandPort = 4001
const receiverPort = 4002
const devicePort = 4003
const getDevicesScanTimeoutMs = 2000

/*
This class handles LAN discovery and communication with Govee devices.

The documentation can be fount at https://app-h5.govee.com/user-manual/wlan-guide.

The connection is UDP based and uses multicast to discover devices on the network.
  - The discovery flow is as follows:
                                       ┌──────┐          ┌───────────┐
                                       │Client│          │GoveeDevice│
                                       └──┬───┘          └─────┬─────┘
                                          │    Request Scan    │
                                          │ ──────────────────>│
                                          │                    │ ╔═══════════════════════════════════════╗
                                          │                    │ ║Group address of 239.255.255.250:4001 ░║
                                          │                    │ ╚═══════════════════════════════════════╝
                                          │   Response Scan    │
                                          │ <─ ─ ─ ─ ─ ─ ─ ─ ─ │
                                          │                    │
    ╔════════════════════════════════════╗│                    │
    ║Response will be sent to port 4002 ░║│                    │
    ╚════════════════════════════════════╝┴───┐          ┌─────┴─────┐
                                       │Client│          │GoveeDevice│
                                       └──────┘          └───────────┘

    1. On devices that have `LAN control` turned on, the device will join the multicast address `239.255.255.250` and listen for information sent to port `4001` of the multicast.
    2. The client (sender) will send a scan request to that group address, on port 4001.
    3. Each Govee device will send to the server (receiver) on port `4002` a send response scan message.

    After the discovery process, we keep track of the devices found and keep polling for new devices every 5 seconds.

  - The communication flow is as follows:
                                       ┌──────┐                                     ┌───────────┐
                                       │Client│                                     │GoveeDevice│
                                       └──┬───┘                                     └─────┬─────┘
                                          │                Control Command                │
                                          │ ──────────────────────────────────────────────>
                                          │                                               │
                                          │                                               │  ╔════════════════════════╗
                                          │                                               │  ║Device IP on port 4003 ░║
                                          │                                               │  ╚════════════════════════╝
                                          │ Device Status (only for Device Status Command)│
                                          │ <─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
                                          │                                               │
    ╔════════════════════════════════════╗│                                               │
    ║Response will be sent to port 4002 ░║│                                               │
    ╚════════════════════════════════════╝┴───┐                                     ┌─────┴─────┐
                                       │Client│                                     │GoveeDevice│
                                       └──────┘                                     └───────────┘
   1. Once the IP of the device is known, we will send a control command to the device on port `4003`.
   2. The device will respond with the device status only if Device Status Command is sent on port `4002`.
*/
export default class {
  constructor(platform) {
    this.log = platform.log
    this.config = platform.config

    // Keeps track of all devices that are found on the network
    this.lanDevices = []

    // Expand any configured subnets (for devices on a different subnet than
    // Homebridge, which the multicast scan can't reach) into a flat list of
    // host IPs to scan directly. Capped so a wide mask can't flood the network.
    this.scanHosts = this.expandSubnets(this.config.lanScanSubnets)

    // Add any devices that have a custom IP address in the config
    Object.keys(platform.deviceConf).forEach((device) => {
      if (platform.deviceConf[device].customIPAddress) {
        this.lanDevices.push({
          ip: platform.deviceConf[device].customIPAddress,
          device,
          isPendingDiscovery: true,
          isManual: true,
        })
      }
    })

    // Create a UDP socket to listen for messages sent by Govee devices in a multicast group
    this.receiver = dgram.createSocket({ type: 'udp4', reuseAddr: true })

    // Create a UDP socket to send messages to Govee devices from host
    this.sender = dgram.createSocket('udp4')

    this.latestDeviceScanTimestamp = Date.now()

    this.connectionPromise = new Promise((resolve, reject) => {
      // Handle messages received
      this.receiver.on('message', (msg, rinfo) => {
        const strMessage = msg.toString()
        try {
          const message = JSON.parse(strMessage)
          if (!message?.msg?.cmd) {
            return
          }
          const command = message.msg.cmd

          switch (command) {
            case commands.scan: {
              // Handle scan responses sent by devices registered in the multicast group
              this.latestDeviceScanTimestamp = Date.now()
              const deviceData = message.msg.data

              // Some models (e.g. R16D0) omit the ip field from their scan response,
              // so fall back to the address the response actually came from (#1313)
              if (!deviceData.ip && rinfo?.address) {
                deviceData.ip = rinfo.address
              }

              const existingIndex = this.lanDevices.findIndex(value => value.device === deviceData.device)

              if (existingIndex === -1) {
                this.log.debug(
                  '[LAN] %s [isNew=true,isManual=false] [%s] [%s].',
                  platformLang.lanFoundDevice,
                  strMessage,
                  JSON.stringify(rinfo),
                )
                this.lanDevices.push(deviceData)

                platform.receiveUpdateLAN(deviceData.device, {}, deviceData.ip)
              } else if (this.lanDevices[existingIndex].isPendingDiscovery) {
                // This device was added in the constructor as a manual device
                // Now we have discovered this device, replace the manual info with the received info
                this.lanDevices[existingIndex] = {
                  ...deviceData,
                  isManual: true,
                }
                this.log.debug(
                  '[LAN] %s [isNew=true,isManual=true] [%s] [%s].',
                  platformLang.lanFoundDevice,
                  strMessage,
                  JSON.stringify(rinfo),
                )
                platform.receiveUpdateLAN(deviceData.device, {}, deviceData.ip)
              } else {
                this.log.debug(
                  '[LAN] %s [isNew=false] [%s] [%s].',
                  platformLang.lanFoundDevice,
                  strMessage,
                  JSON.stringify(rinfo),
                )
              }
              break
            }
            case commands.deviceStatus: {
              // Handle device status responses sent by devices
              const deviceAddress = rinfo.address

              const foundDeviceId = this.lanDevices.find(value => value.ip === deviceAddress)

              if (foundDeviceId) {
                // Send the update to the receiver function
                platform.receiveUpdateLAN(foundDeviceId.device, message.msg.data, deviceAddress)
              } else {
                this.log.warn('[LAN] %s [%s].', platformLang.lanUnkDevice, deviceAddress)
              }
              break
            }
            default:
              break
          }
        } catch (err) {
          this.log('[LAN] %s [%s] [%s].', platformLang.lanParseError, strMessage, parseError(err))
        }
      })

      // Handle errors
      this.receiver.on('error', (err) => {
        this.log.warn('[LAN] server error: %s.', parseError(err))
        reject(err)
      })

      // Handle errors on the sending socket. Without a listener here, node throws
      // the error object instead of emitting it, which takes the bridge down.
      this.sender.on('error', (err) => {
        this.log.warn('[LAN] client error: %s.', parseError(err))
      })

      // Handle started listening for messages
      this.receiver.on('listening', () => {
        const { address, port } = this.receiver.address()
        this.log.debug('[LAN] %s %s:%s.', platformLang.lanServerStarted, address, port)
        resolve()
      })

      this.receiver.bind(receiverPort, () => {
        this.receiver.addMembership(multicastIp, '0.0.0.0')
      })

      this.sender.bind()
    })
  }

  // Expand a comma-derived list of CIDR subnets into individual host IPs.
  // Returns an empty array when nothing is configured or a subnet is invalid.
  // The total is capped (a /24 is 254 hosts) so a wide mask can't flood.
  expandSubnets(subnets) {
    if (!Array.isArray(subnets) || subnets.length === 0) {
      return []
    }
    const maxHosts = 1024
    const hosts = []
    subnets.forEach((cidr) => {
      const [base, prefixStr] = cidr.split('/')
      const prefix = Number.parseInt(prefixStr, 10)
      const octets = base.split('.').map(o => Number.parseInt(o, 10))
      if (prefix < 8 || prefix > 32 || octets.some(o => Number.isNaN(o) || o < 0 || o > 255)) {
        this.log.warn('[LAN] ignoring invalid scan subnet [%s].', cidr)
        return
      }
      const baseInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
      const hostBits = 32 - prefix
      const size = 2 ** hostBits
      // Skip the network and broadcast addresses for a normal subnet
      const first = hostBits > 1 ? baseInt + 1 : baseInt
      const last = hostBits > 1 ? baseInt + size - 2 : baseInt + size - 1
      for (let ip = first; ip <= last && hosts.length < maxHosts; ip += 1) {
        hosts.push(`${(ip >>> 24) & 255}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`)
      }
    })
    if (hosts.length > 0) {
      this.log.debug('[LAN] will also scan %s host(s) across configured subnet(s).', hosts.length)
    }
    return hosts
  }

  // Send a request that asks for all devices in the multicast group
  sendScanCommand() {
    const scanCommand = JSON.stringify({ msg: { cmd: commands.scan, data: { account_topic: 'reserve' } } })
    this.log.debug('[LAN] scanning for devices over LAN...')
    this.sender.send(scanCommand, scanCommandPort, multicastIp, err => this.logScanSendError(multicastIp, err))

    // Also scan any configured subnets directly. Multicast doesn't cross
    // between subnets, so devices on a different subnet than Homebridge are
    // reached by sending the scan straight to each host (they reply on 4002).
    this.scanHosts.forEach((host) => {
      this.sender.send(scanCommand, scanCommandPort, host, err => this.logScanSendError(host, err))
    })
  }

  // A scan send can fail on a host with no route to the target, for example when
  // multicast is unavailable. Report it and carry on rather than letting dgram
  // emit an unhandled 'error' event, which would crash the bridge every scan.
  logScanSendError(target, err) {
    if (err) {
      this.log.debug('[LAN] scan request to %s failed [%s].', target, parseError(err))
    }
  }

  // Get all available LAN devices
  async getDevices() {
    return new Promise((resolve) => {
      this.connectionPromise.then(() => {
        this.sendScanCommand()

        // Since there is no list of devices to be gathered, we will send a scan request and wait until
        // there are no more devices announcing themselves in the multicast group.
        const checkPeriod = setInterval(() => {
          const diff = Date.now() - this.latestDeviceScanTimestamp
          if (diff >= getDevicesScanTimeoutMs) {
            clearInterval(checkPeriod)
            resolve(this.lanDevices)
          }
        }, 100)
      }, () => {
        resolve([])
      })
    })
  }

  // Send a request to a device to ask for its current state
  async sendDeviceStateRequest(device) {
    const stateCommand = JSON.stringify({ msg: { cmd: commands.deviceStatus, data: {} } })
    return new Promise((resolve, reject) => {
      this.sender.send(stateCommand, devicePort, device.ip, (err) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })
    })
  }

  // This is called by the platform on sending a device update via LAN
  async updateDevice(accessory, params) {
    const updatedParams = { msg: params }

    accessory.logDebug(`[LAN] ${platformLang.sendingUpdate} [${JSON.stringify(updatedParams)}]`)

    const foundDeviceId = this.lanDevices.findIndex(value => value.device === accessory.context.gvDeviceId)

    if (foundDeviceId === -1) {
      throw new Error(platformLang.lanDevNotFound)
    }

    const foundDevice = this.lanDevices[foundDeviceId]

    return new Promise((resolve, reject) => {
      const command = JSON.stringify(updatedParams)

      this.sender.send(command, devicePort, foundDevice.ip, async (err) => {
        if (err) {
          // We can assume the device is offline or not available anymore, so we will remove it from the devices list
          // We should only do this if it is not a device that the user has configured manually with an IP
          if (!foundDevice.isManual) {
            const currentIndex = this.lanDevices.findIndex(value => value.device === accessory.context.gvDeviceId)
            if (currentIndex !== -1) {
              this.lanDevices.splice(currentIndex, 1)
            }
            accessory.logDebugWarn(`[LAN] ${platformLang.lanDevRemoved}`)
          }
          reject(err)
        } else {
          accessory.logDebug(`[LAN] ${platformLang.lanCmdSent} ${foundDevice.ip}`)
          resolve()
        }
      })
    })
  }

  startDevicesPolling() {
    this.devicesPolling = setInterval(() => {
      this.sendScanCommand()
    }, this.config.lanScanInterval * 1000)
  }

  startStatusPolling() {
    this.statusPolling = setInterval(async () => {
      for (const device of this.lanDevices) {
        try {
          await this.sendDeviceStateRequest(device)
        } catch (err) {
          this.log.warn('[%s] [LAN] %s %s.', device.device, platformLang.lanReqError, parseError(err))
        }
      }
    }, this.config.lanRefreshTime * 1000)
  }

  close() {
    clearInterval(this.devicesPolling)
    clearInterval(this.statusPolling)
    this.receiver.close()
    this.sender.close()
  }
}
