import { hs2rgb } from '../utils/colour.js'
import {
  base64ToHex,
  generateCodeFromHexValues,
  getTwoItemPosition,
  hexToTwoItems,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Speed codes
    this.value2Code = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      5: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      6: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      7: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      8: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
    }

    // Migrate old %-rotation speed to unitless
    const existingFanService = this.accessory.getService(this.hapServ.Fan)
    if (existingFanService) {
      if (existingFanService.getCharacteristic(this.hapChar.RotationSpeed).props.unit === 'percentage') {
        this.accessory.removeService(existingFanService)
      }
    }

    // Add the fan service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fan) || this.accessory.addService(this.hapServ.Fan)
    this.setupWaterTank()

    // Add the night light service if it doesn't already exist
    this.lightService = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value
      ? 'on'
      : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 8,
        minStep: 1,
        minValue: 0,
        unit: 'unitless',
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler to the lightbulb on/off characteristic
    this.lightService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalLightStateUpdate(value)
    })
    this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value
      ? 'on'
      : 'off'

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'stateHumi',
        value: value ? 1 : 0,
      })

      // Cache the new state and log if appropriate
      this.cacheState = newValue
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      })
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // Don't continue if the speed is 0
      if (value === 0) {
        return
      }

      // Don't continue if the speed value won't have effect
      if (value === this.cacheSpeed) {
        return
      }

      // Get the scene code for this value
      const newCode = this.value2Code[value]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: newCode,
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? {
              instance: 'workMode',
              capabilityType: 'devices.capabilities.work_mode',
              value: { workMode: 1, modeValue: value },
            }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheSpeed = value
      this.accessory.log(`${platformLang.curSpeed} [${value}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
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

      // Generate the hex values for the code
      let hexValues
      if (value) {
        // Calculate current RGB values
        const newRGB = hs2rgb(
          this.lightService.getCharacteristic(this.hapChar.Hue).value,
          this.lightService.getCharacteristic(this.hapChar.Saturation).value,
        )
        hexValues = [
          0x33,
          0x1B,
          0x01,
          this.cacheBright,
          ...newRGB,
        ]
      } else {
        hexValues = [0x33, 0x1B, 0x00]
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: generateCodeFromHexValues(hexValues),
        openApi: this.accessory.context.openApiCapabilities?.nightlightToggle
          ? {
              instance: 'nightlightToggle',
              capabilityType: 'devices.capabilities.toggle',
              value: value ? 1 : 0,
            }
          : undefined,
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

  externalUpdate(params) {
    this.updateWaterTank(params)

    // Check for an ON/OFF change
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Handle OpenAPI workMode (speed)
    if (params.workMode) {
      const speed = params.workMode.modeValue
      if (speed >= 1 && speed <= 8) {
        this.cacheSpeed = speed
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      }
    }

    // Handle OpenAPI toggle (night light)
    if (params.toggles?.nightlightToggle !== undefined) {
      const newNight = params.toggles.nightlightToggle ? 'on' : 'off'
      if (newNight !== this.cacheLightState) {
        this.cacheLightState = newNight
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
        this.accessory.log(`current night light state [${this.cacheLightState}]`)
      }
    }

    // Check the status frames for anything else that changed
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '1b00': // night light off
        case '1b01': { // night light on
          const newNight = deviceFunction === '1b01'
            ? 'on'
            : 'off'
          if (newNight !== this.cacheLightState) {
            this.cacheLightState = newNight
            this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
            this.accessory.log(`current night light state [${this.cacheLightState}]`)
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
