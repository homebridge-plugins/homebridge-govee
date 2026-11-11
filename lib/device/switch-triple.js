import platformLang from '../utils/lang-en.js'
import GoveeDevice from './base.js'

class MultiSwitchTriple extends GoveeDevice {
  constructor(platform, accessory, config) {
    super(platform, accessory)
    // Drop the tiles of the other kind, left behind if this device has been
    // shown as the other one before
    if (this.accessory.getService(`${config.other} 1`)) {
      this.accessory.removeService(this.accessory.getService(`${config.other} 1`))
    }
    if (this.accessory.getService(`${config.other} 2`)) {
      this.accessory.removeService(this.accessory.getService(`${config.other} 2`))
    }
    if (this.accessory.getService(`${config.other} 3`)) {
      this.accessory.removeService(this.accessory.getService(`${config.other} 3`))
    }

    // Add this device's tiles if they are not there already
    this.service1 = this.accessory.getService(`${config.label} 1`)
      || this.accessory.addService(this.hapServ[config.label], `${config.label} 1`, `${config.subtype}1`)
    this.service2 = this.accessory.getService(`${config.label} 2`)
      || this.accessory.addService(this.hapServ[config.label], `${config.label} 2`, `${config.subtype}2`)
    this.service3 = this.accessory.getService(`${config.label} 3`)
      || this.accessory.addService(this.hapServ[config.label], `${config.label} 3`, `${config.subtype}3`)

    // Add the set handler to the switch on/off characteristic
    this.service1.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(this.service1, value ? 17 : 16)
    })
    this.service1.cacheState = this.service1.getCharacteristic(this.hapChar.On).value
      ? 'on'
      : 'off'
    this.service2.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(this.service2, value ? 34 : 32)
    })
    this.service2.cacheState = this.service2.getCharacteristic(this.hapChar.On).value
      ? 'on'
      : 'off'
    this.service3.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(this.service3, value ? 68 : 64)
    })
    this.service3.cacheState = this.service3.getCharacteristic(this.hapChar.On).value
      ? 'on'
      : 'off'

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: config.showAs,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)

    // 119 turns BOTH ON
    // 112 turns BOTH OFF

    // 68 turns outlet 3 ON
    // 64 turns outlet 3 OFF

    // 34 turns outlet 2 ON
    // 32 turns outlet 2 OFF

    // 17 turns outlet 1 ON
    // 16 turns outlet 1 OFF
  }

  async internalStateUpdate(service, value) {
    try {
      const newValue = value % 16 === 0
        ? 'off'
        : 'on'

      // Don't continue if the new value is the same as before
      if (service.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'stateDual',
        value,
      })

      // Cache the new state and log if appropriate
      service.cacheState = newValue
      this.accessory.log(`[${service.displayName}] ${platformLang.curState} [${newValue}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        service.updateCharacteristic(this.hapChar.On, service.cacheState === 'on')
      })
    }
  }

  externalUpdate(params) {
    // Check to see if the provided state is different from the cached state
    if (!params.stateDual) {
      return
    }

    if ([112, 119].includes(params.stateDual)) {
      // 112 -> both off
      // 119 -> both on
      const newState = params.stateDual === 119
        ? 'on'
        : 'off'
      if (newState !== this.service1.cacheState) {
        this.service1.cacheState = newState
        this.service1.updateCharacteristic(this.hapChar.On, this.service1.cacheState === 'on')

        // Log the change
        this.accessory.log(`[${this.service1.displayName}] ${platformLang.curState} [${this.service1.cacheState}]`)
      }
      if (newState !== this.service2.cacheState) {
        this.service2.cacheState = newState
        this.service2.updateCharacteristic(this.hapChar.On, this.service2.cacheState === 'on')

        // Log the change
        this.accessory.log(`[${this.service2.displayName}] ${platformLang.curState} [${this.service2.cacheState}]`)
      }
      if (newState !== this.service3.cacheState) {
        this.service3.cacheState = newState
        this.service3.updateCharacteristic(this.hapChar.On, this.service3.cacheState === 'on')

        // Log the change
        this.accessory.log(`[${this.service3.displayName}] ${platformLang.curState} [${this.service3.cacheState}]`)
      }
    }
    if ([16, 17].includes(params.stateDual)) {
      const newState = params.stateDual === 17
        ? 'on'
        : 'off'
      if (newState !== this.service1.cacheState) {
        this.service1.cacheState = newState
        this.service1.updateCharacteristic(this.hapChar.On, this.service1.cacheState === 'on')

        // Log the change
        this.accessory.log(`[${this.service1.displayName}] ${platformLang.curState} [${this.service1.cacheState}]`)
      }
    }
    if ([32, 34].includes(params.stateDual)) {
      const newState = params.stateDual === 34
        ? 'on'
        : 'off'
      if (newState !== this.service2.cacheState) {
        this.service2.cacheState = newState
        this.service2.updateCharacteristic(this.hapChar.On, this.service2.cacheState === 'on')

        // Log the change
        this.accessory.log(`[${this.service2.displayName}] ${platformLang.curState} [${this.service2.cacheState}]`)
      }
    }
    if ([64, 68].includes(params.stateDual)) {
      const newState = params.stateDual === 68
        ? 'on'
        : 'off'
      if (newState !== this.service3.cacheState) {
        this.service3.cacheState = newState
        this.service3.updateCharacteristic(this.hapChar.On, this.service3.cacheState === 'on')

        // Log the change
        this.accessory.log(`[${this.service3.displayName}] ${platformLang.curState} [${this.service3.cacheState}]`)
      }
    }
  }
}

/**
 * A triple switch and a triple outlet are the same device with a different tile
 * in the Home app, chosen by the owner's `showAs` setting. Only the service
 * type, the tile names and the logged option differ, so they share this and are
 * built from it rather than from a copy of it.
 */
function make(config) {
  return class extends MultiSwitchTriple {
    constructor(platform, accessory) {
      super(platform, accessory, config)
    }
  }
}

export default make({
  label: 'Switch',
  subtype: 'switch',
  other: 'Outlet',
  showAs: 'switch',
})

export const asOutlet = make({
  label: 'Outlet',
  subtype: 'outlet',
  other: 'Switch',
  showAs: 'outlet',
})
