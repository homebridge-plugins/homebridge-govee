import {
  base64ToHex,
  getTwoItemPosition,
  hexToBase64,
  hexToDecimal,
  hexToTwoItems,
  parseError,
  statusToActionCode,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

/*
  H7122
  {
    "mode": {
      "options": [
        {
          "name": "Low",
          "value": 1
        },
        {
          "name": "Medium",
          "value": 2
        },
        {
          "name": "High",
          "value": 3
        },
        {
          "name": "Auto mode",
          "value": 4
        },
        {
          "name": "Sleep mode",
          "value": 5
        },
        {
          "name": "CustomMode mode",
          "value": 6
        }
      ]
    }
  }
*/

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Speed codes
    this.value2Code = {
      1: 'OgUFAAAAAAAAAAAAAAAAAAAAADo=', // sleep
      2: 'OgUBAQAAAAAAAAAAAAAAAAAAAD8=', // low
      3: 'OgUBAgAAAAAAAAAAAAAAAAAAADw=', // med
      4: 'OgUBAwAAAAAAAAAAAAAAAAAAAD0=', // high
      5: 'OgUDAAAAAAAAAAAAAAAAAAAAADw=', // auto
    }

    this.value2Label = {
      0: 'off',
      1: 'sleep',
      2: 'low',
      3: 'medium',
      4: 'high',
      5: 'auto',
    }

    // Govee OpenAPI work modes: sleep=workMode 5, auto=workMode 3,
    // low/medium/high=workMode 1 with modeValue 1/2/3
    this.value2WorkMode = {
      1: { workMode: 5, modeValue: 0 },
      2: { workMode: 1, modeValue: 1 },
      3: { workMode: 1, modeValue: 2 },
      4: { workMode: 1, modeValue: 3 },
      5: { workMode: 3, modeValue: 0 },
    }

    this.night2Code = {
      on: 'MxgBMgAAAAAAAAAAAAAAAAAAABg=',
      off: 'MxgAMgAAAAAAAAAAAAAAAAAAABk=',
    }

    // Add the purifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.AirPurifier)
      || this.accessory.addService(this.hapServ.AirPurifier)

    // Add the air quality service if it doesn't already exist
    this.airService = this.accessory.getService(this.hapServ.AirQualitySensor)

    if (!this.airService) {
      this.airService = this.accessory.addService(this.hapServ.AirQualitySensor)
      this.airService.addCharacteristic(this.hapChar.PM2_5Density)
    }
    this.cacheAir = this.airService.getCharacteristic(this.hapChar.PM2_5Density).value

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'

    // Add options to the purifier target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetAirPurifierState)
      .updateValue(1)
      .setProps({
        minValue: 1,
        maxValue: 1,
        validValues: [1],
      })

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 20,
        validValues: [0, 20, 40, 60, 80, 100],
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheMode = this.service.getCharacteristic(this.hapChar.RotationSpeed).value / 20

    // Add the set handler to the lock controls characteristic
    this.service.getCharacteristic(this.hapChar.LockPhysicalControls).onSet(async (value) => {
      await this.internalLockUpdate(value)
    })
    this.cacheLock = this.service.getCharacteristic(this.hapChar.LockPhysicalControls).value === 0 ? 'off' : 'on'

    // Add night light Eve characteristic if it doesn't exist already
    if (!this.service.testCharacteristic(this.cusChar.NightLight)) {
      this.service.addCharacteristic(this.cusChar.NightLight)
    }

    // Add the set handler to the custom night light characteristic
    this.service.getCharacteristic(this.cusChar.NightLight).onSet(async (value) => {
      await this.internalNightLightUpdate(value)
    })
    this.cacheLight = this.service.getCharacteristic(this.cusChar.NightLight).value ? 'on' : 'off'

    // Add display light Eve characteristic if it doesn't exist already
    if (!this.service.testCharacteristic(this.cusChar.DisplayLight)) {
      this.service.addCharacteristic(this.cusChar.DisplayLight)
    }

    // Add the set handler to the custom display light characteristic
    this.service.getCharacteristic(this.cusChar.DisplayLight).onSet(async (value) => {
      await this.internalDisplayLightUpdate(value)
    })
    this.cacheDisplay = this.service.getCharacteristic(this.cusChar.DisplayLight).value
      ? 'on'
      : 'off'

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value === 1 ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'statePuri',
        value: value ? 1 : 0,
      })

      // Update the current state characteristic
      this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, value === 1 ? 2 : 0)

      // Cache the new state and log if appropriate
      this.cacheState = newValue
      this.accessory.log(`${platformLang.curState} [${newValue}]`)
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
      // Don't continue if the speed is 0
      if (value === 0) {
        return
      }

      // Get the single Govee value {1, 2, 3, 4}
      const newValueKey = value / 20

      // Don't continue if the speed value won't have effect
      if (!newValueKey || newValueKey === this.cacheMode) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.value2Code[newValueKey],
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: this.value2WorkMode[newValueKey] }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheMode = newValueKey
      this.accessory.log(`${platformLang.curMode} [${this.value2Label[this.cacheMode]}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheMode * 20)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalNightLightUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheLight === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.night2Code[newValue],
        openApi: this.accessory.context.openApiCapabilities?.nightlightToggle
          ? { instance: 'nightlightToggle', capabilityType: 'devices.capabilities.toggle', value: newValue === 'on' ? 1 : 0 }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheLight = newValue
      this.accessory.log(`${platformLang.curLight} [${newValue}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.cusChar.NightLight, this.cacheLight === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLockUpdate(value) {
    try {
      const newValue = value === 1 ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheLock === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MxABAAAAAAAAAAAAAAAAAAAAACI=' : 'MxAAAAAAAAAAAAAAAAAAAAAAACM=',
        openApi: this.accessory.context.openApiCapabilities?.lockToggle
          ? { instance: 'lockToggle', capabilityType: 'devices.capabilities.toggle', value: value ? 1 : 0 }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheLock = newValue
      this.accessory.log(`${platformLang.curLock} [${newValue}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.LockPhysicalControls,
          this.cacheLock === 'on' ? 1 : 0,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalDisplayLightUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheDisplay === newValue) {
        return
      }

      // Generate the code to send
      let codeToSend
      if (value) {
        codeToSend = this.accessory.context.cacheDisplayCode
          ? hexToBase64(statusToActionCode(this.accessory.context.cacheDisplayCode))
          : 'MxYBAAAAAAAAAAAAAAAAAAAAACQ='
      } else {
        codeToSend = 'MxYAAAAAAAAAAAAAAAAAAAAAACU='
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: codeToSend,
        openApi: this.accessory.context.openApiCapabilities?.displayToggle
          ? { instance: 'displayToggle', capabilityType: 'devices.capabilities.toggle', value: value ? 1 : 0 }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheDisplay = newValue
      this.accessory.log(`${platformLang.curDisplay} [${newValue}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.cusChar.DisplayLight, this.cacheDisplay === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // Check for an ON/OFF change
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on')
      this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, this.cacheState === 'on' ? 2 : 0)

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Handle OpenAPI workMode (speed/mode)
    if (params.workMode) {
      const { workMode, modeValue } = params.workMode
      let newMode
      if (workMode === 5) {
        newMode = 1 // sleep
      } else if (workMode === 3) {
        newMode = 5 // auto
      } else if (workMode === 1) {
        newMode = (Number.isFinite(modeValue) ? modeValue : 1) + 1 // gear 1/2/3 -> low/medium/high
      }
      if (newMode && newMode !== this.cacheMode) {
        this.cacheMode = newMode
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheMode * 20)
        this.accessory.log(`${platformLang.curMode} [${this.value2Label[this.cacheMode]}]`)
      }
    }

    // Handle OpenAPI toggles
    if (params.toggles) {
      if (params.toggles.lockToggle !== undefined) {
        const newLock = params.toggles.lockToggle ? 'on' : 'off'
        if (newLock !== this.cacheLock) {
          this.cacheLock = newLock
          this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock === 'on' ? 1 : 0)
          this.accessory.log(`${platformLang.curLock} [${this.cacheLock}]`)
        }
      }
      if (params.toggles.nightlightToggle !== undefined) {
        const newLight = params.toggles.nightlightToggle ? 'on' : 'off'
        if (this.cacheLight !== newLight) {
          this.cacheLight = newLight
          this.service.updateCharacteristic(this.cusChar.NightLight, this.cacheLight === 'on')
          this.accessory.log(`${platformLang.curLight} [${this.cacheLight}]`)
        }
      }
      if (params.toggles.displayToggle !== undefined) {
        const newDisplay = params.toggles.displayToggle ? 'on' : 'off'
        if (newDisplay !== this.cacheDisplay) {
          this.cacheDisplay = newDisplay
          this.service.updateCharacteristic(this.cusChar.DisplayLight, this.cacheDisplay === 'on')
          this.accessory.log(`${platformLang.curDisplay} [${this.cacheDisplay}]`)
        }
      }
    }

    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      const deviceFunction = `${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}`

      switch (deviceFunction) {
        case 'aa05': // speed
        case '3a05': { // speed
          const newSpeedCode = `${getTwoItemPosition(hexParts, 3)}${getTwoItemPosition(hexParts, 4)}`

          // Different behaviour for custom speed
          if (newSpeedCode === '0202') {
            this.accessory.log(`${platformLang.curMode} [custom]`)
            return
          }

          let newMode

          switch (newSpeedCode) {
            case '0500': {
              // Sleep
              newMode = 1
              break
            }
            case '0101': {
              // Low
              newMode = 2
              break
            }
            case '0102': {
              // Medium
              newMode = 3
              break
            }
            case '0103': {
              // High
              newMode = 4
              break
            }
            case '0300': {
              // Auto
              newMode = 5
              break
            }
          }

          if (newMode && newMode !== this.cacheMode) {
            this.cacheMode = newMode
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheMode * 20)
            this.accessory.log(`${platformLang.curMode} [${this.value2Label[this.cacheMode]}]`)
          }
          break
        }
        case 'aa10': { // lock
          const newLock = getTwoItemPosition(hexParts, 3) === '01' ? 'on' : 'off'
          if (newLock !== this.cacheLock) {
            this.cacheLock = newLock
            this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curLock} [${this.cacheLock}]`)
          }
          break
        }
        case 'aa16': { // display light
          const newDisplay = getTwoItemPosition(hexParts, 3) === '01' ? 'on' : 'off'
          if (newDisplay === 'on') {
            this.accessory.context.cacheDisplayCode = hexString
          }
          if (newDisplay !== this.cacheDisplay) {
            this.cacheDisplay = newDisplay
            this.service.updateCharacteristic(this.cusChar.DisplayLight, this.cacheDisplay === 'on')

            // Log the change
            this.accessory.log(`${platformLang.curDisplay} [${this.cacheDisplay}]`)
          }
          break
        }
        case 'aa1c': {
          // Check air quality reading
          // part 3 may be the air quality reading, (i.e. 1=green, 2=blue, 3=yellow, 4=red)
          const qualHex = `${getTwoItemPosition(hexParts, 4)}${getTwoItemPosition(hexParts, 5)}`
          const qualDec = hexToDecimal(`0x${qualHex}`)
          if (qualDec !== this.cacheAir) {
            // Air quality is different so update Homebridge with new values
            this.cacheAir = qualDec
            this.airService.updateCharacteristic(this.hapChar.PM2_5Density, this.cacheAir)

            // Log the change
            this.accessory.log(`${platformLang.curPM25} [${qualDec}µg/m³]`)

            // Check for any change to the main air quality characteristic
            // PM2.5 has a range of 0-1000µg/m³
            // HK characteristic ranges from 1-5 (excellent, good, fair, inferior, poor)
            // Scales based on Govee manual
            // 0-12.0µg/m³ = excellent
            // 12-35µg/m³ = good
            // 35-75µg/m³ = fair
            // 75-115µg/m³ = inferior
            // 115-500µg/m³ = poor (use 1000 for HK)
            if (this.cacheAir <= 12) {
              const newValue = 'excellent'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 1)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            } else if (this.cacheAir <= 35) {
              const newValue = 'good'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 2)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            } else if (this.cacheAir <= 75) {
              const newValue = 'fair'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 3)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            } else if (this.cacheAir <= 115) {
              const newValue = 'inferior'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 4)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            } else {
              const newValue = 'poor'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 5)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            }
          }
          break
        }
        case 'aa11': // timer
        case 'aa13': // scheduling
        case '3310': // lock (same command for on and off)
        case '3311': // timer
        case '3313': // scheduling
        case '3316': { // display light
          break
        }
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
