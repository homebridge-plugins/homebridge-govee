import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Connecting to a light over bluetooth on Linux.
 *
 * noble (hci-socket) only sends LE Create Connection for a device it has seen in
 * a scan, so a connect by address alone never reaches the adapter. And some
 * adapters (a Realtek RTL8821C here) stop reporting advertisements after an LE
 * connection until they get an HCI reset, which btClient.reset() does not send.
 */

const ADDRESS = 'a4:c1:38:9d:71:3a'

vi.mock('@stoprocent/noble', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  return {
    default: new Emitter(),
  }
})

const { default: noble } = await import('@stoprocent/noble')
const { default: BLEConnection } = await import('./ble.js')

function makePeripheral(address = ADDRESS, dropsFirst = 0) {
  const peripheral = new EventEmitter()
  peripheral.address = address
  peripheral.state = 'disconnected'
  let drops = dropsFirst
  peripheral.connectAsync = vi.fn(async () => {
    // a weak link can report connected and then fail with 0x3e moments later
    peripheral.state = drops > 0
      ? 'disconnected'
      : 'connected'
    drops -= 1
  })
  return peripheral
}

function makeClient() {
  const log = Object.assign(() => {}, {
    warn: () => {},
    debug: () => {},
    error: () => {},
  })
  return new BLEConnection({
    log,
    config: {},
    hasBleSensor: () => false,
  })
}

describe('connecting to a light on linux', () => {
  let advertising
  let resetCalls

  beforeEach(() => {
    vi.useFakeTimers()
    noble.removeAllListeners()
    advertising = []
    resetCalls = 0
    noble.waitForPoweredOnAsync = vi.fn(async () => {})
    noble.stopScanningAsync = vi.fn(async () => {})
    noble.connectAsync = vi.fn(async () => {
      throw new Error('should connect to the scanned peripheral, not by address')
    })
    noble.startScanningAsync = vi.fn(async () => {
      for (const p of advertising) {
        setTimeout(() => noble.emit('discover', p), 50)
      }
    })
    noble._bindings = {
      _hci: {
        reset: () => { resetCalls += 1 },
      },
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('scans for the device and connects to what the scan found', async () => {
    const light = makePeripheral()
    advertising = [
      makePeripheral('11:22:33:44:55:66'),
      light,
    ]

    const pending = makeClient().connectAfterScan(ADDRESS, 10000)
    await vi.advanceTimersByTimeAsync(1000)

    await expect(pending).resolves.toBe(light)
    expect(light.connectAsync).toHaveBeenCalledTimes(1)
    expect(noble.connectAsync).not.toHaveBeenCalled()
    expect(resetCalls).toBe(0)
  })

  it('resets the adapter and scans again when the first scan hears nothing', async () => {
    const light = makePeripheral()
    // nothing is reported until the adapter has been reset
    noble.startScanningAsync = vi.fn(async () => {
      if (resetCalls > 0) {
        setTimeout(() => noble.emit('discover', light), 50)
      }
    })

    const pending = makeClient().connectAfterScan(ADDRESS, 10000)
    await vi.advanceTimersByTimeAsync(5000)

    await expect(pending).resolves.toBe(light)
    expect(resetCalls).toBe(1)
    expect(noble.startScanningAsync).toHaveBeenCalledTimes(2)
  })

  it('tries again when the link drops right after connecting', async () => {
    const light = makePeripheral(ADDRESS, 1)
    advertising = [light]

    const pending = makeClient().connectAfterScan(ADDRESS, 10000)
    await vi.advanceTimersByTimeAsync(2000)

    await expect(pending).resolves.toBe(light)
    expect(light.connectAsync).toHaveBeenCalledTimes(2)
    expect(light.state).toBe('connected')
  })

  it('gives up when the device never shows up', async () => {
    const pending = makeClient().connectAfterScan(ADDRESS, 10000)
    const outcome = expect(pending).rejects.toThrow(`no advertisement from ${ADDRESS}`)
    await vi.advanceTimersByTimeAsync(10000)

    await outcome
    expect(resetCalls).toBe(1)
  })
})
