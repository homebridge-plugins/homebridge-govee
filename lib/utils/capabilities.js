/**
 * What a device can do, worked out from several sources rather than one table.
 *
 * Writing out all six hundred models by hand is a job nobody finishes, and it
 * throws away the two things we already have: Govee's own API says what each
 * device can do, and some behaviour depends on firmware rather than model. So
 * instead of a table this asks a series of layers and takes the first answer:
 *
 *   1. user config      an explicit setting always wins
 *   2. firmware         this model, at or above this firmware version
 *   3. model            written down because someone worked it out
 *   4. discovered       what this particular device reported it can do
 *   5. family           what this kind of appliance usually has
 *
 * Most models never need an entry of their own. They are answered by what the
 * device reported plus the family defaults, which is why this scales to models
 * nobody has written down.
 *
 * ⚠️ Family defaults are deliberately generous. A control this plugin has
 * offered for years may be in use by someone, and taking it away to tidy up
 * would break a working setup. Only a model entry - written after someone
 * confirmed it - is allowed to say a device does not have something.
 */

import { compareVersions } from './device-capabilities.js'

/**
 * What each kind of appliance usually offers.
 *
 * These are the fallback, so they describe the group rather than any one model.
 * Where a group has historically been given a control, it stays here even if
 * some members turn out not to have it - see the warning above.
 */
const familyControls = {
  heater1: { swing: true, lock: true, light: false },
  heater2: { swing: true, lock: true, light: true },
  fan: { swing: true, lock: false, light: false },
  humidifier: { swing: false, lock: false, light: false },
  dehumidifier: { swing: false, lock: false, light: false },
  purifier: { swing: false, lock: false, light: false },
  iceMaker: { swing: false, lock: false, light: false },
  diffuser: { swing: false, lock: false, light: false },
  composter: { swing: false, lock: false, light: false },
}

const emptyControls = {
  swing: false,
  lock: false,
  light: false,
  humiditySensor: false,
  temperatureSensor: false,
  modes: false,
}

/**
 * Controls worked out for a particular model.
 *
 * Only add a model here once its controls are actually known. An entry is
 * trusted over what the device reports, and it is the only thing allowed to
 * take a control away.
 */
const modelControls = {
  // Heaters. These match what Govee's own app offers for each model.
  // Added new, so there is nobody whose setup could be broken by them
  H7137: { swing: false, lock: false, light: false },
  H713E: { swing: false, lock: false, light: false },

  // Diffusers are power only, which is what the plugin already offers
  H7161: { swing: false, lock: false, light: false },
  H7162: { swing: false, lock: false, light: false },
}

/**
 * Controls a model is believed NOT to have, which are still being offered.
 *
 * These are recorded rather than applied. Each has been offered for a long
 * time, so an owner may be relying on it, and taking it away to match a
 * capability list would break a working setup for the sake of tidiness. The
 * evidence is written down here so nobody has to work it out twice, and so
 * there is a list to check the next time an owner of one of these gets in
 * touch.
 *
 * Move an entry into `modelControls` once an owner confirms the control really
 * does nothing.
 */
const unconfirmedMissing = {
  H713A: { swing: false },
  H713B: { swing: false },
  H713C: { swing: false },
  H7135: { swing: false, light: false },
}

/**
 * Controls that only appear at or above a firmware version. Same shape as the
 * protocol overrides next door: a list per model, oldest rule first.
 */
const firmwareControls = {}

/**
 * What Govee's API calls a capability, and which control it means to us.
 *
 * These names come back per device, so they say what this particular unit can
 * do rather than what its model generally can. That makes them the only source
 * here that works for a model nobody has written down.
 */
const discoveryMap = {
  oscillationToggle: 'swing',
  lockToggle: 'lock',
  nightlightToggle: 'light',
  mainLightToggle: 'light',
  backgroundLightToggle: 'light',
  sensorHumidity: 'humiditySensor',
  sensorTemperature: 'temperatureSensor',
  workMode: 'modes',
}

/**
 * Turn the capability list a device reported into controls.
 *
 * Only ever adds. A capability the device did not mention is left undecided so
 * a later layer can answer, because the API not listing something is not proof
 * the device cannot do it.
 */
function fromDiscovery(openApiCapabilities) {
  const discovered = {}
  Object.keys(openApiCapabilities || {}).forEach((instance) => {
    const control = discoveryMap[instance]
    if (control) {
      discovered[control] = true
    }
  })
  return discovered
}

/**
 * Config settings that name a control directly, so an owner can turn something
 * off that their device does not really have without waiting for a release.
 */
function fromConfig(deviceConf) {
  const chosen = {}
  if (deviceConf?.hideLight === true) {
    chosen.light = false
  }
  if (deviceConf?.hideSwing === true) {
    chosen.swing = false
  }
  return chosen
}

function firmwareLayer(model, firmware) {
  if (!firmware) {
    return {}
  }
  const applied = {}
  const rules = [
    ...(firmwareControls[model] || []),
  ]
    .sort((a, b) => compareVersions(a.minVersion, b.minVersion))
  rules.forEach((rule) => {
    if (compareVersions(firmware, rule.minVersion) >= 0) {
      Object.assign(applied, rule.controls)
    }
  })
  return applied
}

/**
 * Work out what a device can do.
 *
 * @param {object} context describing the device
 * @param {string} context.model the govee model, eg 'H7130'
 * @param {string} [context.family] which set of defaults to fall back on
 * @param {string} [context.firmware] the firmware version the device reported
 * @param {object} [context.openApiCapabilities] what the api said it can do
 * @param {object} [context.deviceConf] this device's settings
 * @returns {{ controls: object, sources: object }} the controls, and which
 *   layer decided each one - the second is for the log, so an unexpected answer
 *   can be traced without guessing
 */
export function resolveControls(context = {}) {
  const {
    model,
    family,
    firmware,
    openApiCapabilities,
    deviceConf,
  } = context

  // Lowest priority first, so a later layer overwrites an earlier one
  const layers = [
    ['family', familyControls[family] || {}],
    [
      'discovered',
      fromDiscovery(openApiCapabilities),
    ],
    ['model', modelControls[model] || {}],
    [
      'firmware',
      firmwareLayer(model, firmware),
    ],
    [
      'config',
      fromConfig(deviceConf),
    ],
  ]

  const controls = { ...emptyControls }
  const sources = {}

  layers.forEach(([name, values]) => {
    Object.entries(values).forEach(([control, value]) => {
      controls[control] = value
      sources[control] = name
    })
  })

  return { controls, sources }
}

/**
 * A one-line summary of where each answer came from, for the debug log. Reading
 * "swing from family" tells you nobody has confirmed it, which is a different
 * situation from "swing from model".
 */
export function describeSources(sources) {
  return Object.entries(sources)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([control, source]) => `${control} from ${source}`)
    .join(', ') || 'nothing known'
}

export { familyControls, modelControls, unconfirmedMissing }
