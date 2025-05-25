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
import deviceTypes from './device/index.js'
import eveService from './fakegato/fakegato-history.js'
import { k2rgb } from './utils/colour.js'
import platformConsts from './utils/constants.js'
import platformChars from './utils/custom-chars.js'
import eveChars from './utils/eve-chars.js'
import {
  base64ToHex,
  hasProperty,
  parseDeviceId,
  parseError,
  pfxToCertAndKey,
} from './utils/functions.js'
import platformLang from './utils/lang-en.js'

const require = createRequire(import.meta.url)
const plugin = require('../package.json')

const devicesInHB = new Map()
const awsDevices = []
const awsDevicesToPoll = []
const httpDevices = []
const lanDevices = []

export default class {
  constructor(log, config, api) {
    if (!log || !api) {
      return
    }

    // Begin plugin initialisation
    try {
      this.api = api
      this.log = log
      this.isBeta = plugin.version.includes('beta')

      // Configuration objects for accessories
      this.deviceConf = {}
      this.ignoredDevices = []

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
      this.applyUserConfig(config)

      // Set up empty clients
      this.bleClient = false
      this.httpClient = false
      this.lanClient = false

      // Set up the Homebridge events
      this.api.on('didFinishLaunching', () => this.pluginSetup())
      this.api.on('shutdown', () => this.pluginShutdown())
    } catch (err) {
      // Catch any errors during initialisation
      log.warn('***** %s [v%s]. *****', platformLang.disabling, plugin.version)
      log.warn('***** %s. *****', parseError(err, [platformLang.hbVersionFail, platformLang.pluginNotConf]))
    }
  }

  applyUserConfig(config) {
    // These shorthand functions save line space during config parsing
    const logDefault = (k, def) => {
      this.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgDef, def)
    }
    const logDuplicate = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgDup)
    }
    const logIgnore = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgn)
    }
    const logIgnoreItem = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgnItem)
    }
    const logIncrease = (k, min) => {
      this.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgLow, min)
    }
    const logQuotes = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgQts)
    }
    const logRemove = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgRmv)
    }

    // Begin applying the user's config
    Object.entries(config).forEach((entry) => {
      const [key, val] = entry
      switch (key) {
        case 'bleControlInterval':
        case 'bleRefreshTime':
        case 'httpRefreshTime':
        case 'lanRefreshTime':
        case 'lanScanInterval': {
          if (typeof val === 'string') {
            logQuotes(key)
          }
          const intVal = Number.parseInt(val, 10)
          if (Number.isNaN(intVal)) {
            logDefault(key, platformConsts.defaultValues[key])
            this.config[key] = platformConsts.defaultValues[key]
          } else if (intVal < platformConsts.minValues[key]) {
            logIncrease(key, platformConsts.minValues[key])
            this.config[key] = platformConsts.minValues[key]
          } else {
            this.config[key] = intVal
          }
          break
        }
        case 'awsDisable':
        case 'bleDisable':
        case 'colourSafeMode':
        case 'disableDeviceLogging':
        case 'ignoreMatter':
        case 'lanDisable':
          if (typeof val === 'string') {
            logQuotes(key)
          }
          this.config[key] = val === 'false' ? false : !!val
          break
        case 'dehumidifierDevices':
        case 'fanDevices':
        case 'heaterDevices':
        case 'humidifierDevices':
        case 'iceMakerDevices':
        case 'kettleDevices':
        case 'leakDevices':
        case 'lightDevices':
        case 'purifierDevices':
        case 'diffuserDevices':
        case 'switchDevices':
        case 'thermoDevices':
          if (Array.isArray(val) && val.length > 0) {
            val.forEach((x) => {
              if (!x.deviceId) {
                logIgnoreItem(key)
                return
              }
              const id = parseDeviceId(x.deviceId)
              if (Object.keys(this.deviceConf).includes(id)) {
                logDuplicate(`${key}.${id}`)
                return
              }
              const entries = Object.entries(x)
              if (entries.length === 1) {
                logRemove(`${key}.${id}`)
                return
              }
              this.deviceConf[id] = {}
              entries.forEach((subEntry) => {
                const [k, v] = subEntry
                switch (k) {
                  case 'adaptiveLightingShift':
                  case 'brightnessStep':
                  case 'lowBattThreshold': {
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${k}`)
                    }
                    const intVal = Number.parseInt(v, 10)
                    if (Number.isNaN(intVal)) {
                      logDefault(`${key}.${id}.${k}`, platformConsts.defaultValues[k])
                      this.deviceConf[id][k] = platformConsts.defaultValues[k]
                    } else if (intVal < platformConsts.minValues[k]) {
                      logIncrease(`${key}.${id}.${k}`, platformConsts.minValues[k])
                      this.deviceConf[id][k] = platformConsts.minValues[k]
                    } else {
                      this.deviceConf[id][k] = intVal
                    }
                    break
                  }
                  case 'awsBrightnessNoScale':
                  case 'hideModeGreenTea':
                  case 'hideModeOolongTea':
                  case 'hideModeCoffee':
                  case 'hideModeBlackTea':
                  case 'showCustomMode1':
                  case 'showCustomMode2':
                  case 'showExtraSwitch':
                  case 'tempReporting':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    this.deviceConf[id][k] = v === 'false' ? false : !!v
                    break
                  case 'awsColourMode':
                  case 'showAs': {
                    if (typeof v !== 'string' || !platformConsts.allowed[k].includes(v)) {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.deviceConf[id][k] = v
                    }
                    break
                  }
                  case 'customAddress':
                  case 'customIPAddress':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.deviceConf[id][k] = v.replace(/\s+/g, '')
                    }
                    break
                  case 'deviceId':
                    break
                  case 'diyMode':
                  case 'diyModeTwo':
                  case 'diyModeThree':
                  case 'diyModeFour':
                  case 'musicMode':
                  case 'musicModeTwo':
                  case 'scene':
                  case 'sceneTwo':
                  case 'sceneThree':
                  case 'sceneFour':
                  case 'segmented':
                  case 'segmentedTwo':
                  case 'segmentedThree':
                  case 'segmentedFour':
                  case 'temperatureSource':
                  case 'videoMode':
                  case 'videoModeTwo': {
                    if (typeof v === 'string') {
                      this.log.warn(`${key}.${id}.${k} incorrectly configured - please use the config screen to reconfigure this item:`)
                      this.log.warn(`${key}.${id}.${k}: ${v}`)
                    }
                    if (typeof v === 'object') {
                      // object - only allowed keys are 'sceneCode', 'bleCode' and 'showAs'
                      const subEntries = Object.entries(v)
                      if (subEntries.length > 0) {
                        this.deviceConf[id][k] = {}
                        subEntries.forEach((subSubEntry) => {
                          const [k1, v1] = subSubEntry
                          switch (k1) {
                            case 'bleCode':
                            case 'sceneCode':
                              if (typeof v1 !== 'string' || v1 === '') {
                                logIgnore(`${key}.${id}.${k}.${k1}`)
                              } else {
                                this.deviceConf[id][k][k1] = v1
                              }
                              break
                            case 'showAs': {
                              if (typeof v1 !== 'string' || !['default', 'switch'].includes(v1)) {
                                logIgnore(`${key}.${id}.${k}.${k1}`)
                              } else {
                                this.deviceConf[id][k][k1] = v1
                              }
                              break
                            }
                            default:
                              logIgnore(`${key}.${id}.${k}.${k1}`)
                              break
                          }
                        })
                      } else {
                        logIgnore(`${key}.${id}.${k}`)
                      }
                    } else {
                      logIgnore(`${key}.${id}.${k}`)
                    }
                    break
                  }
                  case 'ignoreDevice':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${id}.${k}`)
                    }
                    if (!!v && v !== 'false') {
                      this.ignoredDevices.push(id)
                    }
                    break
                  case 'label':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`)
                    } else {
                      this.deviceConf[id][k] = v
                    }
                    break
                  default:
                    logRemove(`${key}.${id}.${k}`)
                }
              })
            })
          } else {
            logIgnore(key)
          }
          break
        case 'name':
        case 'platform':
          break
        case 'password':
        case 'username':
          if (typeof val !== 'string' || val === '') {
            logIgnore(key)
          } else {
            this.config[key] = val
          }
          break
        default:
          logRemove(key)
          break
      }
    })
  }

  async pluginSetup() {
    // Plugin has finished initialising so now onto setup
    try {
      // Log that the plugin initialisation has been successful
      this.log('%s.', platformLang.initialised)

      // Sort out some logging functions
      if (this.isBeta) {
        this.log.debug = this.log
        this.log.debugWarn = this.log.warn

        // Log that using a beta will generate a lot of debug logs
        if (this.isBeta) {
          const divide = '*'.repeat(platformLang.beta.length + 1) // don't forget the full stop (+1!)
          this.log.warn(divide)
          this.log.warn(`${platformLang.beta}.`)
          this.log.warn(divide)
        }
      } else {
        this.log.debug = () => {}
        this.log.debugWarn = () => {}
      }

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
          const accountToken = data.token
          const accountTokenTTR = data.tokenTTR
          this.clientId = data.client
          this.iotEndpoint = data.endpoint
          this.iotPass = data.iotPass

          // Save this to a file
          await promises.writeFile(iotFile, Buffer.from(data.iot, 'base64'))

          // Try and save these to the cache for future reference
          try {
            await this.storageData.setItem(
              'Govee_All_Devices_temp',
              `${this.accountTopic}:::${accountToken}:::${this.config.username}:::${this.accountId}:::${this.iotEndpoint}:::${this.iotPass}:::${accountTokenTTR}`,
            )
          } catch (e) {
            this.log.warn('[HTTP] %s %s.', platformLang.accTokenStoreErr, parseError(e))
          }
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
        const { default: bleClient } = await import('./connection/ble.js')
        this.bleClient = new bleClient(this)
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
        timeout: 10000,
        throwOnTimeout: true,
      })

      // Initialise the devices
      let bleSyncNeeded = false
      let httpSyncNeeded = false
      let lanDevicesWereInitialised = false
      let httpDevicesWereInitialised = false

      if (httpDevices && httpDevices.length > 0) {
        // We have some devices from HTTP client
        httpDevices.forEach((httpDevice) => {
          // Format device id
          if (!httpDevice.device.includes(':')) {
            // Eg converts abcd1234abcd1234 to AB:CD:12:34:AB:CD:12:34
            // For sensors with an add-on sensor like H5178
            // Eg converts abcd1234abcd1234_1 to AB:CD:12:34:AB:CD:12:34_1
            httpDevice.device = httpDevice.device.replace(/([a-z0-9]{2})(?=[a-z0-9])/gi, '$&:').toUpperCase()
          }

          // Check it's not a user-ignored device
          if (this.ignoredDevices.includes(httpDevice.device)) {
            return
          }

          // Check it's not a matter-ignored device, if the config has been set
          if (platformConsts.matterModels.includes(httpDevice.sku) && this.config.ignoreMatter) {
            return
          }

          // Sets the flag to see if we need to set up the BLE/HTTP syncs
          if (platformConsts.models.sensorLeak.includes(httpDevice.sku)) {
            httpSyncNeeded = true
          }
          if (platformConsts.models.sensorThermo.includes(httpDevice.sku)) {
            bleSyncNeeded = true
            httpSyncNeeded = true
          }

          // Find any matching device from the LAN client
          const lanDevice = lanDevices.find(el => el.device === httpDevice.device)

          if (lanDevice) {
            // Device exists in LAN data so add the http info to the object and initialise
            this.initialiseDevice({
              ...lanDevice,
              httpInfo: httpDevice,
              model: httpDevice.sku,
              deviceName: httpDevice.deviceName,
              isLanDevice: true,
            })
            lanDevicesWereInitialised = true
            lanDevice.initialised = true
          } else {
            // Device doesn't exist in LAN data, but try to initialise as could be other device type
            this.initialiseDevice({
              device: httpDevice.device,
              deviceName: httpDevice.deviceName,
              model: httpDevice.sku,
              httpInfo: httpDevice,
            })
          }
          httpDevicesWereInitialised = true
        })
      }

      // Some LAN devices may exist outside the HTTP client
      const pendingLANDevices = lanDevices.filter(el => !el.initialised)
      if (pendingLANDevices.length > 0) {
        // No devices from HTTP client, but LAN devices exist
        pendingLANDevices.forEach((lanDevice) => {
          // Check it's not a user-ignored device
          if (this.ignoredDevices.includes(lanDevice.device)) {
            return
          }

          // Initialise the device into Homebridge
          // Since LAN does not provide a name, we will use the configured label or device id
          this.initialiseDevice({
            device: lanDevice.device,
            deviceName: this.deviceConf?.[lanDevice.device]?.label || lanDevice.device.replaceAll(':', ''),
            model: lanDevice.sku || 'HXXXX', // In case the model is not provided
            isLanDevice: true,
            isLanOnly: true,
          })
          lanDevicesWereInitialised = true
        })
      }

      if (!lanDevicesWereInitialised && !httpDevicesWereInitialised) {
        // No devices either from HTTP client nor LAN client
        throw new Error(platformLang.noDevs)
      }

      // Check for redundant Homebridge accessories
      devicesInHB.forEach((accessory) => {
        // If the accessory doesn't exist in Govee then remove it
        if (
          (!httpDevices.some(el => el.device === accessory.context.gvDeviceId) && !lanDevices.some(el => el.device === accessory.context.gvDeviceId))
          || this.ignoredDevices.includes(accessory.context.gvDeviceId)
        ) {
          this.removeAccessory(accessory)
        }
      })

      // Set up the ble client sync needed for thermo sensor devices
      if (bleSyncNeeded) {
        try {
          // Check BLE is available
          if (!this.bleClient) {
            throw new Error(platformLang.bleNoPackage)
          }
          // Import the required modules
          const {
            debug: GoveeDebug,
            startDiscovery: sensorStartDiscovery,
            stopDiscovery: sensorStopDiscovery,
          } = await import('./govee-bt-client/index.js')

          if (this.isBeta) {
            GoveeDebug(true)
          }

          this.sensorStartDiscovery = sensorStartDiscovery
          this.sensorStopDiscovery = sensorStopDiscovery

          this.refreshBLEInterval = setInterval(
            () => this.goveeBLESync(),
            this.config.bleRefreshTime * 1000,
          )
        } catch (err) {
          this.log.warn('[BLE] %s %s.', platformLang.bleScanDisabled, parseError(err, [platformLang.bleNoPackage]))
        }
      }

      // Set up the http client sync needed for leak and thermo sensor devices
      if (this.httpClient && httpSyncNeeded) {
        this.goveeHTTPSync()
        this.refreshHTTPInterval = setInterval(
          () => this.goveeHTTPSync(),
          this.config.httpRefreshTime * 1000,
        )
      }

      // Set up the AWS client sync if there are any compatible devices
      if (this.awsClient && awsDevices.length > 0) {
        // Set up the AWS client
        await this.awsClient.connect()

        // No need for await as catches its own errors, we poll specific models that need it
        this.goveeAWSSync(true)
        this.refreshAWSInterval = setInterval(
          () => this.goveeAWSSync(),
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
          scenes.forEach((scene) => {
            if (scene.oneClicks) {
              scene.oneClicks.forEach((oneClick) => {
                if (oneClick.iotRules) {
                  oneClick.iotRules.forEach((iotRule) => {
                    if (iotRule?.deviceObj?.sku) {
                      if (platformConsts.models.rgb.includes(iotRule.deviceObj.sku)) {
                        iotRule.rule.forEach((rule) => {
                          this.log.debugWarn(`[%s] [%s] ttr rule debug: ${JSON.stringify(rule)}.`, iotRule.deviceObj.name, oneClick.name)
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

      // Setup successful
      this.log('%s. %s', platformLang.complete, platformLang.welcome)
    } catch (err) {
      // Catch any errors during setup
      this.log.warn('***** %s [v%s]. *****', platformLang.disabling, plugin.version)
      this.log.warn('***** %s. *****', parseError(err, [platformLang.noDevs]))
      this.pluginShutdown()
    }
  }

  pluginShutdown() {
    // A function that is called when the plugin fails to load or Homebridge restarts
    try {
      // Stop the refresh intervals
      if (this.refreshBLEInterval) {
        clearInterval(this.refreshBLEInterval)
      }
      if (this.refreshHTTPInterval) {
        clearInterval(this.refreshHTTPInterval)

        // No need to await this since it catches its own errors
        this.httpClient.logout()
      }
      if (this.refreshAWSInterval) {
        clearInterval(this.refreshAWSInterval)
      }

      // Close the LAN client
      this.lanClient.close()
    } catch (err) {
      // No need to show errors at this point
      this.log.error('***** %s. *****', parseError(err))
    }
  }

  applyAccessoryLogging(accessory) {
    if (this.isBeta) {
      accessory.log = msg => this.log('[%s] %s.', accessory.displayName, msg)
      accessory.logWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
      accessory.logDebug = msg => this.log('[%s] %s.', accessory.displayName, msg)
      accessory.logDebugWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
    } else {
      if (this.config.disableDeviceLogging) {
        accessory.log = () => {}
        accessory.logWarn = () => {}
      } else {
        accessory.log = msg => this.log('[%s] %s.', accessory.displayName, msg)
        accessory.logWarn = msg => this.log.warn('[%s] %s.', accessory.displayName, msg)
      }
      accessory.logDebug = () => {}
      accessory.logDebugWarn = () => {}
    }
  }

  initialiseDevice(device) {
    // Get the correct device type instance for the device
    try {
      const deviceConf = this.deviceConf[device.device.toUpperCase()] || {}
      const uuid = this.api.hap.uuid.generate(device.device)
      let accessory
      let devInstance
      let doAWSPolling = false
      if (platformConsts.models.rgb.includes(device.model)) {
        // Device is an LED strip/bulb
        devInstance = deviceConf.showAs === 'switch'
          ? deviceTypes.deviceLightSwitch
          : deviceTypes.deviceLight
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.switchSingle.includes(device.model)) {
        // Device is a cloud enabled Wi-Fi switch
        switch (deviceConf.showAs || platformConsts.defaultValues.showAs) {
          case 'audio': {
            if (devicesInHB.get(uuid)) {
              this.removeAccessory(devicesInHB.get(uuid))
            }
            devInstance = deviceTypes.deviceTVSingle
            accessory = this.addExternalAccessory(device, 34)
            break
          }
          case 'box': {
            if (devicesInHB.get(uuid)) {
              this.removeAccessory(devicesInHB.get(uuid))
            }
            devInstance = deviceTypes.deviceTVSingle
            accessory = this.addExternalAccessory(device, 35)
            break
          }
          case 'stick': {
            if (devicesInHB.get(uuid)) {
              this.removeAccessory(devicesInHB.get(uuid))
            }
            devInstance = deviceTypes.deviceTVSingle
            accessory = this.addExternalAccessory(device, 36)
            break
          }
          case 'cooler': {
            if (!deviceConf.temperatureSource) {
              this.log.warn('[%s] %s.', device.deviceName, platformLang.heaterSimNoSensor)
              if (devicesInHB.has(uuid)) {
                this.removeAccessory(devicesInHB.get(uuid))
              }
              return
            }
            devInstance = deviceTypes.deviceCoolerSingle
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
          case 'heater': {
            if (!deviceConf.temperatureSource) {
              this.log.warn('[%s] %s.', device.deviceName, platformLang.heaterSimNoSensor)
              if (devicesInHB.has(uuid)) {
                this.removeAccessory(devicesInHB.get(uuid))
              }
              return
            }
            devInstance = deviceTypes.deviceHeater2Single
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
          case 'purifier': {
            devInstance = deviceTypes.devicePurifierSingle
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
          case 'switch': {
            devInstance = deviceTypes.deviceSwitchSingle
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
          case 'tap': {
            devInstance = deviceTypes.deviceTapSingle
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
          case 'valve': {
            devInstance = deviceTypes.deviceValveSingle
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
          default:
            devInstance = deviceTypes.deviceOutletSingle
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
        }
      } else if (platformConsts.models.switchDouble.includes(device.model)) {
        // Device is an AWS enabled Wi-Fi double switch
        switch (deviceConf.showAs || platformConsts.defaultValues.showAs) {
          case 'switch': {
            devInstance = deviceTypes.deviceSwitchDouble
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
          default: {
            devInstance = deviceTypes.deviceOutletDouble
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
        }
      } else if (platformConsts.models.switchTriple.includes(device.model)) {
        // Device is an AWS enabled Wi-Fi double switch
        switch (deviceConf.showAs || platformConsts.defaultValues.showAs) {
          case 'switch': {
            devInstance = deviceTypes.deviceSwitchTriple
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
          default: {
            devInstance = deviceTypes.deviceOutletTriple
            accessory = devicesInHB.get(uuid) || this.addAccessory(device)
            break
          }
        }
      } else if (platformConsts.models.sensorLeak.includes(device.model)) {
        // Device is a leak sensor
        devInstance = deviceTypes.deviceSensorLeak
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.sensorPresence.includes(device.model)) {
        // Device is a presence sensor
        devInstance = deviceTypes.deviceSensorPresence
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.sensorThermo.includes(device.model)) {
        // Device is a thermo-hygrometer sensor
        devInstance = deviceConf.showExtraSwitch
          ? deviceTypes.deviceSensorThermoSwitch
          : deviceTypes.deviceSensorThermo
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.sensorThermo4.includes(device.model)) {
        // Device is a thermo-hygrometer sensor with 4 prongs and AWS support
        devInstance = deviceTypes.deviceSensorThermo4
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.sensorMonitor.includes(device.model)) {
        devInstance = deviceTypes.deviceSensorMonitor
        doAWSPolling = true
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.fan.includes(device.model)) {
        // Device is a fan
        devInstance = deviceTypes[`deviceFan${device.model}`]
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.heater1.includes(device.model)) {
        // Device is a H7130
        devInstance = deviceConf.tempReporting
          ? deviceTypes.deviceHeater1B
          : deviceTypes.deviceHeater1A
        doAWSPolling = true
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.heater2.includes(device.model)) {
        // Device is a H7131/H7132
        devInstance = deviceTypes.deviceHeater2
        doAWSPolling = true
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.humidifier.includes(device.model)) {
        // Device is a humidifier
        doAWSPolling = true
        devInstance = deviceTypes[`deviceHumidifier${device.model}`]
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.dehumidifier.includes(device.model)) {
        // Device is a dehumidifier
        devInstance = deviceTypes[`deviceDehumidifier${device.model}`]
        doAWSPolling = true
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.purifier.includes(device.model)) {
        // Device is a purifier
        devInstance = deviceTypes[`devicePurifier${device.model}`]
        doAWSPolling = true
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.diffuser.includes(device.model)) {
        // Device is a diffuser
        devInstance = deviceTypes[`deviceDiffuser${device.model}`]
        doAWSPolling = true
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.sensorButton.includes(device.model)) {
        // Device is a button
        devInstance = deviceTypes.deviceSensorButton
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.sensorContact.includes(device.model)) {
        // Device is a contact sensor
        devInstance = deviceTypes.deviceSensorContact
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.kettle.includes(device.model)) {
        // Device is a kettle
        devInstance = deviceTypes.deviceKettle
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.iceMaker.includes(device.model)) {
        // Device is an ice maker
        devInstance = deviceTypes[`deviceIceMaker${device.model}`]
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else if (platformConsts.models.template.includes(device.model)) {
        // Device is a work-in-progress
        devInstance = deviceTypes.deviceTemplate
        accessory = devicesInHB.get(uuid) || this.addAccessory(device)
      } else {
        // Device is not in any supported model list but could be implemented into the plugin
        this.log.warn(
          '[%s] %s:\n%s',
          device.deviceName,
          platformLang.devMaySupp,
          JSON.stringify(device),
        )
        return
      }

      // Final check the accessory now exists in Homebridge
      if (!accessory) {
        throw new Error(platformLang.accNotFound)
      }

      // Set the logging level for this device
      this.applyAccessoryLogging(accessory)

      // Add the temperatureSource config to the context if exists
      if (deviceConf.temperatureSource) {
        accessory.context.temperatureSource = deviceConf.temperatureSource
      }

      // Get a supported command list if provided, with their options
      if (device.supportCmds && Array.isArray(device.supportCmds)) {
        accessory.context.supportedCmds = device.supportCmds
        accessory.context.supportedCmdsOpts = {}

        device.supportCmds.forEach((cmd) => {
          if (device?.properties?.[cmd]) {
            accessory.context.supportedCmdsOpts[cmd] = device.properties[cmd]
          }
        })
      }

      // Add some initial context information which is changed later
      accessory.context.hasAwsControl = false
      accessory.context.useAwsControl = false
      accessory.context.hasBleControl = false
      accessory.context.useBleControl = false
      accessory.context.hasLanControl = device.isLanDevice
      accessory.context.useLanControl = accessory.context.hasLanControl
      accessory.context.firmware = false
      accessory.context.hardware = false
      accessory.context.image = false

      // Overrides for when a custom IP is provided, for a light which is not BLE only
      if (
        deviceConf.customIPAddress
        && accessory.context.hasLanControl
        && accessory.context.hasAwsControl
        && platformConsts.models.rgb.includes(device.model)
      ) {
        accessory.context.hasLanControl = true
        accessory.context.useLanControl = true
      }

      // If the device is LAN-only, then sync the display name with the label in the configuration
      if (device.isLanOnly) {
        accessory.displayName = device.deviceName
      }

      // See if we have extra HTTP client info for this device
      if (device.httpInfo) {
        // Save the hardware and firmware versions
        accessory.context.firmware = device.httpInfo.versionSoft
        accessory.context.hardware = device.httpInfo.versionHard

        // It's possible to show a nice little icon of the device in the Homebridge UI
        if (device.httpInfo.deviceExt && device.httpInfo.deviceExt.extResources) {
          const parsed = JSON.parse(device.httpInfo.deviceExt.extResources)
          if (parsed && parsed.skuUrl) {
            accessory.context.image = parsed.skuUrl
          }
        }

        // HTTP info lets us see if AWS/BLE connection methods are available
        if (device.httpInfo.deviceExt && device.httpInfo.deviceExt.deviceSettings) {
          const parsed = JSON.parse(device.httpInfo.deviceExt.deviceSettings)

          // Check to see if AWS is possible
          if (parsed) {
            if (parsed.topic) {
              accessory.context.hasAwsControl = true
              accessory.context.awsTopic = parsed.topic

              if (this.awsClient) {
                accessory.context.useAwsControl = true
                accessory.context.awsBrightnessNoScale = deviceConf.awsBrightnessNoScale
                accessory.context.awsColourMode = deviceConf.awsColourMode || platformConsts.defaultValues.awsColourMode
                awsDevices.push(device.device)

                // Certain models need AWS polling
                if (doAWSPolling) {
                  awsDevicesToPoll.push(device.device)
                }
              }
            }

            // Check to see if BLE is possible
            if (parsed.bleName) {
              const providedBle = parsed.address ? parsed.address.toLowerCase() : device.device.substring(6).toLowerCase()
              accessory.context.hasBleControl = !!parsed.bleName
              accessory.context.bleAddress = deviceConf.customAddress
                ? deviceConf.customAddress.toLowerCase()
                : providedBle
              accessory.context.bleName = parsed.bleName
              if (this.bleClient) {
                accessory.context.useBleControl = true
              }
            }

            // Get a min and max temperature/humidity range to show in the homebridge-ui
            if (hasProperty(parsed, 'temCali')) {
              accessory.context.minTemp = parsed.temMin / 100
              accessory.context.maxTemp = parsed.temMax / 100
              accessory.context.offTemp = parsed.temCali
            }
            if (hasProperty(parsed, 'humCali')) {
              accessory.context.minHumi = parsed.humMin / 100
              accessory.context.maxHumi = parsed.humMax / 100
              accessory.context.offHumi = parsed.humCali
            }
          }
        }
      }

      // Create the instance for this device type
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
      this.api.updatePlatformAccessories([accessory])
      devicesInHB.set(accessory.UUID, accessory)
    } catch (err) {
      // Catch any errors during device initialisation
      this.log.warn('[%s] %s %s.', device.deviceName, platformLang.devNotInit, parseError(err, [
        platformLang.accNotFound,
      ]))
    }
  }

  async goveeAWSSync(allDevices = false) {
    const pollList = allDevices ? awsDevices : awsDevicesToPoll
    if (pollList.length === 0) {
      return
    }
    try {
      pollList.forEach(async (deviceId) => {
        // Generate the UUID from which we can match our Homebridge accessory
        const accessory = devicesInHB.get(this.api.hap.uuid.generate(deviceId))
        try {
          await this.awsClient.requestUpdate(accessory)
        } catch (err) {
          accessory.logDebugWarn(`[LAN] ${platformLang.syncFail} ${parseError(err)}`)
        }
      })
    } catch (err) {
      this.log.warn('[LAN] %s %s.', platformLang.syncFail, parseError(err))
    }
  }

  async goveeBLESync() {
    try {
      await this.sensorStartDiscovery((goveeReading) => {
        const accessory = [...devicesInHB.values()].find(acc => acc.context.bleAddress === goveeReading.address)
        if (accessory && !platformConsts.models.sensorMonitor.includes(accessory.context.gvModel)) {
          this.receiveDeviceUpdate(accessory, {
            temperature: goveeReading.tempInC * 100,
            temperatureF: goveeReading.tempInF * 100,
            humidity: goveeReading.humidity * 100,
            battery: goveeReading.battery,
            source: 'BLE',
          })
        } else {
          this.log.debugWarn('[BLE] %s [%s].', platformLang.bleScanUnknown, goveeReading.address)
        }
      })

      // Stop scanning after 5 seconds
      setTimeout(async () => {
        try {
          await this.sensorStopDiscovery()
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

      // Filter those which are leak sensors
      for (const device1 of devices
        .filter(device => [...platformConsts.models.sensorLeak, ...platformConsts.models.sensorThermo].includes(device.sku))) {
        try {
          // Reformat the device id
          if (!device1.device.includes(':')) {
            // Eg converts abcd1234abcd1234 to AB:CD:12:34:AB:CD:12:34
            // For sensors with an add-on sensor like H5178
            // Eg converts abcd1234abcd1234_1 to AB:CD:12:34:AB:CD:12:34_1
            device1.device = device1.device.replace(/([a-z0-9]{2})(?=[a-z0-9])/gi, '$&:').toUpperCase()
          }

          // Generate the UIID from which we can match our Homebridge accessory
          const uiid = this.api.hap.uuid.generate(device1.device)

          // Don't continue if the accessory doesn't exist
          if (!devicesInHB.has(uiid)) {
            continue
          }

          // Retrieve the Homebridge accessory
          const accessory = devicesInHB.get(uiid)

          // Make sure the data we need for the device exists
          if (!device1.deviceExt || !device1.deviceExt.deviceSettings || !device1.deviceExt.lastDeviceData) {
            continue
          }

          // Parse the data received
          const parsedSettings = JSON.parse(device1.deviceExt.deviceSettings)
          const parsedData = JSON.parse(device1.deviceExt.lastDeviceData)

          const toReturn = { source: 'HTTP' }
          if (platformConsts.models.sensorLeak.includes(device1.sku)) {
            accessory.logDebug(`raw data: ${JSON.stringify({ ...parsedData, ...parsedSettings })}`)

            // Leak Sensors - check to see of any warnings if the lastTime is above 0
            let hasUnreadLeak = false
            if (parsedData.lastTime > 0) {
              // Obtain the leak warning messages for this device
              const msgs = await this.httpClient.getLeakDeviceWarning(device1.device, device1.sku)

              accessory.logDebug(`raw messages: ${JSON.stringify(msgs)}`)

              // Check to see if unread messages exist
              const unreadCount = msgs.filter(msg => !msg.read && msg.message.toLowerCase().replace(/\s+/g, '').startsWith('leakagealert'))
              if (unreadCount.length > 0) {
                hasUnreadLeak = true
              }
            }

            // Generate the params to return
            toReturn.battery = parsedSettings.battery
            toReturn.leakDetected = hasUnreadLeak
            toReturn.online = parsedData.gwonline && parsedData.online
          } else if (platformConsts.models.sensorThermo.includes(device1.sku)) {
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
      }
    } catch (err) {
      this.log.warn('[HTTP] %s %s.', platformLang.syncFail, parseError(err))
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
    const data = {}
    // Construct the params for BLE/AWS
    switch (params.cmd) {
      case 'state': {
        /*
          ON/OFF
          <= INPUT params.value with values 'on' or 'off'
          AWS needs { cmd: 'turn', data: { val: 1/0 } }
          BLE needs { cmd: 0x01, data: 0x1/0x0 }
          LAN needs { cmd: 'turn', data: { value: 'on'/'off' } }
        */
        data.awsParams = {
          cmd: 'turn',
          data: { val: params.value === 'on' ? 1 : 0 },
        }
        data.bleParams = {
          cmd: 0x01,
          data: params.value === 'on' ? 0x1 : 0x0,
        }
        data.lanParams = {
          cmd: 'turn',
          data: { value: params.value === 'on' ? 1 : 0 },
        }
        break
      }
      case 'stateDual': {
        data.awsParams = {
          cmd: 'turn',
          data: { val: params.value },
        }
        break
      }
      case 'stateOutlet': {
        if (platformConsts.awsOutlet1617.includes(accessory.context.gvModel)) {
          data.awsParams = {
            cmd: 'turn',
            data: { val: params.value === 'on' ? 17 : 16 },
          }
        } else {
          data.awsParams = {
            cmd: 'turn',
            data: { val: params.value === 'on' ? 1 : 0 },
          }
        }
        break
      }
      case 'stateHumi':
      case 'statePuri': {
        data.awsParams = {
          cmd: 'turn',
          data: { val: params.value },
        }
        data.bleParams = {
          cmd: 0x01,
          data: params.value ? 0x1 : 0x0,
        }
        break
      }
      case 'stateHeat': {
        const fullCode = params.value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI='
        data.awsParams = {
          cmd: 'multiSync',
          data: { command: [fullCode] },
        }
        data.bleParams = {
          cmd: 'ptReal',
          data: base64ToHex(fullCode),
        }
        break
      }
      case 'multiSync':
      case 'ptReal':
        data.awsParams = {
          cmd: params.cmd,
          data: { command: [params.value] },
        }
        data.bleParams = {
          cmd: 'ptReal',
          data: base64ToHex(params.value),
        }
        break
      case 'brightness': {
        /*
          BRIGHTNESS
          <= INPUT params.value INT in range [0, 100]
          AWS needs { cmd: 'brightness', data: { val: INT[0, 254] } }
          BLE needs { cmd: 0x04, data: (based on) INT[0, 100] }
          LAN needs { cmd: 'brightness', data: { value: INT[0, 100] } }
        */
        data.awsParams = {
          cmd: 'brightness',
          data: {
            val: accessory.context.awsBrightnessNoScale
              ? params.value
              : Math.round(params.value * 2.54),
          },
        }
        data.bleParams = {
          cmd: 0x04,
          data: Math.floor(
            platformConsts.bleBrightnessNoScale.includes(accessory.context.gvModel)
              ? (params.value / 100) * 0x64
              : (params.value / 100) * 0xFF,
          ),
        }
        data.lanParams = {
          cmd: 'brightness',
          data: {
            value: params.value,
          },
        }
        break
      }
      case 'color': {
        /*
          COLOUR (RGB)
          <= INPUT params.value OBJ with properties { r, g, b }
          AWS needs { cmd: 'color', data: { red, green, blue } }
          BLE needs { cmd: 0x05, data: [0x02, r, g, b] }
          H613B needs { cmd: 0x05, data: [0x0D, r, g, b] }
          LAN needs { cmd: 'colorwc', data: { color: {r, g, b}, colorTemInKelvin: 0 } }
        */
        switch (accessory.context.awsColourMode) {
          case 'rgb': {
            data.awsParams = {
              cmd: 'color',
              data: params.value,
            }
            break
          }
          case 'redgreenblue': {
            data.awsParams = {
              cmd: 'color',
              data: {
                red: params.value.r,
                green: params.value.g,
                blue: params.value.b,
              },
            }
            break
          }
          default: {
            data.awsParams = {
              cmd: 'colorwc',
              data: {
                color: {
                  r: params.value.r,
                  g: params.value.g,
                  b: params.value.b,
                  red: params.value.r,
                  green: params.value.g,
                  blue: params.value.b,
                },
                colorTemInKelvin: 0,
              },
            }
            break
          }
        }

        let firstCommand = [0x02]
        let lastCommand = []
        if (platformConsts.bleColourD.includes(accessory.context.gvModel)) {
          firstCommand = [0x0D]
        } else if (platformConsts.bleColour1501.includes(accessory.context.gvModel)) {
          firstCommand = [0x15, 0x01]
          lastCommand = [
            0x00,
            0x00,
            0x00,
            0x00,
            0x00,
            0xFF,
            0x7F,
          ]
        }
        data.bleParams = {
          cmd: 0x05,
          data: [
            ...firstCommand,
            params.value.r,
            params.value.g,
            params.value.b,
            ...lastCommand,
          ],
        }
        data.lanParams = {
          cmd: 'colorwc',
          data: {
            color: {
              r: params.value.r,
              g: params.value.g,
              b: params.value.b,
            },
            colorTemInKelvin: 0,
          },
        }
        break
      }
      case 'colorTem': {
        /*
          COLOUR TEMP (KELVIN)
          <= INPUT params.value INT in [2000, 7143]
          AWS needs { cmd: 'colorTem', data: { color: {},"colorTemInKelvin": } }
          BLE needs { cmd: 0x05, data: [0x02, 0xff, 0xff, 0xff, 0x01, r, g, b] }
          LAN needs { cmd: 'colorwc', data: { color: {r, g, b}, colorTemInKelvin: INT[2000, 9000] } }
        */
        const [r, g, b] = k2rgb(params.value)
        switch (accessory.context.awsColourMode) {
          case 'rgb': {
            data.awsParams = {
              cmd: 'colorTem',
              data: {
                colorTemInKelvin: params.value,
                color: {
                  r,
                  g,
                  b,
                },
              },
            }
            break
          }
          case 'redgreenblue': {
            data.awsParams = {
              cmd: 'colorTem',
              data: {
                color: {
                  red: r,
                  green: g,
                  blue: b,
                },
                colorTemInKelvin: params.value,
              },
            }
            break
          }
          default: {
            data.awsParams = {
              cmd: 'colorwc',
              data: {
                color: {
                  r,
                  g,
                  b,
                },
                colorTemInKelvin: params.value,
              },
            }
            break
          }
        }

        data.bleParams = {
          cmd: 0x05,
          data: [
            platformConsts.bleColourD.includes(accessory.context.gvModel) ? 0x0D : 0x02,
            0xFF,
            0xFF,
            0xFF,
            0x01,
            r,
            g,
            b,
          ],
        }
        data.lanParams = {
          cmd: 'colorwc',
          data: {
            color: {
              r,
              g,
              b,
            },
            colorTemInKelvin: params.value,
          },
        }
        break
      }
      case 'rgbScene': {
        // We get `params.value` as an array [awsCode, bleCode] either could be undefined
        // We get the AWS scene code in a string format, commands separated by a comma (base64)
        // The BLE scene code is still base64 but just one command (no commas)
        if (params.value[0]) {
          const splitCode = params.value[0].split(',')
          data.awsParams = {
            cmd: 'ptReal',
            data: {
              command: splitCode,
            },
          }
          data.lanParams = {
            cmd: 'ptReal',
            data: {
              command: splitCode,
            },
          }
        }
        if (params.value[1]) {
          data.bleParams = {
            cmd: 'ptReal',
            data: params.value[1],
          }
        }
        break
      }
      default:
        throw new Error('Invalid command')
    }

    // *********************************** //
    // ********* CONNECTION: LAN ********* //
    // *********************************** //
    // Check to see if we have the option to use LAN.
    if (accessory.context.useLanControl && data.lanParams) {
      try {
        await this.lanClient.updateDevice(accessory, data.lanParams)
        return true
      } catch (err) {
        accessory.logWarn(`${platformLang.notLANSent} ${parseError(err, [platformLang.lanDevNotFound])}`)
      }
    }

    // *********************************** //
    // ********* CONNECTION: AWS ********* //
    // *********************************** //
    // Check to see if we have the option to use AWS
    if (accessory.context.useAwsControl && data.awsParams) {
      try {
        await this.awsClient.updateDevice(accessory, data.awsParams)
        return true
      } catch (err) {
        // Print the reason to the log if in debug mode, it's not always necessarily an error
        accessory.logWarn(`${platformLang.notAWSSent} ${parseError(err, [platformLang.notAWSConn])}`)
      }
    }

    // We can return now, if there is no option to use BLE
    if (!data.bleParams) {
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
          accessory.logDebugWarn(`${platformLang.notBLESent} ${parseError(err)}`)
        }
      }
      throw new Error(platformLang.noConnMethod)
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
          this.api.updatePlatformAccessories([accessory])
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

  receiveUpdateAWS(payload) {
    const accessoryUUID = this.api.hap.uuid.generate(payload.device)
    const accessory = devicesInHB.get(accessoryUUID)
    this.receiveDeviceUpdate(accessory, {
      source: 'AWS',
      ...payload,
    })
  }

  receiveDeviceUpdate(accessory, params) {
    // No need to continue if the accessory doesn't have the receiver function setup
    if (!accessory?.control?.externalUpdate) {
      return
    }

    // Log the incoming update
    accessory.logDebug(`[${params.source}] ${platformLang.receivingUpdate} ${JSON.stringify(params)}`)

    // Standardise the object for the receiver function
    const data = {}

    // This will add support for status updates from H6104 and possibly other old devices that send the status mesage in a different structure (data instead of state)
    if (params.data && !params.state) {
      params.state = []
      if (hasProperty(params.data, 'turn')) {
        params.state.onOff = params.data.turn
      }
      if (hasProperty(params.data, 'brightness')) {
        params.state.brightness = params.data.brightness
      }
    }

    /*
      ON/OFF
    */
    if (params.state && hasProperty(params.state, 'onOff')) {
      if (platformConsts.models.switchDouble.includes(accessory.context.gvModel)) {
        switch (params.state.onOff) {
          case 0:
            data.state = ['off', 'off']
            break
          case 1:
            data.state = ['on', 'off']
            break
          case 2:
            data.state = ['off', 'on']
            break
          case 3:
            data.state = ['on', 'on']
            break
        }
      } else {
        data.state = [1, 17].includes(params.state.onOff) ? 'on' : 'off'
      }
    }

    /*
      BRIGHTNESS
    */
    if (params.state && hasProperty(params.state, 'brightness')) {
      if (params.source === 'LAN') {
        data.brightness = params.state.brightness
      } else if (params.source === 'AWS') {
        data.brightness = accessory.context.awsBrightnessNoScale
          ? params.state.brightness
          : Math.round(params.state.brightness / 2.54)
      }
    }

    // Sometimes Govee can provide a value out of range of [0, 100]
    if (hasProperty(data, 'brightness')) {
      data.brightness = Math.max(Math.min(data.brightness, 100), 0)
    }

    /*
      COLOUR (RGB)
    */
    if (params.state && hasProperty(params.state, 'color')) {
      data.rgb = params.state.color
    }

    /*
      COLOUR TEMP (KELVIN)
    */
    if (params.state && params.state.colorTemInKelvin) {
      // Ignore values of 0 in above check
      data.kelvin = params.state.colorTemInKelvin
    }

    // It seems sometimes Govee can provide a value out of range so just clamp it
    if (hasProperty(data, 'kelvin') && (data.kelvin < 2000 || data.kelvin > 7143)) {
      // Govee can go to kelvin 9000 but homekit only supports to 7143, try to keep the user logging nice
      if (data.kelvin > 9000) {
        accessory.logDebug(`govee provided a kelvin out of range [${data.kelvin}]`)
      }
      data.kelvin = Math.max(Math.min(data.kelvin, 7143), 2000)
    }

    /*
      BATTERY (leak and thermo sensors)
    */
    if (hasProperty(params, 'battery')) {
      data.battery = Math.min(Math.max(params.battery, 0), 100)
    }

    /*
      LEAK DETECTED (leak sensors)
    */
    if (hasProperty(params, 'leakDetected')) {
      data.leakDetected = params.leakDetected
    }

    /*
      CURRENT TEMPERATURE
    */
    if (hasProperty(params, 'temperature')) {
      data.temperature = params.temperature
    } else if (params?.state?.sta && hasProperty(params.state.sta, 'curTem')) {
      data.temperature = params.state.sta.curTem
    }
    if (hasProperty(params, 'temperatureF')) {
      data.temperatureF = params.temperatureF
    }

    /*
      SET TEMPERATURE
    */
    if (params.state?.sta && hasProperty(params.state.sta, 'setTem')) {
      data.setTemperature = params.state.sta.setTem
    }

    /*
      HUMIDITY (thermo sensors)
    */
    if (hasProperty(params, 'humidity')) {
      data.humidity = params.humidity
    }

    /*
      COMMANDS (these can be light scenes)
    */
    if (params.commands) {
      data.commands = params.commands
      params.baseCmd = 'none'
    } else if (params.op) {
      if (params.op.command) {
        data.commands = params.op.command
        data.baseCmd = 'op'
      } else if (params.op.mode && Array.isArray(params.op.value)) {
        data.commands = params.op.value
        data.baseCmd = 'opMode'
      } else if (params.op.opcode === 'mode' && Array.isArray(params.op.modeValue)) {
        data.commands = params.op.modeValue
        data.baseCmd = 'opCodeMode'
      }
    } else if (params.bulb) {
      data.commands = params.bulb
      data.baseCmd = 'bulb'
    } else if (params.data?.op === 'mode' && Array.isArray(params.data.value)) {
      data.commands = params.data.value
      data.baseCmd = 'opMode'
    }

    // Send the update to the receiver function
    data.source = params.source

    // We may have received a command which we don't recognise
    // We can probably check by seeing if the data object has just one property
    if (Object.keys(data).length > 1) {
      try {
        accessory.control.externalUpdate(data)
      } catch (err) {
        this.log.warn('[%s] %s %s.', accessory.displayName, platformLang.devNotUpdated, parseError(err))
      }
    } else {
      accessory.logDebugWarn(`[${params.source}] ${platformLang.unknownCommand}: ${JSON.stringify(params)}`)
    }
  }
}
