import { describe, expect, it } from 'vitest'

import GoveePlatform from '../lib/platform.js'
import { deviceIdFor, makePlatform } from './harness.js'

/**
 * The heater2 models (H7131 and friends) show their heat level as a fan tile:
 * 25% fan only, 50% low, 75% medium, 100% high. Turning that tile off is meant
 * to put the heater back on auto, but it only changed the HomeKit side - no
 * command went out, so the heater carried on in the mode it was in.
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
  return { control: accessory.control, sent }
}

describe('turning off a heater\'s fan tile', () => {
  it('puts the running heater on auto at its target temperature', async () => {
    const { control, sent } = buildH7131()
    control.cacheState = 'on'
    control.cacheFanState = 'on'
    control.cacheMode = 'high'
    control.cacheTarg = 20

    await control.internalFanStateUpdate(false)

    expect(sent).toHaveLength(1)
    expect(sent[0].cmd).toBe('multiSync')
    expect(sent[0].value).toBe(control.tempCodeAutoTurn[20])
    expect(control.cacheMode).toBe('auto')
  })

  it('sends the same command as choosing auto from the heater\'s mode', async () => {
    const fromFan = buildH7131()
    fromFan.control.cacheState = 'on'
    fromFan.control.cacheFanState = 'on'
    fromFan.control.cacheMode = 'low'
    fromFan.control.cacheTarg = 18
    await fromFan.control.internalFanStateUpdate(false)

    const fromMode = buildH7131()
    fromMode.control.cacheState = 'on'
    fromMode.control.cacheMode = 'low'
    fromMode.control.cacheTarg = 18
    await fromMode.control.internalModeUpdate(0)

    expect(fromFan.sent).toEqual(fromMode.sent)
  })

  it('sends nothing when the heater is off, as auto would switch it on', async () => {
    const { control, sent } = buildH7131()
    control.cacheState = 'off'
    control.cacheFanState = 'on'
    control.cacheMode = 'high'
    control.cacheTarg = 20

    await control.internalFanStateUpdate(false)

    expect(sent).toHaveLength(0)
    expect(control.cacheFanState).toBe('off')
  })

  it('sends nothing when the heater is already on auto', async () => {
    const { control, sent } = buildH7131()
    control.cacheState = 'on'
    control.cacheFanState = 'on'
    control.cacheMode = 'auto'
    control.cacheTarg = 20

    await control.internalFanStateUpdate(false)

    expect(sent).toHaveLength(0)
  })

  it('puts the fan tile back when the command fails', async () => {
    const { control } = buildH7131()
    control.platform.sendDeviceUpdate = async () => {
      throw new Error('device offline')
    }
    control.cacheState = 'on'
    control.cacheFanState = 'on'
    control.cacheMode = 'high'
    control.cacheTarg = 20

    await expect(control.internalFanStateUpdate(false)).rejects.toBeDefined()
    expect(control.cacheFanState).toBe('on')
    expect(control.cacheMode).toBe('high')
  })
})
