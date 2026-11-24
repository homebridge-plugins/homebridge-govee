import { describe, expect, it, vi } from 'vitest'

import { extractTapToRunScenes, resolveTapToRunScenes } from './ttr-scenes.js'

const DEVICE_A = '28:95:C0:EA:F2:C4:6D:43'
const DEVICE_B = '84:63:F2:2A:D5:5A:DB:D5'
const DEVICE_C = '3F:CB:EB:1E:5A:82:79:5A'

const DREAMVIEW_CODE = 'M2ABAQAAAAAAAAAAAAAAAAAAAFM='
const MEDITATION_FRAMES = [
  'owABBQoCIgAAAAECAT8VAwAyAZU=',
  'owEA+TICAAB4AABQAACAAACAAEM=',
  'owIBAgAB/ygAAhkZAgHlegAAAes=',
  'owMBAPkyBAAAeAAyeAAA/wB7/yc=',
  'o/8AAIAAAIAAAAIAAf8AAAAAAKA=',
  'MwUEkgEAAAAAAAAAAAAAAAAAAKE=',
]

const sampleComponents = [
  {
    type: 1,
    name: 'Default',
    oneClicks: [
      {
        name: 'DreamView Test',
        iotRules: [
          {
            deviceObj: { device: DEVICE_A, sku: 'R707A', name: 'Permanent Lights Prism' },
            rule: [
              {
                cmdType: 15,
                cmdVal: '{"feastId":2341305,"open":1}',
                iotMsg: JSON.stringify({
                  msg: {
                    cmd: 'ptReal',
                    data: {
                      command: [DREAMVIEW_CODE],
                    },
                  },
                }),
              },
              {
                cmdType: 0,
                cmdVal: '{"open":1}',
                iotMsg: JSON.stringify({
                  msg: {
                    cmd: 'turn',
                    data: { val: 1 },
                  },
                }),
              },
            ],
          },
        ],
      },
      {
        name: 'Power Only',
        iotRules: [
          {
            deviceObj: { device: DEVICE_A, sku: 'R707A', name: 'Permanent Lights Prism' },
            rule: [
              {
                cmdType: 0,
                cmdVal: '{"open":1}',
                iotMsg: JSON.stringify({
                  msg: {
                    cmd: 'turn',
                    data: { val: 1 },
                  },
                }),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    type: 1,
    name: 'Daily',
    oneClicks: [
      {
        name: 'Meditation',
        execRules: [
          {
            devices: [
              {
                device: DEVICE_B,
                sku: 'H607C',
                deviceName: 'Floor Lamp 1',
                rule: {
                  effectCommand: JSON.stringify({
                    cmd: 'ptReal',
                    data: { command: MEDITATION_FRAMES },
                  }),
                },
              },
              {
                device: DEVICE_C,
                sku: 'H607C',
                deviceName: 'Floor Lamp 2',
                rule: {
                  effectCommand: JSON.stringify({
                    cmd: 'ptReal',
                    data: { command: MEDITATION_FRAMES },
                  }),
                },
              },
            ],
          },
        ],
      },
    ],
  },
]

describe('extractTapToRunScenes', () => {
  it('extracts ptReal rules per exact deviceId, skipping non-ptReal turn rules', () => {
    const byDevice = extractTapToRunScenes(sampleComponents)

    expect(byDevice.get(DEVICE_A)).toEqual([
      { name: 'DreamView Test', ptReal: DREAMVIEW_CODE },
    ])
    expect(byDevice.get(DEVICE_B)).toEqual([
      {
        name: 'Meditation',
        ptReal: MEDITATION_FRAMES.join(','),
      },
    ])
    expect(byDevice.get(DEVICE_C)).toEqual([
      {
        name: 'Meditation',
        ptReal: MEDITATION_FRAMES.join(','),
      },
    ])
  })

  it('filters strictly to allowedDeviceIds without bleeding across duplicate SKUs', () => {
    const byDevice = extractTapToRunScenes(sampleComponents, [DEVICE_B])

    expect(Array.from(byDevice.keys())).toEqual([DEVICE_B])
    expect(byDevice.has(DEVICE_C)).toBe(false)
    expect(byDevice.has(DEVICE_A)).toBe(false)
  })

  it('prefers user-created iotRules over preset execRules when both share a name', () => {
    const customCode = 'MwUEkgEAAAAAAAAAAAAAAAAAAKE='
    const components = [
      {
        oneClicks: [
          {
            name: 'Meditation',
            execRules: [
              {
                devices: [
                  {
                    device: DEVICE_B,
                    sku: 'H607C',
                    deviceName: 'Floor Lamp 1',
                    rule: {
                      effectCommand: JSON.stringify({
                        cmd: 'ptReal',
                        data: { command: MEDITATION_FRAMES },
                      }),
                    },
                  },
                ],
              },
            ],
          },
          {
            name: 'Meditation',
            iotRules: [
              {
                deviceObj: { device: DEVICE_B, sku: 'H607C', name: 'Floor Lamp 1' },
                rule: [
                  {
                    iotMsg: JSON.stringify({
                      msg: {
                        cmd: 'ptReal',
                        data: {
                          command: [customCode],
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

    expect(extractTapToRunScenes(components).get(DEVICE_B)).toEqual([
      { name: 'Meditation', ptReal: customCode },
    ])
  })

  it('returns an empty map for malformed input and normalizes deviceId case, names, and precedence', () => {
    expect(extractTapToRunScenes(null).size).toBe(0)
    expect(extractTapToRunScenes([]).size).toBe(0)

    const userFirst = [
      {
        oneClicks: [
          {
            name: '  Custom  ',
            iotRules: [
              {
                deviceObj: {
                  device: DEVICE_B.toLowerCase(),
                  sku: 'H607C',
                  name: 'Floor Lamp 1',
                },
                rule: [
                  {
                    iotMsg: JSON.stringify({
                      msg: {
                        cmd: 'ptReal',
                        data: {
                          command: [DREAMVIEW_CODE],
                        },
                      },
                    }),
                  },
                  {
                    iotMsg: JSON.stringify({
                      msg: {
                        cmd: 'ptReal',
                        data: {
                          command: ['MwUEkgEAAAAAAAAAAAAAAAAAAKE='],
                        },
                      },
                    }),
                  },
                ],
              },
            ],
          },
          {
            name: 'Custom',
            execRules: [
              {
                devices: [
                  {
                    device: DEVICE_B,
                    sku: 'H607C',
                    deviceName: 'Floor Lamp 1',
                    rule: {
                      effectCommand: JSON.stringify({
                        cmd: 'ptReal',
                        data: { command: MEDITATION_FRAMES },
                      }),
                    },
                  },
                ],
              },
            ],
          },
          {
            name: '   ',
            iotRules: [
              {
                deviceObj: { device: DEVICE_B, sku: 'H607C', name: 'Floor Lamp 1' },
                rule: [
                  {
                    iotMsg: JSON.stringify({
                      msg: {
                        cmd: 'ptReal',
                        data: {
                          command: [DREAMVIEW_CODE],
                        },
                      },
                    }),
                  },
                ],
              },
            ],
          },
          {
            name: 'BadFrames',
            iotRules: [
              {
                deviceObj: { device: DEVICE_B, sku: 'H607C', name: 'Floor Lamp 1' },
                rule: [
                  {
                    iotMsg: JSON.stringify({
                      msg: {
                        cmd: 'ptReal',
                        data: {
                          command: ['', ''],
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

    const extracted = extractTapToRunScenes(userFirst, [DEVICE_B])
    expect(extracted.get(DEVICE_B)).toEqual([
      { name: 'Custom', ptReal: DREAMVIEW_CODE },
    ])
  })
})

describe('resolveTapToRunScenes', () => {
  it('returns empty immediately when deviceIds is empty', async () => {
    const fetchTapToRuns = vi.fn(async () => sampleComponents)
    const res = await resolveTapToRunScenes({ deviceIds: [], fetchTapToRuns })
    expect(fetchTapToRuns).not.toHaveBeenCalled()
    expect(res.scenesByDevice.size).toBe(0)
    expect(res.fetched).toBe(false)
  })

  it('fetches once, writes per-device caches, and returns raw components for log reuse', async () => {
    const store = new Map()
    const fetchTapToRuns = vi.fn(async () => sampleComponents)
    const readCache = vi.fn(async key => store.get(key))

    const result = await resolveTapToRunScenes({
      deviceIds: [DEVICE_A, DEVICE_A, DEVICE_B],
      fetchTapToRuns,
      readCache,
      writeCache: async (key, value) => store.set(key, value),
    })

    expect(fetchTapToRuns).toHaveBeenCalledTimes(1)
    expect(readCache).not.toHaveBeenCalled()
    expect(result.fetched).toBe(true)
    expect(result.components).toBe(sampleComponents)
    expect(result.scenesByDevice.get(DEVICE_A)).toEqual([
      { name: 'DreamView Test', ptReal: DREAMVIEW_CODE },
    ])
    expect(store.get('Govee_TapToRunScenes_v1_28_95_C0_EA_F2_C4_6D_43')).toEqual([
      { name: 'DreamView Test', ptReal: DREAMVIEW_CODE },
    ])
  })

  it('preserves disk cache when fetchTapToRuns returns a malformed non-array or invalid-element response', async () => {
    const key = 'Govee_TapToRunScenes_v1_28_95_C0_EA_F2_C4_6D_43'
    const store = new Map([
      [
        key,
        [
          { name: 'DreamView Test', ptReal: DREAMVIEW_CODE },
        ],
      ],
    ])
    const writeCache = vi.fn(async (k, v) => store.set(k, v))

    for (const badResponse of [
      { unexpected: true },
      [
        { oneClicks: {} },
      ],
    ]) {
      const result = await resolveTapToRunScenes({
        deviceIds: [
          DEVICE_A.toLowerCase(),
        ],
        fetchTapToRuns: async () => badResponse,
        readCache: async k => store.get(k),
        writeCache,
      })

      expect(result.fetched).toBe(false)
      expect(result.fetchError).toBeInstanceOf(Error)
      expect(writeCache).not.toHaveBeenCalled()
      expect(result.scenesByDevice.get(DEVICE_A.toLowerCase())).toEqual([
        { name: 'DreamView Test', ptReal: DREAMVIEW_CODE },
      ])
    }
  })

  it('clears stale cache when fetch succeeds and a device no longer has Tap-to-Runs', async () => {
    const key = 'Govee_TapToRunScenes_v1_28_95_C0_EA_F2_C4_6D_43'
    const store = new Map([
      [
        key,
        [
          { name: 'Old', ptReal: DREAMVIEW_CODE },
        ],
      ],
    ])

    const result = await resolveTapToRunScenes({
      deviceIds: [DEVICE_A],
      fetchTapToRuns: async () => [],
      readCache: async k => store.get(k),
      writeCache: async (k, v) => store.set(k, v),
    })

    expect(result.scenesByDevice.size).toBe(0)
    expect(store.get(key)).toEqual([])
  })

  it('falls back to disk cache per device, warns per uncached device, and handles offline/no-fetcher & cache errors', async () => {
    const keyA = 'Govee_TapToRunScenes_v1_28_95_C0_EA_F2_C4_6D_43'
    const keyC = 'Govee_TapToRunScenes_v1_3F_CB_EB_1E_5A_82_79_5A'
    const store = new Map([
      [
        keyA,
        [
          { name: 'DreamView Test', ptReal: DREAMVIEW_CODE },
          { name: 'Corrupt', ptReal: 'not!!base64' },
          { name: '', ptReal: DREAMVIEW_CODE },
          null,
        ],
      ],
      [keyC, []],
    ])
    const warnings = []
    const debugWarnings = []

    const mixed = await resolveTapToRunScenes({
      deviceIds: [DEVICE_A, DEVICE_B, DEVICE_C],
      deviceNames: new Map([
        [DEVICE_B, 'Floor Lamp 1'],
      ]),
      fetchTapToRuns: async () => {
        throw new Error('network down')
      },
      readCache: async k => store.get(k),
      onDebugWarn: msg => debugWarnings.push(msg),
      onWarn: msg => warnings.push(msg),
    })

    expect(mixed.fetched).toBe(false)
    expect(mixed.warned).toBe(true)
    expect(mixed.scenesByDevice.get(DEVICE_A)).toEqual([
      { name: 'DreamView Test', ptReal: DREAMVIEW_CODE },
    ])
    expect(mixed.scenesByDevice.has(DEVICE_B)).toBe(false)
    expect(mixed.scenesByDevice.has(DEVICE_C)).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Floor Lamp 1')
    expect(warnings[0]).not.toContain(DEVICE_B)

    const offlineWarnings = []
    const offlineDebug = []
    await resolveTapToRunScenes({
      deviceIds: [DEVICE_B],
      readCache: async () => {
        throw new Error('disk fail')
      },
      onDebugWarn: msg => offlineDebug.push(msg),
      onWarn: msg => offlineWarnings.push(msg),
    })
    expect(offlineDebug).toHaveLength(1)
    expect(offlineWarnings).toHaveLength(1)
    expect(offlineWarnings[0]).toContain('unavailable')
  })
})
