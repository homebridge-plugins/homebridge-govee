import { hs2rgb } from '../utils/colour.js'
import {
  base64ToHex,
  generateCodeFromHexValues,
  generateRandomString,
  getTwoItemPosition,
  hexToTwoItems,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import deviceFanH1370 from './fan-H1370.js'

/**
 * The two lights an H1310 has, the api switch each one answers to, and the bit
 * each one sets in the `aa 42` status.
 *
 * Those switches are the only way to reach one light without the other -
 * `powerSwitch` is the whole unit, fan included.
 */
/**
 * ⚠️ The fan has ONE brightness and ONE colour, shared by both lights - the
 * govee app offers a single set too. So only the main light carries them, and
 * the background light is an on/off tile.
 *
 * Two sliders that secretly move together read as a fault, but the real cost
 * was worse: HomeKit sends a brightness of 0 when a bulb is switched off, and
 * the brightness command is device-wide, so switching one light off dimmed the
 * pair to nothing (#1352).
 */
const LIGHTS = [
  { name: 'Main Light', instance: 'mainLightToggle', bit: 0x40, carriesSharedControls: true },
  { name: 'Background Light', instance: 'backgroundLightToggle', bit: 0x20, carriesSharedControls: false },
]

/**
 * The two status frames carrying the lights. This fan sends both, every time,
 * saying the same thing two different ways:
 *
 * - `aa 42 <mask>`  - one byte, bit 6 main, bit 5 background, bit 7 either
 * - `aa 36 <main> <background>` - one byte each
 *
 * They agree in all 69 statuses posted on #1352:
 *
 * | `aa 36` | `aa 42` | lit                |
 * |---------|---------|--------------------|
 * | `01 01` | `e0`    | both               |
 * | `01 00` | `c0`    | main only          |
 * | `00 01` | `a0`    | background only    |
 * | `00 00` | `00`    | neither            |
 *
 * ⚠️ `aa 36` is fan power on the H1370 and the lights here, which is why this
 * handler has to claim the code rather than let the parent read it.
 */
const LIGHT_MASK_CODE = '42'
const LIGHT_PAIR_CODE = '36'

/** Set in that mask whenever either light is lit, whichever one it is. */
const ANY_LIGHT_BIT = 0x80

/**
 * The speed frame, which also carries whether the fan is turning:
 * `aa 31 <running> <speed> <direction>`.
 */
const FAN_CODE = '31'

/** The api switches for the fan itself and for running it backwards. */
const FAN_TOGGLE = 'fanToggle'
const REVERSE_AIRFLOW = 'reverseAirflowToggle'

/**
 * Reads which lights are lit out of a status, from whichever of the two frames
 * the fan sent, normalised to the `aa 42` mask.
 *
 * @param {string[]} commands base64 status codes from the fan
 * @returns {number|undefined} the mask, or undefined if the fan said neither
 */
function lightMaskFrom(commands) {
  let mask
  ;(commands || []).forEach((command) => {
    const hexParts = hexToTwoItems(base64ToHex(command))
    if (getTwoItemPosition(hexParts, 1) !== 'aa') {
      return
    }
    if (getTwoItemPosition(hexParts, 2) === LIGHT_MASK_CODE) {
      mask = Number.parseInt(getTwoItemPosition(hexParts, 3), 16)
      return
    }
    if (getTwoItemPosition(hexParts, 2) === LIGHT_PAIR_CODE) {
      const main = getTwoItemPosition(hexParts, 3) === '01'
      const background = getTwoItemPosition(hexParts, 4) === '01'
      mask = (main ? 0x40 : 0) | (background ? 0x20 : 0) | (main || background ? ANY_LIGHT_BIT : 0)
    }
  })
  return mask
}

/**
 * Reads whether the fan is turning, from the third byte of its speed frame.
 *
 * @param {string[]} commands base64 status codes from the fan
 * @returns {boolean|undefined} true if turning, or undefined if the fan did not say
 */
function fanIsRunningFrom(commands) {
  let running
  ;(commands || []).forEach((command) => {
    const hexParts = hexToTwoItems(base64ToHex(command))
    if (getTwoItemPosition(hexParts, 1) === 'aa' && getTwoItemPosition(hexParts, 2) === FAN_CODE) {
      running = getTwoItemPosition(hexParts, 3) === '01'
    }
  })
  return running
}

export default class GoveeFanH1310 extends deviceFanH1370 {
  constructor(platform, accessory) {
    super(platform, accessory)

    // The H1310/R1310 uses a 6-step speed scale instead of the H1370's 12-step
    // ceiling-fan range. (speedSteps now comes from device-capabilities or the
    // device's OpenAPI fanSpeedMode; do not overwrite the superclass value here.)

    // Both light frames are read here. `aa 36` especially has to be claimed:
    // the parent reads it as fan power, so left to it the fan tile followed
    // the lights - off whenever they were off, whatever the fan was doing
    this.handledStatusCodes.add(LIGHT_MASK_CODE)
    this.handledStatusCodes.add(LIGHT_PAIR_CODE)

    // The fan has its own api switch, which is the only way to reach the fan
    // without touching the lights. `33 36 ...`, which the parent sends for fan
    // power, is the two lights on this model
    this.canSendFanToggle = !!accessory.context.openApiCapabilities?.[FAN_TOGGLE]
      && !!accessory.context.useOpenApiControl

    if (this.service.testCharacteristic(this.hapChar.SwingMode)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.SwingMode))
    }

    // Airflow direction. HomeKit's fan already has somewhere to put this, so it
    // goes on the tile the owner already has rather than adding another one.
    //
    // Gated on its own capability rather than on the lights below: a fan could
    // reasonably have one and not the other, and a control that cannot be sent
    // is worse than no control (#1352)
    this.canReverseAirflow = !!accessory.context.openApiCapabilities?.[REVERSE_AIRFLOW]
      && !!accessory.context.useOpenApiControl

    if (this.canReverseAirflow) {
      this.service
        .getCharacteristic(this.hapChar.RotationDirection)
        .onSet(async value => this.internalDirectionUpdate(value))
      this.cacheDirection = this.service.getCharacteristic(this.hapChar.RotationDirection).value
    } else if (this.service.testCharacteristic(this.hapChar.RotationDirection)) {
      // Left over from a device that used to report the switch, or from a
      // config that has since lost api access
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.RotationDirection))
    }

    // Two tiles are only honest when each one has a switch of its own to send.
    // Those switches exist solely over the api, so without it both tiles would
    // fall back to the device-wide power switch - and either would take the fan
    // down with it, which is the fault this model was reported for. Where they
    // cannot be sent, the single inherited light stays exactly as the H1370 has
    // it: one tile that is honestly device-wide (#1352)
    this.perLightSwitches = LIGHTS.every(({ instance }) => accessory.context.openApiCapabilities?.[instance])
      && !!accessory.context.useOpenApiControl

    if (!this.perLightSwitches) {
      return
    }

    // The superclass built its own unnamed light. Remove it so an owner is not
    // left with a third tile alongside the two named ones
    const inheritedLight = this.accessory.getService(this.hapServ.Lightbulb)
    if (inheritedLight && !inheritedLight.subtype) {
      this.accessory.removeService(inheritedLight)
      this.lightService = undefined
    }

    this.lightServices = {}
    LIGHTS.forEach(({ name, carriesSharedControls }) => {
      const service = this.accessory.getService(name)
        || this.accessory.addService(this.hapServ.Lightbulb, name, name)
      this.lightServices[name] = service
      this.setupLightService(service, name, carriesSharedControls)
    })
  }

  /**
   * Switching the fan on and off.
   *
   * The parent sends `33 36 01 01`, which on an H1370 is its fan. Here `aa 36`
   * is the two lights, so that command turns both lights on and never touches
   * the fan. The fan's own api switch is used instead where it can be sent,
   * and otherwise the speed frame - `33 31 <running> <speed>` - which is the
   * frame this fan reports its own running state in (#1352).
   *
   * @param {number} value 1 active, 0 inactive
   */
  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'
      if (this.cacheState === newValue) {
        return
      }

      if (this.canSendFanToggle) {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'openApi',
          openApi: {
            instance: FAN_TOGGLE,
            capabilityType: 'devices.capabilities.toggle',
            value: value ? 1 : 0,
          },
        })
      } else {
        // Keep the speed the fan already had, so switching it back on returns
        // it to where its owner left it rather than to a speed of nothing
        const speed = this.cacheSpeed || 1
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'ptReal',
          value: generateCodeFromHexValues([0x33, 0x31, value ? 0x01 : 0x00, speed]),
        })
      }

      this.cacheState = newValue
      this.accessory.log(`${platformLang.curState} [${newValue}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      })
    }
  }

  /**
   * HomeKit gives a fan two directions and Govee gives it one switch, so the
   * two map onto each other directly. Which way round the fan physically turns
   * for "reverse" is Govee's business and is not written down anywhere - if an
   * owner reports the two being the wrong way round, swap them here.
   *
   * @param {number} value 0 clockwise, 1 counter-clockwise
   */
  async internalDirectionUpdate(value) {
    try {
      if (this.cacheDirection === value) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'openApi',
        openApi: {
          instance: REVERSE_AIRFLOW,
          capabilityType: 'devices.capabilities.toggle',
          value: value === 1 ? 1 : 0,
        },
      })

      this.cacheDirection = value
      this.accessory.log(`${platformLang.curDirection} [${value === 1 ? 'upward' : 'downward'}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.RotationDirection, this.cacheDirection)
      })
    }
  }

  /**
   * The device-wide on/off field is the whole unit having power here, not the
   * light: a fan reporting `onOff` 1 has been seen with `aa 36 00` (fan off)
   * and `aa 42 00` (both lights off) in the same status. Letting it speak for
   * the light lit the light tile every time the fan was switched on (#1352).
   *
   * The `aa 42` mask is what this fan actually says about its lights, so read
   * the single tile off the bit that is set whenever either one is lit.
   *
   * @param {object} params a parsed device update
   * @returns {'on'|'off'|undefined} the light's state, or undefined if unsaid
   */
  readLightState(params) {
    const mask = lightMaskFrom(params.commands)
    if (mask === undefined) {
      return undefined
    }
    return (mask & ANY_LIGHT_BIT) === ANY_LIGHT_BIT ? 'on' : 'off'
  }

  externalUpdate(params) {
    super.externalUpdate(params)

    // Whether the fan is turning. The parent cannot read this: on an H1370 it
    // comes from `aa 36`, which here belongs to the lights. This fan says so in
    // the third byte of its speed frame instead, and the api switch is read as
    // a fallback for a device answering over the api rather than aws (#1352)
    let running = fanIsRunningFrom(params.commands)
    if (running === undefined && params.toggles?.[FAN_TOGGLE] !== undefined) {
      running = !!params.toggles[FAN_TOGGLE]
    }
    if (running !== undefined) {
      const newState = running ? 'on' : 'off'
      if (this.cacheState !== newState) {
        this.cacheState = newState
        this.service.updateCharacteristic(this.hapChar.Active, running ? 1 : 0)
        this.accessory.log(`${platformLang.curState} [${newState}]`)
      }
    }

    // Each light's own on/off, read off the same mask
    const mask = lightMaskFrom(params.commands)
    if (mask !== undefined) {
      LIGHTS.forEach(({ name, bit }) => {
        const service = this.lightServices?.[name]
        if (!service) {
          return
        }
        const newValue = (mask & bit) === bit ? 'on' : 'off'
        const cacheKey = `${name}:state`
        if (this[cacheKey] !== newValue) {
          this[cacheKey] = newValue
          service.updateCharacteristic(this.hapChar.On, newValue === 'on')
          this.accessory.log(`${name} ${newValue}`)
        }
      })
    }

    // The one shared brightness and colour, reported onto the one tile that
    // carries them. The parent puts these on its single light, which the named
    // tiles replaced
    if (this.lightServices) {
      LIGHTS.filter(light => light.carriesSharedControls).forEach(({ name }) => {
        const service = this.lightServices[name]
        if (params.brightness && this[`${name}:brightness`] !== params.brightness) {
          this[`${name}:brightness`] = params.brightness
          service.updateCharacteristic(this.hapChar.Brightness, params.brightness)
        }
        if (params.kelvin) {
          const k = Math.min(Math.max(params.kelvin, 2700), 6500)
          const mired = Math.min(Math.max(Math.round(1000000 / k), 154), 370)
          if (this[`${name}:ct`] !== mired) {
            this[`${name}:ct`] = mired
            service.updateCharacteristic(this.hapChar.ColorTemperature, mired)
          }
        }
      })
    }

    // Airflow direction is a separate capability from the lights, so it gets
    // its own guard rather than sharing theirs
    if (!this.canReverseAirflow) {
      return
    }

    // The fan reports its direction as the fifth byte of its speed frame -
    // `aa 31 <running> <speed> <direction>` - rather than as a status of its
    // own. Captured on a real H1310 in #1352: flowing downward reported
    // `aa 31 01 01 00` and upward `aa 31 01 01 01`, with nothing else in the
    // status differing between the two.
    let reported
    ;(params.commands || []).forEach((command) => {
      const hexParts = hexToTwoItems(base64ToHex(command))
      if (getTwoItemPosition(hexParts, 1) === 'aa' && getTwoItemPosition(hexParts, 2) === '31') {
        reported = getTwoItemPosition(hexParts, 5) === '01' ? 1 : 0
      }
    })

    // The api toggle is the only way to SEND a direction, so it is still read
    // as a fallback for a device answering over the api rather than aws
    if (reported === undefined && params.toggles?.[REVERSE_AIRFLOW] !== undefined) {
      reported = params.toggles[REVERSE_AIRFLOW] ? 1 : 0
    }

    if (reported !== undefined && this.cacheDirection !== reported) {
      this.cacheDirection = reported
      this.service.updateCharacteristic(this.hapChar.RotationDirection, reported)
      this.accessory.log(`${platformLang.curDirection} [${reported === 1 ? 'upward' : 'downward'}]`)
    }
  }

  setupLightService(service, name, carriesSharedControls) {
    service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalLightStateUpdate(service, name, value)
    })

    if (!carriesSharedControls) {
      // An on/off tile. The brightness and colour live on the other light, as
      // the fan has only one of each. Anything left over from a cached version
      // that gave both tiles the full set has to go, or HomeKit keeps showing
      // a slider that moves the other light too
      const shared = [
        this.hapChar.Brightness,
        this.hapChar.Hue,
        this.hapChar.Saturation,
        this.hapChar.ColorTemperature,
      ]
      shared.forEach((characteristic) => {
        if (service.testCharacteristic(characteristic)) {
          service.removeCharacteristic(service.getCharacteristic(characteristic))
        }
      })
      return
    }

    service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: 1 })
      .onSet(async (value) => {
        await this.internalBrightnessUpdate(service, name, value)
      })

    service.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
      await this.internalColourUpdate(service, name, value)
    })

    service.getCharacteristic(this.hapChar.Saturation).onSet(async () => {
      await this.internalColourUpdate(service, name, service.getCharacteristic(this.hapChar.Hue).value)
    })

    if (!service.testCharacteristic(this.hapChar.ColorTemperature)) {
      service.addCharacteristic(this.hapChar.ColorTemperature)
    }
    service.getCharacteristic(this.hapChar.ColorTemperature).onSet(async (value) => {
      await this.internalCTUpdate(service, name, value)
    })
  }

  async internalLightStateUpdate(service, name, value) {
    const newValue = value ? 'on' : 'off'
    const cacheKey = `${name}:state`
    if (this[cacheKey] === newValue) {
      return
    }

    // These tiles only exist when both switches can be sent, so there is no
    // device-wide fallback here on purpose - it would turn the fan off too
    const { instance } = LIGHTS.find(light => light.name === name)
    await this.platform.sendDeviceUpdate(this.accessory, {
      cmd: 'openApi',
      openApi: {
        instance,
        capabilityType: 'devices.capabilities.toggle',
        value: newValue === 'on' ? 1 : 0,
      },
    })

    this[cacheKey] = newValue
    this.accessory.log(`${name} ${newValue}`)
  }

  async internalBrightnessUpdate(service, name, value) {
    const updateKey = generateRandomString(5)
    this[`${name}:updateKeyBright`] = updateKey
    await sleep(350)
    if (updateKey !== this[`${name}:updateKeyBright`]) {
      return
    }

    const cacheKey = `${name}:brightness`
    if (this[cacheKey] === value) {
      return
    }

    await this.platform.sendDeviceUpdate(this.accessory, {
      cmd: 'brightness',
      value,
    })

    this[cacheKey] = value
    this.accessory.log(`${name} brightness [${value}%]`)
  }

  async internalColourUpdate(service, name, hue) {
    const updateKey = generateRandomString(5)
    this[`${name}:updateKeyColour`] = updateKey
    await sleep(300)
    if (updateKey !== this[`${name}:updateKeyColour`]) {
      return
    }

    const sat = service.getCharacteristic(this.hapChar.Saturation).value
    const [r, g, b] = hs2rgb(hue, sat)
    const cacheKey = `${name}:colour`
    if (this[cacheKey] && this[cacheKey].r === r && this[cacheKey].g === g && this[cacheKey].b === b) {
      return
    }

    await this.platform.sendDeviceUpdate(this.accessory, {
      cmd: 'color',
      value: { r, g, b },
    })

    this[cacheKey] = { r, g, b, hue, sat }
    this.accessory.log(`${name} colour [rgb ${r} ${g} ${b}]`)
  }

  async internalCTUpdate(service, name, value) {
    const updateKey = generateRandomString(5)
    this[`${name}:updateKeyCT`] = updateKey
    await sleep(300)
    if (updateKey !== this[`${name}:updateKeyCT`]) {
      return
    }

    const cacheKey = `${name}:ct`
    if (this[cacheKey] === value) {
      return
    }

    await this.platform.sendDeviceUpdate(this.accessory, {
      cmd: 'colorTem',
      value,
    })

    this[cacheKey] = value
    this.accessory.log(`${name} colour temperature [${value}M]`)
  }
}
