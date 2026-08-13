import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDeviceCapabilities } from '../utils/device-capabilities.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceFanH1310 from './fan-H1310.js'
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

// The fake accessory looks a service up by name or display name, which covers
// both how a handler adds one and how it finds one again
function discoverService(accessory, name) {
  return accessory.getService(name)
}
