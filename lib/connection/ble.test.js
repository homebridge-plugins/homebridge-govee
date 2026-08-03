import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The bug these guard against: on macOS, CoreBluetooth never exposes peripheral
 * MAC addresses, so noble's connect-by-address can never resolve and every BLE
 * update fails with 'Invalid peripheral ID or Address'. Govee devices advertise
 * a local name whose suffix is the last two bytes of their MAC (e.g.
 * Govee_H617A_325A for ...:32:5A), so on darwin the plugin resolves peripherals
 * by scanning for that suffix instead and connects to the discovered object.
 */

const btClient = vi.hoisted(() => {
  const { EventEmitter: EE } = require('node:events')
  const client = new EE()
  client.startScanningAsync = vi.fn(async () => {})
  client.stopScanningAsync = vi.fn(async () => {})
  client.waitForPoweredOnAsync = vi.fn(async () => {})
  client.connectAsync = vi.fn(async () => {})
  client.reset = vi.fn()
  return client
})

vi.mock('@stoprocent/noble', () => ({ default: btClient }))

const { default: BLEConnection } = await import('./ble.js')

function fakePeripheral(localName) {
  return {
    advertisement: { localName },
    connectAsync: vi.fn(async () => {}),
  }
}

function fakePlatform() {
  return {
    log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
}

describe('connectByNameDarwin', () => {
  let connection

  beforeEach(() => {
    btClient.removeAllListeners()
    btClient.startScanningAsync.mockClear()
    btClient.stopScanningAsync.mockClear()
    connection = new BLEConnection(fakePlatform())
  })

  it('resolves the peripheral whose advertised name ends with the address suffix', async () => {
    const strip = fakePeripheral('Govee_H617A_325A')
    const promise = connection.connectByNameDarwin('db:48:c2:06:32:5a', 10000)

    // Peripherals that must be ignored: different device, non-Govee vendor
    btClient.emit('discover', fakePeripheral('ihoment_H6008_F409'))
    btClient.emit('discover', fakePeripheral('NotAGovee_325A'))
    btClient.emit('discover', strip)

    await expect(promise).resolves.toBe(strip)
    expect(strip.connectAsync).toHaveBeenCalledOnce()
    expect(btClient.stopScanningAsync).toHaveBeenCalled()
  })

  it('matches case-insensitively, since bleAddress casing varies', async () => {
    const strip = fakePeripheral('govee_h617a_325a')
    const promise = connection.connectByNameDarwin('DB:48:C2:06:32:5A', 10000)

    btClient.emit('discover', strip)

    await expect(promise).resolves.toBe(strip)
  })

  it('accepts ihoment-prefixed names, which Govee bulbs advertise', async () => {
    const bulb = fakePeripheral('ihoment_H6008_F409')
    const promise = connection.connectByNameDarwin('aa:bb:cc:dd:f4:09', 10000)

    btClient.emit('discover', bulb)

    await expect(promise).resolves.toBe(bulb)
  })

  it('reuses a cached peripheral without scanning again', async () => {
    const strip = fakePeripheral('Govee_H617A_325A')
    const first = connection.connectByNameDarwin('db:48:c2:06:32:5a', 10000)
    btClient.emit('discover', strip)
    await first

    btClient.startScanningAsync.mockClear()
    await expect(connection.connectByNameDarwin('db:48:c2:06:32:5a', 10000)).resolves.toBe(strip)
    expect(btClient.startScanningAsync).not.toHaveBeenCalled()
    expect(strip.connectAsync).toHaveBeenCalledTimes(2)
  })

  it('rescans when the cached peripheral no longer connects', async () => {
    // A peripheral object can go stale (device rebooted, adapter reset). The
    // cache must not wedge the device forever - a failed connect evicts it and
    // falls back to a fresh scan.
    const stale = fakePeripheral('Govee_H617A_325A')
    const first = connection.connectByNameDarwin('db:48:c2:06:32:5a', 10000)
    btClient.emit('discover', stale)
    await first

    stale.connectAsync.mockRejectedValueOnce(new Error('Peripheral already gone'))
    const fresh = fakePeripheral('Govee_H617A_325A')
    const retry = connection.connectByNameDarwin('db:48:c2:06:32:5a', 10000)
    await Promise.resolve()
    await Promise.resolve()
    btClient.emit('discover', fresh)

    await expect(retry).resolves.toBe(fresh)
  })

  it('rejects when no matching peripheral appears before the scan timeout', async () => {
    vi.useFakeTimers()
    try {
      const promise = connection.connectByNameDarwin('db:48:c2:06:32:5a', 10000)
      const assertion = expect(promise).rejects.toThrow(/no peripheral advertising name suffix 325a/)

      btClient.emit('discover', fakePeripheral('ihoment_H6008_D34D'))
      await vi.advanceTimersByTimeAsync(9500)

      await assertion
      expect(btClient.stopScanningAsync).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
