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
    const accessory = makeAccessory('H1310')
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
})

function discoverService(accessory, name) {
  return accessory.getService(name) || accessory.getServiceById?.(accessory.api.hap.Service.Lightbulb, name)
}
