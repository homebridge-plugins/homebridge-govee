import platformConsts from '../utils/constants.js'
import {
  cenToFar,
  generateRandomString,
  hasProperty,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform
    this.httpTimeout = platform.config.bleRefreshTime * 4.5 * 1000

    // Set up variables from the accessory
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId]
    this.lowBattThreshold = deviceConf && deviceConf.lowBattThreshold
      ? Math.min(deviceConf.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold

    // Remove temperature sensor service if it exists
    if (this.accessory.getService(this.hapServ.TemperatureSensor)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.TemperatureSensor))
    }

    // Add the thermostat service if it doesn't already exist
    this.thermoService = this.accessory.getService(this.hapServ.Thermostat)
      || this.accessory.addService(this.hapServ.Thermostat)
    
    // Set up thermostat characteristics
    this.cacheTemp = this.thermoService.getCharacteristic(this.hapChar.CurrentTemperature).value || 20
    
    // Configure thermostat to be read-only (sensor only)
    this.thermoService.getCharacteristic(this.hapChar.TargetTemperature)
      .updateValue(this.cacheTemp)
      .onGet(() => {
        return this.cacheTemp;
      });
    
    // Set heating/cooling state to OFF (0)
    this.thermoService.getCharacteristic(this.hapChar.CurrentHeatingCoolingState)
      .updateValue(0) // 0 = OFF
      .setProps({
        validValues: [0]  // Only allow OFF state
      });
    
    this.thermoService.getCharacteristic(this.hapChar.TargetHeatingCoolingState)
      .updateValue(0) // 0 = OFF
      .setProps({
        validValues: [0]  // Only allow OFF state
      });
    
    // Set temperature display units to Celsius (0)
    this.thermoService.getCharacteristic(this.hapChar.TemperatureDisplayUnits)
      .updateValue(0);
    
    this.updateCache()

    // Add the battery service if it doesn't already exist
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)
    this.cacheBatt = this.battService.getCharacteristic(this.hapChar.BatteryLevel).value

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      lowBattThreshold: this.lowBattThreshold,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async externalUpdate(params) {
    // Check to see if the provided online status is different from the cache value
    if (hasProperty(params, 'online') && this.cacheOnline !== params.online) {
      this.cacheOnline = params.online
      this.platform.updateAccessoryStatus(this.accessory, this.cacheOnline)
    }

    if (params.source === 'BLE') {
      // If we have a BLE update then we should ignore HTTP updates for the next 4 BLE refresh cycles
      // Since BLE will be more accurate and may not have updated with the cloud yet
      // Generate a random key
      const bleKey = generateRandomString(5)
      this.bleKey = bleKey
      setTimeout(() => {
        if (this.bleKey === bleKey) {
          this.bleKey = false
        }
      }, this.httpTimeout)
    }
    if (params.source === 'HTTP' && this.bleKey) {
      return
    }

    // Check to see if the provided battery is different from the cached state
    if (params.battery !== this.cacheBatt && this.battService) {
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

    // Check to see if the provided temperature is different from the cached state
    if (hasProperty(params, 'temperature')) {
      let newTemp = Number.parseInt(params.temperature + this.accessory.context.offTemp, 10)
      newTemp /= 100
      if (newTemp !== this.cacheTemp) {
        // Temperature is different so update Homebridge with new values
        this.cacheTemp = newTemp
        this.thermoService.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
        this.thermoService.updateCharacteristic(this.hapChar.TargetTemperature, this.cacheTemp)
        this.accessory.eveService.addEntry({ temp: this.cacheTemp })

        // Log the change
        this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C / ${cenToFar(this.cacheTemp)}°F]`)

        // Update the cache file with the new temperature
        this.updateCache()
      }
    }
  }

  async updateCache() {
    // Don't continue if the storage client hasn't initialised properly
    if (!this.platform.storageClientData) {
      return
    }

    // Attempt to save the new temperature to the cache
    try {
      await this.platform.storageData.setItem(
        `${this.accessory.context.gvDeviceId}_temp`,
        this.cacheTemp,
      )
    } catch (err) {
      this.accessory.logWarn(`${platformLang.storageWriteErr} ${parseError(err)}`)
    }
  }
}