import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceSceneTv, { sceneSelectorOptions } from './scene-tv.js'

/**
 * The scene selector (#1360): a television accessory whose input list is the
 * device's own scene list from the official API, so one dropdown replaces a
 * pile of on/off switches. What matters here is that the gate only opens when
 * the selector can actually work, that the inputs mirror the cloud's list,
 * and that choosing one sends that scene's value back exactly as listed.
 */

const OPTIONS = [
  { name: 'Rainbow', value: { id: 17936, paramId: 28098 } },
  { name: 'Aurora', value: { id: 17937, paramId: 28099 } },
  { name: 'Sunset', value: { id: 17772, paramId: 27934 } },
]

function build(options = OPTIONS) {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params)
    },
  })
  const accessory = makeAccessory('H601F', { sceneOptions: options })
  const device = new deviceSceneTv(platform, accessory)
  device.accessory = accessory
  return { accessory, device, sent }
}

describe('whether a device gets a scene selector at all', () => {
  const SNAPSHOTS = [{ name: 'WW Evening', value: 4126291 }]
  const device = {
    openApiInfo: {
      byInstance: {
        lightScene: { parameters: { options: OPTIONS } },
        snapshot: { parameters: { options: SNAPSHOTS } },
      },
    },
  }

  it('offers one when the user opted in and the cloud lists scenes, name-sorted', () => {
    expect(sceneSelectorOptions(device, { sceneSelector: true }))
      .toEqual(['Aurora', 'Rainbow', 'Sunset'].map(name => ({
        ...OPTIONS.find(option => option.name === name),
        instance: 'lightScene',
        capabilityType: 'devices.capabilities.dynamic_scene',
      })))
  })

  it('offers none without the config opt-in', () => {
    expect(sceneSelectorOptions(device, {})).toBeNull()
  })

  it('offers none when the cloud lists no scenes - a dropdown that swallows taps is worse than none', () => {
    const bare = { openApiInfo: { byInstance: { lightScene: { parameters: { options: [] } } } } }
    expect(sceneSelectorOptions(bare, { sceneSelector: true })).toBeNull()
    expect(sceneSelectorOptions({}, { sceneSelector: true })).toBeNull()
  })

  it('puts the snapshots before the scenes when their source is ticked, each remembering its instance', () => {
    const merged = sceneSelectorOptions(device, { sceneSelector: true, sceneSelectorSnapshots: true })

    expect(merged).toHaveLength(4)
    expect(merged.at(0)).toEqual({ name: 'WW Evening', value: 4126291, instance: 'snapshot', capabilityType: 'devices.capabilities.dynamic_scene' })
  })

  it('groups the dropdown snapshots first, then diy, then scenes, name-sorted within each group (#1360)', () => {
    // The cloud lists each source in its own arbitrary order, different per
    // device - the selector imposes one uniform order instead
    const messy = {
      openApiInfo: {
        byInstance: {
          lightScene: { parameters: { options: OPTIONS } },
          diyScene: { parameters: { options: [{ name: 'My Fade', value: 9 }, { name: 'Alarm', value: 8 }] } },
          snapshot: { parameters: { options: [{ name: 'WW Evening', value: 4126291 }, { name: 'Day', value: 4126299 }] } },
        },
      },
    }

    const merged = sceneSelectorOptions(messy, { sceneSelector: true, sceneSelectorSnapshots: true, sceneSelectorDiy: true })

    expect(merged.map(option => option.name))
      .toEqual(['Day', 'WW Evening', 'Alarm', 'My Fade', 'Aurora', 'Rainbow', 'Sunset'])
  })

  it('caps the list at 98 so the accessory stays within HAP\'s 100-service limit, dropping stock scenes not personal ones (#1362)', () => {
    // Some devices list hundreds of stock scenes; the accessory information
    // and television services leave room for only 98 inputs before HAP
    // throws and the whole selector fails to appear
    const crowded = {
      openApiInfo: {
        byInstance: {
          lightScene: { parameters: { options: Array.from({ length: 150 }, (_, i) => ({ name: `Scene ${String(i).padStart(3, '0')}`, value: i })) } },
          diyScene: { parameters: { options: [{ name: 'My Fade', value: 9 }] } },
          snapshot: { parameters: { options: [{ name: 'WW Evening', value: 4126291 }] } },
        },
      },
    }
    const capped = []

    const merged = sceneSelectorOptions(crowded, { sceneSelector: true, sceneSelectorSnapshots: true, sceneSelectorDiy: true }, (kept, total) => capped.push([kept, total]))

    expect(merged).toHaveLength(98)
    expect(merged[0].name).toBe('WW Evening')
    expect(merged[1].name).toBe('My Fade')
    expect(capped).toEqual([[98, 152]])
  })

  it('says nothing about the cap when the list fits', () => {
    const capped = []

    const merged = sceneSelectorOptions(device, { sceneSelector: true }, (kept, total) => capped.push([kept, total]))

    expect(merged).toHaveLength(3)
    expect(capped).toEqual([])
  })

  it('reads an ice maker\'s scenes from nightlightScene, which is a mode not a dynamic scene', () => {
    // The H8120 declares its 15 night light scenes under a different
    // instance AND capability type than the lights do (#1250)
    const iceMaker = {
      openApiInfo: {
        byInstance: {
          nightlightScene: { parameters: { options: [{ name: 'Party', value: 1 }] } },
        },
      },
    }

    const merged = sceneSelectorOptions(iceMaker, { sceneSelector: true })

    expect(merged).toEqual([{ name: 'Party', value: 1, instance: 'nightlightScene', capabilityType: 'devices.capabilities.mode' }])
  })

  it('offers snapshots alone when scenes are not ticked', () => {
    const merged = sceneSelectorOptions(device, { sceneSelectorSnapshots: true })

    expect(merged).toEqual([{ name: 'WW Evening', value: 4126291, instance: 'snapshot', capabilityType: 'devices.capabilities.dynamic_scene' }])
  })
})

describe('the selector accessory', () => {
  it('offers one input per scene, in the cloud\'s order, linked to the television', () => {
    const { accessory, device } = build()

    const inputs = accessory.services.filter(service => service.type === 'InputSource')
    expect(inputs.map(service => service.displayName)).toEqual(['Rainbow', 'Aurora', 'Sunset'])
    expect(device.service.linked).toHaveLength(3)
  })

  it('sends a chosen scene\'s value back exactly as the cloud listed it', async () => {
    const { device, sent } = build()

    await device.internalSceneUpdate(2)

    expect(sent).toHaveLength(1)
    expect(sent[0].cmd).toBe('openApi')
    expect(sent[0].openApi).toEqual({
      instance: 'lightScene',
      capabilityType: 'devices.capabilities.dynamic_scene',
      value: { id: 17937, paramId: 28099 },
    })
  })

  it('sends a snapshot through its own instance, with its plain id', async () => {
    const { device, sent } = build([
      ...OPTIONS.map(option => ({ ...option, instance: 'lightScene' })),
      { name: 'WW Evening', value: 4126291, instance: 'snapshot' },
    ])

    await device.internalSceneUpdate(4)

    expect(sent[0].openApi).toEqual({
      instance: 'snapshot',
      capabilityType: 'devices.capabilities.dynamic_scene',
      value: 4126291,
    })
  })

  it('shows the tile as on after a scene is chosen, since activating one wakes the light', async () => {
    const { device } = build()

    await device.internalSceneUpdate(1)

    expect(device.service.getCharacteristic('Active').value).toBe(1)
  })

  it('sends nothing for an identifier outside the scene list', async () => {
    const { device, sent } = build()

    await device.internalSceneUpdate(99)
    await device.internalSceneUpdate(0)

    expect(sent).toEqual([])
  })

  it('drives the light\'s power from the tile\'s own toggle', async () => {
    const { device, sent } = build()

    await device.internalActiveUpdate(1)

    expect(sent).toHaveLength(1)
    expect(sent[0].openApi).toEqual({
      instance: 'powerSwitch',
      capabilityType: 'devices.capabilities.on_off',
      value: 1,
    })
  })

  it('does not resend a power state the tile already has', async () => {
    const { device, sent } = build()
    await device.internalActiveUpdate(1)

    await device.internalActiveUpdate(1)

    expect(sent).toHaveLength(1)
  })

  it('mirrors the light\'s own power state, so the dropdown is usable when the light is on', () => {
    const { device, sent } = build()

    device.externalUpdate({ source: 'AWS', state: 'on' })

    expect(device.service.getCharacteristic('Active').value).toBe(1)
    // Mirroring is not a command - nothing goes back to the device
    expect(sent).toEqual([])
  })

  it('ignores an update carrying no power state', () => {
    const { device } = build()
    device.externalUpdate({ source: 'AWS', state: 'on' })

    device.externalUpdate({ source: 'AWS', brightness: 50 })

    expect(device.service.getCharacteristic('Active').value).toBe(1)
  })
})

describe('a selector on a device with a night light', () => {
  function buildNightlight() {
    const sent = []
    const platform = makePlatform({
      sendDeviceUpdate: async (_accessory, params) => {
        sent.push(params)
      },
    })
    const accessory = makeAccessory('H8120', {
      sceneOptions: OPTIONS,
      openApiCapabilities: { nightlightToggle: {}, lightScene: {} },
    })
    const device = new deviceSceneTv(platform, accessory)
    device.accessory = accessory
    return { accessory, device, sent }
  }

  it('drives the night light from the tile toggle, never the machine', async () => {
    // On the ice makers `powerSwitch` IS the ice making - wiring the scene
    // tile's power there would start the machine
    const { device, sent } = buildNightlight()

    await device.internalActiveUpdate(1)

    expect(sent[0].openApi).toEqual({
      instance: 'nightlightToggle',
      capabilityType: 'devices.capabilities.toggle',
      value: 1,
    })
  })

  it('ignores the forwarded device power, which is the machine and not the light', () => {
    const { device } = buildNightlight()

    device.externalUpdate({ source: 'AWS', state: 'on' })

    expect(device.service.getCharacteristic('Active').value).not.toBe(1)
  })
})

describe('a night light scene selection', () => {
  it('is sent as the mode capability with its plain value', async () => {
    const { device, sent } = build([
      { name: 'Party', value: 1, instance: 'nightlightScene', capabilityType: 'devices.capabilities.mode' },
    ])

    await device.internalSceneUpdate(1)

    expect(sent[0].openApi).toEqual({
      instance: 'nightlightScene',
      capabilityType: 'devices.capabilities.mode',
      value: 1,
    })
  })
})

describe('input identity', () => {
  it('keys each input on its source and name, so a reordered or renamed list reaches a paired picker as new inputs (#1360)', () => {
    // The home app keeps its own copy of an input's name per HAP instance
    // id, and HAP derives that id from the subtype - a position-only
    // subtype would leave a re-sorted list looking unchanged in the picker
    const { accessory } = build([
      { name: 'WW Evening', value: 4126291, instance: 'snapshot', capabilityType: 'devices.capabilities.dynamic_scene' },
      ...OPTIONS.map(option => ({ ...option, instance: 'lightScene', capabilityType: 'devices.capabilities.dynamic_scene' })),
    ])

    const inputs = accessory.services.filter(service => service.type === 'InputSource')
    expect(inputs.map(service => service.subtype)).toEqual([
      'scene-1-snapshot-WW Evening',
      'scene-2-lightScene-Rainbow',
      'scene-3-lightScene-Aurora',
      'scene-4-lightScene-Sunset',
    ])
  })
})

describe('input display order', () => {
  it('tells the home app to display inputs in identifier order, which it otherwise randomises (#1360)', () => {
    const { device } = build()

    // TLV8: an identifier record (tag 1, length 1) per input, separated by
    // empty tag-0 records - identifiers 1, 2, 3 for the three scenes
    const expected = Buffer.from([0x01, 0x01, 0x01, 0x00, 0x00, 0x01, 0x01, 0x02, 0x00, 0x00, 0x01, 0x01, 0x03]).toString('base64')
    expect(device.service.getCharacteristic('DisplayOrder').value).toBe(expected)
  })
})

describe('input visibility', () => {
  it('marks every input as shown, so ones added after pairing reach the picker', () => {
    const { accessory } = build()

    const inputs = accessory.services.filter(service => service.type === 'InputSource')
    inputs.forEach((service) => {
      expect(service.getCharacteristic('CurrentVisibilityState').value).toBe(0)
      expect(service.getCharacteristic('TargetVisibilityState').value).toBe(0)
    })
  })
})

describe('mirroring on a night light device', () => {
  function buildNightlight() {
    const platform = makePlatform({ sendDeviceUpdate: async () => {} })
    const accessory = makeAccessory('H8120', {
      sceneOptions: OPTIONS,
      openApiCapabilities: { nightlightToggle: {}, nightlightScene: {} },
    })
    const device = new deviceSceneTv(platform, accessory)
    device.accessory = accessory
    return { device }
  }

  it('follows the night light frame, not the machine power', () => {
    const { device } = buildNightlight()
    // aa 1b 01 01 = night light on - the same frame the ice maker handler reads
    const frame = Buffer.from([0xAA, 0x1B, 0x01, 0x01, 0x64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

    device.externalUpdate({ source: 'AWS', state: 'on', commands: [frame.toString('base64')] })

    expect(device.service.getCharacteristic('Active').value).toBe(1)
  })

  it('still ignores plain machine power with no light frame', () => {
    const { device } = buildNightlight()

    device.externalUpdate({ source: 'AWS', state: 'on' })

    expect(device.service.getCharacteristic('Active').value).not.toBe(1)
  })
})
