import platformConsts from './constants.js'
import platformLang from './lang-en.js'

/**
 * Works out which devices to set up, and which cached ones to let go of.
 *
 * Govee can describe the same device through three different lists - the
 * account's own device list, the local network scan, and the public api - and
 * each carries something the others do not. This decides how they combine.
 *
 * Nothing here talks to Homebridge. It returns a plan, and the platform carries
 * it out, which is what lets the awkward cases below be tested rather than
 * hoped about.
 */

const DEVICE_ID_FORMAT_REGEX = /([a-z0-9]{2})(?=[a-z0-9])/gi

// The app lets people group devices together. Those groups come back looking
// like devices, and are not (#1309)
// Govee's Feature Hub groups arrive alongside real devices. `DreamViewScenic`
// is the model on every group made there, whatever the group is called - both
// "Scenic DreamView" and a plain "General Group" come through under it (#1357)
// - and it appears nowhere in Govee's own product catalogue.
const GROUP_SKUS = ['BaseGroup', 'DreamViewScenic', 'SameModeGroup']

function isGroup(sku) {
  return GROUP_SKUS.includes(sku)
}

/**
 * Govee's own list gives ids without separators, and everything else uses them.
 * An add-on sensor keeps its `_1` suffix.
 */
function formatDeviceId(id) {
  return id.includes(':') ? id : id.replace(DEVICE_ID_FORMAT_REGEX, '$&:').toUpperCase()
}

/**
 * Decide what to set up.
 *
 * @param {object} input the three device lists and the settings that filter them
 * @param {Array} [input.httpDevices] what the account's device list returned
 * @param {Array} [input.lanDevices] what the local network scan found
 * @param {Array} [input.openApiDevices] what the public api returned
 * @param {Array} [input.ignoredDevices] ids the owner asked to leave alone
 * @param {boolean} [input.ignoreMatter] whether matter models are being skipped
 * @param {object} [input.deviceConf] per-device settings, for names
 * @returns {object} `devices` to hand to the platform in order, which periodic
 *   syncs are needed, which lists produced something, and any app groups that
 *   were skipped so the caller can log them
 */
export function planDeviceSetup({
  httpDevices = [],
  lanDevices = [],
  openApiDevices = [],
  ignoredDevices = [],
  ignoreMatter = false,
  deviceConf = {},
}) {
  const devices = []
  const skippedGroups = []
  let bleSyncNeeded = false
  let httpSyncNeeded = false
  // Which lists produced something, since each one decides whether its own
  // periodic sync is worth starting
  let httpDevicesWereInitialised = false
  let openApiDevicesWereInitialised = false
  let lanDevicesWereInitialised = false

  const isIgnored = id => ignoredDevices.includes(id)
  const isIgnoredMatter = model => ignoreMatter && platformConsts.matterModels.includes(model)

  httpDevices.forEach((httpDevice) => {
    // Kept in place, because the lists are compared by id further down and by
    // the caller afterwards
    httpDevice.device = formatDeviceId(httpDevice.device)

    if (isIgnored(httpDevice.device)) {
      return
    }
    if (isGroup(httpDevice.sku)) {
      skippedGroups.push(httpDevice.deviceName)
      return
    }
    if (isIgnoredMatter(httpDevice.sku)) {
      return
    }

    // These two kinds of sensor are the reason the periodic syncs exist
    if (platformConsts.models.sensorLeak.includes(httpDevice.sku)) {
      httpSyncNeeded = true
    }
    if (platformConsts.models.sensorThermo.includes(httpDevice.sku)) {
      bleSyncNeeded = true
      httpSyncNeeded = true
    }

    const lanDevice = lanDevices.find(el => el.device === httpDevice.device)
    const matchingOpenApi = openApiDevices.find(el => el.device === httpDevice.device)
    const openApiMerge = matchingOpenApi
      ? {
          openApiInfo: matchingOpenApi.openApiInfo,
          properties: matchingOpenApi.properties,
          supportCmds: matchingOpenApi.supportCmds,
        }
      : {}

    if (lanDevice) {
      devices.push({
        ...lanDevice,
        httpInfo: httpDevice,
        model: httpDevice.sku,
        deviceName: httpDevice.deviceName,
        isLanDevice: true,
        ...openApiMerge,
      })
      lanDevicesWereInitialised = true
      lanDevice.initialised = true
    } else {
      // Not on the local network, but it may still be reachable another way
      devices.push({
        device: httpDevice.device,
        deviceName: httpDevice.deviceName,
        model: httpDevice.sku,
        httpInfo: httpDevice,
        ...openApiMerge,
      })
    }
    httpDevicesWereInitialised = true
  })

  openApiDevices.forEach((openApiDevice) => {
    if (isGroup(openApiDevice.model)) {
      skippedGroups.push(openApiDevice.deviceName)
      return
    }
    if (isIgnored(openApiDevice.device) || isIgnoredMatter(openApiDevice.model)) {
      return
    }
    // Already handled by the loop above
    if (httpDevices.some(httpDevice => httpDevice.device === openApiDevice.device)) {
      return
    }

    const lanDevice = lanDevices.find(el => el.device === openApiDevice.device)
    if (lanDevice) {
      devices.push({
        ...lanDevice,
        deviceName: openApiDevice.deviceName,
        model: openApiDevice.model,
        openApiInfo: openApiDevice.openApiInfo,
        properties: openApiDevice.properties,
        supportCmds: openApiDevice.supportCmds,
        isLanDevice: true,
      })
      lanDevicesWereInitialised = true
      lanDevice.initialised = true
    } else {
      devices.push(openApiDevice)
    }
    openApiDevicesWereInitialised = true
  })

  // Anything found on the network that neither list knew about
  lanDevices.filter(el => !el.initialised).forEach((lanDevice) => {
    if (isIgnored(lanDevice.device)) {
      return
    }
    // A device the loops above skipped for this reason still has an unmatched
    // network record. Without this it would be added here and removed again by
    // the cleanup on every restart (#1315)
    if (isIgnoredMatter(lanDevice.sku)) {
      return
    }

    devices.push({
      device: lanDevice.device,
      // The network scan does not give a name, so use the owner's label
      deviceName: deviceConf?.[lanDevice.device]?.label || lanDevice.device.replaceAll(':', ''),
      model: lanDevice.sku || 'HXXXX',
      isLanDevice: true,
      isLanOnly: true,
    })
    lanDevicesWereInitialised = true
  })

  return {
    devices,
    bleSyncNeeded,
    httpSyncNeeded,
    skippedGroups,
    httpDevicesWereInitialised,
    openApiDevicesWereInitialised,
    lanDevicesWereInitialised,
    anyInitialised: httpDevicesWereInitialised || openApiDevicesWereInitialised || lanDevicesWereInitialised,
  }
}

/**
 * Decide which cached accessories no longer belong.
 *
 * ⚠️ The careful part. Removing an accessory destroys the HomeKit scenes and
 * automations it is in, and that cannot be undone from here. So "Govee did not
 * mention it" only counts when the cloud lists were actually fetched this time
 * - a failed request must never look like a deleted device (#1264).
 *
 * @param {object} input the cached accessories and what was seen this session
 * @param {Array} [input.accessories] the accessories Homebridge already has
 * @param {Array} [input.httpDevices] what the account's device list returned
 * @param {Array} [input.lanDevices] what the local network scan found
 * @param {Array} [input.openApiDevices] what the public api returned
 * @param {Array} [input.ignoredDevices] ids the owner asked to leave alone
 * @param {boolean} [input.ignoreMatter] whether matter models are being skipped
 * @param {boolean} [input.cloudListsFetched] whether the cloud lists can be
 *   trusted to be complete this session
 * @returns {Array} the accessories to remove
 */
export function planRedundantAccessories({
  accessories = [],
  httpDevices = [],
  lanDevices = [],
  openApiDevices = [],
  ignoredDevices = [],
  ignoreMatter = false,
  cloudListsFetched = false,
}) {
  return accessories.filter((accessory) => {
    const id = accessory.context.gvDeviceId

    // Asked to be ignored, or a matter model while matter models are ignored -
    // otherwise the cached tile lingers even though setup skipped it (#1287)
    const isIgnored = ignoredDevices.includes(id)
      || (ignoreMatter && platformConsts.matterModels.includes(accessory.context.gvModel))

    const isMissing = !httpDevices.some(el => el.device === id)
      && !lanDevices.some(el => el.device === id)
      && !openApiDevices.some(el => el.device === id)

    // A device only ever seen on the network may simply have missed a scan
    const isLanOnly = accessory.context.hasLanControl && !accessory.context.firmware

    return isIgnored || (isMissing && cloudListsFetched && !isLanOnly)
  })
}

/**
 * Whether the cloud lists can be trusted to be complete this session. A client
 * that was configured but failed to connect means the answer is no.
 */
export function cloudListsWereFetched(config, clients) {
  return (!config.username || !!clients.httpClient)
    && (!!config.openApiDisable || !config.apiKey || !!clients.openApiClient)
}

export { formatDeviceId, platformLang }
