import { hs2rgb, rgb2hs } from '../utils/colour.js'
import {
  base64ToHex,
  fanSpeedToHkPercent,
  generateCodeFromHexValues,
  generateRandomString,
  getTwoItemPosition,
  hexToDecimal,
  hexToTwoItems,
  hkPercentToFanSpeed,
  parseError,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

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

    // Codes etc
    this.speedCodes = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      5: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      6: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      7: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      8: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
      9: 'MwUBCQAAAAAAAAAAAAAAAAAAAD4=',
      10: 'MwUBCgAAAAAAAAAAAAAAAAAAAD0=',
      11: 'MwUBCwAAAAAAAAAAAAAAAAAAADw=',
      12: 'MwUBDAAAAAAAAAAAAAAAAAAAADs=',
      13: 'MwUAAgAAAAAAAAAAAAAAAAAAADQ=', // auto mode
    }
    this.autoSpeed = 13
    // Real speed steps, excluding auto - HomeKit percentages map onto these
    this.speedSteps = 12

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
        maxValue: 100,
        minStep: 1,
        minValue: 0,
        unit: 'unitless', // This is actually from HAP for Bluetooth LE Specification, but fits
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler to the fan swing mode
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'
    this.cacheSwingCode = ''

    if (this.hideLight) {
      if (this.accessory.getService(this.hapServ.Lightbulb)) {
        // Remove the light service if it exists
        this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
      }
    } else {
      // Add the night light service if it doesn't already exist
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

      // Add the set handler to the lightbulb hue characteristic
      this.lightService.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
        await this.internalColourUpdate(value)
      })
      this.cacheHue = this.lightService.getCharacteristic(this.hapChar.Hue).value
      this.cacheSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
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

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${newValue}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // Don't continue if the fan is being turned off
      if (value === 0) {
        return
      }

      // HomeKit sends a percentage - map it onto this model's real speed steps
      value = hkPercentToFanSpeed(value, this.speedSteps)

      // Don't continue if the new value is the same as before
      if (this.cacheSpeed === value) {
        return
      }

      const isAuto = value === this.autoSpeed
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.speedCodes[value],
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: isAuto ? { workMode: 2 } : { workMode: 1, modeValue: value } }
          : undefined,
      })

      // Cache the new state and log if appropriate
      if (this.cacheSpeed !== value) {
        this.cacheSpeed = value
        this.accessory.log(`${platformLang.curSpeed} [${value}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, fanSpeedToHkPercent(this.cacheSpeed, this.speedSteps, this.autoSpeed))
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSwingUpdate(value) {
    try {
      // Don't continue if the new value is the same as before
      if (this.cacheSwing === value) {
        return
      }

      throw new Error('Swing mode update not implemented yet')

      // const newValue = value ? 'on' : 'off'
      // The existing cacheSwingCode might be something like aa1d0101960384000000000000000000000000a6
      // We need to change the third hex value to 00 for off or 01 for on
      // const hexValues = [
      //   0x3A,
      //   0x1D,
      //   value ? 0x01 : 0x00,
      //   ...this.cacheSwingCode.slice(6, 14).match(/.{1,2}/g).map(byte => Number.parseInt(byte, 16)),
      // ]
      //
      // await this.platform.sendDeviceUpdate(this.accessory, {
      //   cmd: 'multiSync',
      //   value: generateCodeFromHexValues(hexValues),
      // })

      // Cache the new state and log if appropriate
      // if (this.cacheSwing !== newValue) {
      //   this.cacheSwing = newValue
      //   this.accessory.log(`${platformLang.curSwing} [${newValue}]`)
      // }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
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
      const hexValues = [0x3A, 0x1B, 0x01, 0x01, value ? 0x01 : 0x00]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      // Cache the new state and log if appropriate
      if (this.cacheLightState !== newValue) {
        this.cacheLightState = newValue
        this.accessory.log(`${platformLang.curLight} [${newValue}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
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

      // Generate the hex values for the code
      const hexValues = [0x3A, 0x1B, 0x01, 0x02, value]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
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
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
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

      // Don't continue if the new value is the same as before
      if (value === this.cacheHue) {
        return
      }

      // Calculate RGB values
      const newRGB = hs2rgb(value, this.lightService.getCharacteristic(this.hapChar.Saturation).value)

      // Generate the hex values for the code
      const hexValues = [0x3A, 0x1B, 0x05, 0x0D, ...newRGB]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      // Cache the new state and log if appropriate
      if (this.cacheHue !== value) {
        this.cacheHue = value
        this.accessory.log(`${platformLang.curColour} [rgb ${newRGB.join(' ')}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.lightService.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // Update the active characteristic
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Handle OpenAPI workMode (speed or auto)
    if (params.workMode) {
      let newSpeed
      if (params.workMode.workMode === 2) {
        newSpeed = this.autoSpeed
      } else {
        newSpeed = params.workMode.modeValue
      }
      if (Number.isFinite(newSpeed) && newSpeed >= 1 && newSpeed <= this.autoSpeed && this.cacheSpeed !== newSpeed) {
        this.cacheSpeed = newSpeed
        const hkSpeed = fanSpeedToHkPercent(newSpeed, this.speedSteps, this.autoSpeed)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, hkSpeed)
        this.accessory.log(`${platformLang.curSpeed} [${newSpeed} -> ${hkSpeed}%]`)
      }
    }

    // Handle OpenAPI toggles
    if (params.toggles?.oscillationToggle !== undefined) {
      const newSwing = params.toggles.oscillationToggle ? 'on' : 'off'
      if (this.cacheSwing !== newSwing) {
        this.cacheSwing = newSwing
        this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
        this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
      }
    }

    // Check for some other scene/mode change
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
          // Fan speed
          const newSpeed = getTwoItemPosition(hexParts, 4)
          const newSpeedInt = Number.parseInt(newSpeed, 16)
          if (this.cacheSpeed !== newSpeedInt) {
            this.cacheSpeed = newSpeedInt
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
            this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}]`)
          }
          break
        }
        case '0500': {
          // Mode change (auto = 0x02)
          if (getTwoItemPosition(hexParts, 4) === '02' && this.cacheSpeed !== this.autoSpeed) {
            this.cacheSpeed = this.autoSpeed
            // Cache auto so we can tell it apart from "user asked for max speed"
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, 100)
            this.accessory.log(`${platformLang.curSpeed} [auto]`)
          }
          break
        }
        case '1b01': {
          // Night light on/off
          if (!this.hideLight) {
            const newLightState = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
            if (this.cacheLightState !== newLightState) {
              this.cacheLightState = newLightState
              this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
              this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
            }
            const newBrightness = hexToDecimal(getTwoItemPosition(hexParts, 5))
            if (this.cacheBright !== newBrightness) {
              this.cacheBright = newBrightness
              this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
              this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
            }
          }
          break
        }
        case '1b05': {
          // Night light colour
          if (!this.hideLight) {
            const newR = hexToDecimal(getTwoItemPosition(hexParts, 5))
            const newG = hexToDecimal(getTwoItemPosition(hexParts, 6))
            const newB = hexToDecimal(getTwoItemPosition(hexParts, 7))

            const hs = rgb2hs(newR, newG, newB)

            // Check for a colour change
            if (hs[0] !== this.cacheHue) {
              // Colour is different so update Homebridge with new values
              this.lightService.updateCharacteristic(this.hapChar.Hue, hs[0])
              this.lightService.updateCharacteristic(this.hapChar.Saturation, hs[1]);
              [this.cacheHue] = hs

              // Log the change
              this.accessory.log(`${platformLang.curColour} [rgb ${newR} ${newG} ${newB}]`)
            }
          }
          break
        }
        case '1d00':{
          // Swing Mode Off
          const newSwing = 'off'
          this.cacheSwingCode = hexString
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, 0)
            this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
          }
          break
        }
        case '1d01':{
          // Swing Mode On
          const newSwing = 'on'
          this.cacheSwingCode = hexString
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, 1)
            this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
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
