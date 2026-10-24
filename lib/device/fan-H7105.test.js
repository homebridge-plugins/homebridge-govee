import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base64ToHex } from '../utils/functions.js'
import deviceFanH7105 from './fan-H7105.js'

/**
 * Oscillating an H7105 used to throw "Swing mode update not implemented yet",
 * so the switch in Home did nothing and reported a failure (#1339).
 *
 * It sends the same shape as the H7107, which is not a guess: those two are the
 * only fans that report a swing RANGE rather than a plain on/off, and the range
 * is exactly what #1334 turned out to hinge on. Turning ON carries the range
 * bytes from the last status seen; turning OFF must not, because a
 * parameterised off command was answered with a zero-tailed frame while the fan
 * carried on oscillating.
 */

// A swing-on status report: aa 1d 01 01 96 03 84 ... - the bytes after the
// on/off flag are the range, and are what an ON command has to carry back
const SWING_ON_STATUS = 'qh0BAZYDhAAAAAAAAAAAAAAAAKY='

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

function makeFan(deviceConf = {}) {
  const sent = []
  const proxy = new Proxy({}, {
    get: (_target, prop) => prop,
  })
  const platform = {
    log: Object.assign(vi.fn(), {
      warn: vi.fn(),
      debug: vi.fn(),
    }),
    api: {
      hap: { Service: proxy, Characteristic: proxy, HapStatusError: class {} },
    },
    deviceConf: { 'AA:BB': deviceConf },
    sendDeviceUpdate: async (_accessory, update) => void sent.push(update),
  }
  const services = new Map()
  const accessory = {
    displayName: 'H7105',
    context: { gvModel: 'H7105', gvDeviceId: 'AA:BB' },
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
  const device = new deviceFanH7105(platform, accessory)
  return { device, sent, accessory }
}

function hexOf(update) {
  return base64ToHex(update.value)
}

describe('turning an H7105\'s oscillation on and off', () => {
  let device
  let sent

  beforeEach(() => {
    ({ device, sent } = makeFan())
  })

  it('sends something at all, rather than throwing not-implemented', async () => {
    await device.internalSwingUpdate(true)

    expect(sent.length).toBeGreaterThan(0)
  })

  it('sends both the ptReal and the multiSync shape', async () => {
    await device.internalSwingUpdate(true)

    expect(sent.map(u => u.cmd)).toEqual(['ptReal', 'multiSync'])
    expect(hexOf(sent[0]).slice(0, 6)).toBe('331d01')
    expect(hexOf(sent[1]).slice(0, 6)).toBe('3a1d01')
  })

  it('carries the range bytes back when turning ON', async () => {
    // the fan reports its range, the owner switches oscillation off, then on
    // again - the range from that first report is what the ON has to carry
    device.externalUpdate({
      source: 'AWS',
      commands: [SWING_ON_STATUS],
    })
    await device.internalSwingUpdate(false)
    sent.length = 0

    await device.internalSwingUpdate(true)

    // 33 1d 01 then the four range bytes from the status above
    expect(hexOf(sent[0]).slice(0, 14)).toBe('331d0101960384')
  })

  it('sends OFF with no range bytes, which is the whole point of #1334', async () => {
    device.externalUpdate({
      source: 'AWS',
      commands: [SWING_ON_STATUS],
    })
    sent.length = 0

    await device.internalSwingUpdate(false)

    // 33 1d 00 and then padding only - no range tail
    expect(hexOf(sent[0]).slice(0, 14)).toBe('331d0000000000')
  })

  it('does nothing when the state is already what was asked for', async () => {
    await device.internalSwingUpdate(true)
    sent.length = 0

    await device.internalSwingUpdate(true)

    // cacheSwing holds 'on'/'off' and the value arrives as a boolean, so a
    // direct comparison never matched and every press sent a command
    expect(sent).toHaveLength(0)
  })

  it('adds the documented api toggle only when the device advertises it', async () => {
    const plain = makeFan()
    await plain.device.internalSwingUpdate(true)
    expect(plain.sent[0].openApi).toBeUndefined()

    const withApi = makeFan()
    withApi.device.accessory.context.openApiCapabilities = { oscillationToggle: true }
    await withApi.device.internalSwingUpdate(true)
    expect(withApi.sent[0].openApi).toMatchObject({ instance: 'oscillationToggle', value: 1 })
  })
})
