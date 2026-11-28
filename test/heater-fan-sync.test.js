import { describe, expect, it } from 'vitest'

import GoveePlatform from '../lib/platform.js'
import { deviceIdFor, makePlatform } from './harness.js'

/**
 * The heater2 models show their heat level on a fan tile. That tile only moved
 * when the heater's mode changed, so turning the heater off from the govee app
 * or its buttons left the tile showing a level, and turning it back on at the
 * same level left the tile off. These keep the tile in step with the heater.
 */
function buildH7131() {
  const sent = []
  const instance = new GoveePlatform()
  Object.assign(instance, makePlatform({
    sendDeviceUpdate: async (_accessory, params) => sent.push(params),
  }))
  const device = {
    device: deviceIdFor('H7131'),
    deviceName: 'H7131',
    model: 'H7131',
  }
  instance.initialiseDevice(device)
  const accessory = instance.accessories.get(instance.api.hap.uuid.generate(device.device))
  const control = accessory.control
  const fan = () => ({
    on: control.fanService.getCharacteristic('On').value,
    speed: control.fanService.getCharacteristic('RotationSpeed').value,
  })
  return { control, fan, sent }
}

// The H7131's own reports of its mode, from a real heater
const HIGH_STATUS = 'qgUBAwAAAAAAAAAAAAAAAAAAAK0='
const AUTO_STATUS = 'qgUDAZH4ghH4Htwc6AAAAAAAAJk='

function runningOnHigh() {
  const built = buildH7131()
  built.control.externalUpdate({
    source: 'AWS',
    state: 'on',
    commands: [HIGH_STATUS],
  })
  return built
}

describe('a heater2 heater\'s fan tile', () => {
  it('shows the level while the heater runs at it', () => {
    const { fan } = runningOnHigh()

    expect(fan()).toEqual({
      on: true,
      speed: 100,
    })
  })

  it('turns off when the heater is turned off elsewhere', () => {
    const { control, fan } = runningOnHigh()

    control.externalUpdate({
      source: 'AWS',
      state: 'off',
      commands: [HIGH_STATUS],
    })

    expect(fan().on).toBe(false)
    expect(control.cacheFanState).toBe('off')
  })

  it('comes back at its level when the heater is turned back on elsewhere', () => {
    const { control, fan } = runningOnHigh()
    control.externalUpdate({
      source: 'AWS',
      state: 'off',
      commands: [HIGH_STATUS],
    })

    control.externalUpdate({
      source: 'AWS',
      state: 'on',
      commands: [HIGH_STATUS],
    })

    expect(fan()).toEqual({
      on: true,
      speed: 100,
    })
  })

  it('stays off while the heater runs on auto', () => {
    const { control, fan } = runningOnHigh()

    control.externalUpdate({
      source: 'AWS',
      state: 'on',
      commands: [AUTO_STATUS],
    })

    expect(fan().on).toBe(false)
  })

  it('follows the heater being turned off and on from home', async () => {
    const { control, fan } = runningOnHigh()

    await control.internalStateUpdate(0)
    expect(fan().on).toBe(false)
    expect(control.cacheFanState).toBe('off')

    await control.internalStateUpdate(1)
    expect(fan()).toEqual({
      on: true,
      speed: 100,
    })
  })

  it('sends the last level again when the heater is off, as that turns it on', async () => {
    const { control, sent } = runningOnHigh()
    control.externalUpdate({
      source: 'AWS',
      state: 'off',
      commands: [HIGH_STATUS],
    })

    await control.internalSpeedUpdate(100)

    expect(sent).toHaveLength(1)
    expect(sent[0].value).toBe(control.speedCode[100])
    expect(control.cacheState).toBe('on')
  })

  it('sends nothing for the level the heater is already running at', async () => {
    const { control, sent } = runningOnHigh()

    await control.internalSpeedUpdate(100)

    expect(sent).toHaveLength(0)
  })
})
