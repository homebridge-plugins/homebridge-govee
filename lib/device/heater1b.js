import {
  base64ToHex,
  farToCen,
  getTwoItemPosition,
  hasProperty,
  hexToTwoItems,
  nearestHalf,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

/*
  H7130 (with temperature reporting)
  {
    "mode": {
      "options": [
        {
          "name": "Low",
          "value": "1"
        },
        {
          "name": "Medium",
          "value": "2"
        },
        {
          "name": "High",
          "value": "3"
        }
      ]
    }
  }
*/
export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    this.log = platform.log

    // Set up variables from the accessory
    this.accessory = accessory

    // Set up objects
    this.speedCode = {
      33: 'MwUBAAAAAAAAAAAAAAAAAAAAADc=',
      66: 'MwUCAAAAAAAAAAAAAAAAAAAAADQ=',
      99: 'MwUDAAAAAAAAAAAAAAAAAAAAADU=',
    }

    this.speedCodeLabel = {
      33: 'low',
      66: 'medium',
      99: 'high',
    }

    this.tempCodeAuto = {
      5: 'MxoBAJAEAAAAAAAAAAAAAAAAALw=',
      6: 'MxoBAJBoAAAAAAAAAAAAAAAAANA=',
      7: 'MxoBAJEwAAAAAAAAAAAAAAAAAIk=',
      8: 'MxoBAJH4AAAAAAAAAAAAAAAAAEE=',
      9: 'MxoBAJLAAAAAAAAAAAAAAAAAAHo=',
      10: 'MxoBAJOIAAAAAAAAAAAAAAAAADM=',
      11: 'MxoBAJPsAAAAAAAAAAAAAAAAAFc=',
      12: 'MxoBAJS0AAAAAAAAAAAAAAAAAAg=',
      13: 'MxoBAJV8AAAAAAAAAAAAAAAAAME=',
      14: 'MxoBAJZEAAAAAAAAAAAAAAAAAPo=',
      15: 'MxoBAJcMAAAAAAAAAAAAAAAAALM=',
      16: 'MxoBAJdwAAAAAAAAAAAAAAAAAM8=',
      17: 'MxoBAJg4AAAAAAAAAAAAAAAAAIg=',
      18: 'MxoBAJkAAAAAAAAAAAAAAAAAALE=',
      19: 'MxoBAJnIAAAAAAAAAAAAAAAAAHk=',
      20: 'MxoBAJqQAAAAAAAAAAAAAAAAACI=',
      21: 'MxoBAJr0AAAAAAAAAAAAAAAAAEY=',
      22: 'MxoBAJu8AAAAAAAAAAAAAAAAAA8=',
      23: 'MxoBAJyEAAAAAAAAAAAAAAAAADA=',
      24: 'MxoBAJ1MAAAAAAAAAAAAAAAAAPk=',
      25: 'MxoBAJ4UAAAAAAAAAAAAAAAAAKI=',
      26: 'MxoBAJ54AAAAAAAAAAAAAAAAAM4=',
      27: 'MxoBAJ9AAAAAAAAAAAAAAAAAAPc=',
      28: 'MxoBAKAIAAAAAAAAAAAAAAAAAIA=',
      29: 'MxoBAKDQAAAAAAAAAAAAAAAAAFg=',
      30: 'MxoBAKGYAAAAAAAAAAAAAAAAABE=',
    }

    this.tempCodeHeat = {
      5: 'MxoAAJAEAAAAAAAAAAAAAAAAAL0=',
      6: 'MxoAAJBoAAAAAAAAAAAAAAAAANE=',
      7: 'MxoAAJEwAAAAAAAAAAAAAAAAAIg=',
      8: 'MxoAAJH4AAAAAAAAAAAAAAAAAEA=',
      9: 'MxoAAJLAAAAAAAAAAAAAAAAAAHs=',
      10: 'MxoAAJOIAAAAAAAAAAAAAAAAADI=',
      11: 'MxoAAJPsAAAAAAAAAAAAAAAAAFY=',
      12: 'MxoAAJS0AAAAAAAAAAAAAAAAAAk=',
      13: 'MxoAAJV8AAAAAAAAAAAAAAAAAMA=',
      14: 'MxoAAJZEAAAAAAAAAAAAAAAAAPs=',
      15: 'MxoAAJcMAAAAAAAAAAAAAAAAALI=',
      16: 'MxoAAJdwAAAAAAAAAAAAAAAAAM4=',
      17: 'MxoAAJg4AAAAAAAAAAAAAAAAAIk=',
      18: 'MxoAAJkAAAAAAAAAAAAAAAAAALA=',
      19: 'MxoAAJnIAAAAAAAAAAAAAAAAAHg=',
      20: 'MxoAAJqQAAAAAAAAAAAAAAAAACM=',
      21: 'MxoAAJr0AAAAAAAAAAAAAAAAAEc=',
      22: 'MxoAAJu8AAAAAAAAAAAAAAAAAA4=',
      23: 'MxoAAJyEAAAAAAAAAAAAAAAAADE=',
      24: 'MxoAAJ1MAAAAAAAAAAAAAAAAAPg=',
      25: 'MxoAAJ4UAAAAAAAAAAAAAAAAAKM=',
      26: 'MxoAAJ54AAAAAAAAAAAAAAAAAM8=',
      27: 'MxoAAJ9AAAAAAAAAAAAAAAAAAPY=',
      28: 'MxoAAKAIAAAAAAAAAAAAAAAAAIE=',
      29: 'MxoAAKDQAAAAAAAAAAAAAAAAAFk=',
      30: 'MxoAAKGYAAAAAAAAAAAAAAAAABA=',
    }

    // Remove any old light service
    if (this.accessory.getService(this.hapServ.Lightbulb)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
    }

    // Remove any old fanv2 service
    if (this.accessory.getService(this.hapServ.Fanv2)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fanv2))
    }

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.HeaterCooler)
      this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 20)
      this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 20)
    }

    // Add the fan service if it doesn't already exist
    this.fanService = this.accessory.getService(this.hapServ.Fan)
      || this.accessory.addService(this.hapServ.Fan)

    // Add the set handler to the heater active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'

    // Add options to the heater target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetHeaterCoolerState)
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1],
      })
      .onSet(async value => this.internalModeUpdate(value))
    this.cacheMode = this.service.getCharacteristic(this.hapChar.TargetHeaterCoolerState).value === 0 ? 'auto' : 'heat'

    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value

    // Add the set handler and a range to the heater target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .setProps({
        minValue: 5,
        maxValue: 30,
        minStep: 1,
      })
      .onSet(async value => this.internalTempUpdate(value))
    this.cacheTarg = this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value

    // Add the set handler to the heater swing mode characteristic (for oscillation)
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'

    // Add the set handler to the heater lock characteristic
    this.service
      .getCharacteristic(this.hapChar.LockPhysicalControls)
      .onSet(async value => this.internalLockUpdate(value))
    this.cacheLock = this.service.getCharacteristic(this.hapChar.LockPhysicalControls).value === 1 ? 'on' : 'off'

    // Add the set handler to the fan on/off characteristic
    this.fanService
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalFanStateUpdate(value))
    this.cacheFanState = this.fanService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.fanService
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 33,
        validValues: [0, 33, 66, 99],
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.fanService.getCharacteristic(this.hapChar.RotationSpeed).value

    // Output the customised options to the log
    const opts = JSON.stringify({
      tempReporting: true,
    })
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
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${newValue}]`)
      }

      // Fan state should also match the new state
      if (this.cacheFanState !== newValue) {
        this.cacheFanState = newValue
        this.fanService.updateCharacteristic(this.hapChar.On, newValue === 'on')
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

  async internalModeUpdate(value) {
    try {
      const newMode = value === 0 ? 'auto' : 'heat'

      // Don't continue if the new value is the same as before
      if (this.cacheMode === newMode) {
        return
      }

      // Get the current state of the heater
      const objectToChoose = newMode === 'auto' ? this.tempCodeAuto : this.tempCodeHeat

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: objectToChoose[this.cacheTarg],
      })

      // Cache the new state and log if appropriate
      if (this.cacheMode !== newMode) {
        this.cacheMode = newMode
        this.accessory.log(`${platformLang.curMode} [${newMode}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.TargetHeaterCoolerState,
          this.cacheMode === 'auto' ? 0 : 1,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalTempUpdate(value) {
    try {
      // Don't continue if the new value is the same as before
      if (this.cacheTarg === value) {
        return
      }

      // Get the current state of the heater
      const objectToChoose = this.cacheMode === 'auto' ? this.tempCodeAuto : this.tempCodeHeat

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: objectToChoose[value],
        openApi: this.accessory.context.openApiCapabilities?.targetTemperature
          ? { instance: 'targetTemperature', capabilityType: 'devices.capabilities.temperature_setting', value: { temperature: value, unit: 'Celsius', autoStop: 0 } }
          : undefined,
      })

      // Cache the new state and log if appropriate
      if (this.cacheTarg !== value) {
        this.cacheTarg = value
        this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}°C]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, this.cacheTarg)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSwingUpdate(value) {
    try {
      // value === 0 -> swing mode OFF
      // value === 1 -> swing mode ON
      const newValue = value === 1 ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheSwing === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MxgBAAAAAAAAAAAAAAAAAAAAACo=' : 'MxgAAAAAAAAAAAAAAAAAAAAAACs=',
        openApi: this.accessory.context.openApiCapabilities?.oscillationToggle
          ? { instance: 'oscillationToggle', capabilityType: 'devices.capabilities.toggle', value: value ? 1 : 0 }
          : undefined,
      })

      // Cache the new state and log if appropriate
      if (this.cacheSwing !== newValue) {
        this.cacheSwing = newValue
        this.accessory.log(`${platformLang.curSwing} [${newValue}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(
          this.hapChar.SwingMode,
          this.cacheSwing === 'on' ? 1 : 0,
        )
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalLockUpdate(value) {
    try {
      // value === 0 -> child lock OFF
      // value === 1 -> child lock ON
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
      if (this.cacheLock !== newValue) {
        this.cacheLock = newValue
        this.accessory.log(`${platformLang.curLock} [${newValue}]`)
      }
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

  async internalFanStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // The fan is used for the following modes (basically all except Auto):
      //  - 0%_: No effect - revert to previous speed
      //  - 33%: Low Mode
      //  - 66%: Medium Mode
      //  - 99%: High Mode
      // If the main heater is turned off then this fan should be turned off too
      // If the main heater is turned on then this fan speed should revert to the current mode

      // Don't continue if the new value is the same as before
      if (this.cacheFanState === newValue) {
        return
      }

      // Turning the fan on should only be possible if the main heater is off, and this should not do anything
      if (newValue === 'on') {
        // Wait a few seconds then turn back off
        setTimeout(() => {
          this.fanService.updateCharacteristic(this.hapChar.On, false)
        }, 3000)
        return
      }

      // Turning fan off:
      // We should wait a few seconds and then just revert to the previous fan speed
      setTimeout(() => {
        this.fanService.updateCharacteristic(this.hapChar.On, true)
        this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      }, 2000)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.fanService.updateCharacteristic(this.hapChar.On, this.cacheFanState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // The fan is used for the following modes (basically all except Auto):
      //  - 0%_: Not sure what to do with this yet
      //  - 33%: Low Mode
      //  - 66%: Medium Mode
      //  - 99%: High Mode
      // If the main heater is turned off then this fan should be turned off too
      // If the main heater is turned on then this fan speed should revert to the current mode

      // Don't continue if the new value is the same as before
      // If the new speed is 0, the on/off handler should take care of resetting to the speed before (home app only)
      if (this.cacheSpeed === value || value === 0) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.speedCode[value],
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: 1, modeValue: { 33: 1, 66: 2, 99: 3 }[value] } }
          : undefined,
      })

      // Cache the new state and log if appropriate
      if (this.cacheSpeed !== value) {
        this.cacheSpeed = value
        this.accessory.log(`${platformLang.curSpeed} [${this.speedCodeLabel[value]}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.fanService.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
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

      // Fan state should also match the main heater state
      if (this.cacheFanState !== this.cacheState) {
        this.cacheFanState = this.cacheState
        this.fanService.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      }
    }

    // Update the current temperature characteristic
    if (hasProperty(params, 'temperature')) {
      const newTemp = nearestHalf(farToCen(params.temperature / 100))
      if (newTemp !== this.cacheTemp) {
        if (newTemp > 100) {
          // Device must be one that does not support ambient temperature
          this.accessory.logWarn('you should disable `tempReporting` in the config for this device')
        } else {
          this.cacheTemp = newTemp
          this.service.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
          this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C]`)
        }
      }
    }

    // Update the target temperature characteristic
    if (hasProperty(params, 'setTemperature')) {
      const newTemp = Math.round(farToCen(params.setTemperature / 100))
      if (newTemp !== this.cacheTarg) {
        this.cacheTarg = newTemp
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, this.cacheTarg)
        this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}°C]`)
      }
    }

    // Handle OpenAPI workMode
    if (params.workMode) {
      const modeValue = params.workMode.modeValue
      if (Number.isFinite(modeValue)) {
        const speedMap = { 1: 33, 2: 66, 3: 99 }
        const newSpeed = speedMap[modeValue] || modeValue
        if (this.cacheSpeed !== newSpeed) {
          this.cacheSpeed = newSpeed
          this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
          this.accessory.log(`${platformLang.curSpeed} [${this.speedCodeLabel[this.cacheSpeed]}]`)
        }
      }
    }

    // Handle OpenAPI toggles
    if (params.toggles) {
      if (params.toggles.oscillationToggle !== undefined) {
        const newSwing = params.toggles.oscillationToggle ? 'on' : 'off'
        if (this.cacheSwing !== newSwing) {
          this.cacheSwing = newSwing
          this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
          this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
        }
      }
      if (params.toggles.lockToggle !== undefined) {
        const newLock = params.toggles.lockToggle ? 'on' : 'off'
        if (this.cacheLock !== newLock) {
          this.cacheLock = newLock
          this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock === 'on' ? 1 : 0)
          this.accessory.log(`${platformLang.curLock} [${this.cacheLock}]`)
        }
      }
    }

    // Handle OpenAPI target temperature
    if (params.targetTemperature) {
      const temp = params.targetTemperature.temperature || params.targetTemperature
      if (Number.isFinite(temp) && temp !== this.cacheTarg) {
        this.cacheTarg = temp
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, this.cacheTarg)
        this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}°C]`)
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

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '1800':
        case '1801': {
          // Swing Mode
          const newSwing = getTwoItemPosition(hexParts, 3) === '01' ? 'on' : 'off'
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
          }
          break
        }
        case '1000':
        case '1001': {
          // Child Lock
          const newLock = getTwoItemPosition(hexParts, 3) === '01' ? 'on' : 'off'
          if (this.cacheLock !== newLock) {
            this.cacheLock = newLock
            this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curLock} [${this.cacheLock}]`)
          }
          break
        }
        case '0501': // fan speed low
        case '0502': // fan speed medium
        case '0503': { // fan speed high
          switch (getTwoItemPosition(hexParts, 3)) {
            case '01': {
              // Fan is low
              if (this.cacheState === 'on' && this.cacheFanState !== 'on') {
                this.cacheFanState = 'on'
                this.fanService.updateCharacteristic(this.hapChar.On, true)
                this.accessory.log(`${platformLang.curMode} [${this.cacheFanState}]`)
              }
              if (this.cacheSpeed !== 33) {
                this.cacheSpeed = 33
                this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
                this.accessory.log(`${platformLang.curSpeed} [${this.speedCodeLabel[this.cacheSpeed]}]`)
              }

              break
            }
            case '02': {
              // Fan is medium
              if (this.cacheState === 'on' && this.cacheFanState !== 'on') {
                this.cacheFanState = 'on'
                this.fanService.updateCharacteristic(this.hapChar.On, true)
                this.accessory.log(`${platformLang.curMode} [${this.cacheFanState}]`)
              }
              if (this.cacheSpeed !== 66) {
                this.cacheSpeed = 66
                this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
                this.accessory.log(`${platformLang.curSpeed} [${this.speedCodeLabel[this.cacheSpeed]}]`)
              }
              break
            }
            case '03': {
              // Fan is high
              if (this.cacheState === 'on' && this.cacheFanState !== 'on') {
                this.cacheFanState = 'on'
                this.fanService.updateCharacteristic(this.hapChar.On, true)
                this.accessory.log(`${platformLang.curMode} [${this.cacheFanState}]`)
              }
              if (this.cacheSpeed !== 99) {
                this.cacheSpeed = 99
                this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
                this.accessory.log(`${platformLang.curSpeed} [${this.speedCodeLabel[this.cacheSpeed]}]`)
              }
              break
            }
          }
          break
        }
        case '1a00': // Target temperature (thermostat mode off)
        case '1a01': { // Target temperature (thermostat mode on)
          const newMode = getTwoItemPosition(hexParts, 3) === '01' ? 'auto' : 'heat'
          if (this.cacheMode !== newMode) {
            this.cacheMode = newMode
            this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, this.cacheMode === 'auto' ? 0 : 1)
            this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
          }
          break
        }
        case '1100': // timer off?
        case '1101':// timer on
        case '1300': // scheduling
        case '1600': // DND off?
        case '1601': // DND on?
          break
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
