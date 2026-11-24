import { Buffer } from 'node:buffer'

import { CMD, COLOR_SUB, PACKET_ID, PACKET_SIZE } from './ble-protocol.js'

const PAYLOAD_BYTES_PER_PACKET = 17
const CACHE_KEY_PREFIX = 'Govee_LightEffects_v1_'

// Only multi-packet `0xA3` scene types verified against real Govee Tap-to-Run
// captures and live over LAN UDP 4003 (type 2 on R707A, type 6 on H607C/H2800)
// are encoded.
const SUPPORTED_MULTI_SCENE_TYPES = new Set([2, 6])

/**
 * Pads up to 19 bytes into a 20-byte Govee BLE/ptReal frame with a trailing
 * XOR checksum, returned as base64.
 *
 * @param {number[]} bytes frame bytes before the checksum (at most 19)
 * @returns {string} base64-encoded 20-byte frame
 */
function encodeXorFrame(bytes) {
  const frame = Buffer.alloc(PACKET_SIZE, 0)
  for (let i = 0; i < Math.min(PACKET_SIZE - 1, bytes.length); i += 1) {
    frame[i] = bytes[i]
  }
  let checksum = 0
  for (let i = 0; i < PACKET_SIZE - 1; i += 1) {
    checksum ^= frame[i]
  }
  frame[PACKET_SIZE - 1] = checksum
  return frame.toString('base64')
}

/**
 * Applies a model-specific override from `effect.specialEffect` when one
 * matches `sku`, matching Govee's app behaviour.
 *
 * @param {object} effect a `lightEffects[0]` entry from Govee's scene library
 * @param {string} [sku] the target device model SKU
 * @returns {object|null} resolved effect object
 */
function resolveEffectForSku(effect, sku) {
  if (!effect || typeof effect !== 'object') {
    return null
  }
  if (sku && Array.isArray(effect.specialEffect)) {
    const override = effect.specialEffect.find((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false
      }
      if (Array.isArray(entry.supportSku)) {
        return entry.supportSku.includes(sku)
      }
      if (typeof entry.supportSku === 'string') {
        return entry.supportSku.split(',').map(s => s.trim()).includes(sku)
      }
      return false
    })
    if (override) {
      return {
        ...effect,
        sceneCode: override.sceneCode ?? effect.sceneCode,
        scenceParam: override.scenceParam ?? effect.scenceParam,
        sceneType: override.sceneType ?? effect.sceneType,
      }
    }
  }
  return effect
}

/**
 * Encodes one entry from Govee's `appsku/v1/light-effect-libraries` endpoint
 * into the comma-separated base64 `ptReal` frame sequence that `buildSceneCommand`
 * sends over LAN UDP (with AWS fallback).
 *
 * Multi-packet effects are chunked into 17-byte slices inside `0xA3` frames
 * (`seq = 0x00, 0x01, ..., 0xFF` for the final chunk), followed by the
 * `33 05 04 <lo> <hi>` scene activation frame.
 *
 * - `sceneType === 2` payloads (e.g. R707A, H6076) start at the layer count,
 *   so the stream header is `[0x01, numPackets, 0x02]`. Even when `scenceParam`
 *   is 14 bytes or less, Govee's app sends two `0xA3` packets (`0x00` with the
 *   data and an empty `0xFF` terminator).
 * - `sceneType === 6` payloads (e.g. H2800, H607C) already begin with their
 *   `0x0A` mode header, so the stream header is `[0x01, numPackets]` (following
 *   the same two-packet minimum as `sceneType === 2` when `scenceParam` is 15
 *   bytes or less). Payloads without a leading `0x0A` byte return `null`.
 * - Code-only effects (empty `scenceParam`) are allowed only when `sceneType === 0`.
 * - Unverified `sceneType` values and entries missing a valid `sceneCode`
 *   activation id return `null` rather than guessing wire frames.
 *
 * @param {object} effect a `lightEffects[0]` entry from Govee's scene library
 * @param {string} [sku] optional device SKU for `specialEffect` overrides
 * @returns {string|null} comma-separated base64 `ptReal` frames, or null
 */
export function encodeLightEffectPtReal(effect, sku) {
  const resolved = resolveEffectForSku(effect, sku)
  if (!resolved) {
    return null
  }

  const rawCode = resolved.sceneCode
  const sceneCode = typeof rawCode === 'number'
    ? rawCode
    : (typeof rawCode === 'string' && /^\d+$/.test(rawCode.trim())
        ? Number(rawCode.trim())
        : Number.NaN)
  const hasValidSceneCode = Number.isInteger(sceneCode) && sceneCode > 0 && sceneCode <= 0xFFFF
  if (!hasValidSceneCode) {
    return null
  }

  if (resolved.scenceParam != null && typeof resolved.scenceParam !== 'string') {
    return null
  }

  const frames = []
  const rawParam = typeof resolved.scenceParam === 'string'
    ? resolved.scenceParam.trim()
    : ''

  if (rawParam) {
    if (!SUPPORTED_MULTI_SCENE_TYPES.has(resolved.sceneType)) {
      return null
    }
    if (
      rawParam.length % 4 === 1
      || !/^[A-Z0-9+/]+={0,2}$/i.test(rawParam)
      || (rawParam.includes('=') && rawParam.length % 4 !== 0)
    ) {
      return null
    }
    const paramBytes = Buffer.from(rawParam, 'base64')
    if (paramBytes.length === 0) {
      return null
    }
    if (resolved.sceneType === 6 && paramBytes[0] !== 0x0A) {
      return null
    }
    const prefix = resolved.sceneType === 6
      ? []
      : [resolved.sceneType]
    const totalStreamLen = 2 + prefix.length + paramBytes.length
    // Follow Govee's two-packet 0xA3 floor (0x00 + 0xFF terminator; observed on
    // type 2 captures and extrapolated to type 6)
    const numPackets = Math.max(2, Math.ceil(totalStreamLen / PAYLOAD_BYTES_PER_PACKET))
    if (numPackets > 0xFF) {
      return null
    }
    const stream = Buffer.concat([
      Buffer.from([0x01, numPackets, ...prefix]),
      paramBytes,
    ])
    for (let i = 0; i < numPackets; i += 1) {
      const chunk = stream.subarray(
        i * PAYLOAD_BYTES_PER_PACKET,
        (i + 1) * PAYLOAD_BYTES_PER_PACKET,
      )
      const seq = i === numPackets - 1
        ? 0xFF
        : i
      frames.push(encodeXorFrame([PACKET_ID.SCENE_MULTI, seq, ...chunk]))
    }
  } else if (resolved.sceneType !== 0) {
    return null
  }

  frames.push(encodeXorFrame([
    PACKET_ID.COMMAND,
    CMD.COLOR_MODE,
    COLOR_SUB.SCENE_PRESET,
    sceneCode & 0xFF,
    (sceneCode >> 8) & 0xFF,
  ]))

  return frames.join(',')
}

/**
 * Extracts deduplicated, LAN-playable scenes from Govee's
 * `appsku/v1/light-effect-libraries` categories list, using the first effect
 * per scene (matching Govee's app) and applying any `specialEffect` override
 * for `sku`.
 *
 * @param {Array} categories the `data.categories` array from Govee
 * @param {string} [sku] optional device SKU for `specialEffect` overrides
 * @returns {Array<{ name: string, ptReal: string }>} deduplicated LAN-playable scenes
 */
export function extractLightEffectScenes(categories, sku) {
  if (!Array.isArray(categories)) {
    return []
  }

  const seen = new Set()
  const scenes = []

  categories.forEach((category) => {
    const list = Array.isArray(category?.scenes)
      ? category.scenes
      : []
    list.forEach((scene) => {
      const name = typeof scene?.sceneName === 'string'
        ? scene.sceneName.trim()
        : ''
      if (!name || seen.has(name)) {
        return
      }
      const firstEffect = Array.isArray(scene?.lightEffects)
        ? scene.lightEffects[0]
        : null
      const ptReal = encodeLightEffectPtReal(firstEffect, sku)
      if (ptReal) {
        seen.add(name)
        scenes.push({ name, ptReal })
      }
    })
  })

  return scenes
}

function sanitizeCachedScenes(cached) {
  if (!Array.isArray(cached)) {
    return []
  }
  return cached.filter(
    item => item
      && typeof item.name === 'string'
      && item.name.trim().length > 0
      && typeof item.ptReal === 'string'
      && item.ptReal.trim().length > 0,
  )
}

/**
 * Loads LAN-playable scene lists for a set of unique SKUs concurrently, with
 * versioned on-disk cache fallback so a transient HTTP outage or offline boot
 * never drops a paired Scene Selector accessory.
 *
 * @param {object} opts loader dependencies
 * @param {Iterable<string>} opts.skus unique model SKUs to resolve
 * @param {(sku: string) => Promise<Array>} [opts.fetchCategories] HTTP fetcher
 * @param {(key: string) => Promise<any>} [opts.readCache] disk cache reader
 * @param {(key: string, value: any) => Promise<void>} [opts.writeCache] disk cache writer
 * @param {(message: string) => void} [opts.onDebugWarn] debug warning sink
 * @param {(message: string) => void} [opts.onWarn] user-visible warning sink when fetch fails and nothing is cached
 * @returns {Promise<Map<string, Array<{ name: string, ptReal: string }>>>} resolved scenes keyed by SKU
 */
export async function resolveLanLightScenes({
  skus,
  fetchCategories,
  readCache,
  writeCache,
  onDebugWarn,
  onWarn,
}) {
  const uniqueSkus = Array.from(new Set(skus))
  const scenesBySku = new Map()
  if (uniqueSkus.length === 0) {
    return scenesBySku
  }

  await Promise.allSettled(uniqueSkus.map(async (sku) => {
    const safeSku = String(sku).replace(/[^\w-]/g, '_')
    const cacheKey = `${CACHE_KEY_PREFIX}${safeSku}`
    let scenes = []
    let fetchError

    if (fetchCategories) {
      try {
        const categories = await fetchCategories(sku)
        scenes = extractLightEffectScenes(categories, sku)
        if (scenes.length > 0 && writeCache) {
          try {
            await writeCache(cacheKey, scenes)
          } catch (cacheErr) {
            onDebugWarn?.(`could not cache light effects for ${sku}: ${cacheErr?.message || cacheErr}`)
          }
        }
      } catch (err) {
        fetchError = err?.message || String(err)
        onDebugWarn?.(`could not retrieve light effects for ${sku}: ${fetchError}`)
      }
    }

    if (scenes.length === 0 && readCache) {
      try {
        const cached = await readCache(cacheKey)
        scenes = sanitizeCachedScenes(cached)
      } catch (cacheErr) {
        onDebugWarn?.(`could not read cached light effects for ${sku}: ${cacheErr?.message || cacheErr}`)
      }
    }

    if (scenes.length > 0) {
      scenesBySku.set(sku, scenes)
    } else if (fetchError) {
      onWarn?.(`could not retrieve light effects for ${sku} (${fetchError}) and no cached scenes are available`)
    }
  }))

  return scenesBySku
}
