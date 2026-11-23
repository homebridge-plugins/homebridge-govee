import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import {
  encodeLightEffectPtReal,
  extractLightEffectScenes,
  resolveLanLightScenes,
} from './scene-encoder.js'

describe('encodeLightEffectPtReal', () => {
  it('matches Govee\'s own sceneType=2 ptReal frames byte-for-byte (Arbeit, sceneCode 2460)', () => {
    // Ground-truth frames from a real Govee tap-to-run response (see ttr-rule.test.js)
    const expected = [
      'owABAgIBHQAAAAECAf//AAAAALw=',
      'o/8A9JYC////j///AAAAAAAAAEw=',
      'MwUEnAkAAAAAAAAAAAAAAAAAAKc=',
    ]
    const rawStream = Buffer.concat([
      Buffer.from(expected[0], 'base64').subarray(2, 19),
      Buffer.from(expected[1], 'base64').subarray(2, 19),
    ])
    const scenceParam = rawStream.subarray(3, 3 + 24).toString('base64')

    expect(encodeLightEffectPtReal({
      scenceParam,
      sceneCode: 2460,
      sceneType: 2,
    })).toBe(expected.join(','))
  })

  it('encodes an R707A Prism scene (Forest, sceneCode 14436) with valid XOR checksums', () => {
    const encoded = encodeLightEffectPtReal({
      scenceParam: 'Ah0AAwEBAAH/fQPJFBQDgBQCQv+pRqomEACJAACAACAAAAABAAH/HwPJFBQD9BQDUP6IRqomev5LAAD8EAD8AA==',
      sceneCode: 14436,
      sceneType: 2,
    })
    const frames = encoded.split(',')

    expect(frames).toHaveLength(5)
    frames.forEach((b64) => {
      const buf = Buffer.from(b64, 'base64')
      expect(buf).toHaveLength(20)
      let xor = 0
      for (let i = 0; i < 19; i += 1) {
        xor ^= buf[i]
      }
      expect(buf[19]).toBe(xor)
    })
    // Last frame activates sceneCode 14436 (0x3864 -> little-endian 0x64 0x38)
    const activation = Buffer.from(frames.at(-1), 'base64')
    expect(Array.from(activation.subarray(0, 5))).toEqual([0x33, 0x05, 0x04, 0x64, 0x38])
  })

  it('sends two 0xA3 packets (0x00 + empty 0xFF terminator) when scenceParam is 14 bytes or less', () => {
    const shortParam = Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64')
    const encoded = encodeLightEffectPtReal({
      scenceParam: shortParam,
      sceneCode: 402,
      sceneType: 2,
    })
    const frames = encoded.split(',').map(frame => Buffer.from(frame, 'base64'))

    expect(frames).toHaveLength(3)
    // Packet 0: a3 00 01 02 02 <data>
    expect(Array.from(frames[0].subarray(0, 9))).toEqual([
      0xA3,
      0x00,
      0x01,
      0x02,
      0x02,
      0x01,
      0x02,
      0x03,
      0x04,
    ])
    // Packet 1: empty a3 ff terminator
    expect(Array.from(frames[1].subarray(0, 19))).toEqual([
      0xA3,
      0xFF,
      ...Array.from({ length: 17 }).fill(0),
    ])
    expect(frames[1][19]).toBe(0xA3 ^ 0xFF)
    // Packet 2: scene activation
    expect(Array.from(frames[2].subarray(0, 5))).toEqual([0x33, 0x05, 0x04, 0x92, 0x01])
  })

  it('applies a matching specialEffect override for the device SKU', () => {
    const effect = {
      scenceParam: '',
      sceneCode: 402,
      sceneType: 0,
      specialEffect: [
        {
          supportSku: ['H6076'],
          scenceParam: '',
          sceneCode: 999,
          sceneType: 0,
        },
        {
          supportSku: ['R707A'],
          scenceParam: '',
          sceneCode: 14436,
          sceneType: 0,
        },
      ],
    }

    expect(encodeLightEffectPtReal(effect, 'R707A')).toBe('MwUEZDgAAAAAAAAAAAAAAAAAAG4=')
    expect(encodeLightEffectPtReal(effect, 'H6056')).toBe('MwUEkgEAAAAAAAAAAAAAAAAAAKE=')
  })

  it('encodes a sceneCode-only effect only when sceneType is 0', () => {
    expect(encodeLightEffectPtReal({
      scenceParam: '',
      sceneCode: 402,
      sceneType: 0,
    })).toBe('MwUEkgEAAAAAAAAAAAAAAAAAAKE=')

    expect(encodeLightEffectPtReal({
      scenceParam: '',
      sceneCode: 402,
      sceneType: 2,
    })).toBeNull()
    expect(encodeLightEffectPtReal({
      scenceParam: '',
      sceneCode: 402,
      sceneType: 6,
    })).toBeNull()
  })

  it('rejects unverified sceneTypes and multi-packet entries missing a valid sceneCode', () => {
    const sampleParam = 'Ah0AAwEBAAH/fQPJFBQ='
    expect(encodeLightEffectPtReal({ scenceParam: sampleParam, sceneCode: 14436, sceneType: 3 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleParam, sceneCode: 14436, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleParam, sceneCode: 14436, sceneType: 0 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleParam, sceneCode: 0, sceneType: 2 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleParam, sceneType: 2 })).toBeNull()
  })

  it('returns null for empty or invalid effects', () => {
    expect(encodeLightEffectPtReal(null)).toBeNull()
    expect(encodeLightEffectPtReal({})).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: '', sceneCode: 0, sceneType: 0 })).toBeNull()
  })
})

describe('extractLightEffectScenes', () => {
  it('uses only the first effect per scene, applies SKU overrides, and deduplicates by name', () => {
    const categories = [
      {
        categoryName: 'Natural',
        scenes: [
          {
            sceneName: 'Forest',
            lightEffects: [
              {
                scenceParam: '',
                sceneCode: 402,
                sceneType: 0,
                specialEffect: [
                  {
                    supportSku: ['R707A'],
                    scenceParam: '',
                    sceneCode: 14436,
                    sceneType: 0,
                  },
                ],
              },
            ],
          },
          {
            // First effect is unencodable (sceneType 3) - should not fall through to second
            sceneName: 'UnsupportedFirst',
            lightEffects: [
              { scenceParam: 'Ah0AAwEB', sceneCode: 100, sceneType: 3 },
              { scenceParam: '', sceneCode: 402, sceneType: 0 },
            ],
          },
          {
            sceneName: 'Forest',
            lightEffects: [
              { scenceParam: '', sceneCode: 9999, sceneType: 0 },
            ],
          },
        ],
      },
      {
        categoryName: 'Emotion',
        scenes: [
          {
            sceneName: 'Sunset',
            lightEffects: [
              { scenceParam: '', sceneCode: 402, sceneType: 0 },
            ],
          },
        ],
      },
    ]

    expect(extractLightEffectScenes(categories, 'R707A')).toEqual([
      { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
      { name: 'Sunset', ptReal: 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=' },
    ])
  })

  it('returns an empty list for malformed input', () => {
    expect(extractLightEffectScenes(null)).toEqual([])
    expect(extractLightEffectScenes([])).toEqual([])
  })
})

describe('resolveLanLightScenes', () => {
  const forestCategory = [
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

  it('fetches unique SKUs, writes versioned cache entries, and returns resolved scenes', async () => {
    const store = new Map()
    const fetchCategories = vi.fn(async () => forestCategory)
    const result = await resolveLanLightScenes({
      skus: ['R707A', 'R707A'],
      fetchCategories,
      readCache: async key => store.get(key),
      writeCache: async (key, value) => {
        store.set(key, value)
      },
    })

    expect(fetchCategories).toHaveBeenCalledTimes(1)
    expect(result.get('R707A')).toEqual([
      { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
    ])
    expect(store.get('Govee_LightEffects_v1_R707A')).toEqual([
      { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
    ])
  })

  it('falls back to the disk cache when HTTP fails or returns an empty list, skipping invalid entries', async () => {
    const store = new Map([
      [
        'Govee_LightEffects_v1_R707A',
        [
          { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
          { name: '', ptReal: 'bad' },
          null,
        ],
      ],
      [
        'Govee_LightEffects_v1_R707A_B',
        [
          { name: 'Sunset', ptReal: 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=' },
        ],
      ],
    ])
    const debugWarnings = []
    const warnings = []

    const result = await resolveLanLightScenes({
      skus: ['R707A', 'R707A_B'],
      fetchCategories: async (sku) => {
        if (sku === 'R707A') {
          throw new Error('network down')
        }
        return []
      },
      readCache: async key => store.get(key),
      writeCache: async () => {},
      onDebugWarn: msg => debugWarnings.push(msg),
      onWarn: msg => warnings.push(msg),
    })

    expect(result.get('R707A')).toEqual([
      { name: 'Forest', ptReal: 'MwUEZDgAAAAAAAAAAAAAAAAAAG4=' },
    ])
    expect(result.get('R707A_B')).toEqual([
      { name: 'Sunset', ptReal: 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=' },
    ])
    expect(debugWarnings).toHaveLength(1)
    expect(warnings).toHaveLength(0)
  })

  it('emits a user-visible warning when fetch fails and nothing is cached', async () => {
    const warnings = []

    const result = await resolveLanLightScenes({
      skus: ['R707A'],
      fetchCategories: async () => {
        throw new Error('timeout')
      },
      readCache: async () => undefined,
      onWarn: msg => warnings.push(msg),
    })

    expect(result.size).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('R707A')
  })
})
