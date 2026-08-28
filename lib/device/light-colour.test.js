import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { hs2rgb } from '../utils/colour.js'
import deviceLight from './light.js'

/**
 * Picking a colour in the Home app writes Hue and Saturation as two separate,
 * concurrent requests - and HAP-NodeJS only commits a characteristic's value
 * AFTER its onSet handler resolves. Reading one characteristic from the other
 * handler therefore serves the PREVIOUS colour for the whole debounce window,
 * so the bulb received the colour one pick behind (#1361, and the same
 * mechanism as the ice maker's light in #1250).
 */

function build(context = {}) {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params)
    },
  })
  const accessory = makeAccessory('H6008', { useAwsControl: true, ...context })
  const device = new deviceLight(platform, accessory)
  device.accessory = accessory
  return { accessory, device, sent }
}

/**
 * Writes a characteristic the way HAP does: the handler runs first, and the
 * committed value only lands once the handler has resolved. This ordering IS
 * the bug's trigger, so the fake must reproduce it.
 */
async function homekitWrite(service, characteristic, value) {
  const char = service.getCharacteristic(characteristic)
  await char.setHandler(value)
  char.value = value
}

function coloursSent(sent) {
  return sent.filter(params => params.cmd === 'color').map(params => params.value)
}

describe('picking a colour in the home app', () => {
  it('sends the colour just picked, not the one before it', async () => {
    const { device, sent } = build()
    device.cacheState = 'on'

    // The bulb is yellow...
    await Promise.all([
      homekitWrite(device.service, 'Hue', 60),
      homekitWrite(device.service, 'Saturation', 100),
    ])

    // ...and the user taps blue. Hue and saturation arrive concurrently,
    // with neither committed until its handler resolves
    await Promise.all([
      homekitWrite(device.service, 'Hue', 240),
      homekitWrite(device.service, 'Saturation', 80),
    ])

    const colours = coloursSent(sent)
    const [r, g, b] = hs2rgb(240, 80)
    expect(colours.at(-1)).toEqual({ r, g, b })
    // The debounce collapses each pair into a single command
    expect(colours).toHaveLength(2)
  })

  it('handles a saturation-only drag, the same colour made paler', async () => {
    const { device, sent } = build()
    device.cacheState = 'on'
    await Promise.all([
      homekitWrite(device.service, 'Hue', 240),
      homekitWrite(device.service, 'Saturation', 100),
    ])

    await homekitWrite(device.service, 'Saturation', 40)

    const [r, g, b] = hs2rgb(240, 40)
    expect(coloursSent(sent).at(-1)).toEqual({ r, g, b })
  })
})

describe('a light reporting colour back', () => {
  it('ignores its own command echoed back, instead of desaturating the picked colour', async () => {
    const { device, sent } = build()
    device.cacheState = 'on'
    await Promise.all([
      homekitWrite(device.service, 'Hue', 240),
      homekitWrite(device.service, 'Saturation', 80),
    ])
    const [r, g, b] = hs2rgb(240, 80)
    expect(coloursSent(sent).at(-1)).toEqual({ r, g, b })

    // The round trip through the device is lossy by a unit or two - writing
    // this echo into Hue/Saturation would walk the colour away from the pick
    device.externalUpdate({ rgb: { r: r - 2, g, b: b + 2 } })

    expect(device.service.getCharacteristic('Hue').value).toBe(240)
    expect(device.service.getCharacteristic('Saturation').value).toBe(80)
  })

  it('mirrors a genuine change from outside homekit, marked as a report in the log', async () => {
    const { accessory, device } = build()
    device.cacheState = 'on'

    device.externalUpdate({ rgb: { r: 255, g: 0, b: 0 } })

    expect(device.service.getCharacteristic('Hue').value).toBe(0)
    expect(device.service.getCharacteristic('Saturation').value).toBe(100)
    expect(accessory.log.messages().join(' ')).toContain('via device report')
  })

  it('combines a later saturation-only drag with the externally-set hue, not a stale one', async () => {
    const { device, sent } = build()
    device.cacheState = 'on'
    await Promise.all([
      homekitWrite(device.service, 'Hue', 240),
      homekitWrite(device.service, 'Saturation', 80),
    ])

    // The govee app turns the light red, then the user drags saturation only
    device.externalUpdate({ rgb: { r: 255, g: 0, b: 0 } })
    await homekitWrite(device.service, 'Saturation', 50)

    const [r, g, b] = hs2rgb(0, 50)
    expect(coloursSent(sent).at(-1)).toEqual({ r, g, b })
  })
})
