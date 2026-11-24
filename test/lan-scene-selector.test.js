import { describe, expect, it, vi } from 'vitest'

import GoveePlatform from '../lib/platform.js'
import { makeAccessory, makePlatform } from './harness.js'

const FOREST_CATEGORIES = [
  {
    categoryName: 'Natural',
    scenes: [
      {
        sceneName: 'Forest',
        lightEffects: [
          { scenceParam: '', sceneCode: 14436, sceneType: 0 },
        ],
      },
    ],
  },
]

function makePlatformForScenes(overrides = {}) {
  const warnings = []
  const debugWarnings = []
  const added = []
  const base = makePlatform()
  return {
    warnings,
    debugWarnings,
    added,
    api: {
      ...base.api,
      hap: {
        ...base.api.hap,
        Categories: { TELEVISION: 31 },
      },
    },
    config: {},
    deviceConf: {},
    openApiClient: false,
    httpClient: {
      getLightEffects: vi.fn(async () => FOREST_CATEGORIES),
    },
    storageClientData: false,
    log: Object.assign(() => {}, {
      warn: (...args) => warnings.push(args.join(' ')),
      debugWarn: (...args) => debugWarnings.push(args.join(' ')),
    }),
    addExternalAccessory: vi.fn((device) => {
      const acc = makeAccessory(device.model, {})
      acc.UUID = `uuid-${device.device}`
      acc.displayName = device.deviceName
      added.push(acc)
      return acc
    }),
    applyAccessoryLogging: () => {},
    ...overrides,
  }
}

describe('platform LAN scene selector wiring', () => {
  it('loads no LAN scenes when an OpenAPI key is configured, even if the OpenAPI client failed to start', async () => {
    const platform = makePlatformForScenes({
      config: { apiKey: 'test-api-key', openApiDisable: false },
      openApiClient: false,
      deviceConf: {
        '28:95:C0:EA:F2:C4:6D:43': { sceneSelector: true },
      },
    })
    const devices = [
      { device: '28:95:C0:EA:F2:C4:6D:43', model: 'R707A', deviceName: 'Permanent Lights Prism' },
    ]

    await GoveePlatform.prototype.loadLanLightScenes.call(platform, devices)

    expect(platform.httpClient.getLightEffects).not.toHaveBeenCalled()
    expect(devices[0].lanLightScenes).toBeUndefined()
  })

  it('loads LAN scenes when an API key is present but OpenAPI is disabled', async () => {
    const platform = makePlatformForScenes({
      config: { apiKey: 'test-api-key', openApiDisable: true },
      openApiClient: false,
      deviceConf: {
        '28:95:C0:EA:F2:C4:6D:43': { sceneSelector: true },
      },
    })
    const devices = [
      { device: '28:95:C0:EA:F2:C4:6D:43', model: 'R707A', deviceName: 'Permanent Lights Prism' },
    ]

    await GoveePlatform.prototype.loadLanLightScenes.call(platform, devices)

    expect(platform.httpClient.getLightEffects).toHaveBeenCalledWith('R707A')
    expect(devices[0].lanLightScenes).toEqual([
      { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
    ])
  })

  it('warns when fetching the scene library fails and nothing is cached', async () => {
    const platform = makePlatformForScenes({
      config: {},
      deviceConf: {
        '28:95:C0:EA:F2:C4:6D:43': { sceneSelector: true },
      },
      httpClient: {
        getLightEffects: vi.fn(async () => {
          throw new Error('service unavailable')
        }),
      },
    })
    const devices = [
      { device: '28:95:C0:EA:F2:C4:6D:43', model: 'R707A', deviceName: 'Permanent Lights Prism' },
    ]

    await GoveePlatform.prototype.loadLanLightScenes.call(platform, devices)

    expect(devices[0].lanLightScenes).toBeUndefined()
    expect(platform.warnings.some(line => line.includes('R707A'))).toBe(true)
  })

  it('creates a LAN selector only when LAN or AWS can reach the light', () => {
    const device = {
      device: '28:95:C0:EA:F2:C4:6D:43',
      model: 'R707A',
      deviceName: 'Permanent Lights Prism',
      lanLightScenes: [
        { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
      ],
    }
    const deviceConf = { sceneSelector: true }

    // BLE-only light: neither LAN nor AWS is enabled -> no selector created
    const bleOnlyPlatform = makePlatformForScenes()
    const bleOnlyAcc = makeAccessory('R707A', {
      useLanControl: false,
      useAwsControl: false,
      useOpenApiControl: false,
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(bleOnlyPlatform, device, deviceConf, bleOnlyAcc)
    expect(bleOnlyPlatform.addExternalAccessory).not.toHaveBeenCalled()

    // LAN-only light: selector is created
    const lanPlatform = makePlatformForScenes()
    const lanAcc = makeAccessory('R707A', {
      useLanControl: true,
      useAwsControl: false,
      useOpenApiControl: false,
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(lanPlatform, device, deviceConf, lanAcc)
    expect(lanPlatform.addExternalAccessory).toHaveBeenCalledTimes(1)

    // AWS-only light: selector is created
    const awsPlatform = makePlatformForScenes()
    const awsAcc = makeAccessory('R707A', {
      useLanControl: false,
      useAwsControl: true,
      awsTopic: 'GA/topic',
      useOpenApiControl: false,
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(awsPlatform, device, deviceConf, awsAcc)
    expect(awsPlatform.addExternalAccessory).toHaveBeenCalledTimes(1)
  })

  it('copies LAN and AWS transport settings onto the companion scene selector accessory', () => {
    const platform = makePlatformForScenes()
    const device = {
      device: '28:95:C0:EA:F2:C4:6D:43',
      model: 'R707A',
      deviceName: 'Permanent Lights Prism',
      lanLightScenes: [
        { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
      ],
    }
    const mainAccessory = makeAccessory('R707A', {
      useLanControl: true,
      useAwsControl: true,
      awsTopic: 'GA/test-topic',
      useOpenApiControl: false,
    })

    GoveePlatform.prototype.initialiseSceneSelector.call(platform, device, { sceneSelector: true }, mainAccessory)

    expect(platform.added).toHaveLength(1)
    expect(platform.added[0].context).toMatchObject({
      gvDeviceId: '28:95:C0:EA:F2:C4:6D:43',
      gvModel: 'R707A',
      useLanControl: true,
      useAwsControl: true,
      awsTopic: 'GA/test-topic',
      useOpenApiControl: false,
    })
  })

  it('loads Tap-to-Run scenes per opted-in RGB device and sorts them ahead of stock scenes', async () => {
    const ttrComponents = [
      {
        oneClicks: [
          {
            name: 'DreamView Test',
            iotRules: [
              {
                deviceObj: { device: '28:95:C0:EA:F2:C4:6D:43', sku: 'R707A', name: 'Permanent Lights Prism' },
                rule: [
                  {
                    iotMsg: JSON.stringify({
                      msg: {
                        cmd: 'ptReal',
                        data: {
                          command: ['M2ABAQAAAAAAAAAAAAAAAAAAAFM='],
                        },
                      },
                    }),
                  },
                ],
              },
            ],
          },
        ],
      },
    ]
    const platform = makePlatformForScenes({
      deviceConf: {
        '28:95:C0:EA:F2:C4:6D:43': { sceneSelector: true, sceneSelectorTapToRun: true },
      },
      httpClient: {
        getLightEffects: vi.fn(async () => FOREST_CATEGORIES),
        getTapToRuns: vi.fn(async () => ttrComponents),
      },
    })
    const devices = [
      { device: '28:95:C0:EA:F2:C4:6D:43', model: 'R707A', deviceName: 'Permanent Lights Prism' },
    ]

    await GoveePlatform.prototype.loadLanLightScenes.call(platform, devices)
    const ttrResult = await GoveePlatform.prototype.loadTapToRunScenes.call(platform, devices)

    expect(ttrResult.fetched).toBe(true)
    expect(ttrResult.components).toBe(ttrComponents)
    expect(devices[0].tapToRunScenes).toEqual([
      { name: 'DreamView Test', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
    ])

    const mainAccessory = makeAccessory('R707A', {
      useLanControl: true,
      useAwsControl: false,
      useOpenApiControl: false,
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(
      platform,
      devices[0],
      platform.deviceConf['28:95:C0:EA:F2:C4:6D:43'],
      mainAccessory,
    )

    expect(platform.added).toHaveLength(1)
    expect(platform.added[0].context.sceneOptions.map(o => `${o.instance}:${o.name}`)).toEqual([
      'tapToRun:DreamView Test',
      'lightScene:Forest',
    ])
  })

  it('keeps an OpenAPI-only light selector working even when sceneSelectorTapToRun is also enabled', () => {
    const platform = makePlatformForScenes()
    const device = {
      device: '28:95:C0:EA:F2:C4:6D:43',
      model: 'R707A',
      deviceName: 'Permanent Lights Prism',
      openApiInfo: {
        byInstance: {
          lightScene: {
            parameters: {
              options: [
                {
                  name: 'Sunrise',
                  value: { id: 1, paramId: 2 },
                },
              ],
            },
          },
        },
      },
      tapToRunScenes: [
        { name: 'DreamView Test', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
      ],
    }
    const openApiOnlyAcc = makeAccessory('R707A', {
      useLanControl: false,
      useAwsControl: false,
      useOpenApiControl: true,
    })

    GoveePlatform.prototype.initialiseSceneSelector.call(
      platform,
      device,
      { sceneSelector: true, sceneSelectorTapToRun: true },
      openApiOnlyAcc,
    )

    expect(platform.added).toHaveLength(1)
    expect(platform.added[0].context.sceneOptions.map(o => `${o.instance}:${o.name}`)).toEqual([
      'lightScene:Sunrise',
    ])
  })

  it('skips Tap-to-Run-only selector on degraded OpenAPI boots (seeded or unseeded) but publishes when OpenAPI is healthy', () => {
    const store = new Map([
      [
        'Govee_SceneSelectorIds_v1_28_95_C0_EA_F2_C4_6D_43',
        { 'lightScene:Sunrise': 1, 'tapToRun:DreamView': 2 },
      ],
    ])
    const setItem = vi.fn(async (k, v) => store.set(k, v))
    const acc = makeAccessory('R707A', {
      useLanControl: true,
      useAwsControl: false,
      useOpenApiControl: false,
    })

    // 1. Seeded map + OpenAPI client down -> skip & warn
    const seededOutage = makePlatformForScenes({
      config: { apiKey: 'test-key', openApiDisable: false },
      openApiClient: false,
      storageClientData: true,
      storageData: {
        getItem: async k => store.get(k),
        setItem,
      },
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(
      seededOutage,
      {
        device: '28:95:C0:EA:F2:C4:6D:43',
        model: 'R707A',
        deviceName: 'Permanent Lights Prism',
        tapToRunScenes: [
          { name: 'DreamView', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
        ],
        sceneIdMap: store.get('Govee_SceneSelectorIds_v1_28_95_C0_EA_F2_C4_6D_43'),
      },
      { sceneSelector: true, sceneSelectorTapToRun: true },
      acc,
    )
    expect(seededOutage.added).toHaveLength(0)
    expect(setItem).not.toHaveBeenCalled()
    expect(seededOutage.warnings.some(w => w.includes('skipping tap-to-run-only'))).toBe(true)

    // 2. Unseeded first upgrade + OpenAPI client down -> skip & do NOT persist {tapToRun: 1}
    const unseededOutage = makePlatformForScenes({
      config: { apiKey: 'test-key', openApiDisable: false },
      openApiClient: false,
      storageClientData: true,
      storageData: {
        getItem: async () => undefined,
        setItem,
      },
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(
      unseededOutage,
      {
        device: '28:95:C0:EA:F2:C4:6D:43',
        model: 'R707A',
        deviceName: 'Permanent Lights Prism',
        tapToRunScenes: [
          { name: 'DreamView', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
        ],
      },
      { sceneSelector: true, sceneSelectorTapToRun: true },
      acc,
    )
    expect(unseededOutage.added).toHaveLength(0)
    expect(setItem).not.toHaveBeenCalled()

    // 3. Healthy OpenAPI where user disabled preset scenes and has 0 snapshots -> Tap-to-Run STILL publishes
    const healthyPlatform = makePlatformForScenes({
      config: { apiKey: 'test-key', openApiDisable: false },
      openApiClient: true,
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(
      healthyPlatform,
      {
        device: '28:95:C0:EA:F2:C4:6D:43',
        model: 'R707A',
        deviceName: 'Permanent Lights Prism',
        openApiInfo: {
          byInstance: {
            snapshot: {
              parameters: { options: [] },
            },
          },
        },
        tapToRunScenes: [
          { name: 'DreamView', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
        ],
        sceneIdMap: { 'lightScene:Sunrise': 1, 'tapToRun:DreamView': 2 },
      },
      { sceneSelector: false, sceneSelectorSnapshots: true, sceneSelectorTapToRun: true },
      acc,
    )
    expect(healthyPlatform.added).toHaveLength(1)

    // 4. OpenAPI-only light with 97 stock scenes + 10 unsendable Tap-to-Runs -> keeps all 97 OpenAPI scenes, 0 cap warnings
    const openApiOnlyPlatform = makePlatformForScenes({ openApiClient: true })
    const openApiOnlyAcc = makeAccessory('R707A', {
      useLanControl: false,
      useAwsControl: false,
      useOpenApiControl: true,
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(
      openApiOnlyPlatform,
      {
        device: '28:95:C0:EA:F2:C4:6D:43',
        model: 'R707A',
        deviceName: 'Permanent Lights Prism',
        openApiInfo: {
          byInstance: {
            lightScene: {
              parameters: {
                options: Array.from({ length: 97 }, (_, i) => ({ name: `Stock ${i}`, value: i })),
              },
            },
          },
        },
        tapToRunScenes: Array.from({ length: 10 }, (_, i) => ({
          name: `TTR ${i}`,
          ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=',
        })),
      },
      { sceneSelector: true, sceneSelectorTapToRun: true },
      openApiOnlyAcc,
    )
    expect(openApiOnlyPlatform.added).toHaveLength(1)
    expect(openApiOnlyPlatform.added[0].context.sceneOptions).toHaveLength(97)
    expect(openApiOnlyPlatform.warnings).toHaveLength(0)

    // 5. OpenAPI client is up, but device is missing from OpenAPI list (openApiInfo undefined) -> skip & warn
    const missingDeviceOpenApi = makePlatformForScenes({
      config: { apiKey: 'test-key', openApiDisable: false },
      openApiClient: true,
      storageClientData: true,
      storageData: {
        getItem: async () => undefined,
        setItem,
      },
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(
      missingDeviceOpenApi,
      {
        device: '28:95:C0:EA:F2:C4:6D:43',
        model: 'R707A',
        deviceName: 'Permanent Lights Prism',
        tapToRunScenes: [
          { name: 'DreamView', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
        ],
      },
      { sceneSelector: true, sceneSelectorTapToRun: true },
      acc,
    )
    expect(missingDeviceOpenApi.added).toHaveLength(0)
    expect(setItem).not.toHaveBeenCalled()
    expect(missingDeviceOpenApi.warnings.some(w => w.includes('skipping tap-to-run-only'))).toBe(true)

    // 6. No API key, sceneSelector is on, and LAN scenes failed with nothing cached -> skip & warn (unseeded + seeded)
    const missingLanUnseeded = makePlatformForScenes({
      config: {},
      storageClientData: true,
      storageData: {
        getItem: async () => undefined,
        setItem,
      },
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(
      missingLanUnseeded,
      {
        device: '28:95:C0:EA:F2:C4:6D:43',
        model: 'R707A',
        deviceName: 'Permanent Lights Prism',
        tapToRunScenes: [
          { name: 'DreamView', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
        ],
      },
      { sceneSelector: true, sceneSelectorTapToRun: true },
      acc,
    )
    expect(missingLanUnseeded.added).toHaveLength(0)
    expect(setItem).not.toHaveBeenCalled()
    expect(missingLanUnseeded.warnings.some(w => w.includes('LAN scenes are unavailable'))).toBe(true)

    // 7. No API key, sceneSelector is OFF (Tap-to-Run only) -> publishes cleanly
    const ttrOnlyNoKey = makePlatformForScenes({ config: {} })
    GoveePlatform.prototype.initialiseSceneSelector.call(
      ttrOnlyNoKey,
      {
        device: '28:95:C0:EA:F2:C4:6D:43',
        model: 'R707A',
        deviceName: 'Permanent Lights Prism',
        tapToRunScenes: [
          { name: 'DreamView', ptReal: 'M2ABAQAAAAAAAAAAAAAAAAAAAFM=' },
        ],
      },
      { sceneSelector: false, sceneSelectorTapToRun: true },
      acc,
    )
    expect(ttrOnlyNoKey.added).toHaveLength(1)
  })

  it('logs the device name (not MAC address) when Tap-to-Run fetch fails with no cache', async () => {
    const platform = makePlatformForScenes({
      deviceConf: {
        '28:95:C0:EA:F2:C4:6D:43': { sceneSelectorTapToRun: true },
      },
      httpClient: {
        getTapToRuns: vi.fn(async () => {
          throw new Error('timeout')
        }),
      },
    })
    const devices = [
      { device: '28:95:C0:EA:F2:C4:6D:43', model: 'R707A', deviceName: 'Permanent Lights Prism' },
    ]

    await GoveePlatform.prototype.loadTapToRunScenes.call(platform, devices)

    expect(platform.warnings).toHaveLength(1)
    expect(platform.warnings[0]).toContain('Permanent Lights Prism')
    expect(platform.warnings[0]).not.toContain('28:95:C0:EA:F2:C4:6D:43')
  })

  it('persists and reloads scene selector IDs across boots, skipping writes on read error or failed publish', async () => {
    const store = new Map()
    const setItem = vi.fn(async (k, v) => store.set(k, v))
    const platform = makePlatformForScenes({
      deviceConf: {
        '28:95:C0:EA:F2:C4:6D:43': { sceneSelector: true, sceneSelectorTapToRun: true },
      },
      storageClientData: true,
      storageData: {
        getItem: async k => store.get(k),
        setItem,
      },
    })
    const device = {
      device: '28:95:C0:EA:F2:C4:6D:43',
      model: 'R707A',
      deviceName: 'Permanent Lights Prism',
      lanLightScenes: [
        { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
      ],
    }
    const acc = makeAccessory('R707A', { useLanControl: true, useAwsControl: false, useOpenApiControl: false })

    // Boot 1: saves { 'lightScene:Forest': 1 }
    await GoveePlatform.prototype.loadSceneSelectorIds.call(platform, [device])
    GoveePlatform.prototype.initialiseSceneSelector.call(platform, device, { sceneSelector: true }, acc)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(store.get('Govee_SceneSelectorIds_v1_28_95_C0_EA_F2_C4_6D_43')).toEqual({
      'lightScene:Forest': 1,
    })

    // Boot 2: unchanged -> does not rewrite storage
    setItem.mockClear()
    const device2 = { ...device, sceneIdMap: undefined }
    await GoveePlatform.prototype.loadSceneSelectorIds.call(platform, [device2])
    GoveePlatform.prototype.initialiseSceneSelector.call(platform, device2, { sceneSelector: true }, acc)
    expect(setItem).not.toHaveBeenCalled()

    // Boot 3: read error -> skips write so good disk map is never overwritten
    const readFailPlatform = makePlatformForScenes({
      deviceConf: {
        '28:95:C0:EA:F2:C4:6D:43': { sceneSelector: true },
      },
      storageClientData: true,
      storageData: {
        getItem: async () => {
          throw new Error('disk busy')
        },
        setItem,
      },
    })
    const device3 = { ...device, sceneIdMap: undefined }
    await GoveePlatform.prototype.loadSceneSelectorIds.call(readFailPlatform, [device3])
    GoveePlatform.prototype.initialiseSceneSelector.call(readFailPlatform, device3, { sceneSelector: true }, acc)
    expect(setItem).not.toHaveBeenCalled()

    // Boot 4: addExternalAccessory returns null -> skips write
    const failPublishPlatform = makePlatformForScenes({
      storageClientData: true,
      storageData: {
        getItem: async () => undefined,
        setItem,
      },
      addExternalAccessory: vi.fn(() => null),
    })
    GoveePlatform.prototype.initialiseSceneSelector.call(failPublishPlatform, { ...device, sceneIdMap: undefined }, { sceneSelector: true }, acc)
    expect(setItem).not.toHaveBeenCalled()
  })

  it('ignores non-RGB devices in loadTapToRunScenes and tolerates null entries in logTapToRunCodes', async () => {
    const logs = []
    const platform = makePlatformForScenes({
      deviceConf: {
        'AA:BB:CC:DD:EE:FF:00:11': { sceneSelectorTapToRun: true },
      },
      httpClient: {
        getTapToRuns: vi.fn(async () => []),
      },
      log: Object.assign((...args) => logs.push(args.join(' ')), {
        warn: () => {},
        debugWarn: () => {},
      }),
    })
    const nonRgb = [
      { device: 'AA:BB:CC:DD:EE:FF:00:11', model: 'H5075', deviceName: 'Thermo' },
    ]
    const res = await GoveePlatform.prototype.loadTapToRunScenes.call(platform, nonRgb)
    expect(res).toBeNull()
    expect(platform.httpClient.getTapToRuns).not.toHaveBeenCalled()

    // logTapToRunCodes tolerates null components and logs both AWS and BLE codes
    expect(() => {
      GoveePlatform.prototype.logTapToRunCodes.call(platform, [
        null,
        {
          oneClicks: [
            {
              name: 'Test',
              iotRules: [
                {
                  deviceObj: { device: '28:95:C0:EA:F2:C4:6D:43', sku: 'R707A', name: 'Prism' },
                  rule: [
                    {
                      iotMsg: JSON.stringify({
                        msg: {
                          cmd: 'ptReal',
                          data: {
                            command: ['M2ABAQAAAAAAAAAAAAAAAAAAAFM='],
                          },
                        },
                      }),
                      blueMsg: JSON.stringify({ type: 'scene', modeCmd: 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=' }),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ])
    }).not.toThrow()
    expect(logs.some(line => line.includes('[AWS]') && line.includes('M2ABAQAAAAAAAAAAAAAAAAAAAFM='))).toBe(true)
    expect(logs.some(line => line.includes('[BLE]') && line.includes('MwUEkgEAAAAAAAAAAAAAAAAAAKE='))).toBe(true)
  })
})
