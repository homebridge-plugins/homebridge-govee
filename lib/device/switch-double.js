import { base64ToHex } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import GoveeDevice from './base.js'

// Models that expose a night light. The H5089 reports its light as
// `aa 1b 01 [on] [level]` and that reading is correct, so the tile shows the
// real state. No command shape tried moves it - neither mirroring its own
// status code nor the `33 18` the purifiers use - so control is refused
// outright rather than accepted and silently dropped (#1323).
const nightLightModels = ['H5089']

class MultiSwitchDouble extends GoveeDevice {
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

    // A model that used to be treated as a single switch or outlet leaves an
    // unnumbered service behind, which would sit next to the numbered pair as
    // a tile that no longer does anything (#1323)
    this.accessory.services
      .filter(service => !service.subtype
        && [this.hapServ.Switch.UUID, this.hapServ.Outlet.UUID].includes(service.UUID))
      .forEach(service => this.accessory.removeService(service))

    // Add this device's tiles if they are not there already
    this.service1 = this.accessory.getService(`${config.label} 1`)
      || this.accessory.addService(this.hapServ[config.label], `${config.label} 1`, `${config.subtype}1`)
    this.service2 = this.accessory.getService(`${config.label} 2`)
      || this.accessory.addService(this.hapServ[config.label], `${config.label} 2`, `${config.subtype}2`)

    if (!this.service1.testCharacteristic(this.hapChar.ConfiguredName)) {
      this.service1.addCharacteristic(this.hapChar.ConfiguredName)
      this.service1.updateCharacteristic(this.hapChar.ConfiguredName, `${config.label} 1`)
    }
    if (!this.service1.testCharacteristic(this.hapChar.ServiceLabelIndex)) {
      this.service1.addCharacteristic(this.hapChar.ServiceLabelIndex)
      this.service1.updateCharacteristic(this.hapChar.ServiceLabelIndex, 1)
    }
    if (!this.service2.testCharacteristic(this.hapChar.ConfiguredName)) {
      this.service2.addCharacteristic(this.hapChar.ConfiguredName)
      this.service2.updateCharacteristic(this.hapChar.ConfiguredName, `${config.label} 2`)
    }
    if (!this.service2.testCharacteristic(this.hapChar.ServiceLabelIndex)) {
      this.service2.addCharacteristic(this.hapChar.ServiceLabelIndex)
      this.service2.updateCharacteristic(this.hapChar.ServiceLabelIndex, 2)
    }

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

    // Add a night light service for the models that have one
    if (nightLightModels.includes(this.accessory.context.gvModel)) {
      this.lightService = this.accessory.getService('Night Light')
        || this.accessory.addService(this.hapServ.Lightbulb, 'Night Light', 'nightlight')
      if (!this.lightService.testCharacteristic(this.hapChar.ConfiguredName)) {
        this.lightService.addCharacteristic(this.hapChar.ConfiguredName)
        this.lightService.updateCharacteristic(this.hapChar.ConfiguredName, 'Night Light')
      }
      this.lightService.getCharacteristic(this.hapChar.On).onSet(() => this.refuseLightControl())
      this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value
        ? 'on'
        : 'off'
      this.lightService.getCharacteristic(this.hapChar.Brightness).onSet(() => this.refuseLightControl())
      this.cacheLightBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value || 100
    } else if (this.accessory.getService('Night Light')) {
      this.accessory.removeService(this.accessory.getService('Night Light'))
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: config.showAs,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)

    // The value is (which outlets to change << 4) | (which of those to turn on)
    // 51 turns BOTH ON
    // 48 turns BOTH OFF
    // 17 turns outlet 1 ON
    // 16 turns outlet 1 OFF
    // 34 turns outlet 2 ON
    // 32 turns outlet 2 OFF
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
      if (service.cacheState !== newValue) {
        service.cacheState = newValue
        this.accessory.log(`[${service.getCharacteristic(this.hapChar.ConfiguredName).value}] ${platformLang.curState} [${newValue}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        service.updateCharacteristic(this.hapChar.On, service.cacheState === 'on')
      })
    }
  }

  // The night light reading is correct, but every command shape tried has been
  // ignored by the plug, so refuse the write. HomeKit reverts the tile rather
  // than showing a state the plug was never given (#1323)
  refuseLightControl() {
    this.accessory.logWarn(`[Night Light] ${platformLang.devNotUpdated} this device does not accept night light commands`)
    throw new this.hapErr(-70402)
  }

  externalUpdate(params) {
    if (Array.isArray(params.state)) {
      if (params.state[0] !== this.service1.cacheState) {
        this.service1.cacheState = params.state[0]
        this.service1.updateCharacteristic(this.hapChar.On, this.service1.cacheState === 'on')

        this.accessory.log(`[${this.service1.getCharacteristic(this.hapChar.ConfiguredName).value}] ${platformLang.curState} [${this.service1.cacheState}]`)
      }

      if (params.state[1] !== this.service2.cacheState) {
        this.service2.cacheState = params.state[1]
        this.service2.updateCharacteristic(this.hapChar.On, this.service2.cacheState === 'on')

        this.accessory.log(`[${this.service2.getCharacteristic(this.hapChar.ConfiguredName).value}] ${platformLang.curState} [${this.service2.cacheState}]`)
      }
    }

    // The night light reports as `aa 1b 01 [on] [level]` (#1323)
    if (this.lightService && Array.isArray(params.commands)) {
      params.commands.forEach((command) => {
        let hexString
        try {
          hexString = base64ToHex(command)
        } catch {
          return
        }
        if (!hexString.startsWith('aa1b01')) {
          return
        }

        const newState = hexString.substring(6, 8) === '01'
          ? 'on'
          : 'off'
        if (newState !== this.cacheLightState) {
          this.cacheLightState = newState
          this.lightService.updateCharacteristic(this.hapChar.On, newState === 'on')
          this.accessory.log(`[Night Light] ${platformLang.curState} [${newState}]`)
        }

        const newBright = Number.parseInt(hexString.substring(8, 10), 16)
        if (newBright >= 1 && newBright <= 100 && newBright !== this.cacheLightBright) {
          this.cacheLightBright = newBright
          this.lightService.updateCharacteristic(this.hapChar.Brightness, newBright)
          this.accessory.log(`[Night Light] ${platformLang.curBright} [${newBright}%]`)
        }
      })
    }
  }
}

/**
 * A double switch and a double outlet are the same device with a different tile
 * in the Home app, chosen by the owner's `showAs` setting. Only the service
 * type, the tile names and the logged option differ, so they share this and are
 * built from it rather than from a copy of it.
 */
function make(config) {
  return class extends MultiSwitchDouble {
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
