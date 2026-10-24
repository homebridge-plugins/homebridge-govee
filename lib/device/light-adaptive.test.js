import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { hs2rgb, k2rgb, m2hs, rgb2hs } from '../utils/colour.js'
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
  const platform = makePlatform({
    sendDeviceUpdate: async () => {},
  })
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

    device.externalUpdate({
      rgb: { r: 0, g: 0, b: 255 },
    })

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

    device.externalUpdate({
      rgb: { r: vivid[0], g: vivid[1], b: vivid[2] },
    })

    expect(disable).toHaveBeenCalledTimes(1)
  })

  it('tells the owner why it turned off', () => {
    settleOnColour(device, 255, 0, 0)

    device.externalUpdate({
      rgb: { r: 0, g: 255, b: 0 },
    })

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

    device.externalUpdate({
      rgb: { r: 255, g: 100, b: 50 },
    })

    expect(disable).not.toHaveBeenCalled()
  })

  it('allows for the drift of the colour conversions on the way out and back', () => {
    settleOnColour(device, 255, 100, 50)

    device.externalUpdate({
      rgb: { r: 253, g: 102, b: 52 },
    })

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
    const platform = makePlatform({
      sendDeviceUpdate: async () => {},
    })
    platform.config.colourSafeMode = true
    const accessory = makeAccessory('H6102')
    const device = new deviceLight(platform, accessory)
    device.accessory = accessory
    device.initialised = true
    const disable = vi.fn()
    device.alController = {
      isAdaptiveLightingActive: () => true,
      disableAdaptiveLighting: disable,
    }
    settleOnColour(device, 255, 0, 0)

    device.externalUpdate({
      rgb: { r: 0, g: 0, b: 255 },
    })

    expect(disable).not.toHaveBeenCalled()
  })
})

describe('a light that cannot go as warm as adaptive lighting asks', () => {
  // The H601C stops at 2700K, though the api gives its range as 2000-9000K. An
  // evening update of 2200K went out as asked, came back as 2700K, and was
  // taken for a colour the owner had chosen

  // 455 mired is 2200K, an adaptive lighting value for late evening
  const EVENING = 455

  function buildWithRange(model) {
    const sent = []
    const platform = makePlatform({
      sendDeviceUpdate: async (_accessory, params) => sent.push(params),
    })
    const accessory = makeAccessory(model, {
      useAwsControl: true,
      supportedCmdsOpts: {
        colorTem: {
          range: { min: 2000, max: 9000 },
        },
      },
    })
    const device = new deviceLight(platform, accessory)
    device.accessory = accessory
    device.initialised = true
    device.cacheState = 'on'
    device.alController = {
      isAdaptiveLightingActive: () => true,
      disableAdaptiveLighting: vi.fn(),
    }
    return { device, sent }
  }

  it('sends the warmest the light can do', async () => {
    const { device, sent } = buildWithRange('H601C')

    await device.internalCTUpdate(EVENING)

    expect(sent).toEqual([
      { cmd: 'colorTem', value: 2700 },
    ])
  })

  it('leaves adaptive lighting on when the light reports that back', async () => {
    const { device } = buildWithRange('H601C')
    await device.internalCTUpdate(EVENING)

    device.externalUpdate({ kelvin: 2700 })

    expect(device.alController.disableAdaptiveLighting).not.toHaveBeenCalled()
  })

  it('keeps the api range for a model with no floor of its own', async () => {
    const { device, sent } = buildWithRange('H6102')

    await device.internalCTUpdate(EVENING)

    expect(sent).toEqual([
      { cmd: 'colorTem', value: 2200 },
    ])
  })
})

describe('the first report after a restart', () => {
  // HomeKit keeps a light's characteristics across a restart, and the adaptive
  // lighting controller restores itself as on. The light's first status report
  // used to be compared against nothing and taken for a colour chosen outside
  // HomeKit, so every restart switched adaptive lighting off

  // Boot once to set up the service, set it as it was left, then boot again
  // on the same accessory, the way Homebridge restores it from its cache
  function restartAs({ hue = 0, saturation = 0, mired = 140 }) {
    const platform = makePlatform({
      sendDeviceUpdate: async () => {},
    })
    const accessory = makeAccessory('H6076', { useLanControl: true })
    const before = new deviceLight(platform, accessory)
    before.service.updateCharacteristic('Hue', hue)
    before.service.updateCharacteristic('Saturation', saturation)
    before.service.updateCharacteristic('ColorTemperature', mired)

    const device = new deviceLight(platform, accessory)
    device.accessory = accessory
    device.initialised = true
    device.alController = {
      isAdaptiveLightingActive: () => true,
      disableAdaptiveLighting: vi.fn(),
    }
    return device
  }

  it('leaves adaptive lighting on when the light is still at its last colour temperature', () => {
    // 370 mired went out as 2700K
    const [hue, saturation] = m2hs(370)
    const device = restartAs({ hue, saturation, mired: 370 })

    device.externalUpdate({ kelvin: 2700 })

    expect(device.alController.disableAdaptiveLighting).not.toHaveBeenCalled()
  })

  it('leaves it on when the light is still at its last colour', () => {
    const device = restartAs({ hue: 30, saturation: 80 })
    const [r, g, b] = hs2rgb(30, 80)

    device.externalUpdate({
      rgb: { r, g, b },
    })

    expect(device.alController.disableAdaptiveLighting).not.toHaveBeenCalled()
  })

  it('still switches it off when the colour temperature was changed while homebridge was down', () => {
    const [hue, saturation] = m2hs(370)
    const device = restartAs({ hue, saturation, mired: 370 })

    device.externalUpdate({ kelvin: 5000 })

    expect(device.alController.disableAdaptiveLighting).toHaveBeenCalledTimes(1)
  })

  it('still switches it off when a colour was chosen while homebridge was down', () => {
    const device = restartAs({ hue: 30, saturation: 80 })

    device.externalUpdate({
      rgb: { r: 0, g: 0, b: 255 },
    })

    expect(device.alController.disableAdaptiveLighting).toHaveBeenCalledTimes(1)
  })

  it('still sends the same colour temperature when it is asked for again', async () => {
    const [hue, saturation] = m2hs(370)
    const device = restartAs({ hue, saturation, mired: 370 })
    const sent = []
    device.platform.sendDeviceUpdate = async (_accessory, params) => sent.push(params)
    device.cacheState = 'on'

    await device.internalCTUpdate(370)

    expect(sent).toEqual([
      { cmd: 'colorTem', value: 2700 },
    ])
  })
})

describe('the first report after a restart, when adaptive lighting ran while the light was off', () => {
  // Adaptive lighting keeps moving HomeKit's saved colour temperature, hue and
  // saturation while the light is off, but nothing is sent to a light that is
  // off. So by the restart HomeKit's values are somewhere the light never went,
  // and comparing the light's first report against them switched adaptive
  // lighting off. What was actually last sent is what counts

  // Send a colour temperature with the light on, turn it off, let adaptive
  // lighting move on to a cooler one, then boot again on the same accessory
  async function restartAfterAdaptiveLightingMovedOn(context) {
    const platform = makePlatform({
      sendDeviceUpdate: async () => {},
    })
    const accessory = makeAccessory('H6076', context)
    const before = new deviceLight(platform, accessory)
    before.cacheState = 'on'
    await before.internalCTUpdate(370)

    before.cacheState = 'off'
    const [hue, saturation] = m2hs(250)
    before.service.updateCharacteristic('Hue', hue)
    before.service.updateCharacteristic('Saturation', saturation)
    before.service.updateCharacteristic('ColorTemperature', 250)
    await before.internalCTUpdate(250)

    const device = new deviceLight(platform, accessory)
    device.accessory = accessory
    device.initialised = true
    device.alController = {
      isAdaptiveLightingActive: () => true,
      disableAdaptiveLighting: vi.fn(),
    }
    return device
  }

  it('leaves adaptive lighting on when the light reports the colour temperature it was last sent', async () => {
    const device = await restartAfterAdaptiveLightingMovedOn({ useLanControl: true })

    device.externalUpdate({ kelvin: 2700 })

    expect(device.alController.disableAdaptiveLighting).not.toHaveBeenCalled()
  })

  it('leaves it on for a bluetooth light reporting the colour it was last sent', async () => {
    const device = await restartAfterAdaptiveLightingMovedOn({})
    // A bluetooth-only light is sent 2700K as rgb, and reports rgb back
    const [r, g, b] = k2rgb(2700)

    device.externalUpdate({
      rgb: { r, g, b },
    })

    expect(device.alController.disableAdaptiveLighting).not.toHaveBeenCalled()
  })

  it('still switches it off when the colour temperature was changed while homebridge was down', async () => {
    const device = await restartAfterAdaptiveLightingMovedOn({ useLanControl: true })

    device.externalUpdate({ kelvin: 5000 })

    expect(device.alController.disableAdaptiveLighting).toHaveBeenCalledTimes(1)
  })
})
