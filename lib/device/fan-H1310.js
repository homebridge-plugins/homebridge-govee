import { hs2rgb } from '../utils/colour.js'
import {
  base64ToHex,
  generateRandomString,
  getTwoItemPosition,
  hexToTwoItems,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import deviceFanH1370 from './fan-H1370.js'

/**
 * The two lights an H1310 has, and the api switch each one answers to. Govee
 * lists both against this device, and they are the only way to reach one light
 * without the other - `powerSwitch` is the whole unit, fan included.
 */
const LIGHTS = [
  { name: 'Main Light', instance: 'mainLightToggle' },
  { name: 'Background Light', instance: 'backgroundLightToggle' },
]

/** The api switch that runs the fan backwards. */
const REVERSE_AIRFLOW = 'reverseAirflowToggle'

export default class GoveeFanH1310 extends deviceFanH1370 {
  constructor(platform, accessory) {
    super(platform, accessory)

    // The H1310/R1310 uses a 6-step speed scale instead of the H1370's 12-step
    // ceiling-fan range. (speedSteps now comes from device-capabilities or the
    // device's OpenAPI fanSpeedMode; do not overwrite the superclass value here.)

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
    LIGHTS.forEach(({ name }) => {
      const service = this.accessory.getService(name)
        || this.accessory.addService(this.hapServ.Lightbulb, name, name)
      this.lightServices[name] = service
      this.setupLightService(service, name)
    })
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

  externalUpdate(params) {
    super.externalUpdate(params)

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

  setupLightService(service, name) {
    service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalLightStateUpdate(service, name, value)
    })

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
