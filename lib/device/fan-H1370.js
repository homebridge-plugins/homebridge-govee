import { getDeviceCapabilities } from '../utils/device-capabilities.js'
import {
  base64ToHex,
  fanSpeedStepsFrom,
  fanSpeedToHkPercent,
  generateCodeFromHexValues,
  generateRandomString,
  getTwoItemPosition,
  hexToTwoItems,
  hkPercentToFanSpeed,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

/*
  Codes below were decoded from a real device's AWS status reports in
  https://github.com/homebridge-plugins/homebridge-govee/issues/1307
  Status aa 31 [?] [speed] [direction] = fan speed and airflow direction
  Status aa 36 01 01 / aa 36 00 00 = fan power on/off
  The light reports through the standard state/brightness/kelvin fields
  (colour temperature only, 2700-6500K)

  The H1310 and R1310 share this handler. They report six speeds against the
  H1370's twelve, so the scale comes from the capabilities table (#1352)
*/
export default class GoveeFanH1370 extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId]
    this.hideLight = deviceConf && deviceConf.hideLight

    // Rebuild the fan service if it was cached under an older speed scale, as
    // HomeKit keeps the old props until the service itself is replaced
    const existingService = this.accessory.getService(this.hapServ.Fanv2)
    if (existingService) {
      const { props } = existingService.getCharacteristic(this.hapChar.RotationSpeed)
      if (props.unit === 'percentage' || props.maxValue !== 100) {
        this.accessory.removeService(existingService)
      }
    }

    // Add the fan service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fanv2) || this.accessory.addService(this.hapServ.Fanv2)

    // This accessory is a fan that happens to have lights on it, so the fan is
    // what its tile should lead with. Without saying so the Home app picks for
    // itself and lands on a light, leaving an owner tapping through to reach
    // the fan they came for (#1352)
    this.service.setPrimaryService(true)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    // Real speed steps - HomeKit percentages map onto these, and they differ
    // per model. The fan's own api entry is the best answer where there is one,
    // with the model table behind it for a device the api never described
    this.speedSteps = fanSpeedStepsFrom(
      accessory.context.openApiCapabilities,
      getDeviceCapabilities(accessory.context.gvModel).fanSpeedSteps,
    )

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 100,
        minStep: 1,
        minValue: 0,
        unit: 'unitless',
      })
      .onSet(async value => this.internalSpeedUpdate(value))

    // cacheSpeed holds a device speed step everywhere else, but the restored
    // characteristic is a HomeKit percentage, so it has to be converted back.
    // Left as a percentage it would sometimes equal a real step and silently
    // swallow the first speed the owner asked for.
    const restoredPercent = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    this.cacheSpeed = restoredPercent ? hkPercentToFanSpeed(restoredPercent, this.speedSteps) : 0

    if (this.hideLight) {
      if (this.accessory.getService(this.hapServ.Lightbulb)) {
        // Remove the light service if it exists
        this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
      }
    } else {
      // Add the light service if it doesn't already exist
      this.lightService = this.accessory.getService(this.hapServ.Lightbulb) || this.accessory.addService(this.hapServ.Lightbulb)

      // Add the set handler to the lightbulb on/off characteristic
      this.lightService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
        await this.internalLightStateUpdate(value)
      })
      this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

      // Add the set handler to the lightbulb brightness characteristic
      this.lightService
        .getCharacteristic(this.hapChar.Brightness)
        .onSet(async (value) => {
          await this.internalBrightnessUpdate(value)
        })
      this.cacheBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value

      // Add the set handler to the lightbulb colour temperature characteristic
      // The light is colour temperature only, 2700K (370 mired) to 6500K (154 mired)
      this.lightService
        .getCharacteristic(this.hapChar.ColorTemperature)
        .setProps({
          maxValue: 370,
          minValue: 154,
        })
        .onSet(async (value) => {
          await this.internalCTUpdate(value)
        })
      this.cacheMired = this.lightService.getCharacteristic(this.hapChar.ColorTemperature).value
      this.cacheKelvin = 0
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

      // Mirrors the fan power status code aa 36 01 01 (on) / aa 36 00 00 (off)
      const hexValues = value ? [0x33, 0x36, 0x01, 0x01] : [0x33, 0x36, 0x00, 0x00]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: generateCodeFromHexValues(hexValues),
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${newValue}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // Don't continue if the value is 0
      if (value === 0) {
        return
      }

      // HomeKit sends a percentage - map it onto this model's real speed steps
      value = hkPercentToFanSpeed(value, this.speedSteps)

      // Don't continue if the new value is the same as before
      if (this.cacheSpeed === value) {
        return
      }

      // Mirrors the fan speed status code aa 31 01 [speed]
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: generateCodeFromHexValues([0x33, 0x31, 0x01, value]),
      })

      // Cache the new state and log if appropriate
      if (this.cacheSpeed !== value) {
        this.cacheSpeed = value
        this.accessory.log(`${platformLang.curSpeed} [${value}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, fanSpeedToHkPercent(this.cacheSpeed, this.speedSteps))
      })
    }
  }

  async internalLightStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheLightState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'state',
        value: newValue,
      })

      // Cache the new state and log if appropriate
      if (this.cacheLightState !== newValue) {
        this.cacheLightState = newValue
        this.accessory.log(`${platformLang.curLight} [${newValue}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      })
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the brightness scale
      const updateKeyBright = generateRandomString(5)
      this.updateKeyBright = updateKeyBright
      await sleep(350)
      if (updateKeyBright !== this.updateKeyBright) {
        return
      }

      // Don't continue if the new value is the same as before
      if (value === this.cacheBright) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'brightness',
        value,
      })

      // Cache the new state and log if appropriate
      if (this.cacheBright !== value) {
        this.cacheBright = value
        this.accessory.log(`${platformLang.curBright} [${value}%]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      })
    }
  }

  async internalCTUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the colour wheel
      const updateKeyCT = generateRandomString(5)
      this.updateKeyCT = updateKeyCT
      await sleep(300)
      if (updateKeyCT !== this.updateKeyCT) {
        return
      }

      // Convert mired to kelvin to nearest 100, clamped to the light's range
      const kelvin = Math.round(1000000 / value / 100) * 100
      const k = Math.min(Math.max(kelvin, 2700), 6500)

      // Don't continue if the new value is the same as before
      if (this.cacheKelvin === k) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'colorTem',
        value: k,
      })

      // Cache the new state and log if appropriate
      this.cacheMired = value
      this.cacheKelvin = k
      this.accessory.log(`${platformLang.curColour} [${k}K]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      })
    }
  }

  externalUpdate(params) {
    // The standard state/brightness/kelvin fields report the light
    if (!this.hideLight) {
      if (params.state && params.state !== this.cacheLightState) {
        this.cacheLightState = params.state
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
        this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
      }

      if (params.brightness && params.brightness !== this.cacheBright) {
        this.cacheBright = params.brightness
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
        this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
      }

      if (params.kelvin && params.kelvin !== this.cacheKelvin) {
        const k = Math.min(Math.max(params.kelvin, 2700), 6500)
        const mired = Math.min(Math.max(Math.round(1000000 / k), 154), 370)
        this.cacheKelvin = k
        this.cacheMired = mired
        this.lightService.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
        this.accessory.log(`${platformLang.curColour} [${k}K]`)
      }
    }

    // Check for fan status codes
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        // aa 31 <?> <speed> <direction>. The third byte is not part of the
        // code: an H1310 has been seen reporting both 00 and 01 for it with the
        // fan running either way, so what it means is still unknown - but
        // matching only 3101 announced every other status as unrecognised,
        // which is the noise that sent this model's owner here (#1352).
        // `aa 36` is the reliable word on whether the fan is running.
        case '3100':
        case '3101': {
          // Fan speed
          const newSpeed = Number.parseInt(getTwoItemPosition(hexParts, 4), 16)
          if (newSpeed >= 1 && newSpeed <= this.speedSteps && this.cacheSpeed !== newSpeed) {
            this.cacheSpeed = newSpeed
            const hkSpeed = fanSpeedToHkPercent(newSpeed, this.speedSteps)
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, hkSpeed)
            this.accessory.log(`${platformLang.curSpeed} [${newSpeed} -> ${hkSpeed}%]`)
          }
          break
        }
        case '3601': {
          // Fan on
          if (this.cacheState !== 'on') {
            this.cacheState = 'on'
            this.service.updateCharacteristic(this.hapChar.Active, 1)
            this.accessory.log(`${platformLang.curState} [on]`)
          }
          break
        }
        case '3600': {
          // Fan off
          if (this.cacheState !== 'off') {
            this.cacheState = 'off'
            this.service.updateCharacteristic(this.hapChar.Active, 0)
            this.accessory.log(`${platformLang.curState} [off]`)
          }
          break
        }
        default:
          logUnknownData(this.accessory, {
            kind: 'status',
            source: params.source,
            raw: command,
            hex: hexString,
          })
          break
      }
    })
  }
}
