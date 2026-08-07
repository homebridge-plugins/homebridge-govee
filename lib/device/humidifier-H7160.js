import { hs2rgb, rgb2hs } from '../utils/colour.js'
import {
  base64ToHex,
  generateCodeFromHexValues,
  generateRandomString,
  getTwoItemPosition,
  hexToDecimal,
  hexToTwoItems,
  sleep,
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
      9: 'MwUBCQAAAAAAAAAAAAAAAAAAAD4=',
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

    // Remove humidity sensor service if it exists
    if (this.accessory.getService(this.hapServ.HumiditySensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HumiditySensor))
    }

    // Add the night light service if it doesn't already exist
    this.lightService = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 9,
        minStep: 1,
        minValue: 0,
        unit: 'unitless',
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    this.cacheSpeedRaw = `0${this.cacheSpeed}` // example '02' for speed 2

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

    // Add the set handler to the lightbulb hue characteristic
    this.lightService.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
      await this.internalColourUpdate(value)
    })
    // Saturation needs a handler of its own. HomeKit writes hue and saturation
    // separately, so with only hue listened for, dragging saturation alone -
    // the same colour made paler or richer - reached nothing and the light
    // never changed. Both handlers share one update, and the debounce inside
    // it collapses a hue-and-saturation pair into a single command.
    this.lightService.getCharacteristic(this.hapChar.Saturation).onSet(async () => {
      await this.internalColourUpdate(this.lightService.getCharacteristic(this.hapChar.Hue).value)
    })
    this.cacheHue = this.lightService.getCharacteristic(this.hapChar.Hue).value
    this.cacheSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value

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
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
      }

      // Also turn the light off if turning off
      if (!value && this.cacheLightState === 'on') {
        this.lightService.updateCharacteristic(this.hapChar.On, false)
        this.accessory.log(`current light state [${this.cacheLightState}]`)
      }
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
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: 1, modeValue: value } }
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
        hexValues = [0x33, 0x1B, 0x01, this.cacheBright, ...newRGB]
      } else {
        hexValues = [0x33, 0x1B, 0x00]
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: generateCodeFromHexValues(hexValues),
        openApi: this.accessory.context.openApiCapabilities?.nightlightToggle
          ? { instance: 'nightlightToggle', capabilityType: 'devices.capabilities.toggle', value: value ? 1 : 0 }
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
      if (value === this.cacheBright || value === 0) {
        return
      }

      // Generate the hex values for the code
      const newRGB = hs2rgb(
        this.lightService.getCharacteristic(this.hapChar.Hue).value,
        this.lightService.getCharacteristic(this.hapChar.Saturation).value,
      )
      const hexValues = [0x33, 0x1B, 0x01, value, ...newRGB]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: generateCodeFromHexValues(hexValues),
      })

      // Govee considers 0% brightness to be off
      if (value === 0) {
        setTimeout(() => {
          this.cacheLightState = 'off'
          if (this.lightService.getCharacteristic(this.hapChar.On).value) {
            this.lightService.updateCharacteristic(this.hapChar.On, false)
            this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
          }
          this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
        }, 1500)
        return
      }

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

  async internalColourUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the colour wheel
      const updateKeyColour = generateRandomString(5)
      this.updateKeyColour = updateKeyColour
      await sleep(300)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }

      // Don't continue if the new colour is the same as before. Saturation is
      // part of that question: comparing hue alone meant a change of saturation
      // at the same hue looked like no change at all, and nothing was sent.
      const currentSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
      if (value === this.cacheHue && currentSat === this.cacheSat) {
        return
      }

      // Generate the hex values for the code
      const newRGB = hs2rgb(
        value,
        currentSat,
      )
      const hexValues = [0x33, 0x1B, 0x01, this.cacheBright, ...newRGB]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: generateCodeFromHexValues(hexValues),
      })

      // Cache the new state and log if appropriate. Saturation is cached on
      // every send, not only when the hue moved, or a change of saturation at
      // the same hue would be sent once and then look unchanged ever after.
      this.cacheSat = currentSat
      if (this.cacheHue !== value) {
        this.cacheHue = value
        this.accessory.log(`${platformLang.curColour} [rgb ${newRGB.join(' ')}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      })
    }
  }

  externalUpdate(params) {
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
      if (speed >= 1 && speed <= 9) {
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
        case '0500': { // mode
          // Mode
          const newModeRaw = getTwoItemPosition(hexParts, 4)
          let newMode
          switch (newModeRaw) {
            case '01': {
              // Manual
              newMode = 'manual'
              break
            }
            case '02': {
              // Custom
              newMode = 'custom'
              break
            }
            case '03': {
              // Auto
              newMode = 'auto'
              break
            }
            default:
              return
          }
          if (this.cacheMode !== newMode) {
            this.cacheMode = newMode
            this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
          }
          break
        }
        case '0501': {
          // Manual speed
          const newSpeedRaw = getTwoItemPosition(hexParts, 4)
          if (newSpeedRaw !== this.cacheSpeedRaw) {
            this.cacheSpeedRaw = newSpeedRaw
            this.cacheSpeed = Number.parseInt(newSpeedRaw, 16)
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
            this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}]`)
          }
          break
        }
        case '1800': // display off
        case '1801': { // display on
          const newDisplay = deviceFunction === '1801' ? 'on' : 'off'
          if (newDisplay !== this.cacheDisplay) {
            this.cacheDisplay = newDisplay
            this.accessory.log(`${platformLang.curDisplay} [${this.cacheDisplay ? 'on' : 'off'}]`)
          }
          break
        }
        case '1b00': // night light off
        case '1b01': { // night light on
          const newNight = deviceFunction === '1b01' ? 'on' : 'off'
          if (newNight !== this.cacheLightState) {
            this.cacheLightState = newNight
            this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
            this.accessory.log(`current night light state [${this.cacheLightState}]`)
          }

          // Brightness and colour
          if (this.cacheLightState === 'on') {
            const newBrightHex = getTwoItemPosition(hexParts, 4)
            const newBrightDec = Math.round(hexToDecimal(newBrightHex))
            if (newBrightDec !== this.cacheBright) {
              this.cacheBright = newBrightDec
              this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
              this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
            }

            const newR = hexToDecimal(getTwoItemPosition(hexParts, 5))
            const newG = hexToDecimal(getTwoItemPosition(hexParts, 6))
            const newB = hexToDecimal(getTwoItemPosition(hexParts, 7))
            const hs = rgb2hs(newR, newG, newB)

            // Check for a colour change. Saturation counts as much as hue, or a
            // change of saturation made in the Govee app is reported back and
            // ignored, leaving the tile showing the old colour.
            if (hs[0] !== this.cacheHue || hs[1] !== this.cacheSat) {
              // Colour is different so update Homebridge with new values
              this.lightService.updateCharacteristic(this.hapChar.Hue, hs[0])
              this.lightService.updateCharacteristic(this.hapChar.Saturation, hs[1]);
              [this.cacheHue, this.cacheSat] = hs

              // Log the change
              this.accessory.log(`${platformLang.curColour} [rgb ${newR} ${newG} ${newB}]`)
            }
          }
          break
        }
        case '0502': // custom mode
        case '0503': // auto mode
        case '1100': // timer
        case '1101': // timer
        case '1300': // scheduling
        case '1500': { // scheduling
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
