import {
  base64ToHex,
  getTwoItemPosition,
  hexToTwoItems,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)

    // Set up variables from the platform
    this.cusChar = platform.cusChar
    this.speed2Value = (speed) => {
      if (speed <= 33) {
        return 1
      }
      if (speed <= 66) {
        return 2
      }
      return 3
    }

    this.value2Speed = {
      1: 33,
      2: 66,
      3: 99,
    }

    // Speed codes
    this.value2Code = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=', // sleep
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=', // low
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=', // high
    }

    // Lock codes
    this.lock2Code = {
      on: 'MxABAAAAAAAAAAAAAAAAAAAAACI=',
      off: 'MxAAAAAAAAAAAAAAAAAAAAAAACM=',
    }

    // Display codes
    this.display2Code = {
      on: 'MxYBAAAAAAAAAAAAAAAAAAAAACQ=',
      off: 'MxYAAAAAAAAAAAAAAAAAAAAAACU=',
    }

    // Add the purifier service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.AirPurifier)
      || this.accessory.addService(this.hapServ.AirPurifier)
    this.setupFilterMaintenance(this.service)

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1
      ? 'on'
      : 'off'

    // Add options to the purifier target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetAirPurifierState)
      .setProps({
        validValues: [0],
      })
      .updateValue(0)

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 33,
        validValues: [0, 33, 66, 99],
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value || 33

    // Add the set handler to the lock controls characteristic
    this.service.getCharacteristic(this.hapChar.LockPhysicalControls).onSet(async (value) => {
      await this.internalLockUpdate(value)
    })
    this.cacheLock = this.service.getCharacteristic(this.hapChar.LockPhysicalControls).value === 1
      ? 'on'
      : 'off'

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
      const newValue = value === 1
        ? 'on'
        : 'off'

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
      this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, value === 1
        ? 2
        : 0)

      // Cache the new state and log if appropriate
      this.cacheState = newValue
      this.accessory.log(`${platformLang.curState} [${newValue}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on'
          ? 1
          : 0)
      })
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // Don't continue if the speed is 0
      if (value === 0) {
        return
      }

      // Get the single Govee value {1, 2, 3}
      const newValue = this.speed2Value(value)
      const newSpeed = this.value2Speed[newValue]

      // Don't continue if the speed value won't have effect
      if (newSpeed === this.cacheSpeed) {
        return
      }

      // Get the scene code for this value
      const newCode = this.value2Code[newValue]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: newCode,
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? {
              instance: 'workMode',
              capabilityType: 'devices.capabilities.work_mode',
              value: { workMode: 1, modeValue: newValue },
            }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheSpeed = newSpeed
      this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}%]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      })
    }
  }

  async internalLockUpdate(value) {
    try {
      const newValue = value === 1
        ? 'on'
        : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheLock === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.lock2Code[newValue],
        openApi: this.accessory.context.openApiCapabilities?.lockToggle
          ? {
              instance: 'lockToggle',
              capabilityType: 'devices.capabilities.toggle',
              value: newValue === 'on'
                ? 1
                : 0,
            }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheLock = newValue
      this.accessory.log(`${platformLang.curLock} [${newValue}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(
          this.hapChar.LockPhysicalControls,
          this.cacheLock === 'on'
            ? 1
            : 0,
        )
      })
    }
  }

  async internalDisplayLightUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheDisplay === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.display2Code[newValue],
        openApi: this.accessory.context.openApiCapabilities?.displayToggle
          ? {
              instance: 'displayToggle',
              capabilityType: 'devices.capabilities.toggle',
              value: newValue === 'on'
                ? 1
                : 0,
            }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheDisplay = newValue
      this.accessory.log(`${platformLang.curDisplay} [${newValue}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.cusChar.DisplayLight, this.cacheDisplay === 'on')
      })
    }
  }

  externalUpdate(params) {
    this.updateFilterLife(params.filterLife)

    // Check for an ON/OFF change
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on')
      this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, this.cacheState === 'on'
        ? 2
        : 0)

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Handle OpenAPI workMode (speed/mode)
    if (params.workMode) {
      const speed = params.workMode.modeValue
      if (speed >= 1 && speed <= 3) {
        const newSpeed = this.value2Speed[speed]
        if (newSpeed && newSpeed !== this.cacheSpeed) {
          this.cacheSpeed = newSpeed
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
          this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}%]`)
        }
      }
    }

    // Handle OpenAPI toggles
    if (params.toggles) {
      if (params.toggles.lockToggle !== undefined) {
        const newLock = params.toggles.lockToggle ? 'on' : 'off'
        if (newLock !== this.cacheLock) {
          this.cacheLock = newLock
          this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock === 'on'
            ? 1
            : 0)
          this.accessory.log(`${platformLang.curLock} [${this.cacheLock}]`)
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
        case '0501': {
          // Manual speed
          const newSpeedRaw = getTwoItemPosition(hexParts, 4)
          const newSpeedValue = Number.parseInt(newSpeedRaw, 16)

          if ([1, 2, 3].includes(newSpeedValue)) {
            const newSpeed = this.value2Speed[newSpeedValue]

            if (newSpeed !== this.cacheSpeed) {
              this.cacheSpeedRaw = newSpeedRaw
              this.cacheSpeed = newSpeed
              this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
              this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}%]`)
            }
          }
          break
        }
        case '1000':
        case '1001': { // lock
          const newLock = deviceFunction === '1001'
            ? 'on'
            : 'off'
          if (newLock !== this.cacheLock) {
            this.cacheLock = newLock
            this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock === 'on'
              ? 1
              : 0)
            this.accessory.log(`${platformLang.curLock} [${this.cacheLock}]`)
          }
          break
        }
        case '1600':
        case '1601': { // display light
          const newDisplay = deviceFunction === '1601'
            ? 'on'
            : 'off'
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
