import { describe, expect, it } from 'vitest'

import GoveePlatform from '../lib/platform.js'
import { deviceIdFor, makePlatform } from './harness.js'

/**
 * Dragging a heater2 heater's fan tile passes every level on the way, and each
 * one used to go to the heater. Its reports of the levels passed through came
 * back after the last had gone out, and the tile jumped back to one of them.
 * Only the level the drag stops on is sent now, as the brightness and colour
 * sliders already do.
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
  control.cacheState = 'on'
  control.cacheFanState = 'on'
  control.cacheMode = 'low'
  control.cacheSpeed = 50
  control.cacheTarg = 20
  return { control, sent }
}

describe('dragging a heater\'s fan tile', () => {
  it('sends only the level the drag stops on', async () => {
    const { control, sent } = buildH7131()

    await Promise.all([75, 100, 25, 100].map(value => control.internalSpeedUpdate(value)))

    expect(sent).toHaveLength(1)
    expect(sent[0].value).toBe(control.speedCode[100])
    expect(control.cacheMode).toBe('high')
  })

  it('sends only the last level of a drag at the pace the Home app sends one', async () => {
    const { control, sent } = buildH7131()

    // The Home app sent a dragged level about every 0.4 to 0.5 seconds
    const passing = control.internalSpeedUpdate(75)
    await new Promise(resolve => setTimeout(resolve, 450))
    await Promise.all([
      passing,
      control.internalSpeedUpdate(100),
    ])

    expect(sent).toHaveLength(1)
    expect(sent[0].value).toBe(control.speedCode[100])
  })

  it('lets a drag down to off end on auto, not on a level passed on the way', async () => {
    const { control, sent } = buildH7131()

    const passing = control.internalSpeedUpdate(25)
    await control.internalFanStateUpdate(false)
    await passing

    expect(sent).toHaveLength(1)
    expect(sent[0].value).toBe(control.tempCodeAutoTurn[20])
    expect(control.cacheMode).toBe('auto')
  })
})
