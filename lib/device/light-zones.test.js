import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceLight from './light.js'

/**
 * The H1250 ceiling light has a main downlight panel and a background ring that
 * switch independently. Govee lists `mainLightToggle` and `backgroundLightToggle`
 * for it and answers `{"status":"success"}` to both, then never delivers the
 * command - so the tiles reported success to HomeKit and the light did nothing,
 * with no way for the plugin to tell (#1333).
 *
 * These models take the frame the device reports its own zones with instead.
 * Everything else about the tiles is shared with the models whose toggles do
 * work, so what matters here is that the right thing goes out, that state comes
 * back, and that no other light is dragged along with it.
 */

function build(model, context = {}) {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params)
    },
  })
  const accessory = makeAccessory(model, context)
  const device = new deviceLight(platform, accessory)
  device.accessory = accessory
  return { accessory, device, sent }
}

function tiles(accessory) {
  return accessory.services
    .filter(service => service.type === 'Switch')
    .map(service => service.displayName)
}

// `aa 30 <main> <background>`, so the main panel is off and the ring is on
const MAIN_OFF_RING_ON = 'qjAAAQAAAAAAAAAAAAAAAAAAAJs='

describe('a light whose zones govee never delivers', () => {
  it('offers a tile per zone once aws is available', () => {
    const { accessory } = build('H1250', { useAwsControl: true })

    expect(tiles(accessory)).toEqual(['Main Light', 'Background Light'])
  })

  it('offers no tiles without aws, rather than ones that quietly do nothing', () => {
    // The frame only goes over AWS, which needs account credentials rather than
    // just an api key. Tiles that accept a tap and drop it are worse than none
    const { accessory } = build('H1250', { useAwsControl: false, useOpenApiControl: true })

    expect(tiles(accessory)).toEqual([])
  })

  it('explains in the log what the missing zone tiles need', () => {
    // No tiles without AWS is right, but silently so leaves the owner unaware
    // the zones exist at all - the log line is what points them at the fix
    const { accessory } = build('H1250', { useAwsControl: false, useOpenApiControl: true })

    expect(accessory.log.messages().join(' ')).toContain('account username and password')
  })

  it('does not nag an owner whose zone tiles are working', () => {
    const { accessory } = build('H1250', { useAwsControl: true })

    expect(accessory.log.messages().join(' ')).not.toContain('account username and password')
  })

  it('ignores the toggles govee lists for it, even with the api connected', () => {
    // Govee reports both capabilities for this model. Believing them is exactly
    // the bug - the tiles would appear and never work
    const { accessory } = build('H1250', {
      useAwsControl: false,
      useOpenApiControl: true,
      openApiCapabilities: { mainLightToggle: {}, backgroundLightToggle: {} },
    })

    expect(tiles(accessory)).toEqual([])
  })

  it('sends the frame the device accepts, not the capability', async () => {
    const { accessory, sent } = build('H1250', { useAwsControl: true })

    await accessory.getService('Background Light')
      .getCharacteristic('On')
      .setHandler(true)

    expect(sent).toHaveLength(1)
    expect(sent[0].cmd).toBe('zoneState')
    expect(sent[0]).toMatchObject({ zone: 'background', value: true })
  })

  it('reads both zones back from the frame the device reports', () => {
    // This arrives unprompted, which is how a change made in the Govee app or at
    // the wall switch reaches the tiles
    const { accessory, device } = build('H1250', { useAwsControl: true })

    device.externalUpdate({ commands: [MAIN_OFF_RING_ON] })

    expect(accessory.getService('Main Light').getCharacteristic('On').value).toBe(false)
    expect(accessory.getService('Background Light').getCharacteristic('On').value).toBe(true)
  })
})

describe('every other light', () => {
  it('is left alone by the zone handling', () => {
    // The H1252 is an ordinary rgb light sharing this handler. It should gain no
    // zone tiles and take no notice of a zone frame
    const { accessory, device } = build('H1252', { useAwsControl: true })

    expect(tiles(accessory)).toEqual([])
    expect(() => device.externalUpdate({ commands: [MAIN_OFF_RING_ON] })).not.toThrow()
    expect(tiles(accessory)).toEqual([])
  })

  it('still takes its zone state from the toggles when they work', () => {
    // The H1270 advertises the same two capabilities and, as far as anyone has
    // reported, they are delivered - so it stays on the toggle path
    const { accessory, device } = build('H1270', {
      useOpenApiControl: true,
      openApiCapabilities: { mainLightToggle: {}, backgroundLightToggle: {} },
    })

    expect(tiles(accessory)).toEqual(['Main Light', 'Background Light'])

    device.externalUpdate({ toggles: { mainLightToggle: true } })

    expect(accessory.getService('Main Light').getCharacteristic('On').value).toBe(true)
  })
})
