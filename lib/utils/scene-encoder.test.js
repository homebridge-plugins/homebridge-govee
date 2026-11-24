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

  it('matches Govee\'s own sceneType=6 ptReal frames byte-for-byte (H607C Meditation, sceneCode 402)', () => {
    // Ground-truth frames from a real H607C Meditation preset tap-to-run
    const expected = [
      'owABBQoCIgAAAAECAT8VAwAyAZU=',
      'owEA+TICAAB4AABQAACAAACAAEM=',
      'owIBAgAB/ygAAhkZAgHlegAAAes=',
      'owMBAPkyBAAAeAAyeAAA/wB7/yc=',
      'o/8AAIAAAIAAAAIAAf8AAAAAAKA=',
      'MwUEkgEAAAAAAAAAAAAAAAAAAKE=',
    ]
    const rawStream = Buffer.concat(
      expected.slice(0, 5).map(frame => Buffer.from(frame, 'base64').subarray(2, 19)),
    )
    const scenceParam = rawStream.subarray(2, 2 + 78).toString('base64')

    expect(encodeLightEffectPtReal({
      scenceParam,
      sceneCode: 402,
      sceneType: 6,
    })).toBe(expected.join(','))
  })

  it('encodes an H2800 Monitor Light Bar sceneType=6 scene (Cyber, sceneCode 33285) with valid XOR checksums', () => {
    const encoded = encodeLightEffectPtReal({
      scenceParam: 'CgIoAAAABAAB//8AxAEBAroUBAAA//8LFosA/wHo/xAA5gAA/AAAAgID/ygAAAAEAAH//wDEAQECuhQEAAD//wsWiwD/Aej/EADmAAD8AAACAAH/',
      sceneCode: 33285,
      sceneType: 6,
    })
    const frames = encoded.split(',')

    // 2 header bytes + 84 param bytes = 86 bytes -> ceil(86 / 17) = 6 A3 frames + 1 activation frame
    expect(frames).toHaveLength(7)
    const bufs = frames.map(b64 => Buffer.from(b64, 'base64'))
    bufs.forEach((buf) => {
      expect(buf).toHaveLength(20)
      let xor = 0
      for (let i = 0; i < 19; i += 1) {
        xor ^= buf[i]
      }
      expect(buf[19]).toBe(xor)
    })
    // Packet 0 starts with a3 00 01 06 0a (no extra sceneType byte before 0x0a)
    expect(Array.from(bufs[0].subarray(0, 5))).toEqual([0xA3, 0x00, 0x01, 0x06, 0x0A])
    // All 6 A3 frames have sequence numbers 0x00..0x04 and 0xFF
    expect(bufs.slice(0, 6).map(buf => buf[1])).toEqual([0x00, 0x01, 0x02, 0x03, 0x04, 0xFF])
    // Final A3 chunk holds the single trailing byte (0xFF) followed by 16 zero-pad bytes
    expect(Array.from(bufs[5].subarray(2, 19))).toEqual([
      0xFF,
      ...Array.from({ length: 16 }).fill(0),
    ])
    // Last frame activates sceneCode 33285 (0x8205 -> little-endian 0x05 0x82)
    expect(Array.from(bufs.at(-1).subarray(0, 5))).toEqual([0x33, 0x05, 0x04, 0x05, 0x82])
  })

  it('sends two 0xA3 packets (0x00 + empty 0xFF terminator) for short sceneType=6 scenceParam (<= 15 bytes)', () => {
    const shortParam = Buffer.from([0x0A, 0x01, 0x02, 0x03]).toString('base64')
    const encoded = encodeLightEffectPtReal({
      scenceParam: shortParam,
      sceneCode: 402,
      sceneType: 6,
    })
    const frames = encoded.split(',').map(frame => Buffer.from(frame, 'base64'))

    expect(frames).toHaveLength(3)
    expect(Array.from(frames[0].subarray(0, 8))).toEqual([
      0xA3,
      0x00,
      0x01,
      0x02,
      0x0A,
      0x01,
      0x02,
      0x03,
    ])
    expect(Array.from(frames[1].subarray(0, 19))).toEqual([
      0xA3,
      0xFF,
      ...Array.from({ length: 17 }).fill(0),
    ])
    expect(frames[1][19]).toBe(0xA3 ^ 0xFF)
    expect(Array.from(frames[2].subarray(0, 5))).toEqual([0x33, 0x05, 0x04, 0x92, 0x01])
  })

  it('handles exact 15/16/32/33-byte sceneType=6 and 14/15-byte sceneType=2 packet boundaries', () => {
    const makeType6 = (len, lastByte = 0x42) => {
      const buf = Buffer.alloc(len, 0x11)
      buf[0] = 0x0A
      buf[len - 1] = lastByte
      return encodeLightEffectPtReal({
        scenceParam: buf.toString('base64'),
        sceneCode: 402,
        sceneType: 6,
      }).split(',').map(f => Buffer.from(f, 'base64'))
    }

    // 15 bytes: 2 + 15 = 17 -> full packet 0x00 + empty 0xFF terminator + activation
    const t6_15 = makeType6(15, 0x77)
    expect(t6_15).toHaveLength(3)
    expect(t6_15[0][3]).toBe(2)
    expect(t6_15[0][18]).toBe(0x77)
    expect(Array.from(t6_15[1].subarray(1, 19))).toEqual([
      0xFF,
      ...Array.from({ length: 17 }).fill(0),
    ])

    // 16 bytes: 2 + 16 = 18 -> packet 0x00 full + 1 byte in packet 0xFF + activation
    const t6_16 = makeType6(16, 0x88)
    expect(t6_16).toHaveLength(3)
    expect(t6_16[0][3]).toBe(2)
    expect(t6_16[1][1]).toBe(0xFF)
    expect(t6_16[1][2]).toBe(0x88)
    expect(t6_16[1][3]).toBe(0x00)

    // 32 bytes: 2 + 32 = 34 -> 2 A3 packets; 33 bytes: 2 + 33 = 35 -> 3 A3 packets
    expect(makeType6(32)).toHaveLength(3)
    expect(makeType6(33)).toHaveLength(4)

    // sceneType=2: 14 bytes (3 + 14 = 17 -> empty 0xFF) vs 15 bytes (3 + 15 = 18 -> 1 byte in 0xFF)
    const t2_14 = encodeLightEffectPtReal({
      scenceParam: Buffer.alloc(14, 0x22).toString('base64'),
      sceneCode: 402,
      sceneType: 2,
    }).split(',').map(f => Buffer.from(f, 'base64'))
    expect(t2_14).toHaveLength(3)
    expect(t2_14[0][18]).toBe(0x22)
    expect(Array.from(t2_14[1].subarray(1, 19))).toEqual([
      0xFF,
      ...Array.from({ length: 17 }).fill(0),
    ])

    const t2_15Buf = Buffer.alloc(15, 0x22)
    t2_15Buf[14] = 0x99
    const t2_15 = encodeLightEffectPtReal({
      scenceParam: t2_15Buf.toString('base64'),
      sceneCode: 402,
      sceneType: 2,
    }).split(',').map(f => Buffer.from(f, 'base64'))
    expect(t2_15).toHaveLength(3)
    expect(t2_15[1][1]).toBe(0xFF)
    expect(t2_15[1][2]).toBe(0x99)
  })

  it('enforces the 255-packet limit for sceneType=6 (4333/4334B) and sceneType=2 (4332/4333B)', () => {
    const t6Max = Buffer.alloc(4333, 0x11)
    t6Max[0] = 0x0A
    const t6MaxFrames = encodeLightEffectPtReal({
      scenceParam: t6Max.toString('base64'),
      sceneCode: 402,
      sceneType: 6,
    }).split(',').map(f => Buffer.from(f, 'base64'))
    expect(t6MaxFrames).toHaveLength(256)
    expect(t6MaxFrames[0][3]).toBe(0xFF)
    expect(t6MaxFrames[253][1]).toBe(0xFD)
    expect(t6MaxFrames[254][1]).toBe(0xFF)

    const t6Over = Buffer.alloc(4334, 0x11)
    t6Over[0] = 0x0A
    expect(encodeLightEffectPtReal({
      scenceParam: t6Over.toString('base64'),
      sceneCode: 402,
      sceneType: 6,
    })).toBeNull()

    const t2MaxFrames = encodeLightEffectPtReal({
      scenceParam: Buffer.alloc(4332, 0x22).toString('base64'),
      sceneCode: 402,
      sceneType: 2,
    }).split(',')
    expect(t2MaxFrames).toHaveLength(256)

    expect(encodeLightEffectPtReal({
      scenceParam: Buffer.alloc(4333, 0x22).toString('base64'),
      sceneCode: 402,
      sceneType: 2,
    })).toBeNull()
  })

  it('rejects sceneType=6 payloads that do not begin with the verified 0x0A mode header', () => {
    expect(encodeLightEffectPtReal({
      scenceParam: Buffer.from([0x02, 0x01, 0x02, 0x03]).toString('base64'),
      sceneCode: 402,
      sceneType: 6,
    })).toBeNull()
    expect(encodeLightEffectPtReal({
      scenceParam: Buffer.from([0x0B, 0x01, 0x02, 0x03]).toString('base64'),
      sceneCode: 402,
      sceneType: 6,
    })).toBeNull()
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

  it('applies matching specialEffect overrides for sceneCode, scenceParam, sceneType, and string supportSku', () => {
    const type6Param = Buffer.from([0x0A, 0x01, 0x02, 0x03]).toString('base64')
    const type2Param = Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64')
    const effect = {
      scenceParam: '',
      sceneCode: 402,
      sceneType: 0,
      specialEffect: [
        null,
        {
          supportSku: 'H607C, H2800',
          scenceParam: type6Param,
          sceneCode: 33285,
          sceneType: 6,
        },
        {
          supportSku: ['R707A'],
          scenceParam: type2Param,
          sceneCode: 14436,
          sceneType: 2,
        },
      ],
    }

    // Comma-separated string supportSku overriding sceneType 0 -> 6 with a 0x0A param
    const h2800Frames = encodeLightEffectPtReal(effect, 'H2800').split(',').map(f => Buffer.from(f, 'base64'))
    expect(h2800Frames).toHaveLength(3)
    expect(Array.from(h2800Frames[0].subarray(0, 8))).toEqual([
      0xA3,
      0x00,
      0x01,
      0x02,
      0x0A,
      0x01,
      0x02,
      0x03,
    ])
    expect(Array.from(h2800Frames[2].subarray(0, 5))).toEqual([0x33, 0x05, 0x04, 0x05, 0x82])

    // Array supportSku overriding sceneType 0 -> 2 with a 0x02 prefix byte
    const r707aFrames = encodeLightEffectPtReal(effect, 'R707A').split(',').map(f => Buffer.from(f, 'base64'))
    expect(r707aFrames).toHaveLength(3)
    expect(Array.from(r707aFrames[0].subarray(0, 9))).toEqual([
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
    expect(Array.from(r707aFrames[2].subarray(0, 5))).toEqual([0x33, 0x05, 0x04, 0x64, 0x38])

    // Override clearing scenceParam to '' and sceneType to 0 does not fall back to base values
    const baseType6 = {
      scenceParam: type6Param,
      sceneCode: 33285,
      sceneType: 6,
      specialEffect: [
        {
          supportSku: ['H6056'],
          scenceParam: '',
          sceneCode: 402,
          sceneType: 0,
        },
      ],
    }
    expect(encodeLightEffectPtReal(baseType6, 'H6056')).toBe('MwUEkgEAAAAAAAAAAAAAAAAAAKE=')

    // Non-matching or omitted SKU uses base effect
    expect(encodeLightEffectPtReal(effect, 'H6056')).toBe('MwUEkgEAAAAAAAAAAAAAAAAAAKE=')
    expect(encodeLightEffectPtReal(effect)).toBe('MwUEkgEAAAAAAAAAAAAAAAAAAKE=')
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
    expect(encodeLightEffectPtReal({
      scenceParam: '   ',
      sceneCode: 402,
      sceneType: 6,
    })).toBeNull()
  })

  it('rejects unverified sceneTypes, invalid sceneCodes, and malformed scenceParam inputs', () => {
    const sampleType2Param = 'Ah0AAwEBAAH/fQPJFBQ='
    const sampleType6Param = Buffer.from([0x0A, 0x01, 0x02, 0x03]).toString('base64')

    expect(encodeLightEffectPtReal({ scenceParam: sampleType2Param, sceneCode: 14436, sceneType: 3 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType2Param, sceneCode: 14436, sceneType: 7 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType2Param, sceneCode: 14436, sceneType: 0 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType2Param, sceneCode: 0, sceneType: 2 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType2Param, sceneType: 2 })).toBeNull()

    // Valid sceneCode bounds & decimal string coercion on sceneType=6 (with valid 0x0A payload)
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: 1, sceneType: 6 })).not.toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: '402', sceneType: 6 })).not.toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: 0xFFFF, sceneType: 6 })).not.toBeNull()

    // Invalid sceneCode values on sceneType=6 (all use valid 0x0A payload so sceneCode guard is isolated)
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: 0, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: -1, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: 1.5, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: 0x10000, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: true, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({
      scenceParam: sampleType6Param,
      sceneCode: [402],
      sceneType: 6,
    })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: '0x10', sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneCode: '1e2', sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: sampleType6Param, sceneType: 6 })).toBeNull()

    // Malformed base64 and non-string scenceParam
    expect(encodeLightEffectPtReal({ scenceParam: 'ab!!cd', sceneCode: 402, sceneType: 2 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: '===', sceneCode: 402, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: '@@@@', sceneCode: 402, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: 'AAAAA', sceneCode: 402, sceneType: 6 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: 'AQ=', sceneCode: 402, sceneType: 2 })).toBeNull()
    expect(encodeLightEffectPtReal({ scenceParam: 123, sceneCode: 402, sceneType: 0 })).toBeNull()
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

  it('extracts mixed sceneType=6, sceneType=2, and sceneType=0 scenes while skipping unencodable entries', () => {
    const categories = [
      {
        categoryName: 'Natural',
        scenes: [
          {
            sceneName: 'Cyber',
            lightEffects: [
              {
                scenceParam: Buffer.from([0x0A, 0x02, 0x28, 0x00]).toString('base64'),
                sceneCode: 33285,
                sceneType: 6,
              },
            ],
          },
          {
            sceneName: 'Forest',
            lightEffects: [
              {
                scenceParam: Buffer.from([0x01, 0x02, 0x03, 0x04]).toString('base64'),
                sceneCode: 14436,
                sceneType: 2,
              },
            ],
          },
          {
            sceneName: 'Sunset Glow',
            lightEffects: [
              { scenceParam: '', sceneCode: 12, sceneType: 0 },
            ],
          },
          {
            sceneName: 'ZeroCode',
            lightEffects: [
              {
                scenceParam: Buffer.from([0x0A, 0x01, 0x02, 0x03]).toString('base64'),
                sceneCode: 0,
                sceneType: 6,
              },
            ],
          },
          {
            sceneName: 'Unsupported',
            lightEffects: [
              { scenceParam: 'Ah0AAwEB', sceneCode: 100, sceneType: 3 },
            ],
          },
        ],
      },
    ]

    const extracted = extractLightEffectScenes(categories, 'H2800')
    expect(extracted.map(s => s.name)).toEqual(['Cyber', 'Forest', 'Sunset Glow'])
    expect(extracted[0].ptReal.split(',')).toHaveLength(3)
    expect(extracted[1].ptReal.split(',')).toHaveLength(3)
    expect(extracted[2].ptReal.split(',')).toHaveLength(1)
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

  it('overwrites a stale v1 cache on online refresh and preserves it on offline boot', async () => {
    const staleH2800 = [
      {
        name: 'Night Light',
        ptReal: encodeLightEffectPtReal({ scenceParam: '', sceneCode: 1, sceneType: 0 }),
      },
      {
        name: 'Sunset Glow',
        ptReal: encodeLightEffectPtReal({ scenceParam: '', sceneCode: 12, sceneType: 0 }),
      },
    ]
    const h2800Categories = [
      {
        categoryName: 'Default',
        scenes: [
          {
            sceneName: 'Night Light',
            lightEffects: [
              { scenceParam: '', sceneCode: 1, sceneType: 0 },
            ],
          },
          {
            sceneName: 'Sunset Glow',
            lightEffects: [
              { scenceParam: '', sceneCode: 12, sceneType: 0 },
            ],
          },
          {
            sceneName: 'Cyber',
            lightEffects: [
              {
                scenceParam: Buffer.from([0x0A, 0x02, 0x28, 0x00]).toString('base64'),
                sceneCode: 33285,
                sceneType: 6,
              },
            ],
          },
        ],
      },
    ]

    // Offline boot: keeps the 2 cached v1 scenes without emitting a user-visible warning
    const offlineStore = new Map([
      ['Govee_LightEffects_v1_H2800', staleH2800],
    ])
    const offlineWarnings = []
    const offlineResult = await resolveLanLightScenes({
      skus: ['H2800'],
      fetchCategories: async () => {
        throw new Error('offline')
      },
      readCache: async key => offlineStore.get(key),
      writeCache: async (key, value) => offlineStore.set(key, value),
      onWarn: msg => offlineWarnings.push(msg),
    })
    expect(offlineResult.get('H2800')).toEqual(staleH2800)
    expect(offlineWarnings).toHaveLength(0)

    // Online refresh: replaces the stale 2-scene v1 cache with the expanded sceneType=6 list
    const onlineStore = new Map([
      ['Govee_LightEffects_v1_H2800', staleH2800],
    ])
    const onlineResult = await resolveLanLightScenes({
      skus: ['H2800'],
      fetchCategories: async () => h2800Categories,
      readCache: async key => onlineStore.get(key),
      writeCache: async (key, value) => onlineStore.set(key, value),
    })
    expect(onlineResult.get('H2800').map(s => s.name)).toEqual(['Night Light', 'Sunset Glow', 'Cyber'])
    expect(onlineStore.get('Govee_LightEffects_v1_H2800')).toEqual(onlineResult.get('H2800'))
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
