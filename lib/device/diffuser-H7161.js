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
    // Remove fan service if exists
    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
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
        cmd: 'stateHumi',
        value,
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
      }

      this.service.updateCharacteristic(this.hapChar.CurrentAirPurifierState, value === 1
        ? 2
        : 0)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on'
          ? 1
          : 0)
      })
    }
  }

  externalUpdate(params) {
    // Check for an ON/OFF change
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on'
        ? 1
        : 0)
      this.service.updateCharacteristic(
        this.hapChar.CurrentAirPurifierState,
        this.cacheState === 'on'
          ? 2
          : 0,
      )

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Handle OpenAPI workMode
    if (params.workMode) {
      const mode = params.workMode.modeValue
      this.accessory.log(`${platformLang.curMode} [${mode}]`)
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
