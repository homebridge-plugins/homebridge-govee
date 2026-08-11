import {
  base64ToHex,
  farToCen,
  getTwoItemPosition,
  hexToDecimal,
  hexToTwoItems,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

/*
  Custom Mode:                                 aa050001010000000000000000000000000000af

  Green Tea:      MwUAAgAAAAAAAAAAAAAAAAAAADQ= 3305000200000000000000000000000000000034 [switch]
                  MwEBAgAAAAAAAAAAAAAAAAAAADk= 3301010200000000000000000000000000000039 [enable]

  Oolong Tea:     MwUAAwAAAAAAAAAAAAAAAAAAADU= 3305000300000000000000000000000000000035 [switch]
                  MwEBAwAAAAAAAAAAAAAAAAAAADg= 3301010300000000000000000000000000000038 [enable]

  Coffee:         MwUABAAAAAAAAAAAAAAAAAAAADI= 3305000400000000000000000000000000000032 [switch]
                  MwEBBAAAAAAAAAAAAAAAAAAAADc= 3301010400000000000000000000000000000037 [enable]

  Black Tea/Boil: MwUABQAAAAAAAAAAAAAAAAAAADM= 3305000500000000000000000000000000000033 [switch]
                  MwEBBQAAAAAAAAAAAAAAAAAAADY= 3301010500000000000000000000000000000036 [enable]
 */
/**
 * The water temperature out of a status frame, in celsius.
 *
 * The frame carries it as two bytes of hundredths of a degree fahrenheit. An
 * owner confirmed that layout against three known points on an H7171 (#1337):
 * cold water read 0x1edc = 79.00F, the moment the kettle beeped at its 142F
 * target it read 0x3778 = 142.00F, and it drifted to 0x39d0 = 148.00F after.
 *
 * The result is still checked before it is used, because only the one model has
 * been seen: a kettle holds water, and a figure outside freezing to a little
 * past boiling is not a temperature at all - it means that model packs the
 * frame differently. Returning nothing then leaves the tile absent rather than
 * wrong.
 *
 * @param {string[]} hexParts the frame split into bytes
 * @returns {number|undefined} the reading in celsius, or undefined if the
 *   frame does not look like one
 */
function readingToCelsius(hexParts) {
  const fahrenheit = hexToDecimal(
    `${getTwoItemPosition(hexParts, 4)}${getTwoItemPosition(hexParts, 5)}`,
  ) / 100

  if (!Number.isFinite(fahrenheit) || fahrenheit < 32 || fahrenheit > 230) {
    return undefined
  }

  return farToCen(fahrenheit)
}

/**
 * What the kettle says it is doing, from the state byte of an `aa 19` frame.
 *
 * Worked out from a full run an owner instrumented for us (#1337), matching the
 * frames against a running commentary of what the kettle was doing:
 *
 *   00  idle      two seconds after they switched it off
 *   01  heating   the moment they turned it on, and a second after setting a
 *                 temperature on an earlier run
 *   04  reached   as the water hit the target and the kettle beeped
 *   02  warming   held for the next three and a half minutes of keep warm
 *
 * `04` and `02` arrive in the same second, so which of the pair marks reaching
 * the target and which marks entering keep warm is read from their order, not
 * proven separately. Both leave the kettle no longer heating, which is what the
 * sensor reflects, so the distinction only affects the wording in the log.
 *
 * Only these four have been seen, all with keep warm switched on. Anything else
 * falls through to the unknown-data report, which is how these were found.
 */
// The range a kettle preset can plausibly sit in. The lowest Govee kettles go
// is around 40°C for delicate teas, and water stops being water at 100°C - so
// 90°F to 212°F covers every real preset with room to spare, while excluding
// the 0 and 1 the H7173 puts in that byte (#1351).
const KETTLE_PRESET_MIN_F = 90
const KETTLE_PRESET_MAX_F = 212

const HEATING_STATES = {
  '00': { label: 'idle', heating: false },
  '01': { label: 'heating', heating: true },
  '02': { label: 'keeping warm', heating: false },
  '04': { label: 'reached target', heating: false },
}

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Set up variables from the accessory
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId] || {}

    // What each preset was last reported as, so a repeat is not logged twice
    this.reportedPresets = new Map()

    this.codes = {
      greenTea: 'MwUAAgAAAAAAAAAAAAAAAAAAADQ=',
      oolongTea: 'MwUAAwAAAAAAAAAAAAAAAAAAADU=',
      coffee: 'MwUABAAAAAAAAAAAAAAAAAAAADI=',
      blackTea: 'MwUABQAAAAAAAAAAAAAAAAAAADM=',
      customMode1: 'MwUAAQEAAAAAAAAAAAAAAAAAADY=',
      customMode2: 'MwUAAQIAAAAAAAAAAAAAAAAAADU=',
    }

    // Add a switch service for Green Tea
    this.service1 = this.accessory.getService('Green Tea')
    if (deviceConf.hideModeGreenTea) {
      if (this.service1) {
        this.accessory.removeService(this.service1)
      }
    } else if (!this.service1) {
      this.service1 = this.accessory.addService(this.hapServ.Switch, 'Green Tea', 'greenTea')
      this.service1.addCharacteristic(this.hapChar.ConfiguredName)
      this.service1.updateCharacteristic(this.hapChar.ConfiguredName, 'Green Tea')
      this.service1.addCharacteristic(this.hapChar.ServiceLabelIndex)
      this.service1.updateCharacteristic(this.hapChar.ServiceLabelIndex, 1)
    }

    // Add a switch service for Oolong Tea
    this.service2 = this.accessory.getService('Oolong Tea')
    if (deviceConf.hideModeOolongTea) {
      if (this.service2) {
        this.accessory.removeService(this.service2)
      }
    } else if (!this.service2) {
      this.service2 = this.accessory.addService(this.hapServ.Switch, 'Oolong Tea', 'oolongTea')
      this.service2.addCharacteristic(this.hapChar.ConfiguredName)
      this.service2.updateCharacteristic(this.hapChar.ConfiguredName, 'Oolong Tea')
      this.service2.addCharacteristic(this.hapChar.ServiceLabelIndex)
      this.service2.updateCharacteristic(this.hapChar.ServiceLabelIndex, 2)
    }

    // Add a switch service for Coffee
    this.service3 = this.accessory.getService('Coffee')
    if (deviceConf.hideModeCoffee) {
      if (this.service3) {
        this.accessory.removeService(this.service3)
      }
    } else if (!this.service3) {
      this.service3 = this.accessory.addService(this.hapServ.Switch, 'Coffee', 'coffee')
      this.service3.addCharacteristic(this.hapChar.ConfiguredName)
      this.service3.updateCharacteristic(this.hapChar.ConfiguredName, 'Coffee')
      this.service3.addCharacteristic(this.hapChar.ServiceLabelIndex)
      this.service3.updateCharacteristic(this.hapChar.ServiceLabelIndex, 3)
    }

    // Add a switch service for Black Tea/Boil
    this.service4 = this.accessory.getService('Black Tea/Boil')
    if (deviceConf.hideModeBlackTea) {
      if (this.service4) {
        this.accessory.removeService(this.service4)
      }
    } else if (!this.service4) {
      this.service4 = this.accessory.addService(this.hapServ.Switch, 'Black Tea/Boil', 'blackTeaBoil')
      this.service4.addCharacteristic(this.hapChar.ConfiguredName)
      this.service4.updateCharacteristic(this.hapChar.ConfiguredName, 'Black Tea/Boil')
      this.service4.addCharacteristic(this.hapChar.ServiceLabelIndex)
      this.service4.updateCharacteristic(this.hapChar.ServiceLabelIndex, 4)
    }

    // Add a switch service for Custom Mode 1
    this.service5 = this.accessory.getService('Custom Mode 1')
    if (deviceConf.showCustomMode1) {
      if (!this.service5) {
        this.service5 = this.accessory.addService(this.hapServ.Switch, 'Custom Mode 1', 'customMode1')
        this.service5.addCharacteristic(this.hapChar.ConfiguredName)
        this.service5.updateCharacteristic(this.hapChar.ConfiguredName, 'Custom Mode 1')
        this.service5.addCharacteristic(this.hapChar.ServiceLabelIndex)
        this.service5.updateCharacteristic(this.hapChar.ServiceLabelIndex, 5)
      }
    } else if (this.service5) {
      this.accessory.removeService(this.service5)
    }

    // Add a switch service for Custom Mode 2
    this.service6 = this.accessory.getService('Custom Mode 2')
    if (deviceConf.showCustomMode2) {
      if (!this.service6) {
        this.service6 = this.accessory.addService(this.hapServ.Switch, 'Custom Mode 2', 'customMode2')
        this.service6.addCharacteristic(this.hapChar.ConfiguredName)
        this.service6.updateCharacteristic(this.hapChar.ConfiguredName, 'Custom Mode 2')
        this.service6.addCharacteristic(this.hapChar.ServiceLabelIndex)
        this.service6.updateCharacteristic(this.hapChar.ServiceLabelIndex, 6)
      }
    } else if (this.service6) {
      this.accessory.removeService(this.service6)
    }

    // The temperature tile is added the first time a reading actually arrives,
    // not here - see readingToCelsius below. This device had one added up front
    // once before, and because nothing ever updated it, owners were left with a
    // tile stuck at its starting value. A number that never moves cannot be
    // told apart from a real reading, so it is worse than no tile at all.
    this.serviceTemp = this.accessory.getService(this.hapServ.TemperatureSensor)
    this.cacheTemp = this.serviceTemp
      ? this.serviceTemp.getCharacteristic(this.hapChar.CurrentTemperature).value
      : undefined

    // Add a contact sensor service to reflect whether the kettle is on its base
    this.serviceOnBase = this.accessory.getService('On Base')
    if (!this.serviceOnBase) {
      this.serviceOnBase = this.accessory.addService(this.hapServ.ContactSensor, 'On Base', 'onBase')
      this.serviceOnBase.addCharacteristic(this.hapChar.ConfiguredName)
      this.serviceOnBase.updateCharacteristic(this.hapChar.ConfiguredName, 'On Base')
    }

    // Add the set handler to the green tea switch if it exists
    if (this.service1) {
      this.service1.getCharacteristic(this.hapChar.On)
        .updateValue(false)
        .onSet(async value => this.internalStateUpdate(this.service1, value, this.codes.greenTea))
    }

    // Add the set handler to the oolong tea switch if it exists
    if (this.service2) {
      this.service2.getCharacteristic(this.hapChar.On)
        .updateValue(false)
        .onSet(async value => this.internalStateUpdate(this.service2, value, this.codes.oolongTea))
    }

    // Add the set handler to the coffee switch if it exists
    if (this.service3) {
      this.service3.getCharacteristic(this.hapChar.On)
        .updateValue(false)
        .onSet(async value => this.internalStateUpdate(this.service3, value, this.codes.coffee))
    }

    // Add the set handler to the black tea/boil switch if it exists
    if (this.service4) {
      this.service4.getCharacteristic(this.hapChar.On)
        .updateValue(false)
        .onSet(async value => this.internalStateUpdate(this.service4, value, this.codes.blackTea))
    }

    // Add the set handler to the custom mode 1 switch if it exists
    if (this.service5) {
      this.service5.getCharacteristic(this.hapChar.On)
        .updateValue(false)
        .onSet(async value => this.internalStateUpdate(this.service5, value, this.codes.customMode1))
    }

    // Add the set handler to the custom mode 2 switch if it exists
    if (this.service6) {
      this.service6.getCharacteristic(this.hapChar.On)
        .updateValue(false)
        .onSet(async value => this.internalStateUpdate(this.service6, value, this.codes.customMode2))
    }

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalStateUpdate(service, value, b64Code) {
    try {
      if (!value) {
        return
      }

      // Determine the mode value from the base64 code for OpenAPI
      const codeToMode = {
        [this.codes.greenTea]: 2,
        [this.codes.oolongTea]: 3,
        [this.codes.coffee]: 4,
        [this.codes.blackTea]: 5,
        [this.codes.customMode1]: 1,
        [this.codes.customMode2]: 1,
      }
      const modeValue = codeToMode[b64Code] || 0

      // Send the request to the platform sender function to change the mode
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: b64Code,
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: modeValue, modeValue: 0 } }
          : undefined,
      })

      await sleep(1000)

      // Send the request to the platform sender function to turn to boiling mode
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: 'MwEBAAAAAAAAAAAAAAAAAAAAADM=',
        openApi: this.accessory.context.openApiCapabilities?.workMode
          ? { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: { workMode: modeValue, modeValue: 1 } }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheState = 'on'
      this.accessory.log(`${platformLang.curMode} [${service.displayName}]`)
      setTimeout(() => {
        service.updateCharacteristic(this.hapChar.On, false)
      }, 3000)
    } catch (err) {
      this.failUpdate(err, () => {
        service.updateCharacteristic(this.hapChar.On, false)
      })
    }
  }

  /**
   * Show the water temperature, adding the tile the first time there is a real
   * reading to put in it.
   *
   * @param {string} hexString the whole frame, for the log if it cannot be read
   * @param {string[]} hexParts the frame split into bytes
   */
  updateCurrentTemperature(hexString, hexParts) {
    const newTemp = readingToCelsius(hexParts)

    if (newTemp === undefined) {
      this.accessory.logDebug(`no temperature read from [${hexString}]`)
      return
    }

    if (!this.serviceTemp) {
      this.serviceTemp = this.accessory.addService(this.hapServ.TemperatureSensor)
    }

    if (newTemp !== this.cacheTemp) {
      this.cacheTemp = newTemp
      this.serviceTemp.updateCharacteristic(this.hapChar.CurrentTemperature, newTemp)
      this.accessory.log(`${platformLang.curTemp} [${this.cacheTemp}°C]`)
    }
  }

  /**
   * Reflect what the kettle says it is doing.
   *
   * The tile is added the first time a state frame arrives rather than up
   * front, for the same reason as the temperature tile above: only the H7171
   * has been seen sending these, and a tile that never updates cannot be told
   * apart from a real reading.
   *
   * @param {string} stateByte the state byte of an `aa 19` frame
   */
  updateHeatingState(stateByte) {
    const state = HEATING_STATES[stateByte]
    if (!state) {
      return
    }

    if (!this.serviceHeating) {
      this.serviceHeating = this.accessory.getService('Heating')
      if (!this.serviceHeating) {
        this.serviceHeating = this.accessory.addService(this.hapServ.ContactSensor, 'Heating', 'heating')
        this.serviceHeating.addCharacteristic(this.hapChar.ConfiguredName)
        this.serviceHeating.updateCharacteristic(this.hapChar.ConfiguredName, 'Heating')
      }
    }

    if (this.cacheHeatingState === state.label) {
      return
    }
    this.cacheHeatingState = state.label

    this.serviceHeating.updateCharacteristic(
      this.hapChar.ContactSensorState,
      state.heating
        ? this.hapChar.ContactSensorState.CONTACT_DETECTED
        : this.hapChar.ContactSensorState.CONTACT_NOT_DETECTED,
    )
    this.accessory.log(`current status [${state.label}]`)
  }

  externalUpdate(params) {
    // Handle OpenAPI workMode
    if (params.workMode) {
      const mode = params.workMode.workMode
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

      const deviceFunction = `${getTwoItemPosition(hexParts, 2)}${getTwoItemPosition(hexParts, 3)}`

      // On startup the kettle lists the temperature held in each of its
      // temperature slots, one frame per slot: aa 05 <slot> <degrees F>. That
      // is a different thing from aa 05 00 <mode> below, which is a mode
      // change - the slot byte is what tells them apart. Nothing here needs the
      // values, so they are logged for reference rather than reported as
      // unrecognised (#1337)
      //
      // Slot 01 is NOT a memory preset, it is the target the kettle is set to
      // right now. Two runs from the owner in #1337 show it moving on its own:
      // 212°F on 3 Aug, then 142°F on both 8 and 11 Aug, matching the `setTem`
      // of 14200 carried in the same message, while slots 02-05 never budged.
      // The memory presets are therefore slots 02-05, which is why the number
      // printed below is one less than the slot.
      //
      // Those four are also not in the same order as the mode commands at the
      // top of this file. The owner's app lists M1-M4 as black tea 212, green
      // tea 180, oolong 195, coffee 205, which is the order slots 02-05 arrive
      // in - whereas the switch commands number green tea 02, oolong 03, coffee
      // 04 and black tea 05. So the slots follow the app's list rather than the
      // mode ids, and no attempt is made here to name them.
      if (getTwoItemPosition(hexParts, 2) === '05' && getTwoItemPosition(hexParts, 3) !== '00') {
        const slot = Number.parseInt(getTwoItemPosition(hexParts, 3), 16)
        const tempInF = Number.parseInt(getTwoItemPosition(hexParts, 4), 16)

        // ⚠️ The `aa 05 <slot> <degrees F>` reading came from ONE kettle, the
        // H7171 in #1337. The H7173 sends the same two leading bytes with a
        // fourth byte of 0 or 1, which is plainly not a temperature - and the
        // plugin cheerfully announced "preset 1 is set to 0°F [-18°C]" (#1351).
        //
        // So the shape alone is not enough to claim a meaning. A preset a
        // kettle could actually hold is the test; anything else is a frame this
        // plugin cannot read yet, and reporting it as such is what gets it
        // decoded rather than guessed at.
        if (tempInF < KETTLE_PRESET_MIN_F || tempInF > KETTLE_PRESET_MAX_F) {
          logUnknownData(this.accessory, {
            kind: 'status',
            source: 'AWS',
            raw: hexString,
            hex: hexParts.join(''),
            extra: { note: 'aa 05 frame whose fourth byte is not a preset temperature' },
          })
          return
        }

        const label = slot === 1 ? 'target temperature' : `memory preset ${slot - 1}`
        const line = `${label} is set to ${tempInF}°F [${Math.round(((tempInF - 32) * 5) / 9)}°C]`
        // Worth seeing in a normal log, but only once each. The kettle sends
        // these when it connects, and if a firmware ever repeats them on a
        // timer this keeps five lines from becoming five every few minutes
        if (this.reportedPresets.get(slot) === line) {
          this.accessory.logDebug(line)
        } else {
          this.reportedPresets.set(slot, line)
          this.accessory.log(line)
        }
        return
      }

      switch (deviceFunction) {
        case '0500': { // current mode
          // switch to green tea_: aa050002000000000000000000000000000000ad
          // switch to oolong tea: aa050003000000000000000000000000000000ac
          // switch to coffee____: aa050004000000000000000000000000000000ab
          // switch to black tea_: aa050005000000000000000000000000000000aa
          // switch to preset1___: aa050001010000000000000000000000000000af
          // switch to preset2___: aa050001020000000000000000000000000000ac
          // No point in changing any switches for the sake of three seconds, no action taken here
          break
        }
        case '1001': { // current temperature of the water
          this.updateCurrentTemperature(hexString, hexParts)
          break
        }
        case '1700': { // on/off base?
          const onBase = getTwoItemPosition(hexParts, 4) === '00' ? 'yes' : 'no'
          if (this.cacheOnBase !== onBase) {
            this.cacheOnBase = onBase
            this.serviceOnBase.updateCharacteristic(
              this.hapChar.ContactSensorState,
              onBase === 'yes'
                ? this.hapChar.ContactSensorState.CONTACT_DETECTED
                : this.hapChar.ContactSensorState.CONTACT_NOT_DETECTED,
            )
            this.accessory.log(`current on base [${this.cacheOnBase}]`)
          }
          break
        }
        case '2200': // keep warm off
        case '2201': // keep warm on
        case '2300': // scheduled start off
        case '2301': { // scheduled start on
          break
        }
        // What the kettle is doing - see HEATING_STATES above. `1900` used to be
        // treated as a startup frame, which it only looked like because a kettle
        // is usually idle when it connects; it is really the idle state and is
        // sent whenever the kettle reaches it.
        case '1900':
        case '1901':
        case '1902':
        case '1904': {
          this.updateHeatingState(getTwoItemPosition(hexParts, 3))
          break
        }
        // Also sent on startup, alongside the preset list above. What each one
        // carries has not been worked out, and nothing here needs them, so they
        // are known-and-ignored rather than reported every time (#1337)
        case '1701': // a second form of the on-base report
        case '1f06':
        case '1f08': {
          this.accessory.logDebug(`startup status [${deviceFunction}]: ${hexString}`)
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
