import { hs2rgb, rgb2hs } from '../utils/colour.js'
import {
  base64ToHex,
  farToCen,
  generateCodeFromHexValues,
  generateRandomString,
  getTwoItemPosition,
  hasProperty,
  hexToDecimal,
  hexToTwoItems,
  nearestHalf,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

/*
  H7131 and H7132
  {
    "mode": {
      "options": [
        {
          "name": "Low",
          "value": "1"
        },
        {
          "name": "Medium",
          "value": "2"
        },
        {
          "name": "High",
          "value": "3"
        },
        {
          "name": "Fan",
          "value": "4"
        },
        {
          "name": "Auto",
          "value": "5"
        }
      ]
    }
  }
*/
export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Set up objects
    this.speedCode = {
      25: 'OgUJAAAAAAAAAAAAAAAAAAAAADY=',
      50: 'OgUBAQAAAAAAAAAAAAAAAAAAAD8=',
      75: 'OgUBAgAAAAAAAAAAAAAAAAAAADw=',
      100: 'OgUBAwAAAAAAAAAAAAAAAAAAAD0=',
    }

    this.speedCodeLabel = {
      0: 'auto',
      25: 'fan-only',
      50: 'low',
      75: 'medium',
      100: 'high',
    }

    this.tempCodeAuto = {
      5: 'MwUDAZAEAAAAAAAAAAAAAAAAAKA=',
      6: 'MwUDAZBoAAAAAAAAAAAAAAAAAMw=',
      7: 'MwUDAZEwAAAAAAAAAAAAAAAAAJU=',
      8: 'MwUDAZH4AAAAAAAAAAAAAAAAAF0=',
      9: 'MwUDAZLAAAAAAAAAAAAAAAAAAGY=',
      10: 'MwUDAZOIAAAAAAAAAAAAAAAAAC8=',
      11: 'MwUDAZPsAAAAAAAAAAAAAAAAAEs=',
      12: 'MwUDAZS0AAAAAAAAAAAAAAAAABQ=',
      13: 'MwUDAZV8AAAAAAAAAAAAAAAAAN0=',
      14: 'MwUDAZZEAAAAAAAAAAAAAAAAAOY=',
      15: 'MwUDAZcMAAAAAAAAAAAAAAAAAK8=',
      16: 'MwUDAZdwAAAAAAAAAAAAAAAAANM=',
      17: 'MwUDAZg4AAAAAAAAAAAAAAAAAJQ=',
      18: 'MwUDAZkAAAAAAAAAAAAAAAAAAK0=',
      19: 'MwUDAZnIAAAAAAAAAAAAAAAAAGU=',
      20: 'MwUDAZqQAAAAAAAAAAAAAAAAAD4=',
      21: 'MwUDAZr0AAAAAAAAAAAAAAAAAFo=',
      22: 'MwUDAZu8AAAAAAAAAAAAAAAAABM=',
      23: 'MwUDAZyEAAAAAAAAAAAAAAAAACw=',
      24: 'MwUDAZ1MAAAAAAAAAAAAAAAAAOU=',
      25: 'MwUDAZ4UAAAAAAAAAAAAAAAAAL4=',
      26: 'MwUDAZ54AAAAAAAAAAAAAAAAANI=',
      27: 'MwUDAZ9AAAAAAAAAAAAAAAAAAOs=',
      28: 'MwUDAaAIAAAAAAAAAAAAAAAAAJw=',
      29: 'MwUDAaDQAAAAAAAAAAAAAAAAAEQ=',
      30: 'MwUDAaGYAAAAAAAAAAAAAAAAAA0=',
    }

    this.tempCodeAutoTurn = {
      5: 'OgUDAZAEAAAAAAAAAAAAAAAAAKk=',
      6: 'OgUDAZBoAAAAAAAAAAAAAAAAAMU=',
      7: 'OgUDAZEwAAAAAAAAAAAAAAAAAJw=',
      8: 'OgUDAZH4AAAAAAAAAAAAAAAAAFQ=',
      9: 'OgUDAZLAAAAAAAAAAAAAAAAAAG8=',
      10: 'OgUDAZOIAAAAAAAAAAAAAAAAACY=',
      11: 'OgUDAZPsAAAAAAAAAAAAAAAAAEI=',
      12: 'OgUDAZS0AAAAAAAAAAAAAAAAAB0=',
      13: 'OgUDAZV8AAAAAAAAAAAAAAAAANQ=',
      14: 'OgUDAZZEAAAAAAAAAAAAAAAAAO8=',
      15: 'OgUDAZcMAAAAAAAAAAAAAAAAAKY=',
      16: 'OgUDAZdwAAAAAAAAAAAAAAAAANo=',
      17: 'OgUDAZg4AAAAAAAAAAAAAAAAAJ0=',
      18: 'OgUDAZkAAAAAAAAAAAAAAAAAAKQ=',
      19: 'OgUDAZnIAAAAAAAAAAAAAAAAAGw=',
      20: 'OgUDAZqQAAAAAAAAAAAAAAAAADc=',
      21: 'OgUDAZr0AAAAAAAAAAAAAAAAAFM=',
      22: 'OgUDAZu8AAAAAAAAAAAAAAAAABo=',
      23: 'OgUDAZyEAAAAAAAAAAAAAAAAACU=',
      24: 'OgUDAZ1MAAAAAAAAAAAAAAAAAOw=',
      25: 'OgUDAZ4UAAAAAAAAAAAAAAAAALc=',
      26: 'OgUDAZ54AAAAAAAAAAAAAAAAANs=',
      27: 'OgUDAZ9AAAAAAAAAAAAAAAAAAOI=',
      28: 'OgUDAaAIAAAAAAAAAAAAAAAAAJU=',
      29: 'OgUDAaDQAAAAAAAAAAAAAAAAAE0=',
      30: 'OgUDAaGYAAAAAAAAAAAAAAAAAAQ=',
    }

    // Fix v9.4.0 -> v9.4.1 bug
    // Remove any light service if it exists
    if (this.accessory.getService(this.hapServ.Lightbulb)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Lightbulb))
    }

    // Add the heater service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.HeaterCooler)
    if (!this.service) {
      this.service = this.accessory.addService(this.hapServ.HeaterCooler)
      this.service.updateCharacteristic(this.hapChar.CurrentTemperature, 20)
      this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, 20)
    }

    // Add the fan service if it doesn't already exist
    this.fanService = this.accessory.getService(this.hapServ.Fan)
      || this.accessory.addService(this.hapServ.Fan)

    // Add the night light service if it doesn't already exist
    this.lightService = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb)

    // Add the set handler to the heater active characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'

    // Add options to the heater target state characteristic
    this.service
      .getCharacteristic(this.hapChar.TargetHeaterCoolerState)
      .setProps({
        minValue: 0,
        maxValue: 1,
        validValues: [0, 1],
      })
      .onSet(async value => this.internalModeUpdate(value))

    this.cacheTemp = this.service.getCharacteristic(this.hapChar.CurrentTemperature).value

    // Add the set handler and a range to the heater target temperature characteristic
    this.service
      .getCharacteristic(this.hapChar.HeatingThresholdTemperature)
      .setProps({
        minValue: 5,
        maxValue: 30,
        minStep: 1,
      })
      .onSet(async value => this.internalTempUpdate(value))
    this.cacheTarg = this.service.getCharacteristic(this.hapChar.HeatingThresholdTemperature).value

    // Add the set handler to the heater swing mode characteristic (for oscillation)
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'

    // Add the set handler to the heater lock characteristic (for oscillation)
    this.service
      .getCharacteristic(this.hapChar.LockPhysicalControls)
      .onSet(async value => this.internalLockUpdate(value))
    this.cacheLock = this.service.getCharacteristic(this.hapChar.LockPhysicalControls).value === 1 ? 'on' : 'off'

    // Add the set handler to the fan on/off characteristic
    this.fanService
      .getCharacteristic(this.hapChar.On)
      .onSet(async value => this.internalFanStateUpdate(value))
    this.cacheFanState = this.fanService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.fanService
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        minStep: 25,
        validValues: [0, 25, 50, 75, 100],
      })
      .onSet(async value => this.internalSpeedUpdate(value))
    this.cacheSpeed = this.fanService.getCharacteristic(this.hapChar.RotationSpeed).value

    // Obtain the current mode
    this.cacheMode = this.speedCodeLabel[this.cacheSpeed]

    // Add the set handler to the lightbulb on/off characteristic
    this.lightService.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalLightStateUpdate(value)
    })
    this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add the set handler to the lightbulb brightness characteristic
    this.lightService
      .getCharacteristic(this.hapChar.Brightness)
      .onSet(async (value) => {
        await this.internalBrightnessUpdate(value)
      })
    this.cacheBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value

    // Add the set handler to the lightbulb hue characteristic
    this.lightService.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
      await this.internalColourUpdate(value)
    })
    // Saturation needs a handler of its own. HomeKit writes hue and saturation
    // separately, so with only hue listened for, dragging saturation alone -
    // the same colour made paler or richer - reached nothing and the light
    // never changed. Both handlers share one update, and the debounce inside
    // it collapses a hue-and-saturation pair into a single command.
    this.lightService.getCharacteristic(this.hapChar.Saturation).onSet(async () => {
      await this.internalColourUpdate(this.lightService.getCharacteristic(this.hapChar.Hue).value)
    })
    this.cacheHue = this.lightService.getCharacteristic(this.hapChar.Hue).value
    this.cacheSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value === 1 ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'stateHeat',
        value: value === 1,
      })

      // If turning off then we also want to show the fan as off
      if (newValue === 'off') {
        this.fanService.updateCharacteristic(this.hapChar.On, false)
      }

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${newValue}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  async internalModeUpdate(value) {
    try {
      // value can be 0 (auto) or 1 (heat)
      let codeToSend
      let newMode
      if (value === 0) {
        // Need to set to auto - hopefully we have a cacheTarg
        // Need to use the turn version of the code since we are changing to this mode
        codeToSend = this.tempCodeAutoTurn[this.cacheTarg]
        newMode = 'auto'
      } else {
        // Need to set to heat - hopefully we have a cacheSpeed, if we don't set to 25 (fan-only)
        codeToSend = this.speedCode[this.cacheSpeed] || this.speedCode[25]
        newMode = this.speedCodeLabel[this.cacheSpeed] || this.speedCodeLabel[25]
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: codeToSend,
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: value === 0 ? 5 : value, modeValue: value === 0 ? this.cacheTarg : this.cacheSpeed } }
          : undefined,
      })

      // If the new mode is auto then we should turn off the fan
      if (newMode === 'auto') {
        this.fanService.updateCharacteristic(this.hapChar.On, false)
      }

      // Cache the new state and log if appropriate
      if (this.cacheMode !== newMode) {
        this.cacheMode = newMode
        this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(
          this.hapChar.TargetHeaterCoolerState,
          this.cacheMode === 'auto' ? 0 : 1,
        )
      })
    }
  }

  async internalTempUpdate(value) {
    try {
      // Don't continue if the new value is the same as before
      if (this.cacheTarg === value) {
        return
      }

      // If the current mode is not auto then we need to change it to auto and use the turn version of the code
      const codeToSend = this.cacheMode === 'auto' ? this.tempCodeAuto[value] : this.tempCodeAutoTurn[value]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: codeToSend,
        openApi: this.accessory.context.openApiCapabilities?.targetTemperature
          ? { instance: 'targetTemperature', capabilityType: 'devices.capabilities.temperature_setting', value: { temperature: value, unit: 'Celsius' } }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheMode = 'auto'
      if (this.cacheTarg !== value) {
        this.cacheTarg = value
        this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}°C]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, this.cacheTarg)
      })
    }
  }

  async internalSwingUpdate(value) {
    try {
      // value === 0 -> swing mode OFF
      // value === 1 -> swing mode ON
      const newValue = value === 1 ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheSwing === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: value === 1 ? 'Mx8BAQAAAAAAAAAAAAAAAAAAACw=' : 'Mx8BAAAAAAAAAAAAAAAAAAAAAC0=',
        openApi: this.accessory.context.openApiCapabilities?.oscillationToggle
          ? { instance: 'oscillationToggle', capabilityType: 'devices.capabilities.toggle', value: value === 1 ? 1 : 0 }
          : undefined,
      })

      // Cache the new state and log if appropriate
      if (this.cacheSwing !== newValue) {
        this.cacheSwing = newValue
        this.accessory.log(`${platformLang.curSwing} [${newValue}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(
          this.hapChar.SwingMode,
          this.cacheSwing === 'on' ? 1 : 0,
        )
      })
    }
  }

  async internalLockUpdate(value) {
    try {
      // value === 0 -> child lock OFF
      // value === 1 -> child lock ON
      const newValue = value === 1 ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheLock === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: value === 1 ? 'Mx8CAQAAAAAAAAAAAAAAAAAAAC8=' : 'Mx8CAAAAAAAAAAAAAAAAAAAAAC4=',
        openApi: this.accessory.context.openApiCapabilities?.lockToggle
          ? { instance: 'lockToggle', capabilityType: 'devices.capabilities.toggle', value: value === 1 ? 1 : 0 }
          : undefined,
      })

      // Cache the new state and log if appropriate
      if (this.cacheLock !== newValue) {
        this.cacheLock = newValue
        this.accessory.log(`${platformLang.curLock} [${newValue}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(
          this.hapChar.LockPhysicalControls,
          this.cacheLock === 'on' ? 1 : 0,
        )
      })
    }
  }

  async internalFanStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // The fan is used for the following modes:
      //  - 0%__: Auto
      //  - 25%_: Fan Only Mode
      //  - 50%_: Low Mode
      //  - 75%_: Medium Mode
      //  - 100%: High Mode
      // If the main heater is turned off then this fan should be turned off too
      // If the main heater is turned on then this fan speed should revert to the current mode

      // Don't continue if the new value is the same as before
      if (this.cacheFanState === newValue) {
        return
      }

      // Turning fan on:
      // We should not need to worry about a command for turning the fan ON, since
      // the correct mode command will be sent when selecting the fan speed
      // However we should mark the heater "active" characteristic as ON
      if (newValue === 'on') {
        if (this.cacheState !== 'on') {
          this.cacheState = 'on'
          this.service.updateCharacteristic(this.hapChar.Active, 1)
          this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
        }
        this.cacheFanState = 'on'
        return
      }

      // Turning fan off:
      // We should send a command to set the heater mode to AUTO
      this.cacheFanState = 'off'
      this.cacheMode = 'auto'
      this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, 0)
      this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.fanService.updateCharacteristic(this.hapChar.On, this.cacheFanState === 'on')
      })
    }
  }

  async internalSpeedUpdate(value) {
    try {
      // Don't continue if the new value is the same as before
      if (this.cacheSpeed === value || value === 0) {
        return
      }

      // Value should be one of 25, 50, 75, 100
      const codeToSend = this.speedCode[value]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: codeToSend,
      })

      // Cache the new state and log if appropriate
      this.cacheFanState = 'on'
      this.service.updateCharacteristic(this.hapChar.Active, 1)
      this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, 1)
      if (this.cacheSpeed !== value) {
        this.cacheSpeed = value
        this.cacheMode = this.speedCodeLabel[value]
        this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSpeed)
      })
    }
  }

  async internalLightStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheLightState === newValue) {
        return
      }

      // Generate the hex values for the code
      const hexValues = [0x3A, 0x1B, 0x01, 0x01, value ? 0x01 : 0x00]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      // Cache the new state and log if appropriate
      if (this.cacheLightState !== newValue) {
        this.cacheLightState = newValue
        this.accessory.log(`${platformLang.curLight} [${newValue}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      })
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the brightness scale
      const updateKeyBright = generateRandomString(5)
      this.updateKeyBright = updateKeyBright
      await sleep(350)
      if (updateKeyBright !== this.updateKeyBright) {
        return
      }

      // Don't continue if the new value is the same as before
      if (value === this.cacheBright) {
        return
      }

      // Generate the hex values for the code
      const hexValues = [0x3A, 0x1B, 0x01, 0x02, value]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      // Govee considers 0% brightness to be off
      if (value === 0) {
        setTimeout(() => {
          this.cacheLightState = 'off'
          if (this.lightService.getCharacteristic(this.hapChar.On).value) {
            this.lightService.updateCharacteristic(this.hapChar.On, false)
            this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
          }
          this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
        }, 1500)
        return
      }

      // Cache the new state and log if appropriate
      if (this.cacheBright !== value) {
        this.cacheBright = value
        this.accessory.log(`${platformLang.curBright} [${value}%]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      })
    }
  }

  async internalColourUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the colour wheel
      const updateKeyColour = generateRandomString(5)
      this.updateKeyColour = updateKeyColour
      await sleep(300)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }

      // Don't continue if the new colour is the same as before. Saturation is
      // part of that question: comparing hue alone meant a change of saturation
      // at the same hue looked like no change at all, and nothing was sent.
      const currentSat = this.lightService.getCharacteristic(this.hapChar.Saturation).value
      if (value === this.cacheHue && currentSat === this.cacheSat) {
        return
      }

      // Calculate RGB values
      const newRGB = hs2rgb(value, currentSat)

      // Generate the hex values for the code
      const hexValues = [0x3A, 0x1B, 0x05, 0x0D, ...newRGB]

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'multiSync',
        value: generateCodeFromHexValues(hexValues),
      })

      // Cache the new state and log if appropriate. Saturation is cached on
      // every send, not only when the hue moved, or a change of saturation at
      // the same hue would be sent once and then look unchanged ever after.
      this.cacheSat = currentSat
      if (this.cacheHue !== value) {
        this.cacheHue = value
        this.accessory.log(`${platformLang.curColour} [rgb ${newRGB.join(' ')}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      })
    }
  }

  externalUpdate(params) {
    // Update the active characteristic
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Update the current temperature characteristic
    if (hasProperty(params, 'temperature')) {
      const newTemp = nearestHalf(farToCen(params.temperature / 100))
      if (newTemp !== this.cacheTemp) {
        this.cacheTemp = newTemp
        this.service.updateCharacteristic(this.hapChar.CurrentTemperature, this.cacheTemp)
        this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C]`)
      }
    }

    // Update the target temperature characteristic
    if (hasProperty(params, 'setTemperature')) {
      const newTemp = Math.round(farToCen(params.setTemperature / 100))
      if (newTemp !== this.cacheTarg) {
        // A change in target temperature would suggest the device is in auto mode
        // If incorrect, the code change will pick this up later
        this.cacheTarg = newTemp
        this.cacheFanState = 'off'
        this.cacheSpeed = 0
        this.cacheMode = 'auto'
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, this.cacheTarg)
        this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}°C]`)
      }
    }

    // Handle OpenAPI workMode
    if (params.workMode) {
      const mode = params.workMode.workMode
      const modeValue = params.workMode.modeValue
      if (mode === 5 || mode === 3) {
        // Auto/thermostat mode
        if (this.cacheMode !== 'auto') {
          this.cacheMode = 'auto'
          this.cacheFanState = 'off'
          this.accessory.log(`${platformLang.curMode} [auto]`)
        }
        if (Number.isFinite(modeValue) && modeValue !== this.cacheTarg) {
          this.cacheTarg = modeValue
          this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, this.cacheTarg)
          this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}°C]`)
        }
      } else if (Number.isFinite(modeValue)) {
        // Speed-based mode
        const speedMap = { 1: 33, 2: 66, 3: 99 }
        const newSpeed = speedMap[modeValue] || modeValue
        if (this.cacheSpeed !== newSpeed) {
          this.cacheSpeed = newSpeed
          this.cacheMode = this.speedCodeLabel?.[newSpeed] || 'heat'
          this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
        }
      }
    }

    // Handle OpenAPI toggles
    if (params.toggles) {
      if (params.toggles.oscillationToggle !== undefined) {
        const newSwing = params.toggles.oscillationToggle ? 'on' : 'off'
        if (this.cacheSwing !== newSwing) {
          this.cacheSwing = newSwing
          this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
          this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
        }
      }
      if (params.toggles.lockToggle !== undefined) {
        const newLock = params.toggles.lockToggle ? 'on' : 'off'
        if (this.cacheLock !== newLock) {
          this.cacheLock = newLock
          this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock === 'on' ? 1 : 0)
          this.accessory.log(`${platformLang.curLock} [${this.cacheLock}]`)
        }
      }
    }

    // Handle OpenAPI target temperature
    if (params.targetTemperature) {
      const temp = params.targetTemperature.temperature || params.targetTemperature
      if (Number.isFinite(temp) && temp !== this.cacheTarg) {
        this.cacheTarg = temp
        this.cacheMode = 'auto'
        this.service.updateCharacteristic(this.hapChar.HeatingThresholdTemperature, this.cacheTarg)
        this.accessory.log(`${platformLang.curTarg} [${this.cacheTarg}°C]`)
      }
    }

    // Check the status frames for anything else that changed
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '1b01': {
          const newLightState = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
          if (this.cacheLightState !== newLightState) {
            this.cacheLightState = newLightState
            this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
            this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
          }
          const newBrightness = hexToDecimal(getTwoItemPosition(hexParts, 5))
          if (this.cacheBright !== newBrightness) {
            this.cacheBright = newBrightness
            this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
            this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
          }
          break
        }
        case '1b05': {
          // Night light colour
          const newR = hexToDecimal(getTwoItemPosition(hexParts, 5))
          const newG = hexToDecimal(getTwoItemPosition(hexParts, 6))
          const newB = hexToDecimal(getTwoItemPosition(hexParts, 7))

          const hs = rgb2hs(newR, newG, newB)

          // Check for a colour change. Saturation counts as much as hue, or a
          // change of saturation made in the Govee app is reported back and
          // ignored, leaving the tile showing the old colour.
          if (hs[0] !== this.cacheHue || hs[1] !== this.cacheSat) {
            // Colour is different so update Homebridge with new values
            this.lightService.updateCharacteristic(this.hapChar.Hue, hs[0])
            this.lightService.updateCharacteristic(this.hapChar.Saturation, hs[1]);
            [this.cacheHue, this.cacheSat] = hs

            // Log the change
            this.accessory.log(`${platformLang.curColour} [rgb ${newR} ${newG} ${newB}]`)
          }
          break
        }
        case '1f00':
        case '1f01': {
          // Swing Mode
          const newSwing = getTwoItemPosition(hexParts, 3) === '01' ? 'on' : 'off'
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
          }

          // Child Lock
          const newLock = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
          if (this.cacheLock !== newLock) {
            this.cacheLock = newLock
            this.service.updateCharacteristic(this.hapChar.LockPhysicalControls, this.cacheLock === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curLock} [${this.cacheLock}]`)
          }
          break
        }
        case '0509': {
          // Fan-only mode
          const newModeLabel = 'fan-only'
          if (this.cacheMode !== newModeLabel) {
            this.cacheMode = newModeLabel
            this.cacheFanState = 'on'
            this.cacheSpeed = 25
            this.fanService.updateCharacteristic(this.hapChar.On, true)
            this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, 25)
            this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, 1)
            this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
          }
          break
        }
        case '0501': { // Speed
          const newMode = getTwoItemPosition(hexParts, 4)
          switch (newMode) {
            case '01': {
              const newModeLabel = 'low'
              if (this.cacheMode !== newModeLabel) {
                this.cacheMode = newModeLabel
                this.cacheFanState = 'on'
                this.cacheSpeed = 50
                this.fanService.updateCharacteristic(this.hapChar.On, true)
                this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, 50)
                this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, 1)
                this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
              }
              break
            }
            case '02': {
              const newModeLabel = 'medium'
              if (this.cacheMode !== newModeLabel) {
                this.cacheMode = newModeLabel
                this.cacheFanState = 'on'
                this.cacheSpeed = 75
                this.fanService.updateCharacteristic(this.hapChar.On, true)
                this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, 75)
                this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, 1)
                this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
              }
              break
            }
            case '03': {
              const newModeLabel = 'high'
              if (this.cacheMode !== newModeLabel) {
                this.cacheMode = newModeLabel
                this.cacheFanState = 'on'
                this.cacheSpeed = 100
                this.fanService.updateCharacteristic(this.hapChar.On, true)
                this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, 100)
                this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, 1)
                this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
              }
              break
            }
            default:
              break
          }
          break
        }
        case '0503': { // Target temperature (thermostat mode on)
          const newModeLabel = 'auto'
          if (this.cacheMode !== newModeLabel) {
            this.cacheMode = newModeLabel
            this.cacheFanState = 'off'
            this.cacheSpeed = 0
            this.fanService.updateCharacteristic(this.hapChar.On, false)
            this.fanService.updateCharacteristic(this.hapChar.RotationSpeed, 0)
            this.service.updateCharacteristic(this.hapChar.TargetHeaterCoolerState, 0)
            this.accessory.log(`${platformLang.curMode} [${this.cacheMode}]`)
          }
          break
        }
        case '1a00': // Target temperature (thermostat mode off)
        case '1100': // Timer off
        case '1101': // Timer on
        case '1600': // Display mode off
        case '1601': // Display mode on
          // We do not need to do anything for these
          break
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
