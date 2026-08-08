import { describe, expect, it, vi } from 'vitest'

import SensorLeak from '../lib/device/sensor-leak.js'
import SensorThermoSwitch from '../lib/device/sensor-thermo-switch.js'
import SensorThermo from '../lib/device/sensor-thermo.js'
import { makeAccessory, makePlatform } from './harness.js'

const handlers = [
  ['leak sensor', SensorLeak],
  ['thermo sensor', SensorThermo],
  ['thermo switch sensor', SensorThermoSwitch],
]

function buildDevice(DeviceClass, {
  battery = 50,
  low = 0,
  seedBattery = true,
  threshold = 20,
} = {}) {
  const platform = makePlatform({
    config: { bleRefreshTime: 30, disableDeviceLogging: false },
  })
  const accessory = makeAccessory('SYNTHETIC', { offHumi: 0, offTemp: 0 })
  platform.deviceConf[accessory.context.gvDeviceId] = { lowBattThreshold: threshold }

  const device = new DeviceClass(platform, accessory)
  if (seedBattery) {
    device.cacheBatt = battery
    device.battService.updateCharacteristic(device.hapChar.BatteryLevel, battery)
    device.battService.updateCharacteristic(device.hapChar.StatusLowBattery, low)
  }
  accessory.log.calls.length = 0
  const batteryUpdates = vi.spyOn(device.battService, 'updateCharacteristic')

  return { accessory, batteryUpdates, device }
}

describe.each(handlers)('%s battery status', (_name, DeviceClass) => {
  it.each([
    [19, 1],
    [20, 1],
    [21, 0],
  ])('reports battery %i with low status %i at threshold 20', async (battery, expectedLow) => {
    const { device } = buildDevice(DeviceClass)

    await device.externalUpdate({ battery })

    expect(device.battService.getCharacteristic(device.hapChar.BatteryLevel).value).toBe(battery)
    expect(device.battService.getCharacteristic(device.hapChar.StatusLowBattery).value).toBe(expectedLow)
  })

  it('repairs stale low status when the battery percentage is unchanged', async () => {
    const { accessory, batteryUpdates, device } = buildDevice(DeviceClass, { battery: 20, low: 0 })

    await device.externalUpdate({ battery: 20 })

    expect(device.battService.getCharacteristic(device.hapChar.BatteryLevel).value).toBe(20)
    expect(device.battService.getCharacteristic(device.hapChar.StatusLowBattery).value).toBe(1)
    expect(batteryUpdates.mock.calls).toEqual([[device.hapChar.StatusLowBattery, 1]])
    expect(accessory.log.calls).toEqual([])
  })

  it('repairs status when the threshold changes around an unchanged percentage', async () => {
    const { accessory, batteryUpdates, device } = buildDevice(DeviceClass, {
      battery: 20,
      low: 0,
      threshold: 19,
    })

    device.lowBattThreshold = 20
    await device.externalUpdate({ battery: 20 })

    expect(batteryUpdates.mock.calls).toEqual([[device.hapChar.StatusLowBattery, 1]])

    batteryUpdates.mockClear()
    device.lowBattThreshold = 19
    await device.externalUpdate({ battery: 20 })

    expect(batteryUpdates.mock.calls).toEqual([[device.hapChar.StatusLowBattery, 0]])
    expect(accessory.log.calls).toEqual([])
  })

  it('does nothing for repeated unchanged correct samples', async () => {
    const { accessory, batteryUpdates, device } = buildDevice(DeviceClass, {
      battery: 20,
      low: 1,
    })

    await device.externalUpdate({ battery: 20 })
    await device.externalUpdate({ battery: 20 })

    expect(batteryUpdates).not.toHaveBeenCalled()
    expect(accessory.log.calls).toEqual([])
  })

  it.each([
    [20, true],
    [21, false],
  ])('does not rewrite equivalent boolean low status for battery %i', async (battery, low) => {
    const { accessory, batteryUpdates, device } = buildDevice(DeviceClass, { battery, low })

    await device.externalUpdate({ battery })

    expect(batteryUpdates).not.toHaveBeenCalled()
    expect(accessory.log.calls).toEqual([])
  })

  it('updates both characteristics across low battery transitions', async () => {
    const { accessory, batteryUpdates, device } = buildDevice(DeviceClass, {
      battery: 21,
      low: 0,
    })

    await device.externalUpdate({ battery: 20 })

    expect(batteryUpdates.mock.calls).toEqual([
      [device.hapChar.BatteryLevel, 20],
      [device.hapChar.StatusLowBattery, 1],
    ])
    expect(accessory.log.calls).toHaveLength(1)

    batteryUpdates.mockClear()
    accessory.log.calls.length = 0
    await device.externalUpdate({ battery: 21 })

    expect(batteryUpdates.mock.calls).toEqual([
      [device.hapChar.BatteryLevel, 21],
      [device.hapChar.StatusLowBattery, 0],
    ])
    expect(accessory.log.calls).toHaveLength(1)
  })

  it.each([
    undefined,
    '20',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    101,
  ])('ignores invalid battery sample %s', async (battery) => {
    const { accessory, batteryUpdates, device } = buildDevice(DeviceClass)

    await device.externalUpdate({ battery })

    expect(device.cacheBatt).toBe(50)
    expect(batteryUpdates).not.toHaveBeenCalled()
    expect(accessory.log.calls).toEqual([])
  })

  it('does not derive low status from the constructor battery default', () => {
    const { batteryUpdates, device } = buildDevice(DeviceClass, { seedBattery: false })

    expect(device.battService.getCharacteristic(device.hapChar.BatteryLevel).value).toBe(0)
    expect(device.battService.getCharacteristic(device.hapChar.StatusLowBattery).value).toBeFalsy()
    expect(batteryUpdates).not.toHaveBeenCalled()
  })
})
