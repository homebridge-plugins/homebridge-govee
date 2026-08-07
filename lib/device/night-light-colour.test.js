import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceFanH7105 from './fan-H7105.js'
import deviceFanH7107 from './fan-H7107.js'
import deviceHeater2 from './heater2.js'
import deviceHumidifierH7142 from './humidifier-H7142.js'
import deviceHumidifierH7160 from './humidifier-H7160.js'

/**
 * The night light on an appliance, and the colour its owner actually asked for.
 *
 * These five handlers each expose a light alongside the appliance, and each one
 * listened for hue and nothing else. HomeKit writes hue and saturation as two
 * separate values, so making a colour paler or richer without moving its hue
 * reached nothing at all: no handler for saturation, and the hue handler
 * returned early because the hue had not changed. The light stayed as it was
 * while HomeKit showed the new colour.
 *
 * The same blind spot sat on the incoming side, so a colour chosen in the Govee
 * app came back and was ignored for the same reason.
 *
 * This is the bug that was fixed in `light.js` first and left here (#1333), so
 * these tests cover all five together - the point is that none of them is
 * allowed to drift back.
 */

const HANDLERS = [
  ['H7105 fan', deviceFanH7105, 'H7105'],
  ['H7107 fan', deviceFanH7107, 'H7107'],
  ['heater', deviceHeater2, 'H7130'],
  ['H7142 humidifier', deviceHumidifierH7142, 'H7142'],
  ['H7160 humidifier', deviceHumidifierH7160, 'H7160'],
]

function build(Handler, model) {
  const sent = []
  const platform = makePlatform({ sendDeviceUpdate: async (_a, params) => void sent.push(params) })
  const accessory = makeAccessory(model)
  const device = new Handler(platform, accessory)
  device.accessory = accessory
  return { device, sent, accessory }
}

describe.each(HANDLERS)('%s night light', (_name, Handler, model) => {
  it('listens for saturation, not only hue', () => {
    const { device } = build(Handler, model)

    // Nothing listens for saturation on its own, so HomeKit's write lands
    // nowhere and the owner's change is silently dropped
    expect(typeof device.lightService?.getCharacteristic('Saturation')?.setHandler)
      .toBe('function')
  })

  it('sends a command when only the saturation changes', async () => {
    const { device, sent } = build(Handler, model)
    device.cacheState = 'on'
    device.cacheHue = 240
    device.cacheSat = 100
    device.lightService.updateCharacteristic('Hue', 240)
    device.lightService.updateCharacteristic('Saturation', 20)

    await device.internalColourUpdate(240)

    expect(sent.length).toBeGreaterThan(0)
  })

  it('still sends nothing when neither hue nor saturation moved', async () => {
    // the early return has to keep doing its job, or every repeat is a command
    const { device, sent } = build(Handler, model)
    device.cacheState = 'on'
    device.cacheHue = 240
    device.cacheSat = 100
    device.lightService.updateCharacteristic('Hue', 240)
    device.lightService.updateCharacteristic('Saturation', 100)

    await device.internalColourUpdate(240)

    expect(sent).toHaveLength(0)
  })

  it('remembers the saturation it sent, so the next change is seen too', async () => {
    const { device } = build(Handler, model)
    device.cacheState = 'on'
    device.cacheHue = 240
    device.cacheSat = 100
    device.lightService.updateCharacteristic('Hue', 240)
    device.lightService.updateCharacteristic('Saturation', 20)

    await device.internalColourUpdate(240)

    expect(device.cacheSat).toBe(20)
  })
})
