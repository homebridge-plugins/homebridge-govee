import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDeviceCapabilities } from '../utils/device-capabilities.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceFanH1310 from './fan-H1310.js'
import deviceFanH1370 from './fan-H1370.js'
import deviceFanH7100 from './fan-H7100.js'

/**
 * The H1310 and R1310 ceiling fans still do not have a confirmed oscillation
 * status meaning, so they are left with the readback disabled even though they
 * have their own handler. That difference is model data rather than a second
 * copy of the file, and the model snapshot cannot see it - it only covers which
 * controls a device is given, not how it reads messages back. So it is pinned
 * here.
 */

const SWING_ON_STATUS = 'qh8BAQAAAAAAAAAAAAAAAAAAALU='

// The `aa 42 <mask>` light mask, as a real H1310 sends it (#1352)
const BOTH_LIGHTS_OFF = 'qkIAAAAAAAAAAAAAAAAAAAAAAOg=' // aa 42 00
const MAIN_LIGHT_ON = 'qkLAAAAAAAAAAAAAAAAAAAAAACg=' // aa 42 c0
const BACKGROUND_LIGHT_ON = 'qkKgAAAAAAAAAAAAAAAAAAAAAEg=' // aa 42 a0

// aa 36 00 00 - the second way this fan says both lights are off
const BOTH_LIGHTS_OFF_PAIR = 'qjYAAAAAAAAAAAAAAAAAAAAAAJw='
// aa 36 01 01 - and both lit
const BOTH_LIGHTS_ON_PAIR = 'qjYBAQAAAAAAAAAAAAAAAAAAAJw='

function makeService() {
  const chars = new Map()
  const characteristic = name => ({
    name,
    value: 0,
    onSet() {
      return this
    },
    setProps() {
      return this
    },
  })
  return {
    getCharacteristic(name) {
      if (!chars.has(name)) {
        chars.set(name, characteristic(name))
      }
      return chars.get(name)
    },
    addCharacteristic(name) {
      if (!chars.has(name)) {
        chars.set(name, characteristic(name))
      }
      return chars.get(name)
    },
    updateCharacteristic(name, value) {
      this.getCharacteristic(name).value = value
      return this
    },
    setPrimaryService(isPrimary = true) {
      this.isPrimary = isPrimary
      return this
    },
    testCharacteristic: name => chars.has(name),
    removeCharacteristic(char) {
      if (char) {
        chars.delete(char.name)
      }
    },
    chars,
  }
}

function makePlatform() {
  const proxy = new Proxy({}, { get: (_target, prop) => prop })
  return {
    log: Object.assign(vi.fn(), { warn: vi.fn(), debug: vi.fn() }),
    api: { hap: { Service: proxy, Characteristic: proxy, HapStatusError: class {} } },
    deviceConf: {},
  }
}

function makeAccessory(model) {
  const services = new Map()
  const bySubtype = new Map()
  return {
    displayName: model,
    context: { gvModel: model, gvDeviceId: 'AA:BB' },
    getService: name => services.get(name) || [...services.values()].find(service => service.displayName === name),
    getServiceById(type, subtype) {
      return bySubtype.get(`${type}:${subtype}`)
    },
    addService(type, name, subtype) {
      const service = makeService()
      service.type = type
      service.subtype = subtype || name
      service.name = name || type
      service.displayName = name || type
      services.set(name || type, service)
      if (subtype) {
        bySubtype.set(`${type}:${subtype}`, service)
      }
      return service
    },
    removeService(service) {
      services.delete(service.name)
      if (service.subtype) {
        bySubtype.delete(`${service.type}:${service.subtype}`)
      }
    },
    log: vi.fn(),
    logWarn: vi.fn(),
    logDebug: vi.fn(),
  }
}

describe('reading a fan\'s oscillation status', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('updates the switch on a model where the message is understood', () => {
    const accessory = makeAccessory('H7100')
    const device = new deviceFanH7100(makePlatform(), accessory)

    device.externalUpdate({ commands: [SWING_ON_STATUS], source: 'AWS' })

    expect(device.cacheSwing).toBe('on')
    expect(device.service.getCharacteristic('SwingMode').value).toBe(1)
  })

  it('reports the message instead on a model where it is not confirmed', () => {
    const accessory = makeAccessory('H1310')
    const device = new deviceFanH7100(makePlatform(), accessory)

    device.externalUpdate({ commands: [SWING_ON_STATUS], source: 'AWS' })

    expect(device.cacheSwing).not.toBe('on')
    // recorded rather than shouted about: the fan volunteered this, and the
    // owner cannot act on it - but the model has to stay in the line
    expect(accessory.logDebug).toHaveBeenCalled()
    expect(accessory.logDebug.mock.calls.map(call => call[0]).join(' ')).toContain('H1310')
  })

  it('treats the R1310 the same as the H1310', () => {
    // Same fan under a newer name, so it must not quietly behave differently
    const accessory = makeAccessory('R1310')
    const device = new deviceFanH7100(makePlatform(), accessory)

    device.externalUpdate({ commands: [SWING_ON_STATUS], source: 'AWS' })

    expect(device.cacheSwing).not.toBe('on')
    expect(accessory.logDebug.mock.calls.map(call => call[0]).join(' ')).toContain('R1310')
  })

  it('uses the H1310 model-specific fan and brightness settings', () => {
    const accessory = withPerLightSwitches(makeAccessory('H1310'))
    const device = new deviceFanH1310(makePlatform(), accessory)
    const main = discoverService(accessory, 'Main Light')
    const background = discoverService(accessory, 'Background Light')

    expect(main).toBeDefined()
    expect(background).toBeDefined()
    expect(main.getCharacteristic('Hue')).toBeDefined()
    expect(background.getCharacteristic('Hue')).toBeDefined()
    expect(main.getCharacteristic('Saturation')).toBeDefined()
    expect(background.getCharacteristic('Saturation')).toBeDefined()
    expect(device.service.testCharacteristic('SwingMode')).toBe(false)
    expect(device.speedSteps).toBe(6)
    expect(getDeviceCapabilities('H1310').awsBrightnessNoScale).toBe(true)
  })

  /**
   * Two tiles that both send the device-wide power switch would each take the
   * fan down with them - the fault this model was reported for. So the named
   * lights only appear when their own api switches can be sent, and otherwise
   * the single inherited light is left as it is (#1352).
   */
  it('leaves the H1310 one light when its per-light switches cannot be sent', () => {
    const accessory = makeAccessory('H1310')
    const device = new deviceFanH1310(makePlatform(), accessory)

    expect(device.perLightSwitches).toBe(false)
    expect(discoverService(accessory, 'Main Light')).toBeUndefined()
    expect(discoverService(accessory, 'Background Light')).toBeUndefined()
    expect(device.lightService).toBeTruthy()
  })

  it('sends the H1310 a per-light switch rather than the whole device', async () => {
    const accessory = withPerLightSwitches(makeAccessory('H1310'))
    const device = new deviceFanH1310(makePlatform(), accessory)
    const sent = []
    device.platform.sendDeviceUpdate = async (_accessory, params) => sent.push(params)

    await device.internalLightStateUpdate(discoverService(accessory, 'Main Light'), 'Main Light', true)

    expect(sent).toHaveLength(1)
    expect(sent[0].cmd).toBe('openApi')
    expect(sent[0].openApi.instance).toBe('mainLightToggle')
  })
})

/**
 * The fan advertises `reverseAirflowToggle`, and HomeKit's fan already has a
 * RotationDirection for it - so it belongs on the tile the owner has, not on
 * a new one (#1352).
 */
it('gives the H1310 a direction control when its fan can reverse', () => {
  const accessory = withAirflowSwitch(makeAccessory('H1310'))
  const device = new deviceFanH1310(makePlatform(), accessory)

  expect(device.canReverseAirflow).toBe(true)
  expect(device.service.testCharacteristic('RotationDirection')).toBe(true)
})

it('leaves the H1310 no direction control when the switch cannot be sent', () => {
  const accessory = makeAccessory('H1310')
  const device = new deviceFanH1310(makePlatform(), accessory)

  expect(device.canReverseAirflow).toBe(false)
  expect(device.service.testCharacteristic('RotationDirection')).toBe(false)
})

it('sends the reverse switch rather than anything device-wide', async () => {
  const accessory = withAirflowSwitch(makeAccessory('H1310'))
  const device = new deviceFanH1310(makePlatform(), accessory)
  const sent = []
  device.platform.sendDeviceUpdate = async (_accessory, params) => sent.push(params)

  await device.internalDirectionUpdate(1)

  expect(sent).toHaveLength(1)
  expect(sent[0].cmd).toBe('openApi')
  expect(sent[0].openApi.instance).toBe('reverseAirflowToggle')
  expect(sent[0].openApi.value).toBe(1)
})

/**
 * The fan reports its direction as the fifth byte of its speed frame, not as a
 * status of its own. Both frames below are the ones a real H1310 sent while its
 * owner switched the airflow over (#1352) - the only byte that differed
 * between the two captures.
 */
it.each([
  ['upward', 'qjEBAQEAAAAAAAAAAAAAAAAAAJo=', 1],
  ['downward', 'qjEBAQAAAAAAAAAAAAAAAAAAAJs=', 0],
])('reads a direction of %s off the fan\'s own speed frame', (_label, frame, expected) => {
  const accessory = withAirflowSwitch(makeAccessory('H1310'))
  const device = new deviceFanH1310(makePlatform(), accessory)
  // start from the other one, so the frame has to genuinely move it
  device.cacheDirection = expected === 1 ? 0 : 1

  device.externalUpdate({ commands: [frame], source: 'AWS' })

  expect(device.cacheDirection).toBe(expected)
  expect(device.service.getCharacteristic('RotationDirection').value).toBe(expected)
})

/**
 * `aa 42` is a mask of which lights are lit. Every frame below was captured on
 * a real H1310 with one thing true at a time (#1352): the main light alone
 * reported c0, the upper alone a0, both e0, neither 00.
 *
 * An earlier theory - that the nine slots in the `aa a5` frames were segments
 * plus the main light - was wrong: they all moved together when one light
 * changed colour, and never tracked brightness at all.
 */
it.each([
  ['neither', 'qkIAAAAAAAAAAAAAAAAAAAAAAOg=', false, false],
  ['the main light only', 'qkLAAAAAAAAAAAAAAAAAAAAAACg=', true, false],
  ['the upper light only', 'qkKgAAAAAAAAAAAAAAAAAAAAAEg=', false, true],
  ['both', 'qkLgAAAAAAAAAAAAAAAAAAAAAAg=', true, true],
])('reads %s as lit off the fan\'s own mask', (_label, frame, main, background) => {
  const accessory = withPerLightSwitches(makeAccessory('H1310'))
  const device = new deviceFanH1310(makePlatform(), accessory)

  device.externalUpdate({ commands: [frame], source: 'AWS' })

  expect(device['Main Light:state']).toBe(main ? 'on' : 'off')
  expect(device['Background Light:state']).toBe(background ? 'on' : 'off')
})

it('falls back to the api toggle when the fan sent no frame', () => {
  const accessory = withAirflowSwitch(makeAccessory('H1310'))
  const device = new deviceFanH1310(makePlatform(), accessory)

  device.externalUpdate({ toggles: { reverseAirflowToggle: true } })

  expect(device.cacheDirection).toBe(1)
})

/**
 * An accessory whose fan reports both per-light switches, and an account that
 * can send them - both halves are needed before the two tiles are built.
 */
function withAirflowSwitch(accessory) {
  accessory.context.useOpenApiControl = true
  accessory.context.openApiCapabilities = {
    ...(accessory.context.openApiCapabilities || {}),
    reverseAirflowToggle: { type: 'devices.capabilities.toggle', instance: 'reverseAirflowToggle' },
  }
  return accessory
}

function withPerLightSwitches(accessory) {
  accessory.context.useOpenApiControl = true
  accessory.context.openApiCapabilities = {
    mainLightToggle: { type: 'devices.capabilities.toggle', instance: 'mainLightToggle' },
    backgroundLightToggle: { type: 'devices.capabilities.toggle', instance: 'backgroundLightToggle' },
  }
  return accessory
}

/**
 * The device-wide on/off field is the whole unit having power on this fan, not
 * the light. Reading the light off it lit the light tile every time the owner
 * switched the fan on, which is how #1352 was reported the second time.
 *
 * The frames here are one real status from that report: `onOff` 1 alongside
 * `aa 36 00` (fan off) and `aa 42 00` (both lights off), which is the proof
 * that field speaks for neither.
 */
describe('reading a ceiling fan\'s light', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('leaves the H1310 light off when only the fan was switched on', () => {
    const accessory = makeAccessory('H1310')
    const device = new deviceFanH1310(makePlatform(), accessory)

    device.externalUpdate({ commands: [BOTH_LIGHTS_OFF_PAIR, BOTH_LIGHTS_OFF], source: 'AWS', state: 'on' })

    expect(device.cacheLightState).not.toBe('on')
    expect(device.lightService.getCharacteristic('On').value).not.toBe(true)
  })

  it('turns the H1310 light on when the fan says a light is lit', () => {
    const accessory = makeAccessory('H1310')
    const device = new deviceFanH1310(makePlatform(), accessory)

    // the device-wide field disagrees, so this also proves the mask wins
    device.externalUpdate({ commands: [MAIN_LIGHT_ON], source: 'AWS', state: 'off' })

    expect(device.cacheLightState).toBe('on')
    expect(device.lightService.getCharacteristic('On').value).toBe(true)
  })

  it('still reads the H1370 light from its device-wide state', () => {
    // That model has nothing else to go on, so it must not lose the reading
    const accessory = makeAccessory('H1370')
    const device = new deviceFanH1370(makePlatform(), accessory)

    device.externalUpdate({ source: 'AWS', state: 'on' })

    expect(device.cacheLightState).toBe('on')
  })

  it('does not call the H1310 light mask unrecognised', () => {
    const accessory = makeAccessory('H1310')
    const device = new deviceFanH1310(makePlatform(), accessory)

    device.externalUpdate({ commands: [BOTH_LIGHTS_OFF], source: 'AWS' })

    const said = [...accessory.logWarn.mock.calls, ...accessory.logDebug.mock.calls]
      .map(call => String(call[0]))
      .join(' ')
    expect(said).not.toMatch(/unrecognised/)
  })

  /**
   * With two named tiles the single inherited light is gone, and the parent
   * updating it threw on every status the fan sent - so an owner with api
   * access saw nothing update at all.
   */
  it('updates both H1310 light tiles from one status without throwing', () => {
    const accessory = withPerLightSwitches(makeAccessory('H1310'))
    const device = new deviceFanH1310(makePlatform(), accessory)

    expect(() => device.externalUpdate({
      brightness: 40,
      commands: [BACKGROUND_LIGHT_ON],
      kelvin: 3500,
      source: 'AWS',
      state: 'on',
    })).not.toThrow()

    expect(device['Main Light:state']).toBe('off')
    expect(device['Background Light:state']).toBe('on')

    // one brightness and one colour, shared by both lights in the hardware
    expect(discoverService(accessory, 'Main Light').getCharacteristic('Brightness').value).toBe(40)
    expect(discoverService(accessory, 'Background Light').getCharacteristic('Brightness').value).toBe(40)
    expect(discoverService(accessory, 'Main Light').getCharacteristic('ColorTemperature').value).toBe(286)
  })
})

/**
 * Switching the fan is the other half of the same mix-up. `33 36 01 01` is the
 * fan on an H1370, so the parent sends it - but `aa 36` is the two lights here,
 * which makes that command "turn both lights on" and leaves the fan alone.
 */
describe('switching a ceiling fan on', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('sends the H1310 its own fan switch rather than the light command', async () => {
    const accessory = withFanToggle(makeAccessory('H1310'))
    const device = new deviceFanH1310(makePlatform(), accessory)
    const sent = []
    device.platform.sendDeviceUpdate = async (_accessory, params) => sent.push(params)

    await device.internalStateUpdate(1)

    expect(sent).toHaveLength(1)
    expect(sent[0].cmd).toBe('openApi')
    expect(sent[0].openApi.instance).toBe('fanToggle')
    expect(device.cacheState).toBe('on')
  })

  it('falls back to the H1310 speed frame, never to the light command', async () => {
    const accessory = makeAccessory('H1310')
    const device = new deviceFanH1310(makePlatform(), accessory)
    const sent = []
    device.platform.sendDeviceUpdate = async (_accessory, params) => sent.push(params)
    device.cacheSpeed = 3

    await device.internalStateUpdate(1)

    expect(sent).toHaveLength(1)
    expect(sent[0].cmd).toBe('ptReal')
    // 33 31 01 03 - turning, at the speed the owner had it on
    const hex = Buffer.from(sent[0].value, 'base64').toString('hex')
    expect(hex.startsWith('33310103')).toBe(true)
  })

  it('still sends the H1370 fan power on aa 36, where it does mean that', async () => {
    const device = new deviceFanH1370(makePlatform(), makeAccessory('H1370'))
    const sent = []
    device.platform.sendDeviceUpdate = async (_accessory, params) => sent.push(params)

    await device.internalStateUpdate(1)

    const hex = Buffer.from(sent[0].value, 'base64').toString('hex')
    expect(hex.startsWith('33360101')).toBe(true)
  })

  /**
   * The fan says which lights are lit twice in every status, once as a mask and
   * once as a byte each. Either has to be enough on its own.
   */
  it('reads the H1310 lights from the aa 36 pair as well as the aa 42 mask', () => {
    const accessory = makeAccessory('H1310')
    const device = new deviceFanH1310(makePlatform(), accessory)

    device.externalUpdate({ commands: [BOTH_LIGHTS_ON_PAIR], source: 'AWS' })
    expect(device.cacheLightState).toBe('on')

    device.externalUpdate({ commands: [BOTH_LIGHTS_OFF_PAIR], source: 'AWS' })
    expect(device.cacheLightState).toBe('off')
  })
})

// The fake accessory looks a service up by name or display name, which covers
// both how a handler adds one and how it finds one again
function discoverService(accessory, name) {
  return accessory.getService(name)
}

function withFanToggle(accessory) {
  accessory.context.useOpenApiControl = true
  accessory.context.openApiCapabilities = {
    ...(accessory.context.openApiCapabilities || {}),
    fanToggle: { type: 'devices.capabilities.toggle', instance: 'fanToggle' },
  }
  return accessory
}
