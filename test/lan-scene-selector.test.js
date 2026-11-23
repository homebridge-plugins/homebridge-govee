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
})
