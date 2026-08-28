import { hs2rgb } from '../utils/colour.js'
import { getDeviceCapabilities } from '../utils/device-capabilities.js'
import { base64ToHex, generateCodeFromHexValues, generateRandomString, getTwoItemPosition, hexToTwoItems, sleep } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

export default class GoveeIceMaker extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Ice size codes: small=1, medium=2, large=3 (matching OpenAPI workMode values)
    // Small, medium and large are all `33 05 <size>`. Which byte means which
    // size runs the opposite way on the older models, so the order comes from
    // the model rather than being written out twice
    this.caps = getDeviceCapabilities(accessory.context.gvModel)
    const ascending = this.caps.iceSizeAscending
    const sizeBytes = ascending ? [0x01, 0x02, 0x03] : [0x03, 0x02, 0x01]
    this.sizeCodes = {
      1: generateCodeFromHexValues([0x33, 0x05, sizeBytes[0]]), // small
      2: generateCodeFromHexValues([0x33, 0x05, sizeBytes[1]]), // medium
      3: generateCodeFromHexValues([0x33, 0x05, sizeBytes[2]]), // large
    }

    this.sizeLabels = {
      1: 'small',
      2: 'medium',
      3: 'large',
    }

    // Remove old switch service if migrating
    if (this.accessory.getService(this.hapServ.Switch)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Switch))
    }

    // The LED night light, for models whose cloud account declares the
    // controls (#1250 - the H8120 lists nightlightToggle and brightness).
    // ⚠️ OpenAPI-only on the send side: the AWS status frame for the light is
    // known (aa 1b 01 <on> <brightness>, watched flipping as an owner toggled
    // it) but no capture of the app's own WRITE command exists, and command
    // bytes are never guessed here. Without an API key the tile would be a
    // dead control, so it only exists when the capability does.
    const nightlightCapable = !!this.accessory.context.openApiCapabilities?.nightlightToggle
    const existingLight = this.accessory.getService(this.hapServ.Lightbulb)
    if (nightlightCapable) {
      this.lightService = existingLight || this.accessory.addService(this.hapServ.Lightbulb)
      this.lightService
        .getCharacteristic(this.hapChar.On)
        .onSet(async value => this.internalLightStateUpdate(value))
      this.cacheLightState = this.lightService.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'
      if (this.accessory.context.openApiCapabilities?.brightness) {
        this.lightService
          .getCharacteristic(this.hapChar.Brightness)
          .onSet(async value => this.internalLightBrightnessUpdate(value))
        this.cacheLightBright = this.lightService.getCharacteristic(this.hapChar.Brightness).value
      }
      if (this.accessory.context.openApiCapabilities?.colorRgb) {
        if (!this.lightService.testCharacteristic(this.hapChar.Hue)) {
          this.lightService.addCharacteristic(this.hapChar.Hue)
        }
        if (!this.lightService.testCharacteristic(this.hapChar.Saturation)) {
          this.lightService.addCharacteristic(this.hapChar.Saturation)
        }
        // The pending values remember exactly what HomeKit sent. HAP-NodeJS
        // runs the Hue and Saturation handlers concurrently and only applies
        // a characteristic's value after its handler resolves - so reading
        // Hue.value from the Saturation handler (the old approach) served the
        // PREVIOUS colour while this handler slept in its settle window,
        // making every send one pick behind (#1250)
        this.lightService
          .getCharacteristic(this.hapChar.Hue)
          .onSet(async (value) => {
            this.pendingLightHue = value
            await this.internalLightColourUpdate()
          })
        this.lightService
          .getCharacteristic(this.hapChar.Saturation)
          .onSet(async (value) => {
            this.pendingLightSat = value
            await this.internalLightColourUpdate()
          })
      }
    } else if (existingLight) {
      // The key was removed, or the account stopped declaring the control
      this.accessory.removeService(existingLight)
    }

    // Add the fan service for ice size control
    this.service = this.accessory.getService(this.hapServ.Fanv2)
      || this.accessory.addService(this.hapServ.Fanv2)

    // Add the set handler to the on/off characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'

    // Add the set handler to the rotation speed characteristic (ice size).
    // Models with no ice size option in the app (the H8120) get a plain
    // on/off tile instead - a speed slider there would be a dead control
    if (this.caps.iceSizes) {
      this.service
        .getCharacteristic(this.hapChar.RotationSpeed)
        .setProps({
          maxValue: 3,
          minStep: 1,
          minValue: 0,
          unit: 'unitless',
        })
        .onSet(async value => this.internalSizeUpdate(value))
      this.cacheSize = this.service.getCharacteristic(this.hapChar.RotationSpeed).value || 2

      // Keep the characteristic in step with the cache. Without this an accessory
      // that has never had a size set reports Active=1 with RotationSpeed=0, which
      // is contradictory and which the Home app renders as "0".
      if (this.service.getCharacteristic(this.hapChar.RotationSpeed).value !== this.cacheSize) {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSize)
      }
    } else if (this.service.testCharacteristic(this.hapChar.RotationSpeed)) {
      // Migration for accessories created before the size control was gated
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.RotationSpeed))
    }

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newState = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (newState === this.cacheState) {
        return
      }

      if (this.caps.icePowerOnOff) {
        // The H8120's ice making is plain device power: `33 01 <0/1>`, the
        // universal govee power frame. The #1250 capture showed `33 01 00`
        // in both directions, which first read as a toggle - but the owner's
        // live test proved it only ever switches OFF (the app's wake most
        // likely went over bluetooth, with the identical AWS frame being an
        // echo), so absolute on/off is sent instead
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: generateCodeFromHexValues([0x33, 0x01, value ? 0x01 : 0x00]),
        })
      } else if (value) {
        // Turn on with current cached ice size
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: this.sizeCodes[this.cacheSize],
          openApi: this.accessory.context.openApiCapabilities?.workMode
            ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: this.cacheSize, modeValue: 0 } }
            : undefined,
        })
      } else {
        // Turn off
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: 'MxkAAAAAAAAAAAAAAAAAAAAAACo=',
          openApi: this.accessory.context.openApiCapabilities?.workMode
            ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: 0, modeValue: 0 } }
            : undefined,
        })
      }

      // Cache the new state and log if appropriate
      if (this.cacheState !== newState) {
        this.cacheState = newState
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  async internalSizeUpdate(value) {
    try {
      // 0 is not a valid ice size. Put the slider back, otherwise HomeKit keeps 0
      // while the device carries on at cacheSize - and that 0 is what gets written
      // to the accessory cache, so it returns on the next restart. Deferred for the
      // same reason as the error reverts below: an immediate update would be
      // overwritten by the value HomeKit is currently writing.
      if (value === 0) {
        setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSize)
        }, 1000)
        return
      }

      // Don't continue if the new value is the same as before
      if (value === this.cacheSize) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: this.sizeCodes[value],
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: value, modeValue: 0 } }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheSize = value
      this.cacheState = 'on'
      this.service.updateCharacteristic(this.hapChar.Active, 1)
      this.accessory.log(`${platformLang.curSpeed} [${this.sizeLabels[value]}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSize)
      })
    }
  }

  async internalLightStateUpdate(value) {
    try {
      const newState = value ? 'on' : 'off'
      if (newState === this.cacheLightState) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'openApi',
        openApi: {
          instance: 'nightlightToggle',
          capabilityType: 'devices.capabilities.toggle',
          value: value ? 1 : 0,
        },
      })
      this.cacheLightState = newState
      this.accessory.log(`${platformLang.curLight} [${this.cacheLightState}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.On, this.cacheLightState === 'on')
      })
    }
  }

  async internalLightBrightnessUpdate(value) {
    try {
      if (value === this.cacheLightBright) {
        return
      }
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'openApi',
        openApi: {
          instance: 'brightness',
          capabilityType: 'devices.capabilities.range',
          value,
        },
      })
      this.cacheLightBright = value
      this.accessory.log(`${platformLang.curBright} [${value}%]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.lightService.updateCharacteristic(this.hapChar.Brightness, this.cacheLightBright)
      })
    }
  }

  async internalLightColourUpdate() {
    try {
      // HomeKit sends hue and saturation as separate writes - wait for the
      // pair to settle and send once. The values come from the pending pair
      // captured in the onSet handlers, never from the characteristics,
      // which HAP only updates after the handlers resolve
      const updateKey = generateRandomString(5)
      this.updateKeyLightColour = updateKey
      await sleep(300)
      if (updateKey !== this.updateKeyLightColour) {
        return
      }

      const hue = this.pendingLightHue ?? this.lightService.getCharacteristic(this.hapChar.Hue).value
      const sat = this.pendingLightSat ?? this.lightService.getCharacteristic(this.hapChar.Saturation).value
      this.pendingLightHue = undefined
      this.pendingLightSat = undefined
      const [r, g, b] = hs2rgb(hue, sat)
      if (this.cacheLightColour && this.cacheLightColour.r === r && this.cacheLightColour.g === g && this.cacheLightColour.b === b) {
        return
      }

      if (this.caps.nightlightColourAws) {
        // The app sets this model's night light colour with a multiSync frame
        // `3a b6 15 fc 01 r g b` (fc = commit; fe previews without saving) -
        // from the #1250 capture, where the OpenAPI colorRgb write was
        // accepted but visibly did nothing on the machine
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'multiSync',
          value: generateCodeFromHexValues([0x3A, 0xB6, 0x15, 0xFC, 0x01, r, g, b]),
        })
      } else {
        // The official api's color_setting takes the colour as one integer
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'openApi',
          openApi: {
            instance: 'colorRgb',
            capabilityType: 'devices.capabilities.color_setting',
            value: (r << 16) + (g << 8) + b,
          },
        })
      }
      this.cacheLightColour = { r, g, b }
      this.accessory.log(`${platformLang.curColour} [rgb ${r} ${g} ${b}]`)
    } catch (err) {
      this.failUpdate(err, () => {})
    }
  }

  externalUpdate(params) {
    // Handle OpenAPI workMode
    if (params.workMode) {
      const mode = params.workMode.workMode
      if (mode > 0 && mode <= 3) {
        if (this.cacheState !== 'on') {
          this.cacheState = 'on'
          this.service.updateCharacteristic(this.hapChar.Active, 1)
          this.accessory.log(`${platformLang.curState} [on]`)
        }
        // Writing RotationSpeed on a model without the size control would
        // silently re-add the characteristic that was removed above
        if (this.caps.iceSizes && this.cacheSize !== mode) {
          this.cacheSize = mode
          this.service.updateCharacteristic(this.hapChar.RotationSpeed, this.cacheSize)
          this.accessory.log(`${platformLang.curSpeed} [${this.sizeLabels[this.cacheSize]}]`)
        }
      } else if (mode === 0) {
        if (this.cacheState !== 'off') {
          this.cacheState = 'off'
          this.service.updateCharacteristic(this.hapChar.Active, 0)
          this.accessory.log(`${platformLang.curState} [off]`)
        }
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

      const deviceFunction = `${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}`

      switch (deviceFunction) {
        case 'aa19': {
          // On/Off
          const newState = getTwoItemPosition(hexParts, 3) === '01' ? 'on' : 'off'
          if (this.cacheState !== newState) {
            this.cacheState = newState
            this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
          }
          break
        }
        case 'aa1b': {
          // Night light: aa 1b 01 <on> <brightness 1-100>. Watched flipping
          // 00->01 at byte 4 as the owner toggled the light in the app, with
          // byte 5 steady at 0x64 after a 100% brightness command (#1250).
          if (getTwoItemPosition(hexParts, 3) !== '01') {
            break
          }
          const newLightState = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
          const newBright = Number.parseInt(getTwoItemPosition(hexParts, 5), 16)
          if (this.lightService) {
            if (this.cacheLightState !== newLightState) {
              this.cacheLightState = newLightState
              this.lightService.updateCharacteristic(this.hapChar.On, newLightState === 'on')
              this.accessory.log(`${platformLang.curLight} [${newLightState}]`)
            }
            if (newBright >= 1 && newBright <= 100 && this.cacheLightBright !== newBright
              && this.accessory.context.openApiCapabilities?.brightness) {
              this.cacheLightBright = newBright
              this.lightService.updateCharacteristic(this.hapChar.Brightness, newBright)
              this.accessory.log(`${platformLang.curBright} [${newBright}%]`)
            }
          }
          break
        }
        case 'aa05': {
          // Ice size report. The payload encoding is deliberately NOT decoded here:
          // the size byte order differs by model while the OpenAPI path sends
          // workMode un-inverted, and which is authoritative is unresolved (#1329).
          // Claiming a mapping here could silently swap sizes, so this case exists
          // only to stop a routine status report being logged as a new scene code.
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
