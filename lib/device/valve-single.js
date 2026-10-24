import { generateRandomString } from '../utils/functions.js'
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
      'Switch',
    ].forEach((service) => {
      if (this.accessory.getService(this.hapServ[service])) {
        this.accessory.removeService(this.accessory.getService(this.hapServ[service]))
      }
    })

    // Make sure this wasn't setup as a valve
    if (
      this.accessory.getService(this.hapServ.Valve)
      && this.accessory.context.valveType !== 'valve'
    ) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Valve))
    }

    // Add the tap service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Valve)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.Valve)
      this.service.updateCharacteristic(this.hapChar.Active, 0)
      this.service.updateCharacteristic(this.hapChar.InUse, 0)
      this.service.updateCharacteristic(this.hapChar.ValveType, 1)
      this.service.updateCharacteristic(this.hapChar.SetDuration, 120)
      this.service.addCharacteristic(this.hapChar.RemainingDuration)
      this.accessory.context.valveType = 'valve'
    }

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })

    // Add the set handler to the valve set duration characteristic
    this.service.getCharacteristic(this.hapChar.SetDuration).onSet((value) => {
      // Check if the valve is currently active
      if (this.service.getCharacteristic(this.hapChar.InUse).value === 1) {
        // Update the remaining duration characteristic with the new value
        this.service.updateCharacteristic(this.hapChar.RemainingDuration, value)

        // Clear any existing active timers
        clearTimeout(this.timer)

        // Set a new active timer with the new time amount
        this.timer = setTimeout(
          () => this.service.setCharacteristic(this.hapChar.Active, 0),
          value * 1000,
        )
      }
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: 'valve',
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

      // Update the InUse characteristic
      this.service.updateCharacteristic(this.hapChar.InUse, value)
      switch (value) {
        case 0:
          this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0)
          clearTimeout(this.timer)
          break
        case 1: {
          const timer = this.service.getCharacteristic(this.hapChar.SetDuration).value
          this.service.updateCharacteristic(this.hapChar.RemainingDuration, timer)
          this.timer = setTimeout(() => {
            this.service.setCharacteristic(this.hapChar.Active, 0)
          }, timer * 1000)
          break
        }
        default:
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
      if (this.cacheState === 'on') {
        if (this.service.getCharacteristic(this.hapChar.Active).value === 0) {
          const timer = this.service.getCharacteristic(this.hapChar.SetDuration).value
          this.service.updateCharacteristic(this.hapChar.Active, 1)
          this.service.updateCharacteristic(this.hapChar.InUse, 1)
          this.service.updateCharacteristic(this.hapChar.RemainingDuration, timer)
          this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
          this.timer = setTimeout(() => {
            this.service.setCharacteristic(this.hapChar.Active, 0)
          }, timer * 1000)
        }
      } else {
        this.service.updateCharacteristic(this.hapChar.Active, 0)
        this.service.updateCharacteristic(this.hapChar.InUse, 0)
        this.service.updateCharacteristic(this.hapChar.RemainingDuration, 0)
        clearTimeout(this.timer)
      }
    }
  }
}
