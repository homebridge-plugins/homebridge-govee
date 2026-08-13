import { hs2rgb } from '../utils/colour.js'
import { generateRandomString, sleep } from '../utils/functions.js'
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

export default class GoveeFanH1310 extends deviceFanH1370 {
  constructor(platform, accessory) {
    super(platform, accessory)

    // The H1310/R1310 uses a 6-step speed scale instead of the H1370's 12-step
    // ceiling-fan range. (speedSteps now comes from device-capabilities or the
    // device's OpenAPI fanSpeedMode; do not overwrite the superclass value here.)

    if (this.service.testCharacteristic(this.hapChar.SwingMode)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.SwingMode))
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
