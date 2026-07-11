import platformConsts from '../utils/constants.js'
import { hasProperty } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.eveChar = platform.eveChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId]
    this.lowBattThreshold = deviceConf && deviceConf.lowBattThreshold
      ? Math.min(deviceConf.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold

    // Add the leak sensor service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.LeakSensor)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.LeakSensor)

      // Adding the characteristic here avoids Homebridge characteristic warnings
      this.service.addCharacteristic(this.eveChar.LastActivation)
    }
    this.cacheLeak = !!this.service.getCharacteristic(this.hapChar.LeakDetected).value

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)
    this.cacheBatt = this.battService.getCharacteristic(this.hapChar.BatteryLevel).value

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('motion', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  externalUpdate(params) {
    // Check to see if the provided online status is different from the cache value
    if (hasProperty(params, 'online') && this.cacheOnline !== params.online) {
      this.cacheOnline = params.online
      this.platform.updateAccessoryStatus(this.accessory, this.cacheOnline)
    }

    // Check to see if the provided battery is different from the cached state
    if (Number.isFinite(params.battery) && params.battery !== this.cacheBatt) {
      // Battery is different so update Homebridge with new values
      this.cacheBatt = params.battery
      this.battService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBatt)
      this.battService.updateCharacteristic(
        this.hapChar.StatusLowBattery,
        this.cacheBatt < this.lowBattThreshold ? 1 : 0,
      )

      // Log the change
      this.accessory.log(`${platformLang.curBatt} [${this.cacheBatt}%]`)
    }

    // Check to see if the provided leak status is different from the cached state
    if (params.leakDetected !== this.cacheLeak) {
      // Leak status is different so update Homebridge with new values
      this.cacheLeak = params.leakDetected
      this.service.updateCharacteristic(this.hapChar.LeakDetected, this.cacheLeak ? 1 : 0)

      // Add the alert to Eve if a leak has been detected
      if (this.cacheLeak) {
        this.service.updateCharacteristic(
          this.eveChar.LastActivation,
          Math.round(new Date().valueOf() / 1000) - this.accessory.eveService.getInitialTime(),
        )
      }

      // Log the change
      this.accessory.log(`${platformLang.curLeak} [${this.cacheLeak ? platformLang.labelYes : platformLang.labelNo}]`)
    }
  }
}
