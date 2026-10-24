import platformLang from '../utils/lang-en.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Remove any lightbulb service
    if (accessory.getService(this.hapServ.Lightbulb)) {
      accessory.removeService(accessory.getService(this.hapServ.Lightbulb))
    }

    // Add the main switch service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Switch)
      || this.accessory.addService(this.hapServ.Switch)

    // Add the set handler to the lightbulb on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value
      ? 'on'
      : 'off'

    // Output the customised options to the log
    const useAwsControl = accessory.context.useAwsControl ? 'enabled' : 'disabled'
    const useBleControl = accessory.context.useBleControl ? 'enabled' : 'disabled'
    const useLanControl = accessory.context.useLanControl ? 'enabled' : 'disabled'
    const opts = JSON.stringify({
      aws: accessory.context.hasAwsControl ? useAwsControl : 'unsupported',
      ble: accessory.context.hasBleControl ? useBleControl : 'unsupported',
      lan: accessory.context.hasLanControl ? useLanControl : 'unsupported',
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
        cmd: 'state',
        value: newValue,
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      })
    }
  }

  externalUpdate(params) {
    // Check to see if the provided state is different from the cached value
    if (params.state && params.state !== this.cacheState) {
      // State is different so update Homebridge with new values
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }
  }
}
