import {
  base64ToHex,
  fanSpeedToHkPercent,
  getTwoItemPosition,
  hexToTwoItems,
  hkPercentToFanSpeed,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

/*
  H7101
  {
    "mode": {
      "options": [
        {
          "name": "Custom",
          "value": 2
        },
        {
          "name": "Auto",
          "value": 3
        },
        {
          "name": "Sleep",
          "value": 5
        },
        {
          "name": "Nature",
          "value": 6
        }
      ]
    },
    "gear": {
      "options": [
        {
          "name": "gear",
          "value": [
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8
          ]
        }
      ]
    }
  }

  // NOTES
  H7101 -> Sleep, Nature, Turbo, Custom, Auto

  sleep
  [31/10/2022, 20:52:08] [Govee] [Device1] [AWS] receiving update {"source":"AWS","result":1,"commands":["qgUFAAAAAAAAAAAAAAAAAAAAAKo=","qgUABQAAAAAAAAAAAAAAAAAAAKo="]}.
  [31/10/2022, 20:52:08] [Govee] [Device1] new scene code: [qgUFAAAAAAAAAAAAAAAAAAAAAKo=] [aa050500000000000000000000000000000000aa].
  [31/10/2022, 20:52:08] [Govee] [Device1] new scene code: [qgUABQAAAAAAAAAAAAAAAAAAAKo=] [aa050005000000000000000000000000000000aa].

  nature
  [31/10/2022, 20:52:43] [Govee] [Device1] [AWS] receiving update {"source":"AWS","result":1,"commands":["qgUGAAAAAAAAAAAAAAAAAAAAAKk=","qgUABgAAAAAAAAAAAAAAAAAAAKk="]}.
  [31/10/2022, 20:52:43] [Govee] [Device1] new scene code: [qgUGAAAAAAAAAAAAAAAAAAAAAKk=] [aa050600000000000000000000000000000000a9].
  [31/10/2022, 20:52:43] [Govee] [Device1] new scene code: [qgUABgAAAAAAAAAAAAAAAAAAAKk=] [aa050006000000000000000000000000000000a9].
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
      9: 'MwUAAwAAAAAAAAAAAAAAAAAAADU=', // auto mode
    }
    this.autoSpeed = 9
    // Real speed steps, excluding auto - HomeKit percentages map onto these
    this.speedSteps = 8

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
        unit: 'unitless',
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler to the fan swing mode
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'

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

      const codeToSend = this.speedCodes[value]

      const isAuto = value === this.autoSpeed
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: codeToSend,
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: isAuto ? { workMode: 3 } : { workMode: 1, modeValue: value } }
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
      const newValue = value ? 'on' : 'off'
      // Don't continue if the new value is the same as before
      if (this.cacheSwing === value) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'Mx8BAQAAAAAAAAAAAAAAAAAAACw=' : 'Mx8BAAAAAAAAAAAAAAAAAAAAAC0=',
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
        this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
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
      if (params.workMode.workMode === 3) {
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
          const newSpeed = Number.parseInt(getTwoItemPosition(hexParts, 4), 16)
          if (newSpeed >= 1 && newSpeed <= this.speedSteps && this.cacheSpeed !== newSpeed) {
            this.cacheSpeed = newSpeed
            const hkSpeed = fanSpeedToHkPercent(newSpeed, this.speedSteps, this.autoSpeed)
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, hkSpeed)
            this.accessory.log(`${platformLang.curSpeed} [${newSpeed} -> ${hkSpeed}%]`)
          }
          break
        }
        case '0500': {
          // Mode change (auto = 0x03)
          if (getTwoItemPosition(hexParts, 4) === '03' && this.cacheSpeed !== this.autoSpeed) {
            this.cacheSpeed = this.autoSpeed
            // Cache auto so we can tell it apart from "user asked for max speed"
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, 100)
            this.accessory.log(`${platformLang.curSpeed} [auto]`)
          }
          break
        }
        case '1f01': {
          // Swing Mode
          const newSwing = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
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
