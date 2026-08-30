import { base64ToHex } from './functions.js'

/**
 * Logging for anything the plugin receives but does not understand yet.
 *
 * Adding support for a new device or a new function almost always stalls on the
 * same thing: the maintainer has to go back and forth with the owner asking for
 * the model, the firmware version, which connection the data arrived on, and
 * the raw payload. This builds all of that into a single line the owner can
 * copy straight into a GitHub issue, so the first report is usually enough.
 *
 * The line is deliberately one piece of JSON rather than prose - it is one
 * copy-paste for the user, and it can be read back without picking it apart.
 */

// Remembers what has already been reported, so a code the device repeats every
// few seconds is only shouted about once. Keyed by device, kind and the shape
// of the frame rather than its whole payload - see frameShape below.
const alreadyReported = new Set()

/**
 * What kind of message a frame is, ignoring the values it carries.
 *
 * A frame is `<prefix> <command> <sub-command> <data...>`, and the first three
 * bytes are what the device handlers themselves switch on to decide what a
 * frame means. Keying on those means one report per kind of message.
 *
 * Keying on the whole payload instead looks equivalent but is not: a frame
 * carrying a reading or a counter differs every time it is sent, so each one
 * counts as new and gets reported again. One fan sent the same message every
 * twenty minutes with a changing value, which worked out at around seventy
 * warnings a day for a single message type, burying the frames worth seeing
 * (#1338).
 *
 * @param {string} [hex] the frame as hex, where there is one
 * @returns {string|undefined} the first three bytes, or undefined if not a frame
 */
function frameShape(hex) {
  return typeof hex === 'string' && /^[0-9a-f]{6}/i.test(hex)
    ? hex.slice(0, 6).toLowerCase()
    : undefined
}

/**
 * What kind of message a JSON payload is, ignoring the values it carries.
 *
 * A payload names what it is in `cmd`, and also carries a per-message
 * transaction id - so keying on the whole JSON made every message count as
 * new, and a device repeating one unrecognised command warned on every single
 * repeat instead of once (#1363). The command name is the payload's equivalent
 * of a frame's first three bytes.
 *
 * @param {*} [raw] the payload as received, where it was an object
 * @returns {string|undefined} the command name, or undefined if there is none
 */
function payloadShape(raw) {
  return raw !== null && typeof raw === 'object' && typeof raw.cmd === 'string'
    ? `cmd:${raw.cmd}`
    : undefined
}

/**
 * Kinds of message that arrive without anyone asking for them.
 *
 * A device describes itself whenever it connects, and sends far more than the
 * plugin needs - a purifier sends nine such frames, a presence sensor nine, an
 * outlet seven, and every model and firmware sends a different set. None of it
 * means anything is wrong, and there is nothing the owner can do about any of
 * it, so warning about them puts a wall of red in the log of someone whose
 * devices are working perfectly (#1340, #1341, #1342).
 *
 * They still matter for adding support later, so they are logged in full - just
 * at debug level, where they can be fetched when someone actually wants them.
 *
 * Everything else stays loud, because everything else is either something the
 * owner asked for that did not work, or a device whose whole message was
 * unreadable - both of which are worth interrupting someone for.
 */
const unsolicitedKinds = new Set(['status'])

/**
 * Reset the record of what has been reported. Only needed by tests, and when
 * the platform restarts and wants a fresh session.
 */
export function resetReportedUnknowns() {
  alreadyReported.clear()
}

/**
 * True the first time a given thing is seen, false every time after.
 *
 * For the places that have something worth reporting but no accessory to hang
 * it off, such as a sensor broadcasting nearby that the plugin cannot decode.
 * Lets those log loudly once and quietly thereafter, the same as the rest.
 *
 * @param {string} fingerprint identifies the thing being reported
 */
export function isFirstReport(fingerprint) {
  if (alreadyReported.has(fingerprint)) {
    return false
  }
  alreadyReported.add(fingerprint)
  return true
}

/**
 * Report a control the plugin knows the device has, but does not yet know the
 * command for, and then fail the request.
 *
 * This is how a model gets added before every last detail is known. The things
 * that are certain - usually power - work straight away, and anything still
 * unknown says so out loud instead of pretending to work. Failing the request
 * matters: HomeKit shows the control as not responding, which sends the owner
 * to the log, where they find the line to paste into an issue. A control that
 * silently did nothing would just look broken.
 *
 * @param {object} accessory the accessory the control belongs to
 * @param {object} details
 * @param {string} details.control what was asked for, eg 'fan speed'
 * @param {*} [details.value] the value HomeKit asked for
 * @returns {string} the message that was logged, mainly for tests
 */
export function reportUnsupportedControl(accessory, { control, value } = {}) {
  const context = accessory?.context || {}
  const report = {
    model: context.gvModel,
    firmware: context.firmware,
    hardware: context.hardware,
    control,
    requested: value,
  }
  Object.keys(report).forEach((key) => {
    if (report[key] === undefined || report[key] === null || report[key] === '') {
      delete report[key]
    }
  })

  const line = `the ${control} for this model is not known yet, so this did not happen - please report this line so it can be added: ${JSON.stringify(report)}`
  const fingerprint = `${context.gvDeviceId || accessory?.displayName}|unsupported|${control}`

  if (alreadyReported.has(fingerprint)) {
    accessory?.logDebug?.(line)
  } else {
    alreadyReported.add(fingerprint)
    accessory?.logWarn?.(line)
  }

  return line
}

/**
 * Log an unrecognised payload with everything needed to add support for it.
 *
 * @param {object} accessory the accessory the data arrived for
 * @param {object} details
 * @param {string} details.kind what was not understood, eg 'scene' or 'command'
 * @param {string} [details.source] the connection it came in on, eg 'AWS'
 * @param {*} [details.raw] the payload exactly as received
 * @param {string} [details.hex] the payload as hex, worked out from raw if omitted
 * @param {object} [details.extra] any further fields worth including
 */
export function logUnknownData(accessory, {
  kind,
  source,
  raw,
  hex,
  extra,
} = {}) {
  if (!accessory) {
    return
  }

  const context = accessory.context || {}

  // Work out the hex form when the payload is base64, since the hex is what
  // actually gets read when working out what a code means.
  let hexValue = hex
  if (!hexValue && typeof raw === 'string') {
    try {
      hexValue = base64ToHex(raw)
    } catch {
      // Not base64, so the raw value is the useful form on its own
    }
  }

  const report = {
    model: context.gvModel,
    firmware: context.firmware,
    hardware: context.hardware,
    source: source || 'unknown',
    kind,
    raw: typeof raw === 'object' ? JSON.stringify(raw) : raw,
    ...(hexValue && hexValue !== raw ? { hex: hexValue } : {}),
    ...extra,
  }

  // Drop anything we do not actually have, so the line stays readable
  Object.keys(report).forEach((key) => {
    if (report[key] === undefined || report[key] === null || report[key] === '') {
      delete report[key]
    }
  })

  const line = `unrecognised ${kind} - please include this line if you report it: ${JSON.stringify(report)}`

  // Nobody asked for this one, so record it quietly - see unsolicitedKinds.
  if (unsolicitedKinds.has(kind)) {
    accessory.logDebug?.(line)
    return
  }

  // Only the callers that pass `hex` are handing over a real device frame. The
  // rest report things like a settings object, and base64ToHex will happily
  // turn any string into hex that looks like one - two different messages can
  // then share a first three bytes and wrongly count as the same shape.
  const fingerprint = `${context.gvDeviceId || accessory.displayName}|${kind}|${frameShape(hex) ?? payloadShape(raw) ?? report.raw}`

  // Say it once loudly enough to be noticed, then keep quiet about that shape
  // for the rest of the session.
  if (alreadyReported.has(fingerprint)) {
    accessory.logDebug?.(line)
    return
  }

  alreadyReported.add(fingerprint)
  accessory.logWarn?.(line)
}
