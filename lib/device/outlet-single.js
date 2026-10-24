import { base64ToHex, generateRandomString, getTwoItemPosition, hexToTwoItems } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)

    // Set up variables from the platform
    this.eveChar = platform.eveChar
    // Remove any old services from simulations
    ;[
      'AirPurifier',
      'HeaterCooler',
      'Lightbulb',
      'Switch',
      'Valve',
    ].forEach((service) => {
      if (this.accessory.getService(this.hapServ[service])) {
        this.accessory.removeService(this.accessory.getService(this.hapServ[service]))
      }
    })

    // Add the outlet service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Outlet)
      || this.accessory.addService(this.hapServ.Outlet)

    // Add the set handler to the switch on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value
      ? 'on'
      : 'off'

    if (this.accessory.context.gvModel === 'H5086') {
      // Power readings
      if (!this.service.testCharacteristic(this.eveChar.CurrentConsumption)) {
        this.service.addCharacteristic(this.eveChar.CurrentConsumption)
      }
      // An outlet cached before the reading became decimal comes back from the
      // cache with the old whole-watt format, which would keep rounding (#1379)
      this.service.getCharacteristic(this.eveChar.CurrentConsumption).setProps({
        format: platform.api.hap.Formats.FLOAT,
        minStep: 0.01,
      })
      if (!this.service.testCharacteristic(this.eveChar.ElectricCurrent)) {
        this.service.addCharacteristic(this.eveChar.ElectricCurrent)
      }
      if (!this.service.testCharacteristic(this.eveChar.Voltage)) {
        this.service.addCharacteristic(this.eveChar.Voltage)
      }

      this.cacheWatt = this.service.getCharacteristic(this.eveChar.CurrentConsumption).value || 0
      this.cacheAmp = this.service.getCharacteristic(this.eveChar.ElectricCurrent).value || 0
      this.cacheVolt = this.service.getCharacteristic(this.eveChar.Voltage).value || 0

      // Pass the accessory to Fakegato to set up with Eve
      this.accessory.eveService = new platform.eveService('energy', this.accessory, {
        log: () => {},
      })
    } else {
      // Pass the accessory to Fakegato to set up with Eve
      this.accessory.eveService = new platform.eveService('switch', this.accessory, {
        log: () => {},
      })
    }

    // Output the customised options to the log
    const opts = JSON.stringify({
      showAs: 'outlet',
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

    // Check the status frames for anything else that changed
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}`

      switch (deviceFunction) {
        case 'aa19': { // power readings
          const hexWatt = `${getTwoItemPosition(hexParts, 13)}${getTwoItemPosition(hexParts, 14)}${getTwoItemPosition(hexParts, 15)}`
          const hexAmp = `${getTwoItemPosition(hexParts, 11)}${getTwoItemPosition(hexParts, 12)}`
          const hexVolt = `${getTwoItemPosition(hexParts, 9)}${getTwoItemPosition(hexParts, 10)}`
          const newWatt = Number.parseInt(hexWatt, 16) / 100
          const newAmp = Number.parseInt(hexAmp, 16) / 100
          const newVolt = Number.parseInt(hexVolt, 16) / 100

          if (this.cacheWatt !== newWatt) {
            this.cacheWatt = newWatt
            this.service.updateCharacteristic(this.eveChar.CurrentConsumption, this.cacheWatt)
            this.accessory.eveService.addEntry({ power: newWatt })
            this.accessory.log(`${platformLang.curWatt} [${this.cacheWatt}W]`)
          }
          if (this.cacheAmp !== newAmp) {
            this.cacheAmp = newAmp
            this.service.updateCharacteristic(this.eveChar.ElectricCurrent, this.cacheAmp)
            this.accessory.log(`${platformLang.curAmp} [${this.cacheAmp}A]`)
          }
          if (this.cacheVolt !== newVolt) {
            this.cacheVolt = newVolt
            this.service.updateCharacteristic(this.eveChar.Voltage, this.cacheVolt)
            this.accessory.log(`${platformLang.curVolt} [${this.cacheVolt}V]`)
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
