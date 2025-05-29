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

    // Add the main switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
      || this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the lightbulb on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

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

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwUCAAAAAAAAAAAAAAAAAAAAADQ=' : 'MxkAAAAAAAAAAAAAAAAAAAAAACo=',
        // value: value ? 'MxkBAAAAAAAAAAAAAAAAAAAAACs=' : 'MxkAAAAAAAAAAAAAAAAAAAAAACo=', // on / off (not working)
      })

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
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // Update the active characteristic
    // if (params.state && params.state !== this.cacheState) {
    //   this.cacheState = params.state
    //   this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    // }

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
            this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
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
