import { Buffer } from 'node:buffer'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { hs2rgb } from '../utils/colour.js'
import { generateCodeFromHexValues } from '../utils/functions.js'
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
  {
    name: 'H7105 fan',
    Handler: deviceFanH7105,
    model: 'H7105',
    reportCode: 0x05,
  },
  {
    name: 'H7107 fan',
    Handler: deviceFanH7107,
    model: 'H7107',
    reportCode: 0x05,
  },
  {
    name: 'heater',
    Handler: deviceHeater2,
    model: 'H7130',
    reportCode: 0x05,
  },
  {
    name: 'H7142 humidifier',
    Handler: deviceHumidifierH7142,
    model: 'H7142',
    reportCode: 0x01,
  },
  {
    name: 'H7160 humidifier',
    Handler: deviceHumidifierH7160,
    model: 'H7160',
    reportCode: 0x01,
  },
]

function build(Handler, model, { sendTakes = 0 } = {}) {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_a, params) => {
      sent.push(params)
      // A command to a real device takes a while to go out and be answered
      if (sendTakes) {
        await new Promise(resolve => setTimeout(resolve, sendTakes))
      }
    },
  })
  const accessory = makeAccessory(model)
  const device = new Handler(platform, accessory)
  device.accessory = accessory
  return { device, sent, accessory, platform }
}

/**
 * Writes characteristics the way HAP-NodeJS does for one HomeKit request: every
 * set handler starts at once, and a characteristic only takes its new value
 * once its own handler has finished. That ordering is what the colour bug
 * hangs on, so the fake has to copy it.
 */
async function homeWrites(service, values) {
  const writes = Promise.all(Object.entries(values).map(async ([name, value]) => {
    const characteristic = service.getCharacteristic(name)
    await characteristic.setHandler(value)
    characteristic.value = value
  }))
  // A failed write is checked by the caller, once the timers have run
  writes.catch(() => {})
  await vi.advanceTimersByTimeAsync(2000)
  await writes
}

/**
 * A colour report as the device sends it: `aa 1b <code> <brightness> r g b`,
 * where the code is the third byte of that handler's colour report.
 */
function colourReport(code, rgb) {
  return generateCodeFromHexValues([
    0xAA,
    0x1B,
    code,
    0x64,
    ...rgb,
  ])
}

/**
 * The red, green and blue each frame carries. Both colour frames hold them in
 * bytes four to six: `33 1b 01 <brightness> r g b` on the humidifiers, which
 * also send their brightness this way, and `3a 1b 05 0d r g b` on the others.
 */
function coloursSent(sent) {
  return sent
    .map(params => Array.from(Buffer.from(params.value, 'base64')))
    .filter(bytes => (bytes[0] === 0x33 && bytes[1] === 0x1B && bytes[2] === 0x01)
      || (bytes[0] === 0x3A && bytes[1] === 0x1B && bytes[2] === 0x05))
    .map(bytes => bytes.slice(4, 7))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe.each(HANDLERS)('$name night light', ({ Handler, model, reportCode }) => {
  it('listens for saturation, not only hue', () => {
    const { device } = build(Handler, model)

    // Nothing listens for saturation on its own, so HomeKit's write lands
    // nowhere and the owner's change is silently dropped
    expect(typeof device.lightService?.getCharacteristic('Saturation')?.setHandler)
      .toBe('function')
  })

  it('sends a command when only the saturation changes', async () => {
    const { device, sent } = build(Handler, model)
    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })
    sent.length = 0

    await homeWrites(device.lightService, { Saturation: 20 })

    expect(coloursSent(sent)).toEqual([
      hs2rgb(240, 20),
    ])
  })

  it('still sends nothing when neither hue nor saturation moved', async () => {
    // the early return has to keep doing its job, or every repeat is a command
    const { device, sent } = build(Handler, model)
    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })
    sent.length = 0

    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })

    expect(sent).toHaveLength(0)
  })

  it('remembers the saturation it sent, so the next change is seen too', async () => {
    const { device } = build(Handler, model)
    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })

    await homeWrites(device.lightService, { Saturation: 20 })

    expect(device.cacheSat).toBe(20)
  })

  /**
   * HAP-NodeJS stores a characteristic's new value only after its own handler
   * finishes. The saturation handler used to read the hue from the
   * characteristic, and the update read the saturation the same way - both
   * still the PREVIOUS colour while the two handlers waited out the debounce.
   * So a scene or automation setting a new colour sent the old one, or
   * nothing at all when the old one was what the light already had.
   */
  it('sends the new colour when home sets hue and saturation together', async () => {
    const { device, sent } = build(Handler, model)
    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })

    // A scene turning the light a pale red
    await homeWrites(device.lightService, { Hue: 0, Saturation: 50 })

    expect(coloursSent(sent)).toEqual([
      hs2rgb(240, 100),
      hs2rgb(0, 50),
    ])
  })

  it('sends the new colour when saturation arrives before hue', async () => {
    const { device, sent } = build(Handler, model)
    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })

    await homeWrites(device.lightService, { Saturation: 50, Hue: 120 })

    expect(coloursSent(sent).at(-1)).toEqual(hs2rgb(120, 50))
  })

  it('pairs a later saturation change with the hue the light reported', async () => {
    const { device, sent } = build(Handler, model)
    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })

    // The light is turned red in the Govee app and reports it
    device.externalUpdate({
      commands: [
        colourReport(reportCode, [255, 0, 0]),
      ],
      source: 'AWS',
    })
    await homeWrites(device.lightService, { Saturation: 50 })

    // Red made paler, not the blue from before the report
    expect(coloursSent(sent).at(-1)).toEqual(hs2rgb(0, 50))
  })

  it('pairs a later saturation change with the hue the light kept, after a failed send', async () => {
    const { device, sent, platform } = build(Handler, model)
    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })

    const send = platform.sendDeviceUpdate
    platform.sendDeviceUpdate = async () => {
      throw new Error('device offline')
    }
    await expect(homeWrites(device.lightService, { Hue: 0, Saturation: 50 })).rejects.toThrow()
    platform.sendDeviceUpdate = send

    // Let the failed control be put back, then make the light paler
    await vi.advanceTimersByTimeAsync(2000)
    await homeWrites(device.lightService, { Saturation: 30 })

    // The blue the light still has, not the red that never arrived
    expect(coloursSent(sent).at(-1)).toEqual(hs2rgb(240, 30))
  })
})

/**
 * The humidifiers send their brightness in the same frame as the colour. A
 * scene sets brightness and colour together, and brightness waits slightly
 * longer than colour before sending - so it used to read the colour from the
 * characteristics while the colour command was still on its way, and put the
 * old saturation straight back.
 */
describe.each(HANDLERS.filter(({ name }) => name.includes('humidifier')))('$name night light brightness', ({ Handler, model }) => {
  it('keeps the new colour when home sets brightness and colour together', async () => {
    const { device, sent } = build(Handler, model, { sendTakes: 200 })
    device.cacheLightState = 'on'
    await homeWrites(device.lightService, { Hue: 240, Saturation: 100 })

    await homeWrites(device.lightService, { Brightness: 50, Hue: 0, Saturation: 50 })

    const colours = coloursSent(sent)
    expect(colours.at(-1)).toEqual(hs2rgb(0, 50))
    expect(colours).not.toContainEqual(hs2rgb(0, 100))
  })
})
