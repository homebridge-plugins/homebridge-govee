import {
  base64ToHex,
  getTwoItemPosition,
  hexToTwoItems,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

/*
  The modes these purifiers report over the api. Low, medium and high are the
  gear speeds the plugin drives; sleep is listed for reference and is the one
  place the two models differ, so it must not be sent as a shared value.

  H7120: Low 1, Medium 2, High 3, "Sleep mode" 5
  H7121: Low 1, Medium 2, High 3, "Sleep" 16
 */

export default class GoveePurifierH7120 extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)

    // Set up variables from the platform
    this.cusChar = platform.cusChar
    // Rotation speed to value in {1, 2, 3, 4}
    this.speed2Value = speed => Math.min(Math.max(Number.parseInt(speed / 25, 10), 1), 4)

    // Speed codes
    this.value2Code = {
      1: 'MwUQAAAAAAAAAAAAAAAAAAAAACY=',
      2: 'MwUBAAAAAAAAAAAAAAAAAAAAADc=',
      3: 'MwUCAAAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUDAAAAAAAAAAAAAAAAAAAAADU=',
    }

    // Night light codes
    this.night2Code = {
      on: 'MxgBMgAAAAAAAAAAAAAAAAAAABg=',
      off: 'MxgAMgAAAAAAAAAAAAAAAAAAABk=',
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
        minStep: 25,
        validValues: [0, 25, 50, 75, 100],
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.service.getCharacteristic(this.hapChar.RotationSpeed).value

    // Add the set handler to the lock controls characteristic
    this.service.getCharacteristic(this.hapChar.LockPhysicalControls).onSet(async (value) => {
      await this.internalLockUpdate(value)
    })
    this.cacheLock = this.service.getCharacteristic(this.hapChar.LockPhysicalControls).value === 1
      ? 'on'
      : 'off'

    // Add night light Eve characteristic if it doesn't exist already
    if (!this.service.testCharacteristic(this.cusChar.NightLight)) {
      this.service.addCharacteristic(this.cusChar.NightLight)
    }

    // Add the set handler to the custom night light characteristic
    this.service.getCharacteristic(this.cusChar.NightLight).onSet(async (value) => {
      await this.internalNightLightUpdate(value)
    })
    this.cacheLight = this.service.getCharacteristic(this.cusChar.NightLight).value
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

      // Get the single Govee value {1, 2, ..., 8}
      const newValue = this.speed2Value(value)

      // Don't continue if the speed value won't have effect
      if (newValue * 25 === this.cacheSpeed) {
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
      this.cacheSpeed = newValue * 25
      this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}%]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      })
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
          ? {
              instance: 'nightlightToggle',
              capabilityType: 'devices.capabilities.toggle',
              value: newValue === 'on'
                ? 1
                : 0,
            }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheLight = newValue
      this.accessory.log(`${platformLang.curLight} [${newValue}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.cusChar.NightLight, this.cacheLight === 'on')
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
      if (speed >= 1 && speed <= 4) {
        const newSpeed = speed * 25
        if (newSpeed !== this.cacheSpeed) {
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
        case '0501':
        case '0502': {
          // Speed update
          const newSpeedValue = Number.parseInt(getTwoItemPosition(hexParts, 4), 16)
          if (newSpeedValue >= 1 && newSpeedValue <= 4) {
            const newSpeed = newSpeedValue * 25
            if (newSpeed !== this.cacheSpeed) {
              this.cacheSpeed = newSpeed
              this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
              this.accessory.log(`${platformLang.curSpeed} [${this.cacheSpeed}%]`)
            }
          }
          break
        }
        case '1000':
        case '1001': {
          // Lock
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
