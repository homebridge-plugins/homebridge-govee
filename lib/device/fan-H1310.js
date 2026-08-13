import { hs2rgb } from '../utils/colour.js'
import { generateRandomString, sleep } from '../utils/functions.js'
import deviceFanH1370 from './fan-H1370.js'

export default class GoveeFanH1310 extends deviceFanH1370 {
  constructor(platform, accessory) {
    super(platform, accessory)

    // The H1310/R1310 uses a 6-step speed scale instead of the H1370's 12-step
    // ceiling-fan range.
    this.speedSteps = 6

    // The superclass (H1370) may have added a default unnamed Lightbulb
    // service when it initialised the main light. Remove any inherited
    // unnamed Lightbulb (no subtype) so that only the two named services we
    // create below appear in Home, avoiding a third unwanted tile.
    const inheritedLight = this.accessory.getService(this.hapServ.Lightbulb)
    if (inheritedLight && !inheritedLight.subtype) {
      this.accessory.removeService(inheritedLight)
    }

    if (this.service.testCharacteristic(this.hapChar.SwingMode)) {
      this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.SwingMode))
    }

    this.lightServices = {}
    ;['Main Light', 'Background Light'].forEach((name) => {
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

    // Map the human-friendly service name to the OpenAPI instance name the
    // platform recognises for per-light toggles.
    const instance = name === 'Main Light' ? 'mainLightToggle' : 'backgroundLightToggle'

    // Prefer the OpenAPI per-light toggle if the capability is present and the
    // platform is able to use it; otherwise fall back to the device-wide state
    // command so behaviour remains unchanged on older setups.
    if (this.accessory.context.openApiCapabilities?.[instance] && this.accessory.context.useOpenApiControl) {
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'openApi',
        openApi: {
          instance,
          capabilityType: 'devices.capabilities.toggle',
          value: newValue === 'on' ? 1 : 0,
        },
      })
    } else {
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'state',
        value: newValue,
      })
    }

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
