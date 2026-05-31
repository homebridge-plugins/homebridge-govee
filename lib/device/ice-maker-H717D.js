import { base64ToHex, getTwoItemPosition, hexToTwoItems, parseError } from '../utils/functions.js'
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

    // Ice size codes: HomeKit slider 1=small, 2=medium, 3=large.
    // Note: Govee OpenAPI workMode is the reverse (1=large, 2=medium, 3=small).
    this.sizeCodes = {
      1: 'MwUDAAAAAAAAAAAAAAAAAAAAADU=', // small
      2: 'MwUCAAAAAAAAAAAAAAAAAAAAADQ=', // medium
      3: 'MwUBAAAAAAAAAAAAAAAAAAAAADc=', // large
    }

    this.sizeLabels = {
      1: 'small',
      2: 'medium',
      3: 'large',
    }

    // Remove old switch service if migrating
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // Add the fan service for ice size control
    this.service = this.accessory.getService(this.hapServ.Fanv2)
      || this.accessory.addService(this.hapServ.Fanv2)

    // Add the set handler to the on/off characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'

    // Add the set handler to the rotation speed characteristic (ice size)
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 3,
        minStep: 1,
        minValue: 0,
        unit: 'unitless',
      })
      .onSet(async value => this.internalSizeUpdate(value))
    this.cacheSize = this.service.getCharacteristic(this.hapChar.RotationSpeed).value || 2

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newState = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (newState === this.cacheState) {
        return
      }

      if (value) {
        // Turn on with current cached ice size
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: this.sizeCodes[this.cacheSize],
          openApi: this.accessory.context.openApiCapabilities?.workMode
            ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: 4 - this.cacheSize, modeValue: 0 } }
            : undefined,
        })
      } else {
        // Turn off
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: 'MxkAAAAAAAAAAAAAAAAAAAAAACo=',
          openApi: this.accessory.context.openApiCapabilities?.workMode
            ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: 0, modeValue: 0 } }
            : undefined,
        })
      }

      // Cache the new state and log if appropriate
      if (this.cacheState !== newState) {
        this.cacheState = newState
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
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

  async internalSizeUpdate(value) {
    try {
      // Don't continue if 0
      if (value === 0) {
        return
      }

      // Don't continue if the new value is the same as before
      if (value === this.cacheSize) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.sizeCodes[value],
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: 4 - value, modeValue: 0 } }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheSize = value
      this.cacheState = 'on'
      this.service.updateCharacteristic(this.hapChar.Active, 1)
      this.accessory.log(`${platformLang.curSpeed} [${this.sizeLabels[value]}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSize)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // Handle OpenAPI workMode
    if (params.workMode) {
      const mode = params.workMode.workMode
      if (mode > 0 && mode <= 3) {
        // Govee workMode 1=large, 2=medium, 3=small -> HomeKit slider 1=small, 3=large
        const size = 4 - mode
        this.cacheState = 'on'
        this.service.updateCharacteristic(this.hapChar.Active, 1)
        if (this.cacheSize !== size) {
          this.cacheSize = size
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSize)
          this.accessory.log(`${platformLang.curSpeed} [${this.sizeLabels[this.cacheSize]}]`)
        }
      } else if (mode === 0) {
        if (this.cacheState !== 'off') {
          this.cacheState = 'off'
          this.service.updateCharacteristic(this.hapChar.Active, 0)
          this.accessory.log(`${platformLang.curState} [off]`)
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

      const deviceFunction = `${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}`

      switch (deviceFunction) {
        case 'aa19': {
          // On/Off
          const newState = getTwoItemPosition(hexParts, 3) === '01' ? 'on' : 'off'
          if (this.cacheState !== newState) {
            this.cacheState = newState
            this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
          }
          break
        }
        default:
          this.accessory.logWarn(`${platformLang.newScene}: [${command}] [${hexString}]`)
          break
      }
    })
  }
}
