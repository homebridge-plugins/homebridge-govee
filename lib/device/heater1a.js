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
  H7130 (without temperature reporting)
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

    // Remove any old light service
    if (this.accessory.getService(this.hapServ.Lightbulb)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
    }

    // Remove any old heater service
    if (this.accessory.getService(this.hapServ.HeaterCooler)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.HeaterCooler))
    }

    // Remove any old fan service
    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
    }

    // Add the fan v2 service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fanv2) || this.accessory.addService(this.hapServ.Fanv2)

    // Add the set handler to the fan active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 33,
        validValues: [0, 33, 66, 99],
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler to the heater swing mode characteristic (for oscillation)
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'

    // Add the set handler to the heater lock characteristic (for oscillation)
    this.service
      .getCharacteristic(this.hapChar.LockPhysicalControls)
      .onSet(async value => this.internalLockUpdate(value))
    this.cacheLock = this.service.getCharacteristic(this.hapChar.LockPhysicalControls).value === 1 ? 'on' : 'off'

    // Output the customised options to the log
    const opts = JSON.stringify({
      tempReporting: false,
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
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
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

    // Update the current temperature characteristic
    if (hasProperty(params, 'temperature')) {
      const newTemp = nearestHalf(farToCen(params.temperature / 100))
      if (newTemp <= 100) {
        // Device must be one that DOES support ambient temperature
        this.accessory.logWarn('you should enable `tempReporting` in the config for this device')
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
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
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
              if (this.cacheSpeed !== 33) {
                this.cacheSpeed = 33
                this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
                this.accessory.log(`${platformLang.curSpeed} [${this.speedCodeLabel[this.cacheSpeed]}]`)
              }
              break
            }
            case '02': {
              // Fan is medium
              if (this.cacheSpeed !== 66) {
                this.cacheSpeed = 66
                this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
                this.accessory.log(`${platformLang.curSpeed} [${this.speedCodeLabel[this.cacheSpeed]}]`)
              }
              break
            }
            case '03': {
              // Fan is high
              if (this.cacheSpeed !== 99) {
                this.cacheSpeed = 99
                this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
                this.accessory.log(`${platformLang.curSpeed} [${this.speedCodeLabel[this.cacheSpeed]}]`)
              }
              break
            }
          }
          break
        }
        case '1a00': // Target temperature (thermostat mode off)
        case '1a01': { // Target temperature (thermostat mode on)
          break
        }
        default:
          this.accessory.logDebugWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
