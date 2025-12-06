import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, promises } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import process from 'node:process';

import storage from 'node-persist';
import PQueue from 'p-queue';

import awsClient from './connection/aws.js';
import httpClient from './connection/http.js';
import lanClient from './connection/lan.js';
import deviceTypes from './device/index.js';
import eveService from './fakegato/fakegato-history.js';
import { k2rgb } from './utils/colour.js';
import platformConsts from './utils/constants.js';
import platformChars from './utils/custom-chars.js';
import eveChars from './utils/eve-chars.js';
import {
  base64ToHex,
  hasProperty,
  parseDeviceId,
  parseError,
  pfxToCertAndKey,
} from './utils/functions.js';
import platformLang from './utils/lang-en.js';

const require = createRequire(import.meta.url);
const plugin = require('../package.json');

const devicesInHB = new Map();
const awsDevices = [];
const awsDevicesToPoll = [];
const httpDevices = [];
const lanDevices = [];

export default class {
  constructor(log, config, api) {
    if (!log || !api) {
      return;
    }

    // Begin plugin initialisation
    try {
      this.api = api;
      this.log = log;
      this.isBeta = plugin.version.includes('beta');

      // Configuration objects for accessories
      this.deviceConf = {};
      this.ignoredDevices = [];

      // Make sure user is running Homebridge v1.5 or above
      if (!api.versionGreaterOrEqual?.('1.5.0')) {
        throw new Error(platformLang.hbVersionFail);
      }

      // Check the user has configured the plugin
      if (!config) {
        throw new Error(platformLang.pluginNotConf);
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
      );

      // Apply the user's configuration
      this.config = platformConsts.defaultConfig;
      this.applyUserConfig(config);

      // Set up empty clients
      this.bleClient = false;
      this.httpClient = false;
      this.lanClient = false;

      // Set up the Homebridge events
      this.api.on('didFinishLaunching', () => this.pluginSetup());
      this.api.on('shutdown', () => this.pluginShutdown());
    } catch (err) {
      // Catch any errors during initialisation
      log.warn('***** %s [v%s]. *****', platformLang.disabling, plugin.version);
      log.warn('***** %s. *****', parseError(err, [platformLang.hbVersionFail, platformLang.pluginNotConf]));
    }
  }

  applyUserConfig(config) {
    const logDefault = (k, def) => {
      this.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgDef, def);
    };
    const logDuplicate = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgDup);
    };
    const logIgnore = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgn);
    };
    const logIgnoreItem = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgIgnItem);
    };
    const logIncrease = (k, min) => {
      this.log.warn('%s [%s] %s %s.', platformLang.cfgItem, k, platformLang.cfgLow, min);
    };
    const logQuotes = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgQts);
    };
    const logRemove = (k) => {
      this.log.warn('%s [%s] %s.', platformLang.cfgItem, k, platformLang.cfgRmv);
    };

    Object.entries(config).forEach(([key, val]) => {
      switch (key) {
        case 'awsDisable':
        case 'bleDisable':
        case 'colourSafeMode':
        case 'disableDeviceLogging':
        case 'ignoreMatter':
        case 'lanDisable':
          this.config[key] = val === 'false' ? false : !!val;
          break;
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
                logIgnoreItem(key);
                return;
              }
              const id = parseDeviceId(x.deviceId);
              if (Object.keys(this.deviceConf).includes(id)) {
                logDuplicate(`${key}.${id}`);
                return;
              }
              const entries = Object.entries(x);
              if (entries.length === 1) {
                logRemove(`${key}.${id}`);
                return;
              }
              this.deviceConf[id] = {};
              entries.forEach(([k, v]) => {
                switch (k) {
                  case 'brightnessStep':
                    if (typeof v === 'string') {
                      logQuotes(`${key}.${k}`);
                    }
                    const intVal = Number.parseInt(v, 10);
                    if (Number.isNaN(intVal)) {
                      logDefault(`${key}.${id}.${k}`, platformConsts.defaultValues[k]);
                      this.deviceConf[id][k] = platformConsts.defaultValues[k];
                    } else {
                      this.deviceConf[id][k] = intVal;
                    }
                    break;
                  case 'awsColourMode':
                    if (typeof v !== 'string' || !platformConsts.allowed[k].includes(v)) {
                      logIgnore(`${key}.${id}.${k}`);
                    } else {
                      this.deviceConf[id][k] = v;
                    }
                    break;
                  case 'label':
                    if (typeof v !== 'string' || v === '') {
                      logIgnore(`${key}.${id}.${k}`);
                    } else {
                      this.deviceConf[id][k] = v;
                    }
                    break;
                  default:
                    logRemove(`${key}.${id}.${k}`);
                }
              });
            });
          } else {
            logIgnore(key);
          }
          break;
        default:
          logRemove(key);
          break;
      }
    });
  }

  sendDeviceUpdate(accessory, params) {
    const data = {};

    // Handle the ON/OFF logic
    switch (params.cmd) {
      case 'state': {
        // ON/OFF logic
        data.awsParams = {
          cmd: 'turn',
          data: { val: params.value === 'on' ? 1 : 0 }, // 1 for ON, 0 for OFF
        };
        data.bleParams = {
          cmd: 0x01,
          data: params.value === 'on' ? 0x1 : 0x0, // 0x1 for ON, 0x0 for OFF
        };
        data.lanParams = {
          cmd: 'turn',
          data: { value: params.value === 'on' ? 1 : 0 }, // 1 for ON, 0 for OFF
        };
        break;
      }
      case 'brightness': {
        // Ensure brightness is clamped to the correct scale [0-100]
        if (params.value === 0) {
          // Treat 0 brightness as OFF
          data.awsParams = {
            cmd: 'turn',
            data: { val: 0 },
          };
          data.bleParams = {
            cmd: 0x01,
            data: 0x0,
          };
          data.lanParams = {
            cmd: 'turn',
            data: { value: 0 },
          };
          break;
        }

        // Apply scaling for brightness
        const scaledBrightness = Math.floor(
          platformConsts.bleBrightnessNoScale.includes(accessory.context.gvModel)
            ? (params.value / 100) * 0x64 // No scale for certain models
            : (params.value / 100) * 0xFF // Standard scaling to 255
        );

        data.awsParams = {
          cmd: 'brightness',
          data: { val: params.value },
        };
        data.bleParams = {
          cmd: 0x04,
          data: scaledBrightness, // Scaled brightness for BLE
        };
        data.lanParams = {
          cmd: 'brightness',
          data: { value: params.value }, // For LAN, send normal brightness value
        };
        break;
      }
      case 'color': {
        // Handle RGB color logic with scaling
        switch (accessory.context.awsColourMode) {
          case 'rgb': {
            data.awsParams = {
              cmd: 'color',
              data: params.value, // Directly pass RGB values
            };
            break;
          }
          case 'redgreenblue': {
            data.awsParams = {
              cmd: 'color',
              data: {
                red: params.value.r,
                green: params.value.g,
                blue: params.value.b,
              },
            };
            break;
          }
          default: {
            data.awsParams = {
              cmd: 'colorwc',
              data: {
                color: {
                  r: params.value.r,
                  g: params.value.g,
                  b: params.value.b,
                },
                colorTemInKelvin: 0, // Assuming no color temperature adjustment
              },
            };
            break;
          }
        }

        // BLE and LAN should follow the same color scaling logic
        let firstCommand = [0x02]; // Default first command for BLE color
        if (platformConsts.bleColourD.includes(accessory.context.gvModel)) {
          firstCommand = [0x0D]; // Special handling for some models
        }

        data.bleParams = {
          cmd: 0x05,
          data: [
            ...firstCommand,
            params.value.r,
            params.value.g,
            params.value.b,
          ],
        };
        data.lanParams = {
          cmd: 'colorwc',
          data: {
            color: {
              r: params.value.r,
              g: params.value.g,
              b: params.value.b,
            },
            colorTemInKelvin: 0, // Assuming no color temperature adjustment
          },
        };
        break;
      }
      case 'colorTem': {
        // Handle Color Temperature (Kelvin) scaling
        const [r, g, b] = k2rgb(params.value); // Convert Kelvin to RGB
        data.awsParams = {
          cmd: 'colorTem',
          data: {
            colorTemInKelvin: params.value,
            color: { r, g, b },
          },
        };
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
        };
        data.lanParams = {
          cmd: 'colorwc',
          data: {
            color: { r, g, b },
            colorTemInKelvin: params.value,
          },
        };
        break;
      }
      default:
        throw new Error('Invalid command');
    }

    // Send data based on connection methods: LAN, AWS, BLE
    if (accessory.context.useLanControl && data.lanParams) {
      try {
        await this.lanClient.updateDevice(accessory, data.lanParams);
        return true;
      } catch (err) {
        accessory.logWarn(`${platformLang.notLANSent} ${parseError(err, [platformLang.lanDevNotFound])}`);
      }
    }

    if (accessory.context.useAwsControl && data.awsParams) {
      try {
        await this.awsClient.updateDevice(accessory, data.awsParams);
        return true;
      } catch (err) {
        accessory.logWarn(`${platformLang.notAWSSent} ${parseError(err, [platformLang.notAWSConn])}`);
      }
    }

    // Queue BLE updates if needed
    if (data.bleParams) {
      return this.queue.add(async () => {
        if (accessory.context.useBleControl && data.bleParams) {
          try {
            await this.bleClient.updateDevice(accessory, data.bleParams);
            return true;
          } catch (err) {
            accessory.logDebugWarn(`${platformLang.notBLESent} ${parseError(err)}`);
          }
        }
        throw new Error(platformLang.noConnMethod);
      });
    }

    return true;
  }
}
