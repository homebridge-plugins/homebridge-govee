import {
  hs2rgb,
  k2rgb,
  m2hs,
  rgb2hs,
} from '../utils/colour.js'
import platformConsts from '../utils/constants.js'
import {
  generateRandomString,
  hasProperty,
  parseError,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

export default class {
  constructor(platform, accessory) {
    // Set up variables from the platform
    this.cusChar = platform.cusChar
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.colourSafeMode = platform.config.colourSafeMode
    this.minKelvin = accessory.context?.supportedCmdsOpts?.colorTem?.range?.min || 2000
    this.maxKelvin = accessory.context?.supportedCmdsOpts?.colorTem?.range?.max || 9000
    this.isBLEOnly = !accessory.context.useAwsControl && !accessory.context.useLanControl

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId] || {}
    this.alShift = deviceConf.adaptiveLightingShift || platformConsts.defaultValues.adaptiveLightingShift
    this.brightStep = deviceConf.brightnessStep
      ? Math.min(deviceConf.brightnessStep, 100)
      : platformConsts.defaultValues.brightnessStep

    // Remove any switch service if it exists
    if (accessory.getService(this.hapServ.Switch)) {
      accessory.removeService(accessory.getService(this.hapServ.Switch))
    }

    // Add the main lightbulb service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb)

    // If adaptive lighting has just been disabled then remove and re-add service to hide AL icon
    if ((this.colourSafeMode || this.alShift === -1) && this.accessory.context.adaptiveLighting) {
      this.accessory.removeService(this.service)
      this.service = this.accessory.addService(this.hapServ.Lightbulb)
      this.accessory.context.adaptiveLighting = false
    }

    // Setup custom characteristics for different scenes and modes
    this.usedCodes = [];

    [
      'DiyMode',
      'DiyModeTwo',
      'DiyModeThree',
      'DiyModeFour',
      'MusicMode',
      'MusicModeTwo',
      'Scene',
      'SceneTwo',
      'SceneThree',
      'SceneFour',
      'Segmented',
      'SegmentedTwo',
      'SegmentedThree',
      'SegmentedFour',
      'VideoMode',
      'VideoModeTwo',
    ].forEach((charName) => {
      const confName = charName.charAt(0).toLowerCase() + charName.slice(1)
      const confCode = deviceConf[confName]

      // Check if any code has been entered in the config by the user
      if (confCode?.sceneCode) {
        const { bleCode, sceneCode } = confCode

        // Add to the global enabled scenes list
        this.usedCodes.push(charName)

        // Add the characteristic if not already
        if (confCode?.showAs === 'switch') {
          // Remove the Eve switch if exists
          if (this.service.testCharacteristic(this.cusChar[charName])) {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.cusChar[charName]))
          }

          // Add the accessory service switch
          if (!this.accessory.getService(charName)) {
            this.accessory.addService(this.hapServ.Switch, charName, charName)
          }

          // Add the set handler and also mark all as off when initialising accessory
          this.accessory.getService(charName)
            .getCharacteristic(this.hapChar.On)
            .onSet(async (value) => {
              await this.internalSceneUpdate(charName, sceneCode, bleCode, value, true)
            })
            .updateValue(false)
        } else {
          // Remove the accessory service switch if exists
          if (this.accessory.getService(charName)) {
            this.accessory.removeService(this.accessory.getService(charName))
          }

          // Add the Eve switch
          if (!this.service.testCharacteristic(this.cusChar[charName])) {
            this.service.addCharacteristic(this.cusChar[charName])
          }

          // Add the set handler and also mark all as off when initialising accessory
          this.service
            .getCharacteristic(this.cusChar[charName])
            .onSet(async (value) => {
              await this.internalSceneUpdate(charName, sceneCode, bleCode, value)
            })
            .updateValue(false)
        }
      } else {
        // If here then either code is invalid or has been removed, so remove the characteristic

        if (this.service.testCharacteristic(this.cusChar[charName])) {
          this.service.removeCharacteristic(this.service.getCharacteristic(this.cusChar[charName]))
        }
      }
    })

    this.hasScenes = this.usedCodes.length > 0

    // Add the colour mode characteristic if at least one other scene/mode is exposed
    if (this.hasScenes) {
      // Add the colour mode characteristic if not already
      if (!this.service.testCharacteristic(this.cusChar.ColourMode)) {
        this.service.addCharacteristic(this.cusChar.ColourMode)
      }

      // Add the set handler and also mark as off when initialising accessory
      this.service
        .getCharacteristic(this.cusChar.ColourMode)
        .onSet(async (value) => {
          if (value) {
            await this.internalColourUpdate(this.cacheHue, true)
          }
        })
        .updateValue(false)
    } else if (this.service.testCharacteristic(this.cusChar.ColourMode)) {
      // Remove the characteristic if it exists already (no need for it)
      this.service.removeCharacteristic(this.service.getCharacteristic(this.cusChar.ColourMode))
    }

    // Add the set handler to the lightbulb on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add the set handler to the lightbulb brightness characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightStep })
      .onSet(async (value) => {
        await this.internalBrightnessUpdate(value)
      })
    this.cacheBright = this.service.getCharacteristic(this.hapChar.Brightness).value
    this.cacheBrightRaw = this.cacheBright

    // Add the set handler to the lightbulb hue characteristic
    this.service.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
      await this.internalColourUpdate(value)
    })
    this.cacheHue = this.service.getCharacteristic(this.hapChar.Hue).value
    this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value

    // Add the set handler to the lightbulb cct characteristic
    if (this.colourSafeMode) {
      if (this.service.testCharacteristic(this.hapChar.ColorTemperature)) {
        this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.ColorTemperature))
      }
      this.cacheMired = 0
    } else {
      this.service.getCharacteristic(this.hapChar.ColorTemperature).onSet(async (value) => {
        await this.internalCTUpdate(value)
      })
      this.cacheMired = this.service.getCharacteristic(this.hapChar.ColorTemperature).value
    }

    // Set up the adaptive lighting controller if not disabled by user
    if (!this.colourSafeMode && this.alShift !== -1) {
      this.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
        customTemperatureAdjustment: this.alShift,
      })
      this.accessory.configureController(this.alController)
      this.accessory.context.adaptiveLighting = true
    }

    // Some lights (e.g. the H1270 Ceiling Light Ultra) have two independently
    // controllable zones - a main/bottom panel and a background/top light. Govee
    // exposes these as OpenAPI toggle capabilities, so add a switch for each zone
    // the device reports. These are only controllable via the OpenAPI connection.
    this.zoneServices = {}
    this.zoneCache = {}
    const zoneToggleDefs = [
      { instance: 'mainLightToggle', name: 'Main Light' },
      { instance: 'backgroundLightToggle', name: 'Background Light' },
    ]
    const openApiCaps = accessory.context.openApiCapabilities || {}
    zoneToggleDefs.forEach(({ instance, name }) => {
      const existingService = this.accessory.getService(name)
      if (accessory.context.useOpenApiControl && openApiCaps[instance]) {
        const service = existingService
          || this.accessory.addService(this.hapServ.Switch, name, instance)
        service
          .getCharacteristic(this.hapChar.On)
          .onSet(async value => this.internalZoneUpdate(instance, name, value))
        this.zoneServices[instance] = service
        this.zoneCache[instance] = service.getCharacteristic(this.hapChar.On).value ? 1 : 0
      } else if (existingService) {
        // Capability no longer available (or OpenAPI disabled) so remove the switch
        this.accessory.removeService(existingService)
      }
    })

    // Output the customised options to the log
    const useAwsControl = accessory.context.useAwsControl ? 'enabled' : 'disabled'
    const useBleControl = accessory.context.useBleControl ? 'enabled' : 'disabled'
    const useLanControl = accessory.context.useLanControl ? 'enabled' : 'disabled'
    const opts = JSON.stringify({
      adaptiveLightingShift: this.alShift,
      aws: accessory.context.hasAwsControl ? useAwsControl : 'unsupported',
      ble: accessory.context.hasBleControl ? useBleControl : 'unsupported',
      brightnessStep: this.brightStep,
      colourSafeMode: this.colourSafeMode,
      lan: accessory.context.hasLanControl ? useLanControl : 'unsupported',
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
    this.initialised = true
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (newValue === this.cacheState) {
        return
      }

      // Await slightly longer than brightness and colour so on/off is sent last
      await sleep(400)

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
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalZoneUpdate(instance, name, value) {
    const service = this.zoneServices[instance]
    try {
      const newValue = value ? 1 : 0

      // Don't continue if the new value is the same as before
      if (this.zoneCache[instance] === newValue) {
        return
      }

      // These toggles are only controllable via the OpenAPI (cloud) connection
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'openApi',
        openApi: {
          instance,
          capabilityType: 'devices.capabilities.toggle',
          value: newValue,
        },
      })

      // Cache the new state and log
      this.zoneCache[instance] = newValue
      this.accessory.log(`[${name}] ${platformLang.curState} [${value ? 'on' : 'off'}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`[${name}] ${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and revert this after 2 seconds
      setTimeout(() => {
        if (service) {
          service.updateCharacteristic(this.hapChar.On, this.zoneCache[instance] === 1)
        }
      }, 2000)
      throw new this.hapErr(-70402)
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

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'brightness',
        value,
      })

      // Govee considers 0% brightness to be off
      if (value === 0) {
        setTimeout(() => {
          this.cacheState = 'off'
          if (this.service.getCharacteristic(this.hapChar.On).value) {
            this.service.updateCharacteristic(this.hapChar.On, false)
            this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
          }
          this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
        }, 1500)
        return
      }

      // Cache the new state and log if appropriate
      if (this.cacheBright !== value) {
        this.cacheBright = value
        this.accessory.log(`${platformLang.curBright} [${value}%]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalColourUpdate(value, force = false) {
    try {
      // This acts like a debounce function when endlessly sliding the colour wheel
      const updateKeyColour = generateRandomString(5)
      this.updateKeyColour = updateKeyColour
      await sleep(300)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }

      if (!this.colourSafeMode) {
        // Updating the cct to the lowest value mimics native adaptive lighting
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, 140)
      }

      // Don't continue if the new value is the same as before
      const currentSat = this.service.getCharacteristic(this.hapChar.Saturation).value
      const newRGB = hs2rgb(value, currentSat)
      if (
        !force
        && newRGB[0] === this.cacheR
        && newRGB[1] === this.cacheG
        && newRGB[2] === this.cacheB
      ) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'color',
        value: {
          r: newRGB[0],
          g: newRGB[1],
          b: newRGB[2],
        },
      })

      // Switch off any custom mode/scene characteristics and turn the on switch to on
      if (this.hasScenes) {
        setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.On, true)
          this.service.updateCharacteristic(this.cusChar.ColourMode, true)
          this.usedCodes.forEach((thisCharName) => {
            if (this.service.testCharacteristic(this.cusChar[thisCharName])) {
              this.service.updateCharacteristic(this.cusChar[thisCharName], false)
            }
            if (this.accessory.getService(thisCharName)) {
              this.accessory.getService(thisCharName).updateCharacteristic(this.hapChar.On, false)
            }
          })
        }, 1000)
      }

      // Cache the new state and log if appropriate
      this.cacheHue = value
      this.cacheKelvin = 0
      this.cacheScene = ''
      if (this.cacheR !== newRGB[0] || this.cacheG !== newRGB[1] || this.cacheB !== newRGB[2]) {
        [this.cacheR, this.cacheG, this.cacheB] = newRGB
        this.accessory.log(`${platformLang.curColour} [rgb ${this.cacheR} ${this.cacheG} ${this.cacheB}]`)
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalCTUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the colour wheel
      const updateKeyCT = generateRandomString(5)
      this.updateKeyCT = updateKeyCT
      await sleep(300)
      if (updateKeyCT !== this.updateKeyCT) {
        return
      }

      // Convert mired to kelvin to nearest 100 (Govee seems to need this)
      const kelvin = Math.round(1000000 / value / 100) * 100

      // Check and increase/decrease kelvin to range of device
      const k = Math.min(Math.max(kelvin, this.minKelvin), this.maxKelvin)

      // Don't continue if the new value is the same as before
      if (this.cacheState !== 'on' || this.cacheKelvin === k) {
        if (this.alController?.isAdaptiveLightingActive?.()) {
          this.accessory.logDebug(`${platformLang.skippingAL} [${k}K /${value}M]`)
        }
        return
      }

      // Updating the hue/sat to the corresponding values mimics native adaptive lighting
      const hs = m2hs(value)
      this.service.updateCharacteristic(this.hapChar.Hue, hs[0])
      this.service.updateCharacteristic(this.hapChar.Saturation, hs[1])

      // Convert kelvin to rgb to use in case device doesn't support colour temperature
      const rgb = k2rgb(k)

      // Set up the params object to send
      const objToSend = {}

      // For BLE only models, convert to RGB, otherwise send kelvin value
      // TODO we can look at this in the future
      if (this.isBLEOnly) {
        objToSend.cmd = 'color'
        objToSend.value = { r: rgb[0], g: rgb[1], b: rgb[2] }
      } else {
        objToSend.cmd = 'colorTem'
        objToSend.value = k
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, objToSend)

      // Switch off any custom mode/scene characteristics and turn the on switch to on
      if (this.hasScenes) {
        setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.On, true)
          this.service.updateCharacteristic(this.cusChar.ColourMode, true)
          this.usedCodes.forEach((thisCharName) => {
            if (this.service.testCharacteristic(this.cusChar[thisCharName])) {
              this.service.updateCharacteristic(this.cusChar[thisCharName], false)
            }
            if (this.accessory.getService(thisCharName)) {
              this.accessory.getService(thisCharName).updateCharacteristic(this.hapChar.On, false)
            }
          })
        }, 1000)
      }

      // Cache the new state and log if appropriate
      [this.cacheR, this.cacheG, this.cacheB] = rgb
      this.cacheMired = value
      this.cacheScene = ''
      if (this.cacheKelvin !== k) {
        this.cacheKelvin = k
        if (this.alController?.isAdaptiveLightingActive?.()) {
          this.accessory.log(`${platformLang.curColour} [${k}K / ${value}M] ${platformLang.viaAL}`)
        } else {
          this.accessory.log(`${platformLang.curColour} [${k}K / ${value}M]`)
        }
      }
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSceneUpdate(charName, awsCode, bleCode, value, isService = false) {
    try {
      // Don't continue if command is to turn off - we should turn off by changing to a colour mode instead, or another scene
      if (!value) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'rgbScene',
        value: [awsCode, bleCode],
      })

      // Disable adaptive lighting if it's on already
      if (!this.colourSafeMode && this.alController?.isAdaptiveLightingActive?.()) {
        this.alController.disableAdaptiveLighting()
        this.accessory.log(platformLang.alDisabledScene)
      }

      // Log the scene change
      if (this.cacheScene !== charName) {
        this.cacheScene = charName
        this.accessory.log(`${platformLang.curScene} [${this.cacheScene}]`)
      }

      // Turn all the characteristics off and turn the on switch to on
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, true)
        this.service.updateCharacteristic(this.cusChar.ColourMode, false)
        this.usedCodes.forEach((thisCharName) => {
          if (thisCharName !== charName) {
            if (this.service.testCharacteristic(this.cusChar[thisCharName])) {
              this.service.updateCharacteristic(this.cusChar[thisCharName], false)
            }
            if (this.accessory.getService(thisCharName)) {
              this.accessory.getService(thisCharName).updateCharacteristic(this.hapChar.On, false)
            }
          }
        })
      }, 1000)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        if (isService) {
          this.accessory.getService(charName).updateCharacteristic(this.hapChar.On, false)
        } else {
          this.service.updateCharacteristic(this.cusChar[charName], false)
        }
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // Return if not initialised
    if (!this.initialised) {
      return
    }

    // Check to see if the provided state is different from the cached value
    if (params.state && params.state !== this.cacheState) {
      // State is different so update Homebridge with new values
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Check to see if the provided brightness is different from the cached value
    if (hasProperty(params, 'brightness') && params.brightness !== this.cacheBrightRaw) {
      // Brightness is different so update Homebridge with new values
      this.cacheBrightRaw = params.brightness

      // Govee considers brightness 0 as OFF so change brightness to 1 if light is on
      this.cacheBright = this.cacheState === 'on' ? Math.max(this.cacheBrightRaw, 1) : this.cacheBrightRaw
      this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)

      // Log the change
      this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
    }

    // Check to see if the provided colour is different from the cached state
    if (params.kelvin || params.rgb) {
      // Colour can be provided in rgb or kelvin so either way convert to hs for later
      let hs
      let rgb
      let mired
      let colourChange = false
      let sigColourChange = false
      if (params.kelvin) {
        mired = Math.round(1000000 / params.kelvin)
        hs = m2hs(mired)
        rgb = hs2rgb(hs[0], hs[1])

        // Check for a colour change
        if (params.kelvin !== this.cacheKelvin) {
          colourChange = true

          // Check for a significant colour change
          const kelvinDiff = Math.abs(params.kelvin - this.cacheKelvin)
          if (kelvinDiff > 100) {
            sigColourChange = true
          }
        }
      } else {
        rgb = [params.rgb.r, params.rgb.g, params.rgb.b]
        hs = rgb2hs(rgb[0], rgb[1], rgb[2])

        // Check for a colour change
        if (hs[0] !== this.cacheHue) {
          colourChange = true

          // Check for a significant colour change
          const rgbDiff = Math.abs(rgb[0] - this.cacheR)
            + Math.abs(rgb[1] - this.cacheG)
            + Math.abs(rgb[2] - this.cacheB)
          if (rgbDiff > 50) {
            sigColourChange = true
          }
        }
      }

      // Perform the check against the cache
      if (colourChange) {
        // Colour is different so update Homebridge with new values
        this.service.updateCharacteristic(this.hapChar.Hue, hs[0])
        this.service.updateCharacteristic(this.hapChar.Saturation, hs[1]);
        [this.cacheR, this.cacheG, this.cacheB] = rgb;
        [this.cacheHue] = hs

        if (mired) {
          if (!this.colourSafeMode) {
            this.service.updateCharacteristic(this.hapChar.ColorTemperature, mired)
          }
          this.cacheMired = mired
          this.cacheKelvin = params.kelvin
          this.accessory.log(`${platformLang.curColour} [${params.kelvin}K / ${mired}M]`)
        } else {
          this.accessory.log(`${platformLang.curColour} [rgb ${this.cacheR} ${this.cacheG} ${this.cacheB}]`)
        }

        // If the difference is significant then disable adaptive lighting
        if (!this.colourSafeMode && this.alController?.isAdaptiveLightingActive?.() && sigColourChange) {
          this.alController.disableAdaptiveLighting()
          this.accessory.log(platformLang.alDisabled)
        }
      }
    }

    // Update any independently-controllable light zones (e.g. main/background)
    if (params.toggles) {
      Object.entries(this.zoneServices).forEach(([instance, service]) => {
        if (hasProperty(params.toggles, instance)) {
          const newValue = params.toggles[instance] ? 1 : 0
          if (this.zoneCache[instance] !== newValue) {
            this.zoneCache[instance] = newValue
            service.updateCharacteristic(this.hapChar.On, newValue === 1)
            this.accessory.log(`[${service.displayName}] ${platformLang.curState} [${newValue === 1 ? 'on' : 'off'}]`)
          }
        }
      })
    }
  }
}
