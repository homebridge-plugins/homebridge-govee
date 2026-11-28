import { describe, expect, it } from 'vitest'

import GoveePlatform from '../lib/platform.js'
import { deviceIdFor, makePlatform } from './harness.js'

/**
 * The heater2 models' own auto mode holds a heating target. Shown to HomeKit as
 * its auto - which means holding a temperature between a heating and a cooling
 * threshold - the Home app had no cooling threshold to show and left the
 * heater's tile with no controls at all (#618). Shown as heat, the tile keeps
 * its power and temperature controls.
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
  const targetState = () => control.service.getCharacteristic('TargetHeaterCoolerState')
  return { control, sent, targetState }
}

// The H7131's own report of being on auto at 8°C, from a real heater
const AUTO_STATUS = 'qgUDAZH4ghH4Htwc6AAAAAAAAJk='
// ...and of being on high
const HIGH_STATUS = 'qgUBAwAAAAAAAAAAAAAAAAAAAK0='

describe('a heater2 heater on its own auto mode', () => {
  it('offers HomeKit heat only, and starts out showing heat', () => {
    const { targetState } = buildH7131()

    expect(targetState().props.validValues).toEqual([1])
    expect(targetState().value).toBe(1)
  })

  it('still shows heat when the heater reports it is on auto', () => {
    const { control, targetState } = buildH7131()
    control.externalUpdate({
      source: 'AWS',
      commands: [HIGH_STATUS],
    })
    expect(control.cacheMode).toBe('high')

    control.externalUpdate({
      source: 'AWS',
      commands: [AUTO_STATUS],
    })

    expect(control.cacheMode).toBe('auto')
    expect(targetState().value).toBe(1)
  })

  it('still shows heat once the fan tile has put it on auto', async () => {
    const { control, targetState } = buildH7131()
    control.cacheState = 'on'
    control.cacheFanState = 'on'
    control.cacheMode = 'high'
    control.cacheTarg = 20

    await control.internalFanStateUpdate(false)

    expect(control.cacheMode).toBe('auto')
    expect(targetState().value).toBe(1)
  })

  it('stays on auto when HomeKit asks for heat, rather than dropping to fan only', async () => {
    const { control, sent } = buildH7131()
    control.cacheState = 'on'
    control.cacheMode = 'auto'
    control.cacheTarg = 20

    await control.internalModeUpdate(1)

    expect(sent).toHaveLength(0)
    expect(control.cacheMode).toBe('auto')
  })

  it('sends nothing when HomeKit asks for heat, as the level is on the fan tile', async () => {
    const { control, sent } = buildH7131()
    control.cacheState = 'on'
    control.cacheMode = 'low'
    control.cacheSpeed = 50

    await control.internalModeUpdate(1)

    expect(sent).toHaveLength(0)
    expect(control.cacheMode).toBe('low')
  })

  it('leaves an off heater off when off and heat come in one write', async () => {
    const { control, sent } = buildH7131()
    control.cacheState = 'on'
    control.cacheMode = 'high'
    control.cacheSpeed = 100

    await Promise.all([
      control.internalStateUpdate(0),
      control.internalModeUpdate(1),
    ])

    expect(sent.map(params => params.cmd)).toEqual(['stateHeat'])
    expect(sent[0].value).toBe(false)
    expect(control.cacheState).toBe('off')
  })

  it('does not switch an off heater on when heat comes alone', async () => {
    const { control, sent } = buildH7131()
    control.cacheState = 'off'
    control.cacheMode = 'high'
    control.cacheSpeed = 100

    await control.internalModeUpdate(1)

    expect(sent).toHaveLength(0)
    expect(control.cacheState).toBe('off')
  })

  it('turns the fan tile off once the dial puts the heater on auto', async () => {
    const { control } = buildH7131()
    control.externalUpdate({
      source: 'AWS',
      state: 'on',
      commands: [HIGH_STATUS],
    })
    expect(control.fanService.getCharacteristic('On').value).toBe(true)

    await control.internalTempUpdate(21)

    expect(control.cacheMode).toBe('auto')
    expect(control.fanService.getCharacteristic('On').value).toBe(false)
  })
})
