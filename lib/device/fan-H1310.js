import { hs2rgb, rgb2hs } from '../utils/colour.js'
import {
  base64ToHex,
  generateRandomString,
  getTwoItemPosition,
  hexToDecimal,
  hexToTwoItems,
  parseError,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

/*
  H1310 is a ceiling fan with an integrated light. Govee reports it as
  devices.types.light, so the light uses the standard powerSwitch / brightness /
  colorRgb / colorTemperatureK capabilities, while the fan is exposed via the
  separate fanToggle / fanSpeedMode / reverseAirflowToggle capabilities.

  The OpenAPI capability instances below are confirmed against a real device
  (see lasswellt/govee-homeassistant commit ed5365b, issue #74). The BLE/AWS
  `ptReal` opcodes are retained as an unverified fallback for non-OpenAPI
  transports. Govee does not report live fan speed, so speed is optimistic.
*/
export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId]
    this.hideLight = deviceConf && deviceConf.hideLight

    // Work out which OpenAPI capabilities the device actually reports
    const caps = accessory.context.openApiCapabilities || {}
    this.hasOpenApiCaps = Object.keys(caps).length > 0
    this.supportsReverse = !!caps.reverseAirflowToggle
    this.hasColour = !this.hasOpenApiCaps || !!caps.colorRgb
    this.hasColourTem = !this.hasOpenApiCaps || !!caps.colorTemperatureK

    // Determine the fan speed steps from the fanSpeedMode capability options.
    // Each option is { name, value }; fall back to an assumed 1-8 range when
    // the device hasn't reported them (e.g. BLE/AWS only).
    const speedOptions = caps.fanSpeedMode?.parameters?.options || []
    this.fanSpeedValues = speedOptions.length > 0
      ? speedOptions.map(opt => opt.value).filter(Number.isFinite).sort((a, b) => a - b)
      : [1, 2, 3, 4, 5, 6, 7, 8]
    this.maxSpeed = this.fanSpeedValues.length

    // Assumed BLE/AWS ptReal opcodes (unverified fallback for non-OpenAPI use)
    this.speedCodes = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      5: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      6: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      7: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      8: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
    }

    // Remove any old original Fan services
    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
    }

    // Migrate old %-rotation speed to unitless
    const existingService = this.accessory.getService(this.hapServ.Fanv2)
    if (existingService) {
      if (existingService.getCharacteristic(this.hapChar.RotationSpeed).props.unit === 'percentage') {
        this.accessory.removeService(existingService)
      }
    }

    // Add the fan service for the fan if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fanv2) || this.accessory.addService(this.hapServ.Fanv2)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: this.maxSpeed,
        minStep: 1,
        minValue: 0,
        unit: 'unitless',
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler for reverse airflow (mapped to fan direction)
    if (this.supportsReverse) {
      this.service
        .getCharacteristic(this.hapChar.RotationDirection)
        .onSet(async value => this.internalDirectionUpdate(value))
      this.cacheDirection = this.service.getCharacteristic(this.hapChar.RotationDirection).value
    } else if (this.service.testCharacteristic(this.hapChar.RotationDirection)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.RotationDirection))
    }

    // Remove any previously-added swing characteristic (H1310 uses direction, not swing)
    if (this.service.testCharacteristic(this.hapChar.SwingMode)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.SwingMode))
    }

    // Set up the integrated light unless hidden
    if (this.hideLight) {
      if (this.accessory.getService(this.hapServ.Lightbulb)) {
        this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
      }
    } else {
      this.lightService = this.accessory.getService(this.hapServ.Lightbulb) || this.accessory.addService(this.hapServ.Lightbulb)

      // On/off
      this.lightService.getCharacteristic(this.hapChar.On).onSet(async value => this.internalLightStateUpdate(value))
      this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

      // Brightness
      this.lightService
        .getCharacteristic(this.hapChar.Brightness)
        .onSet(async value => this.internalBrightnessUpdate(value))
      this.cacheBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value

      // Colour (hue/saturation)
      if (this.hasColour) {
        this.lightService.getCharacteristic(this.hapChar.Hue).onSet(async value => this.internalColourUpdate(value))
        this.cacheHue = this.lightService.getCharacteristic(this.hapChar.Hue).value
        this.cacheSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
      }

      // Colour temperature
      if (this.hasColourTem) {
        this.lightService
          .getCharacteristic(this.hapChar.ColorTemperature)
          .onSet(async value => this.internalCTUpdate(value))
        this.cacheMired = this.lightService.getCharacteristic(this.hapChar.ColorTemperature).value
      }
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      hideLight: this.hideLight,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Fan power: confirmed OpenAPI fanToggle, assumed BLE/AWS power opcode fallback
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
        openApi: { instance: 'fanToggle', capabilityType: 'devices.capabilities.toggle', value: value ? 1 : 0 },
      })

      // Cache the new state and log if appropriate
      this.cacheState = newValue
      this.accessory.log(`${platformLang.curState} [${newValue}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // Don't continue if the value is 0 or the same as before
      if (value === 0 || this.cacheSpeed === value) {
        return
      }

      // Map the 1-based HomeKit step to the device's fanSpeedMode option value
      const speedValue = this.fanSpeedValues[value - 1]
      if (!Number.isFinite(speedValue)) {
        return
      }

      // Fan speed: confirmed OpenAPI fanSpeedMode, assumed BLE/AWS opcode fallback
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.speedCodes[speedValue] || this.speedCodes[1],
        openApi: { instance: 'fanSpeedMode', capabilityType: 'devices.capabilities.mode', value: speedValue },
      })

      // Cache the new state and log if appropriate
      this.cacheSpeed = value
      this.accessory.log(`${platformLang.curSpeed} [${value}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalDirectionUpdate(value) {
    try {
      // HomeKit: 0 = clockwise (forward), 1 = counter-clockwise (reverse)
      const reverse = value === 1
      if (this.cacheDirection === value) {
        return
      }

      // Reverse airflow: confirmed OpenAPI reverseAirflowToggle (no verified BLE opcode)
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'openApi',
        openApi: { instance: 'reverseAirflowToggle', capabilityType: 'devices.capabilities.toggle', value: reverse ? 1 : 0 },
      })

      // Cache the new state and log if appropriate
      this.cacheDirection = value
      this.accessory.log(`${platformLang.curState} [direction ${reverse ? 'reverse' : 'forward'}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationDirection, this.cacheDirection)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLightStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (this.cacheLightState === newValue) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'state',
        value: newValue,
      })

      this.cacheLightState = newValue
      this.accessory.log(`${platformLang.curLight} [${newValue}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      // Debounce rapid slider changes
      const updateKeyBright = generateRandomString(5)
      this.updateKeyBright = updateKeyBright
      await sleep(350)
      if (updateKeyBright !== this.updateKeyBright) {
        return
      }

      if (value === this.cacheBright) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'brightness',
        value,
      })

      this.cacheBright = value
      this.accessory.log(`${platformLang.curBright} [${value}%]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalColourUpdate(value) {
    try {
      // Debounce rapid colour wheel changes
      const updateKeyColour = generateRandomString(5)
      this.updateKeyColour = updateKeyColour
      await sleep(300)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }

      if (value === this.cacheHue) {
        return
      }

      const newRGB = hs2rgb(value, this.lightService.getCharacteristic(this.hapChar.Saturation).value)

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'color',
        value: { r: newRGB[0], g: newRGB[1], b: newRGB[2] },
      })

      this.cacheHue = value
      this.accessory.log(`${platformLang.curColour} [rgb ${newRGB.join(' ')}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCTUpdate(value) {
    try {
      // Debounce rapid slider changes
      const updateKeyCT = generateRandomString(5)
      this.updateKeyCT = updateKeyCT
      await sleep(350)
      if (updateKeyCT !== this.updateKeyCT) {
        return
      }

      if (value === this.cacheMired) {
        return
      }

      // Convert mired to kelvin for the command path
      const kelvin = Math.round(1000000 / value)

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'colorTem',
        value: kelvin,
      })

      this.cacheMired = value
      this.accessory.log(`${platformLang.curColour} [${kelvin}K]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // Light power (powerSwitch -> onOff)
    if (!this.hideLight && this.lightService && params.state && params.state !== this.cacheLightState) {
      this.cacheLightState = params.state
      this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
    }

    // Light brightness
    if (!this.hideLight && this.lightService && params.brightness !== undefined && this.cacheBright !== params.brightness) {
      this.cacheBright = params.brightness
      this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
    }

    // Light colour
    if (!this.hideLight && this.lightService && this.hasColour && params.rgb) {
      const hs = rgb2hs(params.rgb.r, params.rgb.g, params.rgb.b)
      if (hs[0] !== this.cacheHue) {
        this.lightService.updateCharacteristic(this.hapChar.Hue, hs[0])
        this.lightService.updateCharacteristic(this.hapChar.Saturation, hs[1]);
        [this.cacheHue, this.cacheSat] = hs
        this.accessory.log(`${platformLang.curColour} [rgb ${params.rgb.r} ${params.rgb.g} ${params.rgb.b}]`)
      }
    }

    // Light colour temperature
    if (!this.hideLight && this.lightService && this.hasColourTem && params.kelvin) {
      const mired = Math.round(1000000 / params.kelvin)
      if (mired !== this.cacheMired) {
        this.cacheMired = mired
        this.lightService.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
        this.accessory.log(`${platformLang.curColour} [${params.kelvin}K]`)
      }
    }

    // Fan power (fanToggle) and reverse airflow (reverseAirflowToggle) via OpenAPI toggles
    if (params.toggles?.fanToggle !== undefined) {
      const newState = params.toggles.fanToggle ? 'on' : 'off'
      if (this.cacheState !== newState) {
        this.cacheState = newState
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
      }
    }
    if (this.supportsReverse && params.toggles?.reverseAirflowToggle !== undefined) {
      const newDirection = params.toggles.reverseAirflowToggle ? 1 : 0
      if (this.cacheDirection !== newDirection) {
        this.cacheDirection = newDirection
        this.service.updateCharacteristic(this.hapChar.RotationDirection, this.cacheDirection)
        this.accessory.log(`${platformLang.curState} [direction ${newDirection === 1 ? 'reverse' : 'forward'}]`)
      }
    }

    // Check for BLE/AWS status packets (fallback for non-OpenAPI transports)
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      if (getTwoItemPosition(hexParts, 2) === '08') {
        // Sensor Attached?
        const dev = hexString.substring(4, hexString.length - 24)
        this.accessory.context.sensorAttached = dev !== '000000000000'
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '0501': {
          // Fan speed (raw option value -> 1-based HomeKit step)
          const rawSpeed = Number.parseInt(getTwoItemPosition(hexParts, 4), 16)
          const step = this.fanSpeedValues.indexOf(rawSpeed) + 1
          if (step >= 1 && this.cacheSpeed !== step) {
            this.cacheSpeed = step
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
            this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}]`)
          }
          break
        }
        case '1b01': {
          // Light on/off + brightness
          if (!this.hideLight && this.lightService) {
            const newLightState = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
            if (this.cacheLightState !== newLightState) {
              this.cacheLightState = newLightState
              this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
              this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
            }
            const newBrightness = hexToDecimal(getTwoItemPosition(hexParts, 5))
            if (Number.isFinite(newBrightness) && this.cacheBright !== newBrightness) {
              this.cacheBright = newBrightness
              this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
              this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
            }
          }
          break
        }
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
