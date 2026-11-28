import { describe, expect, it } from 'vitest'

import GoveePlatform from '../lib/platform.js'
import { deviceIdFor, makePlatform } from './harness.js'

/**
 * How a heater2 heater's power and fan tile handlers behave together. HomeKit
 * hands every characteristic of one write to its handler at once, so these run
 * the handlers concurrently, the way Siri or a scene does.
 */
function buildH7131({ state = 'on', mode = 'low', speed = 50 } = {}) {
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
  control.cacheState = state
  control.cacheMode = mode
  control.cacheSpeed = speed
  control.cacheFanState = state === 'on' && mode !== 'auto'
    ? 'on'
    : 'off'
  control.cacheTarg = 20
  const fan = () => ({
    on: control.fanService.getCharacteristic('On').value,
    speed: control.fanService.getCharacteristic('RotationSpeed').value,
  })
  const sentKinds = () => sent.map(params => params.cmd === 'stateHeat'
    ? `power:${params.value ? 'on' : 'off'}`
    : Object.keys(control.speedCode).some(level => control.speedCode[level] === params.value)
      ? `level:${Object.keys(control.speedCode).find(level => control.speedCode[level] === params.value)}`
      : params.value === control.tempCodeAutoTurn[20]
        ? 'auto'
        : params.cmd)
  return { control, fan, sent, sentKinds }
}

// The H7131's own report of running on low, from a real heater
const LOW_STATUS = 'qgUBAQAAAAAAAAAAAAAAAAAAAK8='

describe('turning a heater off along with its fan tile', () => {
  it('sends only off when the power handler runs first', async () => {
    const { control, sentKinds } = buildH7131()

    await Promise.all([
      control.internalStateUpdate(0),
      control.internalFanStateUpdate(false),
    ])

    expect(sentKinds()).toEqual(['power:off'])
    expect(control.cacheState).toBe('off')
  })

  it('ends on off when the fan handler runs first', async () => {
    const { control, sentKinds } = buildH7131()

    await Promise.all([
      control.internalFanStateUpdate(false),
      control.internalStateUpdate(0),
    ])

    expect(sentKinds().at(-1)).toBe('power:off')
    expect(control.cacheState).toBe('off')
  })

  it('does not send a level written along with off, in either order', async () => {
    const first = buildH7131()
    await Promise.all([
      first.control.internalStateUpdate(0),
      first.control.internalSpeedUpdate(100),
    ])
    expect(first.sentKinds()).toEqual(['power:off'])

    const second = buildH7131()
    await Promise.all([
      second.control.internalSpeedUpdate(100),
      second.control.internalStateUpdate(0),
    ])
    expect(second.sentKinds()).toEqual(['power:off'])
    expect(second.control.cacheState).toBe('off')
  })

  it('keeps the last level, so the fan tile can bring it back', async () => {
    const { control } = buildH7131({ mode: 'high', speed: 100 })

    await Promise.all([
      control.internalStateUpdate(0),
      control.internalFanStateUpdate(false),
    ])

    expect(control.cacheMode).toBe('high')
    expect(control.cacheSpeed).toBe(100)
  })

  it('puts the state back when the off command fails', async () => {
    const { control } = buildH7131()
    control.platform.sendDeviceUpdate = async () => {
      throw new Error('device offline')
    }

    await expect(control.internalStateUpdate(0)).rejects.toBeDefined()

    expect(control.cacheState).toBe('on')
  })
})

describe('tapping a heater\'s fan tile on', () => {
  it('switches an off heater on at its last level', async () => {
    const { control, fan, sentKinds } = buildH7131({ state: 'off', mode: 'high', speed: 100 })

    await control.internalFanStateUpdate(true)

    expect(sentKinds()).toEqual(['level:100'])
    expect(control.cacheState).toBe('on')
    expect(fan()).toEqual({
      on: true,
      speed: 100,
    })
  })

  it('switches a heater on auto to low when it has no last level', async () => {
    const { control, sentKinds } = buildH7131({ mode: 'auto', speed: 0 })

    await control.internalFanStateUpdate(true)

    expect(sentKinds()).toEqual(['level:50'])
    expect(control.cacheMode).toBe('low')
  })

  it('sends nothing when the heater already runs at a level', async () => {
    const { control, sent } = buildH7131()
    control.cacheFanState = 'off'

    await control.internalFanStateUpdate(true)

    expect(sent).toHaveLength(0)
    expect(control.cacheFanState).toBe('on')
  })

  it('does not switch on a heater turned off in the same write', async () => {
    const { control, sentKinds } = buildH7131()

    await Promise.all([
      control.internalStateUpdate(0),
      control.internalFanStateUpdate(true),
    ])

    expect(sentKinds()).toEqual(['power:off'])
    expect(control.cacheState).toBe('off')
  })

  it('sends only the dragged level when the tile is turned on by a drag, in either order', async () => {
    const onFirst = buildH7131({ mode: 'auto', speed: 50 })
    await Promise.all([
      onFirst.control.internalFanStateUpdate(true),
      onFirst.control.internalSpeedUpdate(100),
    ])
    expect(onFirst.sentKinds()).toEqual(['level:100'])

    const levelFirst = buildH7131({ state: 'off', mode: 'low', speed: 50 })
    await Promise.all([
      levelFirst.control.internalSpeedUpdate(75),
      levelFirst.control.internalFanStateUpdate(true),
    ])
    expect(levelFirst.sentKinds()).toEqual(['level:75'])
    expect(levelFirst.control.cacheMode).toBe('medium')
  })

  it('does not then send the remembered level again', async () => {
    const { control, sentKinds } = buildH7131({ state: 'off', mode: 'high', speed: 100 })

    await Promise.all([
      control.internalFanStateUpdate(true),
      control.internalSpeedUpdate(100),
    ])

    expect(sentKinds()).toEqual(['level:100'])
  })
})

describe('a status report while a chosen level is waiting', () => {
  it('does not put the tile back to the old level', async () => {
    const { control, fan, sentKinds } = buildH7131()

    const choosing = control.internalSpeedUpdate(100)
    control.externalUpdate({
      source: 'AWS',
      state: 'on',
      commands: [LOW_STATUS],
    })
    expect(fan().speed).not.toBe(50)
    await choosing

    expect(sentKinds()).toEqual(['level:100'])
    expect(fan()).toEqual({
      on: true,
      speed: 100,
    })
  })

  it('shows the level once sent, though the report said the heater was off', async () => {
    const { control, fan } = buildH7131({ state: 'off', mode: 'high', speed: 100 })

    const choosing = control.internalSpeedUpdate(75)
    control.externalUpdate({
      source: 'AWS',
      state: 'off',
    })
    await choosing

    expect(control.cacheState).toBe('on')
    expect(fan()).toEqual({
      on: true,
      speed: 75,
    })
  })
})
