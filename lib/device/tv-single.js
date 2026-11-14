import { generateRandomString } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Add the tv service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Television)
      || this.accessory.addService(this.hapServ.Television)

    // Add the set handler to the tv active characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1
      ? 'on'
      : 'off'

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: 'audio/box/stick',
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value === 1
        ? 'on'
        : 'off'

      // Don't continue if the new value is the same as before
      if (newValue === this.cacheState) {
        return
      }

      // Set up a one-minute timeout for the plugin to ignore incoming updates
      const timerKey = generateRandomString(5)
      this.updateTimeout = timerKey
      setTimeout(() => {
        if (this.updateTimeout === timerKey) {
          this.updateTimeout = false
        }
      }, 60000)

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'stateOutlet',
        value: newValue,
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on'
          ? 1
          : 0)
      })
    }
  }

  externalUpdate(params) {
    // Check to see if the provided state is different from the cached state
    if (params.state && params.state !== this.cacheState) {
      // State is different so update Homebridge with new values
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on'
        ? 1
        : 0)

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }
  }
}
