import platformConsts from '../utils/constants.js'
import {
  base64ToHex,
  cenToFar,
  getTwoItemPosition,
  hasProperty,
  hexToDecimal,
  hexToTwoItems,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId]
    this.lowBattThreshold = deviceConf && deviceConf.lowBattThreshold
      ? Math.min(deviceConf.lowBattThreshold, 100)
      : platformConsts.defaultValues.lowBattThreshold

    // Add the temperature service if it doesn't already exist
    this.tempService = this.accessory.getService(this.hapServ.TemperatureSensor)
      || this.accessory.addService(this.hapServ.TemperatureSensor)
    // Mark it as the primary service so the HomeKit tile shows the temperature
    this.tempService.setPrimaryService(true)
    this.cacheTemp = this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value
    this.updateCache()

    // Add the battery service if it doesn't already exist. The device reports a
    // battery in the HTTP device list the same way the thermo sensors do, and
    // this handler already took a lowBattThreshold from the config - it just had
    // nowhere to put the reading, so the setting did nothing and the level never
    // reached HomeKit
    this.battService = this.accessory.getService(this.hapServ.Battery)
      || this.accessory.addService(this.hapServ.Battery)
    this.cacheBatt = this.battService.getCharacteristic(this.hapChar.BatteryLevel).value

    // Add the humidity service if it doesn't already exist
    this.humiService = this.accessory.getService(this.hapServ.HumiditySensor)
      || this.accessory.addService(this.hapServ.HumiditySensor)
    this.cacheHumi = this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value

    // Add the air quality service if it doesn't already exist
    this.airService = this.accessory.getService(this.hapServ.AirQualitySensor)

    if (!this.airService) {
      this.airService = this.accessory.addService(this.hapServ.AirQualitySensor)
      this.airService.addCharacteristic(this.hapChar.PM2_5Density)
    }
    this.cacheAir = this.airService.getCharacteristic(this.hapChar.PM2_5Density).value

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
    // Readings can also arrive from the HTTP device list (#1322), for accounts
    // where the AWS channel never delivers for this model. The fields use the
    // same semantics as the thermo-hygrometer sensors: hundredths of a degree
    // and hundredths of a percent
    this.updateBattery(params.battery)

    if (hasProperty(params, 'temperature')) {
      let newTemp = Number.parseInt(params.temperature + this.accessory.context.offTemp, 10)
      newTemp /= 100
      if (Number.isFinite(newTemp) && newTemp !== this.cacheTemp) {
        this.cacheTemp = newTemp
        this.tempService.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
        this.accessory.eveService.addEntry({ temp: this.cacheTemp })

        // Log the change
        this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C / ${cenToFar(this.cacheTemp)}°F]`)

        // Update the cache file with the new temperature
        this.updateCache()
      }
    }
    if (hasProperty(params, 'humidity')) {
      let newHumi = Number.parseInt(params.humidity + this.accessory.context.offHumi, 10)
      newHumi /= 100
      newHumi = Math.max(Math.min(newHumi, 100), 0)
      if (Number.isFinite(newHumi) && newHumi !== this.cacheHumi) {
        this.cacheHumi = newHumi
        this.humiService.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, this.cacheHumi)
        this.accessory.eveService.addEntry({ humidity: this.cacheHumi })

        // Log the change
        this.accessory.log(`${platformLang.curHumi} [${this.cacheHumi}%]`)
      }
    }

    // Check the status frames for anything else that changed
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      const deviceFunction = `${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}`

      switch (deviceFunction) {
        case '0000':
        case '0003':
        case '0100':
        case '0101':
        case '0102':
        case '0103':
        case '331a':
        case '3315':
        case 'aa0d':
        case 'aa0e':
          break
        default: {
          if (hexParts.length < 20) {
            break
          }
          const tempInCen = Math.round((hexToDecimal(`0x${deviceFunction}`) + (this.accessory.context.offTemp / 100)) / 10) / 10

          // Check to see if the provided temperature is different from the cached state
          if (tempInCen !== this.cacheTemp) {
            // Temperature is different so update Homebridge with new values
            this.cacheTemp = tempInCen
            this.tempService.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
            this.accessory.eveService.addEntry({ temp: this.cacheTemp })

            // Log the change
            this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C / ${cenToFar(tempInCen)}°F]`)

            // Update the cache file with the new temperature
            this.updateCache()
          }

          // Check to see if the provided humidity is different from the cached state
          const humiHex = `${getTwoItemPosition(hexParts, 10)}${getTwoItemPosition(hexParts, 11)}`
          const humiDec = Math.round(`0x${humiHex}` / 100) + (this.accessory.context.offHumi / 100)
          if (humiDec !== this.cacheHumi) {
            // Humidity is different so update Homebridge with new values
            this.cacheHumi = humiDec
            this.humiService.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, this.cacheHumi)
            this.accessory.eveService.addEntry({ humidity: this.cacheHumi })

            // Log the change
            this.accessory.log(`${platformLang.curHumi} [${this.cacheHumi}%]`)
          }

          // Check air quality reading
          const qualHex = `${getTwoItemPosition(hexParts, 19)}${getTwoItemPosition(hexParts, 20)}`
          const qualDec = hexToDecimal(`0x${qualHex}`)
          if (qualDec !== this.cacheAir) {
            // Air quality is different so update Homebridge with new values
            this.cacheAir = qualDec
            this.airService.updateCharacteristic(this.hapChar.PM2_5Density, this.cacheAir)

            // Log the change
            this.accessory.log(`${platformLang.curPM25} [${qualDec}µg/m³]`)

            // Check for any change to the main air quality characteristic
            // PM2.5 has a range of 0-1000µg/m³
            // HK characteristic ranges from 1-5 (excellent, good, fair, inferior, poor)
            // Scales based on Govee manual
            // 0-12.0µg/m³ = excellent
            // 12-35µg/m³ = good
            // 35-75µg/m³ = fair
            // 75-115µg/m³ = inferior
            // 115-500µg/m³ = poor (use 1000 for HK)
            if (this.cacheAir <= 12) {
              const newValue = 'excellent'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 1)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            } else if (this.cacheAir <= 35) {
              const newValue = 'good'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 2)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            } else if (this.cacheAir <= 75) {
              const newValue = 'fair'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 3)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            } else if (this.cacheAir <= 115) {
              const newValue = 'inferior'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 4)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            } else {
              const newValue = 'poor'
              if (this.cacheAirQual !== newValue) {
                this.cacheAirQual = newValue
                this.airService.updateCharacteristic(this.hapChar.AirQuality, 5)
                this.accessory.log(`${platformLang.curAirQual} [${newValue}]`)
              }
            }
          }
          break
        }
      }
    })
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
