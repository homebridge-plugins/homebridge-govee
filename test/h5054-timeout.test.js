import { describe, expect, it, vi } from 'vitest'

import GoveePlatform from '../lib/platform.js'
import { deviceIdFor, makePlatform } from './harness.js'

function sensor(name, model = 'H5054') {
  return {
    device: deviceIdFor(model),
    deviceName: name,
    model,
  }
}

function httpDevice(device, name, lastDeviceData = { gwonline: true, online: true, lastTime: 1 }) {
  return {
    device: device.device,
    deviceName: name,
    sku: device.model,
    deviceExt: {
      deviceSettings: JSON.stringify({ battery: 88 }),
      lastDeviceData: JSON.stringify(lastDeviceData),
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('h5054 HTTP timeout containment', () => {
  it('keeps the timed-out sensor untouched and continues to its sibling', async () => {
    const platform = makePlatform()
    const instance = new GoveePlatform()
    Object.assign(instance, platform, { syncsInFlight: new Set() })

    const first = sensor('synthetic-first')
    const second = sensor('synthetic-second')
    instance.initialiseDevice(first)
    instance.initialiseDevice(second)
    const firstAccessory = platform.accessories.get(instance.api.hap.uuid.generate(first.device))
    firstAccessory.control.externalUpdate({ leakDetected: true })

    const updates = []
    let firstWarningRequest = true
    const receiveDeviceUpdate = instance.receiveDeviceUpdate.bind(instance)
    instance.receiveDeviceUpdate = (accessory, params) => {
      updates.push(params)
      receiveDeviceUpdate(accessory, params)
    }
    instance.httpClient = {
      getDevices: vi.fn(async () => [httpDevice(first, first.deviceName), httpDevice(second, second.deviceName)]),
      getLeakDeviceWarning: vi.fn(async (id) => {
        if (id === first.device && firstWarningRequest) {
          firstWarningRequest = false
          throw new Error('synthetic timeout')
        }
        return []
      }),
    }

    await instance.goveeHTTPSync()

    expect(instance.httpClient.getLeakDeviceWarning).toHaveBeenCalledTimes(2)
    expect(updates).toEqual([{ source: 'HTTP', battery: 88, leakDetected: false, online: true }])
    expect(firstAccessory.getService('LeakSensor').getCharacteristic('LeakDetected').value).toBe(1)
    expect(platform.log.entries.filter(entry => entry.level === 'warn')).toHaveLength(1)

    await instance.goveeHTTPSync()

    expect(instance.httpClient.getLeakDeviceWarning).toHaveBeenCalledTimes(4)
    expect(updates).toHaveLength(3)
    expect(firstAccessory.getService('LeakSensor').getCharacteristic('LeakDetected').value).toBe(0)
  })

  it('keeps startup and interval HTTP syncs behind the same overlap guard', async () => {
    vi.useFakeTimers()
    const instance = new GoveePlatform()
    instance.config = { httpRefreshTime: 1 }
    instance.log = Object.assign(() => {}, { debugWarn: vi.fn() })
    instance.syncsInFlight = new Set()

    const pending = deferred()
    instance.goveeHTTPSync = vi.fn(() => pending.promise)

    try {
      instance.setupHTTPSync()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)

      expect(instance.goveeHTTPSync).toHaveBeenCalledTimes(1)
      expect(instance.syncsInFlight.has('HTTP')).toBe(true)
    } finally {
      pending.resolve()
      clearInterval(instance.refreshHTTPInterval)
      vi.useRealTimers()
    }
  })

  it('starts a healthy sibling and then the third leak check while the first remains stalled', async () => {
    const platform = makePlatform()
    const instance = new GoveePlatform()
    Object.assign(instance, platform, { syncsInFlight: new Set() })

    const first = sensor('synthetic-stalled')
    const second = sensor('synthetic-healthy')
    const third = sensor('synthetic-queued')
    instance.initialiseDevice(first)
    instance.initialiseDevice(second)
    instance.initialiseDevice(third)

    const firstWarning = deferred()
    const secondWarning = deferred()
    const secondStarted = deferred()
    const thirdStarted = deferred()
    let activeWarnings = 0
    let maxActiveWarnings = 0
    const getLeakDeviceWarning = vi.fn((id) => {
      activeWarnings += 1
      maxActiveWarnings = Math.max(maxActiveWarnings, activeWarnings)
      if (id === first.device) {
        return firstWarning.promise.finally(() => {
          activeWarnings -= 1
        })
      }
      if (id === second.device) {
        secondStarted.resolve()
        return secondWarning.promise.finally(() => {
          activeWarnings -= 1
        })
      }
      thirdStarted.resolve()
      activeWarnings -= 1
      return []
    })
    instance.httpClient = {
      getDevices: vi.fn(async () => [
        httpDevice(first, first.deviceName),
        httpDevice(second, second.deviceName),
        httpDevice(third, third.deviceName),
      ]),
      getLeakDeviceWarning,
    }

    const sync = instance.goveeHTTPSync()
    await secondStarted.promise
    expect(getLeakDeviceWarning).toHaveBeenCalledTimes(2)
    expect(activeWarnings).toBe(2)
    expect(maxActiveWarnings).toBe(2)

    secondWarning.resolve([])
    await thirdStarted.promise
    expect(getLeakDeviceWarning).toHaveBeenCalledTimes(3)
    expect(activeWarnings).toBe(1)
    expect(maxActiveWarnings).toBe(2)

    firstWarning.resolve([])
    await sync
  })

  it('updates an H5106 monitor while two leak-warning calls remain pending', async () => {
    const platform = makePlatform()
    const instance = new GoveePlatform()
    Object.assign(instance, platform, { syncsInFlight: new Set() })

    const first = sensor('synthetic-stalled-first')
    const second = sensor('synthetic-stalled-second')
    const monitor = sensor('synthetic-monitor', 'H5106')
    instance.initialiseDevice(first)
    instance.initialiseDevice(second)
    instance.initialiseDevice(monitor)

    const firstWarning = deferred()
    const secondWarning = deferred()
    const firstStarted = deferred()
    const secondStarted = deferred()
    const monitorUpdated = deferred()
    let activeWarnings = 0
    instance.receiveDeviceUpdate = vi.fn((accessory, params) => {
      if (accessory.UUID === instance.api.hap.uuid.generate(monitor.device)) {
        monitorUpdated.resolve(params)
      }
    })
    instance.httpClient = {
      getDevices: vi.fn(async () => [
        httpDevice(first, first.deviceName),
        httpDevice(second, second.deviceName),
        httpDevice(monitor, monitor.deviceName, { online: true, tem: 2150, hum: 4530 }),
      ]),
      getLeakDeviceWarning: vi.fn((id) => {
        activeWarnings += 1
        if (id === first.device) {
          firstStarted.resolve()
          return firstWarning.promise.finally(() => {
            activeWarnings -= 1
          })
        }
        secondStarted.resolve()
        return secondWarning.promise.finally(() => {
          activeWarnings -= 1
        })
      }),
    }

    const sync = instance.goveeHTTPSync()
    const [, , monitorParams] = await Promise.all([
      firstStarted.promise,
      secondStarted.promise,
      monitorUpdated.promise,
    ])
    expect(activeWarnings).toBe(2)
    expect(monitorParams).toEqual({ source: 'HTTP', battery: 88, temperature: 2150, humidity: 4530, online: true })

    firstWarning.resolve([])
    secondWarning.resolve([])
    await sync
  })
})
