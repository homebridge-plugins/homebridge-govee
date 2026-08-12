import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceFanH1370 from './fan-H1370.js'
import deviceIndex from './index.js'

/**
 * The H1310 and R1310 are ceiling fans with lights, and were on the H7100
 * tower fan handler as "the same fan". They are not the same fan at all -
 * Govee's own app files them under Indoor Lighting as "Govee Ceiling Fan",
 * while every H71xx sits under Air Treatment.
 *
 * The cost to an owner was all three of the symptoms in #1352: a fan tile that
 * did nothing, because the tower fan's speed codes mean nothing here; an
 * oscillation control for a fan that cannot oscillate; and no light at all,
 * because the H7100 handler never builds one.
 *
 * The frames below are from that report, and they are exactly the ones this
 * handler already reads.
 */

// aa 36 00 00 - fan power off
const FAN_POWER_OFF = 'qjYAAAAAAAAAAAAAAAAAAAAAAJw='
// aa 31 01 01 - fan speed 1
const FAN_SPEED_1 = 'qjEBAQAAAAAAAAAAAAAAAAAAAJs='

function makeService() {
  const chars = new Map()
  const characteristic = name => ({
    name,
    value: 0,
    onSet() {
      return this
    },
    onGet() {
      return this
    },
    setProps() {
      return this
    },
    props: {},
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
    services,
  }
}

describe('the ceiling fans', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it.each(['H1310', 'R1310', 'H1370'])('sends the %s to the ceiling fan handler', (model) => {
    expect(deviceIndex[`deviceFan${model}`]).toBe(deviceFanH1370)
  })

  it.each(['H1310', 'R1310'])('gives the %s a light, which the tower fan handler never did', (model) => {
    const accessory = makeAccessory(model)
    const Handler = deviceIndex[`deviceFan${model}`]
    const device = new Handler(makePlatform(), accessory)

    expect(device.lightService).toBeTruthy()
  })

  it.each(['H1310', 'R1310'])('reads the %s fan power its owner actually reported', (model) => {
    const accessory = makeAccessory(model)
    const Handler = deviceIndex[`deviceFan${model}`]
    const device = new Handler(makePlatform(), accessory)

    // start from on, so the frame has to genuinely move it rather than the
    // assertion landing on whatever the cache happened to start as
    device.cacheState = 'on'
    device.externalUpdate({ commands: [FAN_POWER_OFF], source: 'AWS' })

    expect(device.cacheState).toBe('off')
  })

  it.each(['H1310', 'R1310'])('reads the %s fan speed its owner actually reported', (model) => {
    const accessory = makeAccessory(model)
    const Handler = deviceIndex[`deviceFan${model}`]
    const device = new Handler(makePlatform(), accessory)

    device.externalUpdate({ commands: [FAN_SPEED_1], source: 'AWS' })

    expect(device.cacheSpeed).toBeGreaterThan(0)
  })

  /**
   * The two frames above were arriving as "unrecognised status" lines on the
   * old handler, which is what sent the owner to the issue tracker.
   */
  it.each(['H1310', 'R1310'])('no longer calls the %s fan frames unrecognised', (model) => {
    const accessory = makeAccessory(model)
    const Handler = deviceIndex[`deviceFan${model}`]
    const device = new Handler(makePlatform(), accessory)

    device.externalUpdate({ commands: [FAN_POWER_OFF, FAN_SPEED_1], source: 'AWS' })

    const said = [
      ...accessory.logWarn.mock.calls,
      ...accessory.logDebug.mock.calls,
    ].map(call => String(call[0])).join(' ')
    expect(said).not.toMatch(/unrecognised/)
  })
})
