import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { hs2rgb, rgb2hs } from '../utils/colour.js'
import deviceLight from './light.js'

/**
 * When adaptive lighting has to get out of the way.
 *
 * Adaptive lighting keeps moving a light's colour through the day, so the
 * moment its owner picks a colour themselves it has to stop - otherwise the
 * light wanders off that colour within a few minutes.
 *
 * Homebridge handles that for changes made in the Home app: it watches for a
 * real write to hue, saturation or colour temperature and switches adaptive
 * lighting off itself. What it cannot see is a colour chosen in the Govee app,
 * on a remote or at the wall, because those reach the plugin as a status report
 * rather than a write. Catching those is this plugin's job, and its alone.
 *
 * The catch is that the light also reports back the colours adaptive lighting
 * itself just set. Treating one of those as the owner's doing would switch
 * adaptive lighting off within a minute of it being switched on, so the two
 * have to be told apart - by whether the reported colour is the one that was
 * just sent.
 */

function build(context = {}) {
  const platform = makePlatform({ sendDeviceUpdate: async () => {} })
  const accessory = makeAccessory('H6102', context)
  const device = new deviceLight(platform, accessory)
  device.accessory = accessory
  device.initialised = true
  device.alController = {
    isAdaptiveLightingActive: () => true,
    disableAdaptiveLighting: vi.fn(),
  }
  return { accessory, device }
}

// Put the device in a known colour state, as though this is what was last sent
function settleOnColour(device, r, g, b) {
  const [hue, sat] = rgb2hs(r, g, b)
  device.cacheR = r
  device.cacheG = g
  device.cacheB = b
  device.cacheHue = hue
  device.cacheSat = sat
  device.cacheKelvin = 0
}

describe('a colour chosen outside HomeKit', () => {
  let device
  let disable

  beforeEach(() => {
    ({ device } = build())
    disable = device.alController.disableAdaptiveLighting
  })

  it('switches adaptive lighting off', () => {
    settleOnColour(device, 255, 0, 0)

    device.externalUpdate({ rgb: { r: 0, g: 0, b: 255 } })

    expect(disable).toHaveBeenCalledTimes(1)
  })

  it('switches it off for a change of saturation at the same hue', () => {
    // The bug this was written for: only hue was compared, so going from a pale
    // colour to a vivid one at the same hue looked like no change at all. The
    // light was left following adaptive lighting after its owner had chosen a
    // colour, and moved off it a few minutes later
    const pale = hs2rgb(240, 25)
    const vivid = hs2rgb(240, 100)
    settleOnColour(device, ...pale)

    device.externalUpdate({ rgb: { r: vivid[0], g: vivid[1], b: vivid[2] } })

    expect(disable).toHaveBeenCalledTimes(1)
  })

  it('tells the owner why it turned off', () => {
    settleOnColour(device, 255, 0, 0)

    device.externalUpdate({ rgb: { r: 0, g: 255, b: 0 } })

    const logged = device.accessory.log.messages().join(' ')
    expect(logged).toContain('adaptive lighting turned off')
    expect(logged).toContain('outside HomeKit')
  })

  it('switches it off for a colour temperature set elsewhere', () => {
    device.cacheKelvin = 2700

    device.externalUpdate({ kelvin: 5000 })

    expect(disable).toHaveBeenCalledTimes(1)
  })
})

describe('the light repeating back what it was just told', () => {
  let device
  let disable

  beforeEach(() => {
    ({ device } = build())
    disable = device.alController.disableAdaptiveLighting
  })

  it('leaves adaptive lighting alone', () => {
    // Otherwise adaptive lighting would switch itself off a minute after being
    // switched on, every time
    settleOnColour(device, 255, 100, 50)

    device.externalUpdate({ rgb: { r: 255, g: 100, b: 50 } })

    expect(disable).not.toHaveBeenCalled()
  })

  it('allows for the drift of the colour conversions on the way out and back', () => {
    settleOnColour(device, 255, 100, 50)

    device.externalUpdate({ rgb: { r: 253, g: 102, b: 52 } })

    expect(disable).not.toHaveBeenCalled()
  })

  it('allows for colour temperature being sent rounded to the nearest 100K', () => {
    device.cacheKelvin = 2700

    device.externalUpdate({ kelvin: 2750 })

    expect(disable).not.toHaveBeenCalled()
  })
})

describe('when the owner has turned colour handling off', () => {
  it('never touches adaptive lighting', () => {
    const platform = makePlatform({ sendDeviceUpdate: async () => {} })
    platform.config.colourSafeMode = true
    const accessory = makeAccessory('H6102')
    const device = new deviceLight(platform, accessory)
    device.accessory = accessory
    device.initialised = true
    const disable = vi.fn()
    device.alController = { isAdaptiveLightingActive: () => true, disableAdaptiveLighting: disable }
    settleOnColour(device, 255, 0, 0)

    device.externalUpdate({ rgb: { r: 0, g: 0, b: 255 } })

    expect(disable).not.toHaveBeenCalled()
  })
})
