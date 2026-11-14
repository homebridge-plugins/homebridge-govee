import platformLang from '../utils/lang-en.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Remove any old services from simulations
    ;[
      'AirPurifier',
      'HeaterCooler',
      'Lightbulb',
      'Outlet',
      'Valve',
    ].forEach((service) => {
      if (this.accessory.getService(this.hapServ[service])) {
        this.accessory.removeService(this.accessory.getService(this.hapServ[service]))
      }
    })

    // Add the switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
      || this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value
      ? 'on'
      : 'off'

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('switch', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: 'switch',
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (newValue === this.cacheState) {
        return
      }

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

      // Add the entry to the Eve history service
      this.accessory.eveService.addEntry({
        status: value ? 1 : 0,
      })
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      })
    }
  }

  externalUpdate(params) {
    // Check to see if the provided state is different from the cached state
    if (params.state && params.state !== this.cacheState) {
      // State is different so update Homebridge with new values
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)

      // Add the entry to the Eve history service
      this.accessory.eveService.addEntry({
        status: this.cacheState === 'on'
          ? 1
          : 0,
      })
    }
  }
}
