import { describe, expect, it, vi } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import GoveeDevice from './base.js'

/**
 * The pieces every handler shares. The failure path especially - it is used
 * over a hundred times, so a change here reaches every control in the plugin.
 */

function build() {
  const platform = makePlatform()
  const accessory = makeAccessory('H6102')
  return {
    device: new GoveeDevice(platform, accessory),
    platform,
    accessory,
  }
}

describe('what a handler starts with', () => {
  it('has the platform and accessory it was given', () => {
    const { device, platform, accessory } = build()

    expect(device.platform).toBe(platform)
    expect(device.accessory).toBe(accessory)
    expect(device.hapChar).toBe(platform.api.hap.Characteristic)
    expect(device.hapServ).toBe(platform.api.hap.Service)
    expect(device.hapErr).toBe(platform.api.hap.HapStatusError)
  })
})

describe('building a tile', () => {
  it('makes one that is not there yet', () => {
    const { device, accessory } = build()

    const service = device.getOrAddService('Lightbulb')

    expect(service.type).toBe('Lightbulb')
    expect(accessory.services).toContain(service)
  })

  it('gives back the same one next time, rather than a second copy', () => {
    const { device, accessory } = build()

    const first = device.getOrAddService('Lightbulb')
    const before = accessory.services.length
    const second = device.getOrAddService('Lightbulb')

    expect(second).toBe(first)
    expect(accessory.services).toHaveLength(before)
  })

  it('keeps named tiles apart', () => {
    const { device } = build()

    const one = device.getOrAddService('Switch', 'Switch 1', 'switch1')
    const two = device.getOrAddService('Switch', 'Switch 2', 'switch2')

    expect(two).not.toBe(one)
    expect(two.displayName).toBe('Switch 2')
  })
})

describe('dropping a tile that no longer belongs', () => {
  it('removes one the device has', () => {
    const { device, accessory } = build()
    device.getOrAddService('Fan')

    expect(device.removeServiceIfPresent('Fan')).toBe(true)
    expect(accessory.getService('Fan')).toBeUndefined()
  })

  it('does nothing, quietly, when there is none', () => {
    const { device } = build()

    expect(device.removeServiceIfPresent('Fan')).toBe(false)
  })
})

describe('giving up on a control', () => {
  it('tells HomeKit, so the tile shows as not responding', () => {
    const { device } = build()

    expect(() => device.failUpdate(new Error('device offline'))).toThrow()
  })

  it('says what went wrong in the log', () => {
    const { device, accessory } = build()

    expect(() => device.failUpdate(new Error('device offline'))).toThrow()
    expect(accessory.logWarn.messages().join(' ')).toContain('device offline')
  })

  it('puts the control back, but not straight away', () => {
    // Reverting immediately fights the change HomeKit has already drawn
    vi.useFakeTimers()
    const { device } = build()
    const revert = vi.fn()

    expect(() => device.failUpdate(new Error('nope'), revert)).toThrow()
    expect(revert).not.toHaveBeenCalled()

    vi.advanceTimersByTime(2000)
    expect(revert).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('reads the value when it reverts, not when it failed', () => {
    // The value can move in those two seconds, and the tile should end up
    // showing where the device actually is
    vi.useFakeTimers()
    const { device } = build()
    let state = 'on'
    const seen = []

    expect(() => device.failUpdate(new Error('nope'), () => seen.push(state))).toThrow()
    state = 'off'
    vi.advanceTimersByTime(2000)

    expect(seen).toEqual(['off'])
    vi.useRealTimers()
  })

  it('still fails when there is nothing to put back', () => {
    const { device } = build()

    expect(() => device.failUpdate(new Error('nope'))).toThrow()
  })
})
