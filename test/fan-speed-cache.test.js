import { describe, expect, it } from 'vitest'

import deviceFanH1370 from '../lib/device/fan-H1370.js'
import deviceFanH7100 from '../lib/device/fan-H7100.js'
import deviceFanH7105 from '../lib/device/fan-H7105.js'
import deviceFanH7107 from '../lib/device/fan-H7107.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * The four fans that map HomeKit percentages onto real speed steps keep
 * `cacheSpeed` as a step - 1 to 8, or 1 to 12 - everywhere except in their
 * constructors, which seeded it straight from the restored RotationSpeed
 * characteristic. That characteristic is a percentage.
 *
 * Most of the time the two just disagree harmlessly. The exception is a
 * twelve step fan left running on speed 1: HomeKit stores that as 8%, the
 * cache reads 8 as though it were a speed, and the next time the owner asks
 * for speed 8 the handler decides nothing has changed and sends nothing. The
 * fan stays on speed 1 and Home shows 67%.
 */

const FANS = [
  { name: 'H7100', Handler: deviceFanH7100, steps: 8 },
  { name: 'H7105', Handler: deviceFanH7105, steps: 12 },
  { name: 'H7107', Handler: deviceFanH7107, steps: 12 },
  { name: 'H1370', Handler: deviceFanH1370, steps: 12 },
]

/**
 * An accessory as Homebridge hands it back after a restart, with the fan
 * service already built and RotationSpeed holding the percentage from last
 * time. The props matter: each handler rebuilds the service from scratch if
 * they look like an older scale, which would throw the restored value away.
 */
function makeRestoredAccessory(model, restoredPercent) {
  const accessory = makeAccessory(model)
  const service = accessory.addService('Fanv2')
  const speed = service.getCharacteristic('RotationSpeed')
  speed.setProps({ maxValue: 100, minStep: 1, minValue: 0, unit: 'unitless' })
  speed.value = restoredPercent
  return accessory
}

function build(Handler, accessory) {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params)
    },
  })
  return { device: new Handler(platform, accessory), sent }
}

describe('the fan speed cache', () => {
  it.each(FANS)('restores the $name cache as a speed step, not a percentage', ({ name, Handler, steps }) => {
    // half speed, whatever that is on this fan
    const half = Math.round(steps / 2)
    const { device } = build(Handler, makeRestoredAccessory(name, Math.round((half / steps) * 100)))

    expect(device.cacheSpeed).toBe(half)
  })

  it.each(FANS)('leaves the $name cache at zero when the fan was off', ({ name, Handler }) => {
    const { device } = build(Handler, makeRestoredAccessory(name, 0))

    // 0 is not a speed step, and converting it would clamp it up to 1 - which
    // would then swallow a request for the fan's slowest speed
    expect(device.cacheSpeed).toBe(0)
  })

  /**
   * The failure an owner would actually notice, on the twelve step fans. The
   * eight and six step fans cannot reach it: no percentage they store is also
   * a valid step number for them.
   */
  it.each(FANS.filter(fan => fan.steps === 12))(
    'still sends an $name speed the owner asks for after a restart on speed 1',
    async ({ name, Handler }) => {
      // speed 1 on a twelve step fan is stored by HomeKit as 8%
      const { device, sent } = build(Handler, makeRestoredAccessory(name, 8))

      // 67% is speed 8 - the same number as the stored percentage
      await device.internalSpeedUpdate(67)

      expect(sent).toHaveLength(1)
      expect(device.cacheSpeed).toBe(8)
    },
  )
})
