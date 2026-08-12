import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceFanH7100 from './fan-H7100.js'

/**
 * Oscillation read-back for the tower fans on this handler. The H1310 and
 * R1310 used to be here too, opted out of reading it; they turned out to be
 * ceiling fans and moved to fan-H1370 (#1352).
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
    updateCharacteristic(name, value) {
      this.getCharacteristic(name).value = value
      return this
    },
    testCharacteristic: name => chars.has(name),
    removeCharacteristic() {},
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
  return {
    displayName: model,
    context: { gvModel: model, gvDeviceId: 'AA:BB' },
    getService: name => services.get(name),
    addService(name) {
      const service = makeService()
      service.name = name
      services.set(name, service)
      return service
    },
    removeService(service) {
      services.delete(service.name)
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
})
