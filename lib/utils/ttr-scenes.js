import { collectTapToRunRules, parseTapToRunRule } from './response-parser.js'

const CACHE_KEY_PREFIX = 'Govee_TapToRunScenes_v1_'
const BASE64_FRAME_REGEX = /^[A-Z0-9+/]+={0,2}$/i

function isValidPtRealSequence(value) {
  if (typeof value !== 'string') {
    return false
  }
  const frames = value.split(',')
  return frames.length > 0 && frames.every((raw) => {
    const frame = raw.trim()
    return frame.length > 0
      && frame.length % 4 !== 1
      && BASE64_FRAME_REGEX.test(frame)
      && (!frame.includes('=') || frame.length % 4 === 0)
  })
}

function normalizeDeviceId(deviceId) {
  return typeof deviceId === 'string'
    ? deviceId.trim().toUpperCase()
    : ''
}

/**
 * Extracts deduplicated, LAN/AWS-playable `ptReal` Tap-to-Run scenes per device
 * from Govee's `bff-app/v1/exec-plat/home` components response.
 *
 * Rules are matched strictly by normalized `deviceId` (never by SKU alone) so
 * multiple lights of the same model never receive each other's Tap-to-Run
 * rules. Non-`ptReal` rules (e.g. plain power `turn` actions) are skipped, and
 * when a user-created `iotRules` entry and a Govee preset `execRules` entry
 * share the same name for a device, the user-created entry takes precedence.
 * Only the first `ptReal` rule per Tap-to-Run name per device is kept.
 *
 * @param {Array} components the `data.components` array from `getTapToRuns()`
 * @param {Iterable<string>} [allowedDeviceIds] optional set of device IDs to include
 * @returns {Map<string, Array<{ name: string, ptReal: string }>>} scenes keyed by deviceId
 */
export function extractTapToRunScenes(components, allowedDeviceIds) {
  const scenesByDevice = new Map()
  if (!Array.isArray(components)) {
    return scenesByDevice
  }

  let allowed = null
  if (allowedDeviceIds) {
    allowed = new Map()
    for (const id of allowedDeviceIds) {
      const normalized = normalizeDeviceId(id)
      if (normalized && !allowed.has(normalized)) {
        allowed.set(normalized, id)
      }
    }
  }

  // Track per-device map of name -> { ptReal, isPreset } so user-created
  // iotRules override built-in execRules presets with the same name
  const perDevice = new Map()

  components.forEach((component) => {
    const oneClicks = Array.isArray(component?.oneClicks)
      ? component.oneClicks
      : []
    oneClicks.forEach((oneClick) => {
      const name = typeof oneClick?.name === 'string'
        ? oneClick.name.trim()
        : ''
      if (!name) {
        return
      }
      collectTapToRunRules(oneClick).forEach(({ deviceId, rule, isPreset }) => {
        const normalizedId = normalizeDeviceId(deviceId)
        if (!normalizedId) {
          return
        }
        let targetKey = normalizedId
        if (allowed) {
          if (!allowed.has(normalizedId)) {
            return
          }
          targetKey = allowed.get(normalizedId)
        }
        const { awsCode } = parseTapToRunRule(rule)
        if (!isValidPtRealSequence(awsCode)) {
          return
        }
        let entries = perDevice.get(targetKey)
        if (!entries) {
          entries = new Map()
          perDevice.set(targetKey, entries)
        }
        const existing = entries.get(name)
        if (!existing || (existing.isPreset && !isPreset)) {
          entries.set(name, {
            ptReal: awsCode,
            isPreset: Boolean(isPreset),
          })
        }
      })
    })
  })

  perDevice.forEach((entries, deviceId) => {
    const list = []
    entries.forEach(({ ptReal }, name) => {
      list.push({ name, ptReal })
    })
    if (list.length > 0) {
      scenesByDevice.set(deviceId, list)
    }
  })

  return scenesByDevice
}

function sanitizeCachedScenes(cached) {
  if (!Array.isArray(cached)) {
    return null
  }
  return cached.filter(
    item => item
      && typeof item.name === 'string'
      && item.name.trim().length > 0
      && isValidPtRealSequence(item.ptReal),
  )
}

/**
 * Loads `ptReal` Tap-to-Run scenes for a set of devices with a single
 * `getTapToRuns()` call and per-device on-disk cache fallback so a transient
 * HTTP outage or offline boot never drops a paired Scene Selector accessory.
 *
 * Only a valid array response from `fetchTapToRuns()` updates or clears
 * per-device caches. Non-array responses, thrown errors, or missing HTTP
 * clients fall back to cached scenes per device and emit `onWarn` for each
 * device that has no cached entry at all.
 *
 * @param {object} opts loader dependencies
 * @param {Iterable<string>} opts.deviceIds unique device IDs to resolve
 * @param {Map<string, string>|Record<string, string>} [opts.deviceNames] optional display names keyed by deviceId for warnings
 * @param {() => Promise<Array>} [opts.fetchTapToRuns] HTTP fetcher returning `components`
 * @param {(key: string) => Promise<any>} [opts.readCache] disk cache reader
 * @param {(key: string, value: any) => Promise<void>} [opts.writeCache] disk cache writer
 * @param {(message: string) => void} [opts.onDebugWarn] debug warning sink
 * @param {(message: string) => void} [opts.onWarn] user-visible warning sink per uncached device on failure/offline
 * @returns {Promise<{ scenesByDevice: Map<string, Array<{ name: string, ptReal: string }>>, components: Array|undefined, fetched: boolean, fetchError: any, warned: boolean }>} resolved scenes and raw components
 */
export async function resolveTapToRunScenes({
  deviceIds,
  deviceNames,
  fetchTapToRuns,
  readCache,
  writeCache,
  onDebugWarn,
  onWarn,
}) {
  const uniqueIds = Array.from(new Set(deviceIds))
  const scenesByDevice = new Map()
  if (uniqueIds.length === 0) {
    return {
      scenesByDevice,
      components: undefined,
      fetched: false,
      fetchError: undefined,
      warned: false,
    }
  }

  let components
  let extracted
  let fetched = false
  let fetchError

  if (fetchTapToRuns) {
    try {
      const response = await fetchTapToRuns()
      const validShape = Array.isArray(response) && response.every(
        comp => comp && typeof comp === 'object' && (comp.oneClicks === undefined || comp.oneClicks === null || Array.isArray(comp.oneClicks)),
      )
      if (!validShape) {
        throw new TypeError('unexpected tap-to-run response')
      }
      extracted = extractTapToRunScenes(response, uniqueIds)
      components = response
      fetched = true
    } catch (err) {
      fetchError = err
      onDebugWarn?.(`could not retrieve tap-to-run scenes: ${err?.message || String(err)}`)
    }
  }

  if (fetched) {
    await Promise.allSettled(uniqueIds.map(async (deviceId) => {
      const safeId = normalizeDeviceId(deviceId).replace(/[^\w-]/g, '_')
      const cacheKey = `${CACHE_KEY_PREFIX}${safeId}`
      const scenes = extracted.get(deviceId) || []
      if (scenes.length > 0) {
        scenesByDevice.set(deviceId, scenes)
      }
      if (writeCache) {
        try {
          await writeCache(cacheKey, scenes)
        } catch (cacheErr) {
          onDebugWarn?.(`could not cache tap-to-run scenes for ${deviceId}: ${cacheErr?.message || cacheErr}`)
        }
      }
    }))
    return {
      scenesByDevice,
      components,
      fetched,
      fetchError,
      warned: false,
    }
  }

  const uncachedIds = []
  await Promise.allSettled(uniqueIds.map(async (deviceId) => {
    const safeId = normalizeDeviceId(deviceId).replace(/[^\w-]/g, '_')
    const cacheKey = `${CACHE_KEY_PREFIX}${safeId}`
    let sanitized = null
    if (readCache) {
      try {
        const cached = await readCache(cacheKey)
        sanitized = sanitizeCachedScenes(cached)
      } catch (cacheErr) {
        onDebugWarn?.(`could not read cached tap-to-run scenes for ${deviceId}: ${cacheErr?.message || cacheErr}`)
      }
    }
    if (sanitized !== null) {
      if (sanitized.length > 0) {
        scenesByDevice.set(deviceId, sanitized)
      }
    } else {
      uncachedIds.push(deviceId)
    }
  }))

  let warned = false
  if (uncachedIds.length > 0) {
    const reason = fetchError
      ? (fetchError?.message || String(fetchError))
      : 'Govee account client is unavailable'
    uncachedIds.forEach((deviceId) => {
      if (onWarn) {
        const label = (deviceNames instanceof Map
          ? deviceNames.get(deviceId)
          : deviceNames?.[deviceId]) || deviceId
        onWarn(`could not retrieve tap-to-run scenes for ${label} (${reason}) and no cached scenes are available`)
        warned = true
      }
    })
  }

  return {
    scenesByDevice,
    components,
    fetched,
    fetchError,
    warned,
  }
}
