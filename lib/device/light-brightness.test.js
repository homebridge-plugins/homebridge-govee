import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceLight from './light.js'

/**
 * A Govee light sent a brightness of 0 stays switched on and reports
 * `onOff: 1`, so Home showed it as on again. An automation that turned it on
 * then only sent a brightness, and its "turn off after" never reached the
 * strip (#1397, an H805C).
 */

function build() {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params)
    },
  })
  const accessory = makeAccessory('H805C', { useAwsControl: true })
  const device = new deviceLight(platform, accessory)
  device.accessory = accessory
  device.cacheState = 'on'
  device.cacheBright = 100
  return { accessory, device, sent }
}

describe('a light set to 0% in home', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is switched off, rather than sent a brightness of 0', async () => {
    const { device, sent } = build()

    const update = device.internalBrightnessUpdate(0)
    await vi.advanceTimersByTimeAsync(2000)
    await update

    expect(sent).toEqual([
      { cmd: 'state', value: 'off' },
    ])
    expect(device.cacheState).toBe('off')
  })

  it('still sends any other brightness as a brightness', async () => {
    const { device, sent } = build()

    const update = device.internalBrightnessUpdate(40)
    await vi.advanceTimersByTimeAsync(2000)
    await update

    expect(sent).toEqual([
      { cmd: 'brightness', value: 40 },
    ])
    expect(device.cacheState).toBe('on')
  })
})
