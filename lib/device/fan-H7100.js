import { getDeviceCapabilities } from '../utils/device-capabilities.js'
import {
  base64ToHex,
  fanSpeedToHkPercent,
  getTwoItemPosition,
  hexToTwoItems,
  hkPercentToFanSpeed,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

/*
  The models on this handler and the modes each offers:

  H7100, H7102, H7106 -> Sleep, Nature, Custom, Auto
  H7101               -> Sleep, Nature, Turbo, Custom, Auto
  H7111               -> Sleep, Nature, Custom, Auto

  The H1310 and R1310 were once on this handler as "the same fan". They are
  not - they are ceiling fans with lights, and moved to fan-H1370 in #1352.
 */

export default class GoveeFanH7100 extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Which of the models on this handler have a confirmed meaning for the
    // oscillation status message
    this.readsSwingStatus = getDeviceCapabilities(accessory.context.gvModel).readsSwingStatus

    // Codes etc
    this.speedCodes = {
      1: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
      2: 'MwUBAgAAAAAAAAAAAAAAAAAAADU=',
      3: 'MwUBAwAAAAAAAAAAAAAAAAAAADQ=',
      4: 'MwUBBAAAAAAAAAAAAAAAAAAAADM=',
      5: 'MwUBBQAAAAAAAAAAAAAAAAAAADI=',
      6: 'MwUBBgAAAAAAAAAAAAAAAAAAADE=',
      7: 'MwUBBwAAAAAAAAAAAAAAAAAAADA=',
      8: 'MwUBCAAAAAAAAAAAAAAAAAAAAD8=',
      9: 'MwUAAwAAAAAAAAAAAAAAAAAAADU=', // auto mode
    }
    this.autoSpeed = 9
    // Real speed steps, excluding auto - HomeKit percentages map onto these
    this.speedSteps = 8

    // Remove any old original Fan services
    if (this.accessory.getService(this.hapServ.Fan)) {
      this.accessory.removeService(this.accessory.getService(this.hapServ.Fan))
    }

    // Rebuild the fan service if it was cached under an older speed scale, as
    // HomeKit keeps the old props until the service itself is replaced
    const existingService = this.accessory.getService(this.hapServ.Fanv2)
    if (existingService) {
      const { props } = existingService.getCharacteristic(this.hapChar.RotationSpeed)
      if (props.unit === 'percentage' || props.maxValue !== 100) {
        this.accessory.removeService(existingService)
      }
    }

    // Add the fan service for the fan if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Fanv2) || this.accessory.addService(this.hapServ.Fanv2)

    // Add the set handler to the fan on/off characteristic
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value ? 'on' : 'off'

    // Add the set handler to the fan rotation speed characteristic
    this.service
      .getCharacteristic(this.hapChar.RotationSpeed)
      .setProps({
        maxValue: 100,
        minStep: 1,
        minValue: 0,
        unit: 'unitless',
      })
      .onSet(async value => this.internalSpeedUpdate(value))

    // cacheSpeed holds a device speed step everywhere else, but the restored
    // characteristic is a HomeKit percentage, so it has to be converted back.
    // Left as a percentage it would sometimes equal a real step and silently
    // swallow the first speed the owner asked for. A restored 100% stays
    // ambiguous between auto and top speed - both report 100 - so it settles on
    // top speed rather than guessing.
    const restoredPercent = this.service.getCharacteristic(this.hapChar.RotationSpeed).value
    this.cacheSpeed = restoredPercent ? hkPercentToFanSpeed(restoredPercent, this.speedSteps) : 0

    // Add the set handler to the fan swing mode
    this.service
      .getCharacteristic(this.hapChar.SwingMode)
      .onSet(async value => this.internalSwingUpdate(value))
    this.cacheSwing = this.service.getCharacteristic(this.hapChar.SwingMode).value === 1 ? 'on' : 'off'

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
      })

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

  async internalSpeedUpdate(value) {
    try {
      // Don't continue if the value is 0
      if (value === 0) {
        return
      }

      // HomeKit sends a percentage - map it onto this model's real speed steps
      value = hkPercentToFanSpeed(value, this.speedSteps)

      // Don't continue if the new value is the same as before
      if (this.cacheSpeed === value) {
        return
      }

      const codeToSend = this.speedCodes[value]

      const isAuto = value === this.autoSpeed
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: codeToSend,
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: isAuto ? { workMode: 3 } : { workMode: 1, modeValue: value } }
          : undefined,
      })

      // Cache the new state and log if appropriate
      if (this.cacheSpeed !== value) {
        this.cacheSpeed = value
        this.accessory.log(`${platformLang.curSpeed} [${value}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, fanSpeedToHkPercent(this.cacheSpeed, this.speedSteps, this.autoSpeed))
      })
    }
  }

  async internalSwingUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      // Don't continue if the new value is the same as before
      if (this.cacheSwing === value) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'Mx8BAQAAAAAAAAAAAAAAAAAAACw=' : 'Mx8BAAAAAAAAAAAAAAAAAAAAAC0=',
        openApi: this.accessory.context.openApiCapabilities?.oscillationToggle
          ? { instance: 'oscillationToggle', capabilityType: 'devices.capabilities.toggle', value: value ? 1 : 0 }
          : undefined,
      })

      // Cache the new state and log if appropriate
      if (this.cacheSwing !== newValue) {
        this.cacheSwing = newValue
        this.accessory.log(`${platformLang.curSwing} [${newValue}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
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

    // Handle OpenAPI workMode (speed or auto)
    if (params.workMode) {
      let newSpeed
      if (params.workMode.workMode === 3) {
        newSpeed = this.autoSpeed
      } else {
        newSpeed = params.workMode.modeValue
      }
      if (Number.isFinite(newSpeed) && newSpeed >= 1 && newSpeed <= this.autoSpeed && this.cacheSpeed !== newSpeed) {
        this.cacheSpeed = newSpeed
        const hkSpeed = fanSpeedToHkPercent(newSpeed, this.speedSteps, this.autoSpeed)
        this.service.updateCharacteristic(this.hapChar.RotationSpeed, hkSpeed)
        this.accessory.log(`${platformLang.curSpeed} [${newSpeed} -> ${hkSpeed}%]`)
      }
    }

    // Handle OpenAPI toggles
    if (params.toggles?.oscillationToggle !== undefined) {
      const newSwing = params.toggles.oscillationToggle ? 'on' : 'off'
      if (this.cacheSwing !== newSwing) {
        this.cacheSwing = newSwing
        this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
        this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
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

      if (getTwoItemPosition(hexParts, 2) === '08') {
        // Sensor Attached?
        const dev = hexString.substring(4, hexString.length - 24)
        this.accessory.context.sensorAttached = dev !== '000000000000'
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      switch (deviceFunction) {
        case '0501': {
          // Fan speed
          const newSpeed = Number.parseInt(getTwoItemPosition(hexParts, 4), 16)
          if (newSpeed >= 1 && newSpeed <= this.speedSteps && this.cacheSpeed !== newSpeed) {
            this.cacheSpeed = newSpeed
            const hkSpeed = fanSpeedToHkPercent(newSpeed, this.speedSteps, this.autoSpeed)
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, hkSpeed)
            this.accessory.log(`${platformLang.curSpeed} [${newSpeed} -> ${hkSpeed}%]`)
          }
          break
        }
        case '0500': {
          // Mode change (auto = 0x03)
          if (getTwoItemPosition(hexParts, 4) === '03' && this.cacheSpeed !== this.autoSpeed) {
            this.cacheSpeed = this.autoSpeed
            // Cache auto so we can tell it apart from "user asked for max speed"
            this.service.updateCharacteristic(this.hapChar.RotationSpeed, 100)
            this.accessory.log(`${platformLang.curSpeed} [auto -> 100%]`)
          }
          break
        }
        case '1f01': {
          // Not every model on this handler is known to mean oscillation by
          // this message, so one that has not been confirmed falls through and
          // reports it instead - which is how it gets confirmed
          if (!this.readsSwingStatus) {
            logUnknownData(this.accessory, {
              kind: 'status',
              source: params.source,
              raw: command,
              hex: hexString,
            })
            break
          }
          const newSwing = getTwoItemPosition(hexParts, 4) === '01' ? 'on' : 'off'
          if (this.cacheSwing !== newSwing) {
            this.cacheSwing = newSwing
            this.service.updateCharacteristic(this.hapChar.SwingMode, this.cacheSwing === 'on' ? 1 : 0)
            this.accessory.log(`${platformLang.curSwing} [${this.cacheSwing}]`)
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
