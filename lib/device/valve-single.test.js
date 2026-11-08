import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceValveSingle from './valve-single.js'

/**
 * A socket shown as a valve turns itself off after its set duration.
 *
 * The timer only lives in memory. After a restart the accessory comes back with
 * the valve still on, and the first report that the socket is on used to skip
 * the timer because the valve already looked on - so it never turned off (#1387).
 */

function makeValve(accessory = makeAccessory('H5080'), sendDelay = 0) {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params.value)
      if (sendDelay) {
        await new Promise(resolve => setTimeout(resolve, sendDelay))
      }
    },
  })
  const device = new deviceValveSingle(platform, accessory)
  device.service.updateCharacteristic(device.hapChar.SetDuration, 5)
  return { device, accessory, sent }
}

// The timer turns the valve off through the Active characteristic
const isOn = device => device.service.getCharacteristic(device.hapChar.Active).value === 1

describe('a socket shown as a valve', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('turns off after its duration when turned on from home', async () => {
    const { device } = makeValve()
    device.service.updateCharacteristic(device.hapChar.Active, 1)

    await device.internalStateUpdate(1)
    await vi.advanceTimersByTimeAsync(4900)
    expect(isOn(device)).toBe(true)

    await vi.advanceTimersByTimeAsync(100)
    expect(isOn(device)).toBe(false)
  })

  it('turns off after its duration when restored as on after a restart', async () => {
    const { device: before, accessory } = makeValve()
    before.service.updateCharacteristic(before.hapChar.Active, 1)
    before.service.updateCharacteristic(before.hapChar.InUse, 1)

    // A new handler on the same accessory, as after a restart
    const { device } = makeValve(accessory)
    device.externalUpdate({ state: 'on' })
    await vi.advanceTimersByTimeAsync(5000)

    expect(isOn(device)).toBe(false)
  })

  it('keeps only one timer when the report of its own command arrives first', async () => {
    const { device } = makeValve(undefined, 3000)

    // The command takes 3s to send, and the socket reports it is on after 1s
    const pending = device.internalStateUpdate(1)
    await vi.advanceTimersByTimeAsync(1000)
    device.externalUpdate({ state: 'on' })
    await vi.advanceTimersByTimeAsync(2000)
    await pending

    // An extra timer from the report would turn it off 2s early, at 6s
    await vi.advanceTimersByTimeAsync(4900)
    expect(isOn(device)).toBe(true)

    await vi.advanceTimersByTimeAsync(100)
    expect(isOn(device)).toBe(false)
  })
})
