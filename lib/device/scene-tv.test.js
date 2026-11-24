import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceSceneTv, {
  assignStableSceneIdentifiers,
  MAX_SCENE_OPTIONS,
  sceneSelectorOptions,
} from './scene-tv.js'

/**
 * The scene selector (#1360): a television accessory whose input list is the
 * device's own scene list from the official API, so one dropdown replaces a
 * pile of on/off switches. What matters here is that the gate only opens when
 * the selector can actually work, that the inputs mirror the cloud's list,
 * and that choosing one sends that scene's value back exactly as listed.
 */

const OPTIONS = [
  {
    name: 'Rainbow',
    value: { id: 17936, paramId: 28098 },
  },
  {
    name: 'Aurora',
    value: { id: 17937, paramId: 28099 },
  },
  {
    name: 'Sunset',
    value: { id: 17772, paramId: 27934 },
  },
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
  const SNAPSHOTS = [
    { name: 'WW Evening', value: 4126291 },
  ]
  const device = {
    openApiInfo: {
      byInstance: {
        lightScene: {
          parameters: { options: OPTIONS },
        },
        snapshot: {
          parameters: { options: SNAPSHOTS },
        },
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
    const bare = {
      openApiInfo: {
        byInstance: {
          lightScene: {
            parameters: { options: [] },
          },
        },
      },
    }
    expect(sceneSelectorOptions(bare, { sceneSelector: true })).toBeNull()
    expect(sceneSelectorOptions({}, { sceneSelector: true })).toBeNull()
  })

  it('puts the snapshots before the scenes when their source is ticked, each remembering its instance', () => {
    const merged = sceneSelectorOptions(device, { sceneSelector: true, sceneSelectorSnapshots: true })

    expect(merged).toHaveLength(4)
    expect(merged.at(0)).toEqual({
      name: 'WW Evening',
      value: 4126291,
      instance: 'snapshot',
      capabilityType: 'devices.capabilities.dynamic_scene',
    })
  })

  it('groups the dropdown snapshots first, then diy, then scenes, name-sorted within each group (#1360)', () => {
    // The cloud lists each source in its own arbitrary order, different per
    // device - the selector imposes one uniform order instead
    const messy = {
      openApiInfo: {
        byInstance: {
          lightScene: {
            parameters: { options: OPTIONS },
          },
          diyScene: {
            parameters: {
              options: [
                { name: 'My Fade', value: 9 },
                { name: 'Alarm', value: 8 },
              ],
            },
          },
          snapshot: {
            parameters: {
              options: [
                { name: 'WW Evening', value: 4126291 },
                { name: 'Day', value: 4126299 },
              ],
            },
          },
        },
      },
    }

    const merged = sceneSelectorOptions(messy, { sceneSelector: true, sceneSelectorSnapshots: true, sceneSelectorDiy: true })

    expect(merged.map(option => option.name))
      .toEqual([
        'Day',
        'WW Evening',
        'Alarm',
        'My Fade',
        'Aurora',
        'Rainbow',
        'Sunset',
      ])
  })

  it('caps the list at 97 so the accessory stays within HAP\'s 100-service limit, dropping stock scenes not personal ones (#1362)', () => {
    // Some devices list hundreds of stock scenes; the accessory information
    // and television services, plus the protocol information service HAP
    // adds on publish, leave room for only 97 inputs before HAP throws and
    // the whole selector fails to appear
    const crowded = {
      openApiInfo: {
        byInstance: {
          lightScene: {
            parameters: {
              options: Array.from({ length: 150 }, (_, i) => ({ name: `Scene ${String(i).padStart(3, '0')}`, value: i })),
            },
          },
          diyScene: {
            parameters: {
              options: [
                { name: 'My Fade', value: 9 },
              ],
            },
          },
          snapshot: {
            parameters: {
              options: [
                { name: 'WW Evening', value: 4126291 },
              ],
            },
          },
        },
      },
    }
    const capped = []

    const merged = sceneSelectorOptions(crowded, { sceneSelector: true, sceneSelectorSnapshots: true, sceneSelectorDiy: true }, (kept, total) => capped.push([kept, total]))

    expect(merged).toHaveLength(97)
    expect(merged[0].name).toBe('WW Evening')
    expect(merged[1].name).toBe('My Fade')
    expect(capped).toEqual([
      [97, 152],
    ])
  })

  it('leaves room for every service the published accessory carries (#1362)', () => {
    // A light listing 116 scenes failed to appear at a cap of 98: accessory
    // information + television + the protocol information service HAP adds
    // when it publishes the external accessory made 101
    const servicesBesideInputs = ['AccessoryInformation', 'Television', 'ProtocolInformation']

    expect(MAX_SCENE_OPTIONS + servicesBesideInputs.length).toBeLessThanOrEqual(100)
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
          nightlightScene: {
            parameters: {
              options: [
                { name: 'Party', value: 1 },
              ],
            },
          },
        },
      },
    }

    const merged = sceneSelectorOptions(iceMaker, { sceneSelector: true })

    expect(merged).toEqual([
      {
        name: 'Party',
        value: 1,
        instance: 'nightlightScene',
        capabilityType: 'devices.capabilities.mode',
      },
    ])
  })

  it('offers snapshots alone when scenes are not ticked', () => {
    const merged = sceneSelectorOptions(device, { sceneSelectorSnapshots: true })

    expect(merged).toEqual([
      {
        name: 'WW Evening',
        value: 4126291,
        instance: 'snapshot',
        capabilityType: 'devices.capabilities.dynamic_scene',
      },
    ])
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
      {
        name: 'Party',
        value: 1,
        instance: 'nightlightScene',
        capabilityType: 'devices.capabilities.mode',
      },
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
      {
        name: 'WW Evening',
        value: 4126291,
        instance: 'snapshot',
        capabilityType: 'devices.capabilities.dynamic_scene',
      },
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
    const expected = Buffer.from([
      0x01,
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
      0x01,
      0x02,
      0x00,
      0x00,
      0x01,
      0x01,
      0x03,
    ]).toString('base64')
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
    const platform = makePlatform({
      sendDeviceUpdate: async () => {},
    })
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
    const frame = Buffer.from([
      0xAA,
      0x1B,
      0x01,
      0x01,
      0x64,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ])

    device.externalUpdate({
      source: 'AWS',
      state: 'on',
      commands: [
        frame.toString('base64'),
      ],
    })

    expect(device.service.getCharacteristic('Active').value).toBe(1)
  })

  it('still ignores plain machine power with no light frame', () => {
    const { device } = buildNightlight()

    device.externalUpdate({ source: 'AWS', state: 'on' })

    expect(device.service.getCharacteristic('Active').value).not.toBe(1)
  })
})

describe('lan-first ptReal scenes without an OpenAPI key', () => {
  const LAN_SCENES = [
    { name: 'Sunset', ptReal: 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=' },
    { name: 'Forest', ptReal: 'owABBAICHQADAQEAAf99A8kUFPE=,MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
  ]

  it('falls back to lanLightScenes when no OpenAPI scene list is present', () => {
    const merged = sceneSelectorOptions({ lanLightScenes: LAN_SCENES }, { sceneSelector: true })

    expect(merged).toEqual([
      {
        name: 'Forest',
        ptReal: 'owABBAICHQADAQEAAf99A8kUFPE=,MwUEZDgAAAAAAAAAAAAAAAAAAG4=',
        instance: 'lightScene',
      },
      {
        name: 'Sunset',
        ptReal: 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=',
        instance: 'lightScene',
      },
    ])
  })

  it('keeps OpenAPI lightScene when present so existing OpenAPI selectors do not renumber', () => {
    const both = {
      openApiInfo: {
        byInstance: {
          lightScene: {
            parameters: { options: OPTIONS },
          },
        },
      },
      lanLightScenes: LAN_SCENES,
    }

    const merged = sceneSelectorOptions(both, { sceneSelector: true })

    expect(merged.map(option => option.name)).toEqual(['Aurora', 'Rainbow', 'Sunset'])
    expect(merged.every(option => !option.ptReal)).toBe(true)
  })

  it('keeps OpenAPI selectors untouched even when snapshot-only or LAN is enabled', async () => {
    const snapshotOnly = {
      openApiInfo: {
        byInstance: {
          snapshot: {
            parameters: {
              options: [
                { name: 'WW Evening', value: 4126291 },
              ],
            },
          },
        },
      },
      lanLightScenes: LAN_SCENES,
    }

    const merged = sceneSelectorOptions(snapshotOnly, { sceneSelector: true, sceneSelectorSnapshots: true })
    expect(merged).toEqual([
      {
        name: 'WW Evening',
        value: 4126291,
        instance: 'snapshot',
        capabilityType: 'devices.capabilities.dynamic_scene',
      },
    ])

    // OpenAPI selector on a LAN-capable light keeps OpenAPI power routing
    const sent = []
    const platform = makePlatform({
      sendDeviceUpdate: async (_accessory, params) => {
        sent.push(params)
      },
    })
    const accessory = makeAccessory('H601F', {
      useLanControl: true,
      useOpenApiControl: true,
      sceneOptions: OPTIONS,
    })
    const device = new deviceSceneTv(platform, accessory)
    device.accessory = accessory

    await device.internalActiveUpdate(1)
    expect(sent).toEqual([
      {
        cmd: 'openApi',
        openApi: {
          instance: 'powerSwitch',
          capabilityType: 'devices.capabilities.on_off',
          value: 1,
        },
      },
    ])
  })

  it('sends ptReal scenes through rgbScene (LAN-first with AWS fallback) and power through state', async () => {
    const sent = []
    const platform = makePlatform({
      sendDeviceUpdate: async (_accessory, params) => {
        sent.push(params)
      },
    })
    const options = sceneSelectorOptions({ lanLightScenes: LAN_SCENES }, { sceneSelector: true })
    const accessory = makeAccessory('R707A', {
      useLanControl: true,
      sceneOptions: options,
    })
    const device = new deviceSceneTv(platform, accessory)
    device.accessory = accessory

    await device.internalSceneUpdate(1)
    await device.internalActiveUpdate(0)

    expect(sent).toEqual([
      {
        cmd: 'rgbScene',
        value: ['owABBAICHQADAQEAAf99A8kUFPE=,MwUEZDgAAAAAAAAAAAAAAAAAAG4='],
      },
      {
        cmd: 'state',
        value: 'off',
      },
    ])
  })

  it('offers tapToRunScenes alone or sorted above stock scenes without shifting existing IDs', async () => {
    const ttrOnly = sceneSelectorOptions({
      tapToRunScenes: [
        { name: 'Test for neon', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
      ],
    }, { sceneSelectorTapToRun: true })
    expect(ttrOnly).toEqual([
      {
        name: 'Test for neon',
        ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=',
        instance: 'tapToRun',
      },
    ])

    // Initial boot: 2 stock scenes get IDs 1 and 2
    const initialOptions = sceneSelectorOptions({ lanLightScenes: LAN_SCENES }, { sceneSelector: true })
    const { idMap: initialIds } = assignStableSceneIdentifiers(initialOptions)
    expect(initialIds).toEqual({
      'lightScene:Forest': 1,
      'lightScene:Sunset': 2,
    })

    // Next boot: user enables sceneSelectorTapToRun with a new Tap-to-Run sorted first
    const expandedOptions = sceneSelectorOptions({
      lanLightScenes: LAN_SCENES,
      tapToRunScenes: [
        { name: 'Test for neon', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
      ],
    }, { sceneSelector: true, sceneSelectorTapToRun: true })
    expect(expandedOptions.map(o => `${o.instance}:${o.name}`)).toEqual([
      'tapToRun:Test for neon',
      'lightScene:Forest',
      'lightScene:Sunset',
    ])

    // Forest stays ID 1, Sunset stays ID 2, and Test for neon takes ID 3 while DisplayOrder puts 3 first
    const sent = []
    const platform = makePlatform({
      sendDeviceUpdate: async (_accessory, params) => {
        sent.push(params)
      },
    })
    const accessory = makeAccessory('H607C', {
      useLanControl: true,
      sceneOptions: expandedOptions,
      sceneIdMap: initialIds,
    })
    const device = new deviceSceneTv(platform, accessory)
    device.accessory = accessory

    const displayOrder = Buffer.from(device.service.getCharacteristic('DisplayOrder').value, 'base64')
    expect(Array.from(displayOrder)).toEqual([
      0x01,
      0x01,
      3,
      0x00,
      0x00,
      0x01,
      0x01,
      1,
      0x00,
      0x00,
      0x01,
      0x01,
      2,
    ])

    // Writing existing ID 1 still dispatches Forest, and writing ID 3 dispatches Test for neon
    await device.internalSceneUpdate(1)
    await device.internalSceneUpdate(3)
    expect(sent).toEqual([
      {
        cmd: 'rgbScene',
        value: ['owABBAICHQADAQEAAf99A8kUFPE=,MwUEZDgAAAAAAAAAAAAAAAAAAG4='],
      },
      {
        cmd: 'rgbScene',
        value: ['M2ABAQAAAAAAAAAAAAAAAAAAAFM='],
      },
    ])
  })

  it('seeds unseeded first-upgrade boots with non-tapToRun IDs first so existing paired inputs do not shift', () => {
    const stock = Array.from({ length: 97 }, (_, i) => ({
      name: `Scene ${String(i + 1).padStart(3, '0')}`,
      ptReal: 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=',
    }))
    const merged = sceneSelectorOptions({
      lanLightScenes: stock,
      tapToRunScenes: [
        { name: 'DreamView', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
      ],
    }, { sceneSelector: true, sceneSelectorTapToRun: true })

    expect(merged).toHaveLength(97)
    expect(merged[0]).toMatchObject({ instance: 'tapToRun', name: 'DreamView' })

    const { options, idMap } = assignStableSceneIdentifiers(merged)
    expect(options[0].identifier).toBe(97)
    expect(options[1].identifier).toBe(1)
    expect(options[96].identifier).toBe(96)
    expect(idMap['lightScene:Scene 001']).toBe(1)
    expect(idMap['tapToRun:DreamView']).toBe(97)
  })

  it('retains tombstone reservations across degraded boots, avoids immediate ID reuse, and evicts oldest absent ID at 255', () => {
    const boot1 = assignStableSceneIdentifiers([
      { name: 'A', instance: 'lightScene' },
      { name: 'B', instance: 'lightScene' },
      { name: 'C', instance: 'lightScene' },
    ])
    expect(boot1.idMap).toEqual({
      'lightScene:A': 1,
      'lightScene:B': 2,
      'lightScene:C': 3,
    })

    const boot2 = assignStableSceneIdentifiers([
      { name: 'A', instance: 'lightScene' },
      { name: 'C', instance: 'lightScene' },
      { name: 'D', instance: 'tapToRun' },
    ], boot1.idMap)
    expect(boot2.options.map(o => [o.name, o.identifier])).toEqual([
      ['A', 1],
      ['C', 3],
      ['D', 4],
    ])
    expect(boot2.idMap['lightScene:B']).toBe(2)

    const boot3 = assignStableSceneIdentifiers([
      { name: 'A', instance: 'lightScene' },
      { name: 'B', instance: 'lightScene' },
      { name: 'C', instance: 'lightScene' },
      { name: 'D', instance: 'tapToRun' },
    ], boot2.idMap)
    expect(boot3.options.find(o => o.name === 'B').identifier).toBe(2)

    const fullPrev = {}
    for (let id = 1; id <= 255; id += 1) {
      fullPrev[`lightScene:Old${id}`] = id
    }
    const exhausted = assignStableSceneIdentifiers([
      { name: 'Old1', instance: 'lightScene' },
      { name: 'BrandNew', instance: 'tapToRun' },
    ], fullPrev)
    expect(exhausted.options.map(o => [o.name, o.identifier])).toEqual([
      ['Old1', 1],
      ['BrandNew', 2],
    ])
    expect(exhausted.idMap['lightScene:Old2']).toBeUndefined()
    expect(exhausted.idMap['tapToRun:BrandNew']).toBe(2)
  })

  it('handles duplicate (instance, name) entries deterministically across restarts and respects pre-assigned IDs', () => {
    const dupOptions = [
      { name: 'Party', instance: 'diyScene', value: 10 },
      { name: 'Party', instance: 'diyScene', value: 20 },
      { name: 'Party#2', instance: 'diyScene', value: 30 },
    ]
    const b1 = assignStableSceneIdentifiers(dupOptions)
    const b2 = assignStableSceneIdentifiers(dupOptions, b1.idMap)
    const b3 = assignStableSceneIdentifiers(dupOptions, b2.idMap)
    expect(b1.options.map(o => o.identifier)).toEqual([1, 2, 3])
    expect(b2.options.map(o => o.identifier)).toEqual([1, 2, 3])
    expect(b3.options.map(o => o.identifier)).toEqual([1, 2, 3])

    const platform = makePlatform({
      sendDeviceUpdate: async () => {},
    })
    const accessory = makeAccessory('H607C', {
      sceneOptions: [
        {
          name: 'Second',
          instance: 'tapToRun',
          ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=',
          identifier: 5,
        },
        {
          name: 'First',
          instance: 'lightScene',
          ptReal: 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=',
          identifier: 1,
        },
      ],
    })
    const tv = new deviceSceneTv(platform, accessory)
    const order = Array.from(Buffer.from(tv.service.getCharacteristic('DisplayOrder').value, 'base64'))
    expect(order).toEqual([
      0x01,
      0x01,
      5,
      0x00,
      0x00,
      0x01,
      0x01,
      1,
    ])
  })

  it('ignores corrupt, out-of-range, and duplicate previousIds values', () => {
    const corrupt = {
      'lightScene:A': 0,
      'lightScene:B': 256,
      'lightScene:C': -1,
      'lightScene:D': '3',
      'lightScene:E': 1.5,
      'lightScene:F': null,
      'lightScene:G': Number.NaN,
      'lightScene:H': 10,
      'lightScene:I': 10,
    }
    const opts = [
      'A',
      'B',
      'C',
      'D',
      'E',
      'F',
      'G',
      'H',
      'I',
    ].map(name => ({ name, instance: 'lightScene' }))
    const { options } = assignStableSceneIdentifiers(opts, corrupt)
    const ids = options.map(o => o.identifier)
    expect(options.find(o => o.name === 'H').identifier).toBe(10)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.every(id => Number.isInteger(id) && id >= 1 && id <= 255)).toBe(true)
    expect(assignStableSceneIdentifiers([
      { name: 'A', instance: 'lightScene' },
    ], ['bad']).options[0].identifier).toBe(1)
  })

  it('orders snapshots < diy < tapToRun < stock scenes and routes hybrid power through OpenAPI', async () => {
    const merged = sceneSelectorOptions({
      openApiInfo: {
        byInstance: {
          lightScene: {
            parameters: {
              options: [
                { name: 'A-Stock', value: 1 },
              ],
            },
          },
          diyScene: {
            parameters: {
              options: [
                { name: 'Z-Diy', value: 2 },
              ],
            },
          },
          snapshot: {
            parameters: {
              options: [
                { name: 'Z-Snap', value: 3 },
              ],
            },
          },
        },
      },
      tapToRunScenes: [
        { name: 'A-TTR', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
      ],
    }, {
      sceneSelector: true,
      sceneSelectorSnapshots: true,
      sceneSelectorDiy: true,
      sceneSelectorTapToRun: true,
    })

    expect(merged.map(o => `${o.instance}:${o.name}`)).toEqual([
      'snapshot:Z-Snap',
      'diyScene:Z-Diy',
      'tapToRun:A-TTR',
      'lightScene:A-Stock',
    ])

    const sent = []
    const platform = makePlatform({
      sendDeviceUpdate: async (_accessory, params) => {
        sent.push(params)
      },
    })
    const accessory = makeAccessory('H607C', {
      useLanControl: true,
      useOpenApiControl: true,
      sceneOptions: merged,
    })
    const tv = new deviceSceneTv(platform, accessory)
    await tv.internalActiveUpdate(1)
    await tv.internalSceneUpdate(tv.sceneOptions.find(o => o.instance === 'tapToRun').identifier)
    await tv.internalSceneUpdate(tv.sceneOptions.find(o => o.instance === 'lightScene').identifier)

    expect(sent[0].cmd).toBe('openApi')
    expect(sent[0].openApi.instance).toBe('powerSwitch')
    expect(sent[1]).toEqual({
      cmd: 'rgbScene',
      value: ['M2ABAQAAAAAAAAAAAAAAAAAAAFM='],
    })
    expect(sent[2].cmd).toBe('openApi')
    expect(sent[2].openApi.instance).toBe('lightScene')
  })
})
