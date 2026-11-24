import { Buffer } from 'node:buffer'

import { base64ToHex, getTwoItemPosition, hexToTwoItems, parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

/**
 * The selectable sources a selector can offer, each pairing a config opt-in
 * with the capability instance whose option list it contributes and the
 * capability type a selection is sent back through. The lights declare their
 * scenes as `lightScene` (dynamic_scene); the ice makers declare theirs as
 * `nightlightScene` (mode) with plain enum values (#1250) - both answer the
 * same `sceneSelector` opt-in, and no known device declares both.
 */
const SCENE_SOURCES = [
  { confKey: 'sceneSelector', instance: 'lightScene', capabilityType: 'devices.capabilities.dynamic_scene' },
  { confKey: 'sceneSelector', instance: 'nightlightScene', capabilityType: 'devices.capabilities.mode' },
  { confKey: 'sceneSelectorSnapshots', instance: 'snapshot', capabilityType: 'devices.capabilities.dynamic_scene' },
  { confKey: 'sceneSelectorDiy', instance: 'diyScene', capabilityType: 'devices.capabilities.dynamic_scene' },
]

// The dropdown groups snapshots first (few, personal), then diy scenes, then
// tap-to-run scenes, then the long preset scene list, name-sorted within each
// group - so the same options land in the same order on every device (#1360)
const SOURCE_ORDER = {
  snapshot: 0,
  diyScene: 1,
  tapToRun: 2,
  lightScene: 3,
  nightlightScene: 3,
}

// An accessory may hold at most 100 services (HAP throws on the 101st). The
// accessory information and television services use two of those, and HAP
// adds a protocol information service of its own when it publishes the
// external accessory, so 97 inputs is the most one selector can carry. The
// sort below puts the user's own snapshots and diy scenes before the stock
// catalogue, so a capped device loses stock scenes, never personal ones (#1362)
export const MAX_SCENE_OPTIONS = 97

export function sceneOptionKey(option) {
  return `${option?.instance || 'lightScene'}:${option?.name || ''}`
}

function buildUniqueOptionKeys(options) {
  const usedKeys = new Set()
  return options.map((option) => {
    const base = sceneOptionKey(option)
    let key = base
    let suffix = 2
    while (usedKeys.has(key)) {
      key = `${base}#${suffix}`
      suffix += 1
    }
    usedKeys.add(key)
    return key
  })
}

/**
 * Assigns stable numeric HomeKit InputSource identifiers (1..255) to a sorted
 * list of scene options while preserving previously assigned IDs (including
 * tombstones for temporarily absent scenes so freed IDs are not immediately
 * reused by a different scene and HomeKit automations stay intact).
 *
 * When `previousIds` is empty (first boot after upgrading from positional IDs),
 * non-`tapToRun` options are assigned before `tapToRun` options so enabling
 * Tap-to-Run on an already-paired selector never shifts existing input IDs.
 * Visual order in Apple Home is still controlled by `DisplayOrder` TLV8.
 *
 * @param {Array<object>} options sorted scene options (at most MAX_SCENE_OPTIONS)
 * @param {Record<string, number>} [previousIds] persisted map of `instance:name -> identifier`
 * @returns {{ options: Array<object>, idMap: Record<string, number> }} options annotated with `identifier` and updated map
 */
export function assignStableSceneIdentifiers(options, previousIds = {}) {
  const keys = buildUniqueOptionKeys(options)
  const validPrev = {}
  const reservedIds = new Set()
  let maxId = 0

  if (previousIds && typeof previousIds === 'object' && !Array.isArray(previousIds)) {
    Object.entries(previousIds).forEach(([key, id]) => {
      if (Number.isInteger(id) && id >= 1 && id <= 0xFF && !reservedIds.has(id)) {
        validPrev[key] = id
        reservedIds.add(id)
        if (id > maxId) {
          maxId = id
        }
      }
    })
  }

  const isUnseeded = Object.keys(validPrev).length === 0
  const liveIds = new Set()
  const assigned = options.map((option, index) => {
    const key = keys[index]
    if (Object.hasOwn(validPrev, key) && !liveIds.has(validPrev[key])) {
      const id = validPrev[key]
      liveIds.add(id)
      return { ...option, identifier: id }
    }
    return { ...option, identifier: undefined }
  })

  // On an unseeded upgrade boot, assign pre-existing non-tapToRun options
  // first so surviving stock/snapshot/DIY inputs keep their legacy 1..M IDs
  const pendingIndices = []
  if (isUnseeded) {
    assigned.forEach((option, index) => {
      if (option.identifier === undefined && option.instance !== 'tapToRun') {
        pendingIndices.push(index)
      }
    })
    assigned.forEach((option, index) => {
      if (option.identifier === undefined && option.instance === 'tapToRun') {
        pendingIndices.push(index)
      }
    })
  } else {
    assigned.forEach((option, index) => {
      if (option.identifier === undefined) {
        pendingIndices.push(index)
      }
    })
  }

  const idMap = { ...validPrev }
  const findNextAvailableId = () => {
    // Prefer allocating above the high-water mark so absent scenes keep their IDs
    for (let id = maxId + 1; id <= 0xFF; id += 1) {
      if (!reservedIds.has(id)) {
        maxId = id
        return id
      }
    }
    // Wrap to any completely unused ID in 1..255 before reclaiming a tombstone
    for (let id = 1; id <= 0xFF; id += 1) {
      if (!reservedIds.has(id)) {
        return id
      }
    }
    // All 255 IDs are reserved: evict the oldest absent tombstone
    for (const [staleKey, staleId] of Object.entries(idMap)) {
      if (!liveIds.has(staleId)) {
        delete idMap[staleKey]
        reservedIds.delete(staleId)
        return staleId
      }
    }
    return undefined
  }

  pendingIndices.forEach((index) => {
    const id = findNextAvailableId()
    if (id !== undefined) {
      assigned[index].identifier = id
      reservedIds.add(id)
      liveIds.add(id)
      idMap[keys[index]] = id
    }
  })

  return { options: assigned, idMap }
}

function hasValidPreassignedIdentifiers(options) {
  const seen = new Set()
  return options.every((option) => {
    const id = option?.identifier
    if (!Number.isInteger(id) || id < 1 || id > 0xFF || seen.has(id)) {
      return false
    }
    seen.add(id)
    return true
  })
}

/**
 * Returns the merged option list a device's scene selector would offer, or
 * null when the selector cannot work - no config opt-in, no API key, or the
 * cloud account lists nothing for any enabled source.
 *
 * This is the single gate the platform uses to decide whether the extra
 * accessory exists at all: a dropdown that swallows taps is worse than none,
 * the same principle the zone tiles follow (#1333).
 *
 * @param {object} device the device from the sync, with `openApiInfo`
 * @param {object} deviceConf the user's per-device config block
 * @param {(kept: number, total: number) => void} [onCap] called when the list was cut to MAX_SCENE_OPTIONS
 * @returns {Array<{ name: string, value?: any, ptReal?: string, instance: string, capabilityType?: string }> | null} the merged options, or null when the selector should not exist
 */
export function sceneSelectorOptions(device, deviceConf, onCap) {
  const merged = []
  SCENE_SOURCES.forEach(({ confKey, instance, capabilityType }) => {
    if (!deviceConf?.[confKey]) {
      return
    }
    const options = device?.openApiInfo?.byInstance?.[instance]?.parameters?.options
    if (!Array.isArray(options)) {
      return
    }
    options.forEach(option => merged.push({
      name: option.name,
      value: option.value,
      instance,
      capabilityType,
    }))
  })
  // Only fall back to locally-playable ptReal scenes when the device has no
  // OpenAPI info at all - never mix them into an OpenAPI selector or flip a
  // paired OpenAPI selector's InputSource IDs during a transient cloud outage
  if (deviceConf?.sceneSelector && !device?.openApiInfo && merged.length === 0 && Array.isArray(device?.lanLightScenes)) {
    device.lanLightScenes.forEach((scene) => {
      if (scene?.name && scene?.ptReal) {
        merged.push({
          name: scene.name,
          ptReal: scene.ptReal,
          instance: 'lightScene',
        })
      }
    })
  }
  if (deviceConf?.sceneSelectorTapToRun && Array.isArray(device?.tapToRunScenes)) {
    device.tapToRunScenes.forEach((scene) => {
      if (scene?.name && scene?.ptReal) {
        merged.push({
          name: scene.name,
          ptReal: scene.ptReal,
          instance: 'tapToRun',
        })
      }
    })
  }
  merged.sort((a, b) => (SOURCE_ORDER[a.instance] - SOURCE_ORDER[b.instance]) || a.name.localeCompare(b.name))
  if (merged.length > MAX_SCENE_OPTIONS) {
    onCap?.(MAX_SCENE_OPTIONS, merged.length)
    merged.length = MAX_SCENE_OPTIONS
  }
  return merged.length > 0
    ? merged
    : null
}

/**
 * A scene selector for a light: a Television accessory whose input list is
 * the device's own scene list from the official API, so one dropdown replaces
 * a pile of on/off switches (#1360). Published as an external accessory -
 * HomeKit renders the input picker properly only on a television, and a
 * television has to be its own accessory rather than a bridge tile.
 *
 * The scene list and its values come straight from the cloud's `lightScene`
 * capability (already stored on the accessory context), and selecting an
 * input sends that option's value back through the same official capability.
 * Govee reports no "current scene", so the selector shows the last choice
 * made here rather than live state.
 */
export default class {
  constructor(platform, accessory) {
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform
    this.accessory = accessory

    this.sceneOptions = accessory.context.sceneOptions || []

    // The scene list belongs to whichever light the device's scenes drive.
    // On a device with a night light (the ice makers), `powerSwitch` is the
    // MACHINE - wiring the tile's toggle to it would start the ice making -
    // so the toggle follows the night light instead where one is declared
    this.powerInstance = accessory.context.openApiCapabilities?.nightlightToggle
      ? 'nightlightToggle'
      : 'powerSwitch'

    // The television service carries the input selector
    this.service = this.accessory.getService(this.hapServ.Television)
      || this.accessory.addService(this.hapServ.Television)
    this.service.setCharacteristic(this.hapChar.ConfiguredName, accessory.displayName)
    this.service.setCharacteristic(this.hapChar.SleepDiscoveryMode, 1)

    // The tile's power toggle drives the light's own power - a selector whose
    // toggle did nothing would read as broken. Optimistic: the device's power
    // reports route to the main light accessory, not this one
    this.service
      .getCharacteristic(this.hapChar.Active)
      .onSet(async value => this.internalActiveUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value

    // Selecting an input is selecting a scene
    this.service
      .getCharacteristic(this.hapChar.ActiveIdentifier)
      .onSet(async value => this.internalSceneUpdate(value))

    // One input per scene, with stable identifiers so adding a personal scene
    // at the top never renumbers existing inputs or forces Apple Home to
    // rebuild all 97 InputSource services at once. Identifiers start at 1 -
    // HomeKit treats 0 as nothing-selected. Respect valid pre-assigned IDs from
    // platform initialisation so duplicate names are never re-assigned (#1360)
    if (!hasValidPreassignedIdentifiers(this.sceneOptions)) {
      const { options: identifiedOptions } = assignStableSceneIdentifiers(
        this.sceneOptions,
        accessory.context.sceneIdMap,
      )
      this.sceneOptions = identifiedOptions
    }
    this.optionById = new Map()
    this.sceneOptions.forEach((option) => {
      const identifier = option.identifier
      if (!Number.isInteger(identifier) || identifier < 1 || identifier > 0xFF) {
        return
      }
      this.optionById.set(identifier, option)
      const subtype = `scene-${identifier}-${option.instance}-${option.name}`
      const inputService = this.accessory.getServiceById(this.hapServ.InputSource, subtype)
        || this.accessory.addService(this.hapServ.InputSource, option.name, subtype)
      inputService
        .setCharacteristic(this.hapChar.Identifier, identifier)
        .setCharacteristic(this.hapChar.ConfiguredName, option.name)
        .setCharacteristic(this.hapChar.IsConfigured, 1)
        .setCharacteristic(this.hapChar.InputSourceType, 3)
        // Without an explicit SHOWN, an input added after the accessory was
        // paired lands in the home app's rename list but not the picker,
        // and only a remove-and-re-add would surface it (#1360)
        .setCharacteristic(this.hapChar.CurrentVisibilityState, 0)
        .setCharacteristic(this.hapChar.TargetVisibilityState, 0)
      this.service.addLinkedService(inputService)
    })

    // Without an explicit display order the home app shows the PICKER's
    // entries in an arbitrary per-hub order - only the settings page sorts by
    // identifier, which is why the two disagreed (#1360). The TLV8 list here
    // (identifier records with tag 1, separated by empty tag-0 records) tells
    // it to display inputs in the sorted option order even when identifiers
    // were preserved from an earlier boot
    const orderBytes = []
    let orderCount = 0
    this.sceneOptions.forEach((option) => {
      if (!Number.isInteger(option.identifier) || option.identifier < 1 || option.identifier > 0xFF) {
        return
      }
      if (orderCount > 0) {
        orderBytes.push(0x00, 0x00)
      }
      orderBytes.push(0x01, 0x01, option.identifier)
      orderCount += 1
    })
    this.service.setCharacteristic(this.hapChar.DisplayOrder, Buffer.from(orderBytes).toString('base64'))

    // Output the customised options to the log
    const opts = JSON.stringify({ scenes: this.sceneOptions.length })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  async internalActiveUpdate(value) {
    try {
      if (value === this.cacheState) {
        return
      }
      const useLocalState = this.powerInstance === 'powerSwitch'
        && this.sceneOptions.length > 0
        && this.sceneOptions.every(option => Boolean(option.ptReal))
      if (useLocalState) {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'state',
          value: value === 1
            ? 'on'
            : 'off',
        })
      } else {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'openApi',
          openApi: {
            instance: this.powerInstance,
            capabilityType: this.powerInstance === 'powerSwitch'
              ? 'devices.capabilities.on_off'
              : 'devices.capabilities.toggle',
            value: value === 1
              ? 1
              : 0,
          },
        })
      }
      this.cacheState = value
      this.accessory.log(`${platformLang.curState} [${value === 1
        ? 'on'
        : 'off'}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalSceneUpdate(value) {
    try {
      const option = this.optionById.get(value)
      if (!option) {
        return
      }
      if (option.ptReal) {
        // LAN-first ptReal scene command (falls back to AWS ptReal if LAN is unavailable)
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'rgbScene',
          value: [option.ptReal],
        })
      } else {
        // The option's value goes back exactly as the cloud listed it, through
        // the instance and capability type it came from - a scene as
        // `{ id, paramId }`, a snapshot or night light scene as its plain id.
        // Options stored before sources existed carry neither and were always
        // scenes
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'openApi',
          openApi: {
            instance: option.instance || 'lightScene',
            capabilityType: option.capabilityType || 'devices.capabilities.dynamic_scene',
            value: option.value,
          },
        })
      }

      // Activating a scene turns the light on, so the tile follows
      this.cacheState = 1
      this.service.updateCharacteristic(this.hapChar.Active, 1)
      this.accessory.log(`${platformLang.curScene} [${option.name}]`)
    } catch (err) {
      this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate(params) {
    // The platform forwards the light's own updates here so the tile's power
    // mirrors the device - there is still no live scene state to reflect.
    // `state` is DEVICE power, so it only maps onto a powerSwitch-driven
    // tile: on a night-light device the light's state comes from its own
    // status frame instead - `aa 1b 01 <on>`, the same frame the ice maker
    // handler reads (#1250)
    let newState
    if (this.powerInstance === 'powerSwitch') {
      if (params?.state !== 'on' && params?.state !== 'off') {
        return
      }
      newState = params.state === 'on'
        ? 1
        : 0
    } else {
      (params?.commands || []).forEach((command) => {
        const hexParts = hexToTwoItems(base64ToHex(command))
        if (`${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}` !== 'aa1b') {
          return
        }
        if (getTwoItemPosition(hexParts, 3) !== '01') {
          return
        }
        newState = getTwoItemPosition(hexParts, 4) === '01'
          ? 1
          : 0
      })
      if (newState === undefined) {
        return
      }
    }
    if (newState === this.cacheState) {
      return
    }
    this.cacheState = newState
    this.service.updateCharacteristic(this.hapChar.Active, newState)
    this.accessory.log(`${platformLang.curState} [${newState === 1
      ? 'on'
      : 'off'}]`)
  }
}
