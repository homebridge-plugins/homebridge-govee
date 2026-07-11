import {
  base64ToHex,
  cenToFar,
  getTwoItemPosition,
  hexToTwoItems,
  parseError,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

// HomeKit triggers "CO2 detected" abnormal flag at this threshold (ppm).
// Govee app default warn level is 1000 ppm; override via deviceConf.co2AbnormalThreshold.
const DEFAULT_CO2_ABNORMAL_PPM = 1000

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId] || {}
    this.co2AbnormalThreshold = deviceConf.co2AbnormalThreshold || DEFAULT_CO2_ABNORMAL_PPM

    // Add the CO2 sensor service (with level + peak characteristics) if it doesn't already exist
    this.co2Service = this.accessory.getService(this.hapServ.CarbonDioxideSensor)
      || this.accessory.addService(this.hapServ.CarbonDioxideSensor)
    if (!this.co2Service.testCharacteristic(this.hapChar.CarbonDioxideLevel)) {
      this.co2Service.addCharacteristic(this.hapChar.CarbonDioxideLevel)
    }
    if (!this.co2Service.testCharacteristic(this.hapChar.CarbonDioxidePeakLevel)) {
      this.co2Service.addCharacteristic(this.hapChar.CarbonDioxidePeakLevel)
    }
    this.cacheCO2 = this.co2Service.getCharacteristic(this.hapChar.CarbonDioxideLevel).value || 0
    this.cacheCO2Peak = this.co2Service.getCharacteristic(this.hapChar.CarbonDioxidePeakLevel).value || 0
    this.cacheCO2Detected = this.co2Service.getCharacteristic(this.hapChar.CarbonDioxideDetected).value || 0

    // Add the temperature service if it doesn't already exist
    this.tempService = this.accessory.getService(this.hapServ.TemperatureSensor)
      || this.accessory.addService(this.hapServ.TemperatureSensor)
    this.cacheTemp = this.tempService.getCharacteristic(this.hapChar.CurrentTemperature).value

    // Add the humidity service if it doesn't already exist
    this.humiService = this.accessory.getService(this.hapServ.HumiditySensor)
      || this.accessory.addService(this.hapServ.HumiditySensor)
    this.cacheHumi = this.humiService.getCharacteristic(this.hapChar.CurrentRelativeHumidity).value

    // No Battery service — H5140 is mains-powered via USB; the Govee cloud
    // stream doesn't carry a meaningful battery level. Remove any stale service
    // left over from earlier versions of this handler.
    const staleBattery = this.accessory.getService(this.hapServ.Battery)
    if (staleBattery) {
      this.accessory.removeService(staleBattery)
    }

    this.updateCache()

    // Pass the accessory to Fakegato to set up with Eve
    this.accessory.eveService = new platform.eveService('custom', this.accessory, {
      log: () => {},
    })

    // Output the customised options to the log
    const opts = JSON.stringify({
      co2AbnormalThreshold: this.co2AbnormalThreshold,
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async externalUpdate(params) {
    // Parse AWS reading packets — opcode 0x0A carries live CO2 / temp / humidity
    const commands = params.commands || []
    commands.forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)
      if (!hexParts || hexParts.length < 20) {
        return
      }
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }
      if (getTwoItemPosition(hexParts, 2) !== '0a') {
        return
      }

      // 1-indexed: position N -> byte (N-1). LE u16: low byte at lower position.
      const u16le = (lsbPos, msbPos) => Number.parseInt(
        `${getTwoItemPosition(hexParts, msbPos)}${getTwoItemPosition(hexParts, lsbPos)}`,
        16,
      )

      const offTemp = this.accessory.context.offTemp || 0
      const offHumi = this.accessory.context.offHumi || 0

      const tempRaw = u16le(3, 4) // bytes 2-3 of packet, °C × 100
      const humiRaw = u16le(5, 6) // bytes 4-5, %RH × 100
      const co2Raw = u16le(7, 8) // bytes 6-7, ppm

      const newTemp = Math.round(tempRaw + offTemp) / 100
      const newHumi = Math.max(0, Math.min(100, Math.round((humiRaw + offHumi) / 100)))
      const newCO2 = co2Raw

      if (newTemp !== this.cacheTemp && newTemp > -40 && newTemp < 100) {
        this.cacheTemp = newTemp
        this.tempService.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
        this.accessory.eveService.addEntry({ temp: this.cacheTemp })
        this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C / ${cenToFar(this.cacheTemp)}°F]`)
        this.updateCache()
      }

      if (newHumi !== this.cacheHumi) {
        this.cacheHumi = newHumi
        this.humiService.updateCharacteristic(this.hapChar.CurrentRelativeHumidity, this.cacheHumi)
        this.accessory.eveService.addEntry({ humidity: this.cacheHumi })
        this.accessory.log(`${platformLang.curHumi} [${this.cacheHumi}%]`)
      }

      if (newCO2 !== this.cacheCO2 && newCO2 >= 0 && newCO2 <= 40000) {
        this.cacheCO2 = newCO2
        this.co2Service.updateCharacteristic(this.hapChar.CarbonDioxideLevel, this.cacheCO2)

        if (newCO2 > this.cacheCO2Peak) {
          this.cacheCO2Peak = newCO2
          this.co2Service.updateCharacteristic(this.hapChar.CarbonDioxidePeakLevel, this.cacheCO2Peak)
        }

        const detected = newCO2 >= this.co2AbnormalThreshold ? 1 : 0
        if (detected !== this.cacheCO2Detected) {
          this.cacheCO2Detected = detected
          this.co2Service.updateCharacteristic(this.hapChar.CarbonDioxideDetected, detected)
        }

        this.accessory.eveService.addEntry({ ppm: this.cacheCO2 })
        this.accessory.log(`${platformLang.curCO2} [${this.cacheCO2} ppm]`)
      }
    })
  }

  async updateCache() {
    if (!this.platform.storageClientData) {
      return
    }
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
