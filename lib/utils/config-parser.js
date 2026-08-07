import platformConsts from './constants.js'
import { parseDeviceId } from './functions.js'
import platformLang from './lang-en.js'

const WHITESPACE_REGEX = /\s+/g

/**
 * Reads the user's settings, warns about anything that will not be used, and
 * fills in the defaults for the rest.
 *
 * Lifted out of the platform unchanged. It was the largest single thing in
 * there and had nothing to do with talking to devices, so a change to how a
 * device works no longer means opening the same file as a change to how a
 * setting is read.
 *
 * It writes `config`, `deviceConf` and `ignoredDevices` onto the platform
 * rather than returning them, which is how it always worked.
 */
export function applyUserConfig(platform, config) {
  // These shorthand functions save line space during config parsing
  const logDefault = (k, def) => {
    platform.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgDef, def)
  }
  const logDuplicate = (k) => {
    platform.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgDup)
  }
  const logIgnore = (k) => {
    platform.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgn)
  }
  const logIgnoreItem = (k) => {
    platform.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgnItem)
  }
  const logIncrease = (k, min) => {
    platform.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgLow, min)
  }
  const logQuotes = (k) => {
    platform.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgQts)
  }
  const logRemove = (k) => {
    platform.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgRmv)
  }

  // Begin applying the user's config
  Object.entries(config).forEach((entry) => {
    const [key, val] = entry
    switch (key) {
      case 'apiKey':
      case 'code':
      case 'password':
      case 'username':
        if (typeof val !== 'string' || val === '') {
          logIgnore(key)
        } else {
          platform.config[key] = val
        }
        break
      case 'lanScanSubnets': {
        // Comma-separated list of CIDR subnets to scan directly (for devices
        // on a different subnet from Homebridge, which multicast can't reach)
        if (typeof val !== 'string' || val.trim() === '') {
          break
        }
        const subnets = val
          .split(',')
          .map(s => s.trim())
          .filter(s => /^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(s))
        if (subnets.length === 0) {
          logIgnore(key)
        } else {
          platform.config[key] = subnets
        }
        break
      }
      case 'awsDisable':
      case 'bleDisable':
      case 'colourSafeMode':
      case 'disableDeviceLogging':
      case 'ignoreMatter':
      case 'lanDisable':
      case 'openApiDisable':
        if (typeof val === 'string') {
          logQuotes(key)
        }
        platform.config[key] = val === 'false' ? false : !!val
        break
      case 'bleControlInterval':
      case 'bleRefreshTime':
      case 'httpRefreshTime':
      case 'lanRefreshTime':
      case 'lanScanInterval':
      case 'openApiRefreshTime': {
        if (typeof val === 'string') {
          logQuotes(key)
        }
        const intVal = Number.parseInt(val, 10)
        if (Number.isNaN(intVal)) {
          logDefault(key, platformConsts.defaultValues[key])
          platform.config[key] = platformConsts.defaultValues[key]
        } else if (intVal < platformConsts.minValues[key]) {
          logIncrease(key, platformConsts.minValues[key])
          platform.config[key] = platformConsts.minValues[key]
        } else {
          platform.config[key] = intVal
        }
        break
      }
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
            if (Object.keys(platform.deviceConf).includes(id)) {
              logDuplicate(`${key}.${id}`)
              return
            }
            const entries = Object.entries(x)
            if (entries.length === 1) {
              logRemove(`${key}.${id}`)
              return
            }
            platform.deviceConf[id] = {}
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
                    platform.deviceConf[id][k] = platformConsts.defaultValues[k]
                  } else if (intVal < platformConsts.minValues[k]) {
                    logIncrease(`${key}.${id}.${k}`, platformConsts.minValues[k])
                    platform.deviceConf[id][k] = platformConsts.minValues[k]
                  } else {
                    platform.deviceConf[id][k] = intVal
                  }
                  break
                }
                case 'awsBrightnessNoScale':
                case 'hideLight':
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
                  platform.deviceConf[id][k] = v === 'false' ? false : !!v
                  break
                case 'awsColourMode':
                case 'openApiTempUnit':
                case 'showAs': {
                  if (typeof v !== 'string' || !platformConsts.allowed[k].includes(v)) {
                    logIgnore(`${key}.${id}.${k}`)
                  } else {
                    platform.deviceConf[id][k] = v
                  }
                  break
                }
                case 'customAddress':
                case 'customIPAddress':
                  if (typeof v !== 'string' || v === '') {
                    logIgnore(`${key}.${id}.${k}`)
                  } else {
                    platform.deviceConf[id][k] = v.replace(WHITESPACE_REGEX, '')
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
                    platform.log.warn(`${key}.${id}.${k} incorrectly configured - please use the config screen to reconfigure this item:`)
                    platform.log.warn(`${key}.${id}.${k}: ${v}`)
                  }
                  if (typeof v === 'object') {
                    // object - only allowed keys are 'sceneCode', 'bleCode' and 'showAs'
                    const subEntries = Object.entries(v)
                    if (subEntries.length > 0) {
                      platform.deviceConf[id][k] = {}
                      subEntries.forEach((subSubEntry) => {
                        const [k1, v1] = subSubEntry
                        switch (k1) {
                          case 'bleCode':
                          case 'sceneCode':
                            if (typeof v1 !== 'string' || v1 === '') {
                              logIgnore(`${key}.${id}.${k}.${k1}`)
                            } else {
                              platform.deviceConf[id][k][k1] = v1
                            }
                            break
                          case 'showAs': {
                            if (typeof v1 !== 'string' || !['default', 'switch'].includes(v1)) {
                              logIgnore(`${key}.${id}.${k}.${k1}`)
                            } else {
                              platform.deviceConf[id][k][k1] = v1
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
                    platform.ignoredDevices.push(id)
                  }
                  break
                case 'label':
                  if (typeof v !== 'string' || v === '') {
                    logIgnore(`${key}.${id}.${k}`)
                  } else {
                    platform.deviceConf[id][k] = v
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
      default:
        logRemove(key)
        break
    }
  })
}
