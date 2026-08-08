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
    .filter(service => service.type === 'Lightbulb' && service.subtype)
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

describe('a two-zone light\'s light segment layout', () => {
  it('knows which light segments belong to which zone', () => {
    const { device } = build('H1250', { useAwsControl: true })

    expect(device.zoneLightSegments.main).toEqual([16])
    // Written as a literal rather than re-deriving the range: a duplicated or
    // reordered interior light segment, or light segment 16 leaking into this
    // list, would still pass a length-and-endpoints check but is exactly the
    // kind of bug this layout exists to prevent - light segment 16 belonging
    // to both zones would mean setting the background silently repaints the
    // main panel too
    expect(device.zoneLightSegments.background).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('leaves a model with no layout alone', () => {
    const { device } = build('H6102', { useAwsControl: true })

    expect(device.hasRawZones).toBe(false)
  })
})

describe('a zone tile', () => {
  it('is a lightbulb, so it can carry brightness and color', () => {
    const { accessory } = build('H1250', { useAwsControl: true })
    const tile = accessory.getService('Main Light')

    expect(tile.type).toBe('Lightbulb')
    expect(tile.testCharacteristic('On')).toBe(true)
    expect(tile.testCharacteristic('Brightness')).toBe(true)
    expect(tile.testCharacteristic('Hue')).toBe(true)
    expect(tile.testCharacteristic('Saturation')).toBe(true)
  })

  it('is the only service with that name, so no switch is left behind', () => {
    // HomeKit cannot change a service's type in place, and a Switch cannot
    // carry brightness. Leaving the old one would strand the tile on On-only
    const { accessory, device } = build('H1250', { useAwsControl: true })

    expect(accessory.services.filter(service => service.displayName === 'Main Light')).toHaveLength(1)
    expect(device.zoneServices.mainLightToggle.type).toBe('Lightbulb')
  })

  it('replaces a pre-existing switch with a lightbulb of the same name', () => {
    // The exact scenario the conversion has to handle: an owner who already
    // set up both tiles under the already-shipped on/off feature. A stale
    // Switch left in place would leave that owner stuck on On-only forever.
    //
    // Both zones are seeded here, not just one: the base Lightbulb service's
    // own unrelated switch-to-lightbulb migration (elsewhere in this
    // constructor, for the main light) removes the FIRST Switch service it
    // finds by type, regardless of name - so a test seeding only one zone's
    // switch can pass even if this zone-specific migration is broken, because
    // the other cleanup silently covers for it. Two zones means at least one
    // has to survive on its own
    const platform = makePlatform({ sendDeviceUpdate: async () => {} })
    const accessory = makeAccessory('H1250', { useAwsControl: true })
    accessory.addService('Switch', 'Main Light', 'mainLightToggle')
    accessory.addService('Switch', 'Background Light', 'backgroundLightToggle')

    const device = new deviceLight(platform, accessory)
    device.accessory = accessory

    ;['Main Light', 'Background Light'].forEach((name) => {
      const matches = accessory.services.filter(service => service.displayName === name)
      expect(matches).toHaveLength(1)
      expect(matches[0].type).toBe('Lightbulb')
      expect(matches[0].testCharacteristic('Brightness')).toBe(true)
    })
  })

  it('does not tear down an already-migrated lightbulb on a later restart', () => {
    // A real HAP Service has no `.type` field - only the fake harness invents
    // one (as `hapType`, matched by `getService`/`getServiceById`) for tests
    // elsewhere to read as a stand-in. Code that leaned on `.type` to
    // recognize an already-migrated lightbulb would see `undefined` on real
    // hardware and read every restart as "still a stale Switch", tearing the
    // tile down and rebuilding it every single boot even though nothing had
    // changed.
    //
    // Deleting `.type` below - while leaving `hapType` alone - reproduces
    // exactly that gap: it removes the field a regression would read while
    // keeping the field production lookups actually use, so a reintroduced
    // `.type` comparison genuinely fails this test rather than silently
    // passing against the harness's own convenience field
    const { accessory } = build('H1250', { useAwsControl: true })
    const lightbulbFromFirstBoot = accessory.getService('Main Light')
    accessory.services.forEach((service) => {
      delete service.type
    })

    const platform = makePlatform({ sendDeviceUpdate: async () => {} })
    const device = new deviceLight(platform, accessory)
    device.accessory = accessory

    expect(accessory.getService('Main Light')).toBe(lightbulbFromFirstBoot)
  })

  it('gives a toggle-driven zone on/off only, with no sliders that would do nothing', () => {
    const { accessory } = build('H1270', {
      useOpenApiControl: true,
      openApiCapabilities: { mainLightToggle: true, backgroundLightToggle: true },
    })
    const tile = accessory.getService('Main Light')

    expect(tile.testCharacteristic('On')).toBe(true)
    expect(tile.testCharacteristic('Brightness')).toBe(false)
  })

  it('carries color temperature, which adaptive lighting requires', () => {
    // HAP is explicit: a service must have BOTH Brightness and
    // ColorTemperature before an AdaptiveLightingController can attach to it
    const { accessory } = build('H1250', { useAwsControl: true })
    const tile = accessory.getService('Main Light')

    expect(tile.testCharacteristic('ColorTemperature')).toBe(true)
  })

  it('gets its own adaptive lighting controller, one per zone', () => {
    // A controller's id is derived from its service
    // ("characteristic-transition-<serviceId>"), so each zone's sits alongside
    // the main light's rather than clashing. Two with the same id would throw
    const { accessory, device } = build('H1250', { useAwsControl: true })

    expect(Object.keys(device.zoneAlControllers)).toEqual(['mainLightToggle', 'backgroundLightToggle'])
    expect(accessory.controllers).toHaveLength(3)
    // A controller pointed at the wrong service would still pass a bare
    // length check above - this confirms all three are attached to distinct
    // services rather than, say, two of them both landing on the same tile
    expect(new Set(accessory.controllers.map(controller => controller.service)).size).toBe(3)
  })

  it('leaves adaptive lighting off the zones when color handling is turned off', () => {
    const platform = makePlatform({ sendDeviceUpdate: async () => {} })
    platform.config.colourSafeMode = true
    const accessory = makeAccessory('H1250', { useAwsControl: true })
    const device = new deviceLight(platform, accessory)

    expect(Object.keys(device.zoneAlControllers)).toHaveLength(0)
    expect(accessory.getService('Main Light').testCharacteristic('ColorTemperature')).toBe(false)
  })

  it('removes a zone tile when its capability is later withdrawn', () => {
    // The exact branch whose `existingService` scoping changed during the
    // getServiceById fix (the "capability gone, remove the tile" else branch)
    // - simulate the capability disappearing on a restart, the same shape as
    // the restart tests above, and confirm the stale tile does not survive it
    const platform1 = makePlatform({ sendDeviceUpdate: async () => {} })
    const accessory = makeAccessory('H1250', { useAwsControl: true })
    const device1 = new deviceLight(platform1, accessory)
    device1.accessory = accessory
    expect(accessory.getService('Main Light')).toBeDefined()

    accessory.context.useAwsControl = false
    const platform2 = makePlatform({ sendDeviceUpdate: async () => {} })
    const device2 = new deviceLight(platform2, accessory)
    device2.accessory = accessory

    expect(accessory.getService('Main Light')).toBeUndefined()
  })

  it('removes color temperature from a zone that already carries it when color handling turns off', () => {
    // No test before this seeded a zone service that already has
    // ColorTemperature before checking the removal branch - every other test
    // of that removal starts from a fresh service that never had it to begin
    // with, which the removal code path would pass trivially either way
    const platform1 = makePlatform({ sendDeviceUpdate: async () => {} })
    const accessory = makeAccessory('H1250', { useAwsControl: true })
    const device1 = new deviceLight(platform1, accessory)
    device1.accessory = accessory
    expect(accessory.getService('Main Light').testCharacteristic('ColorTemperature')).toBe(true)

    const platform2 = makePlatform({ sendDeviceUpdate: async () => {} })
    platform2.config.colourSafeMode = true
    const device2 = new deviceLight(platform2, accessory)
    device2.accessory = accessory

    expect(accessory.getService('Main Light').testCharacteristic('ColorTemperature')).toBe(false)
  })

  it('keeps manual color temperature but skips the controller when adaptive lighting is disabled by shift', () => {
    // Distinct from colourSafeMode: adaptiveLightingShift: -1 opts out of the
    // automatic adaptive lighting daemon specifically, not color handling
    // altogether. This mirrors the main light, a few lines up in this same
    // file - its ColorTemperature block is gated on colourSafeMode alone,
    // while its controller block right after is gated on colourSafeMode AND
    // alShift together, so alShift: -1 alone still leaves it a manual CT
    // slider with no controller behind it. The zone code was written to
    // follow that same split, so this checks it does
    const platform = makePlatform({ sendDeviceUpdate: async () => {} })
    platform.deviceConf['AA:BB'] = { adaptiveLightingShift: -1 }
    const accessory = makeAccessory('H1250', { useAwsControl: true })
    const device = new deviceLight(platform, accessory)
    device.accessory = accessory

    expect(accessory.getService('Main Light').testCharacteristic('ColorTemperature')).toBe(true)
    expect(Object.keys(device.zoneAlControllers)).toHaveLength(0)
    // alShift is shared with the main light too, so its own controller is
    // skipped for the same reason - nothing here should have configured one
    expect(accessory.controllers).toHaveLength(0)
  })

  it('applies the configured brightness step to a zone brightness characteristic', () => {
    // The main light already throttles command volume this way - an owner who
    // set brightnessStep did so on purpose, and the zone path rides a raw AWS
    // frame, which is exactly where unthrottled taps matter most
    const platform = makePlatform({ sendDeviceUpdate: async () => {} })
    platform.deviceConf['AA:BB'] = { brightnessStep: 5 }
    const accessory = makeAccessory('H1250', { useAwsControl: true })
    const device = new deviceLight(platform, accessory)
    device.accessory = accessory

    expect(accessory.getService('Main Light').getCharacteristic('Brightness').props.minStep).toBe(5)
  })

  it('clears stale adaptive lighting characteristics from a zone when color handling turns off', () => {
    // Real HAP's AdaptiveLightingController is what actually adds these three
    // characteristics to a service, not this file - simulate that here the way
    // an earlier boot with adaptive lighting on would have left them behind,
    // then confirm turning color handling off clears them rather than leaving
    // a zone that still advertises adaptive lighting with no controller behind it
    const platform1 = makePlatform({ sendDeviceUpdate: async () => {} })
    const accessory = makeAccessory('H1250', { useAwsControl: true })
    const device1 = new deviceLight(platform1, accessory)
    device1.accessory = accessory
    const tile = accessory.getService('Main Light')
    const alCharNames = [
      'SupportedCharacteristicValueTransitionConfiguration',
      'CharacteristicValueTransitionControl',
      'CharacteristicValueActiveTransitionCount',
    ]
    alCharNames.forEach(charName => tile.getCharacteristic(charName))

    const platform2 = makePlatform({ sendDeviceUpdate: async () => {} })
    platform2.config.colourSafeMode = true
    const device2 = new deviceLight(platform2, accessory)
    device2.accessory = accessory

    alCharNames.forEach((charName) => {
      expect(tile.testCharacteristic(charName)).toBe(false)
    })
  })
})

describe('dimming one zone', () => {
  it('sends that zone\'s light segments and nothing else', async () => {
    const { device, sent } = build('H1250', { useAwsControl: true })

    await device.internalZoneBrightnessUpdate('mainLightToggle', 'main', 'Main Light', 40)

    expect(sent).toHaveLength(1)
    expect(sent[0].cmd).toBe('zoneBrightness')
    expect(sent[0].lightSegments).toEqual([16])
    expect(sent[0].value).toBe(40)
  })

  it('leaves the other zone alone', async () => {
    const { device, sent } = build('H1250', { useAwsControl: true })

    await device.internalZoneBrightnessUpdate('backgroundLightToggle', 'background', 'Background Light', 40)

    expect(sent[0].lightSegments).toHaveLength(16)
    expect(sent[0].lightSegments).not.toContain(16)
  })

  it('does not resend a value the zone already has', async () => {
    const { device, sent } = build('H1250', { useAwsControl: true })

    await device.internalZoneBrightnessUpdate('mainLightToggle', 'main', 'Main Light', 40)
    await device.internalZoneBrightnessUpdate('mainLightToggle', 'main', 'Main Light', 40)

    expect(sent).toHaveLength(1)
  })

  it('puts the tile back where it was when the command fails', async () => {
    const { device } = build('H1250', { useAwsControl: true })
    device.zoneBrightCache.mainLightToggle = 25
    device.platform.sendDeviceUpdate = async () => {
      throw new Error('no response')
    }

    await expect(device.internalZoneBrightnessUpdate('mainLightToggle', 'main', 'Main Light', 80))
      .rejects
      .toThrow()
    await new Promise((resolve) => {
      setTimeout(resolve, 2100)
    })

    expect(device.zoneServices.mainLightToggle.getCharacteristic('Brightness').value).toBe(25)
  })
})

describe('colouring one zone', () => {
  it('converts hue and the tile\'s own saturation into rgb', async () => {
    const { device, sent } = build('H1250', { useAwsControl: true })
    device.zoneServices.mainLightToggle.updateCharacteristic('Saturation', 100)

    await device.internalZoneColourUpdate('mainLightToggle', 'main', 'Main Light', 0)

    expect(sent).toHaveLength(1)
    expect(sent[0].cmd).toBe('zoneColour')
    expect(sent[0].lightSegments).toEqual([16])
    expect(sent[0].value).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('reads the saturation of the zone being set, not another tile\'s', async () => {
    const { device, sent } = build('H1250', { useAwsControl: true })
    device.zoneServices.backgroundLightToggle.updateCharacteristic('Saturation', 100)
    device.zoneServices.mainLightToggle.updateCharacteristic('Saturation', 0)

    await device.internalZoneColourUpdate('backgroundLightToggle', 'background', 'Background Light', 120)

    expect(sent[0].value).toEqual({ r: 0, g: 255, b: 0 })
  })

  it('does not resend a colour the zone already has', async () => {
    const { device, sent } = build('H1250', { useAwsControl: true })
    device.zoneServices.mainLightToggle.updateCharacteristic('Saturation', 100)

    await device.internalZoneColourUpdate('mainLightToggle', 'main', 'Main Light', 0)
    await device.internalZoneColourUpdate('mainLightToggle', 'main', 'Main Light', 0)

    expect(sent).toHaveLength(1)
  })
})
