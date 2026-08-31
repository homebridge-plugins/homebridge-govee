import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import forge from 'node-forge'

const TWO_CHAR_REGEX = /.{1,2}/g
const DEVICE_ID_CLEAN_REGEX = /[^A-F0-9_:]+/g

const base64ToHex = base64 => Buffer.from(base64, 'base64').toString('hex')

const hexToBase64 = hex => Buffer.from(hex, 'hex').toString('base64')

const cenToFar = temp => Math.round(((temp * 9) / 5 + 32) * 10) / 10

const farToCen = temp => Math.round(((temp - 32) * 5) / 9)

/**
 * Builds a 20-byte BLE packet with XOR checksum.
 * Packet format: [ID(1B)] [Cmd(1B)] [Sub(1B)] [Data(≤16B pad to 19)] [XOR(1B)]
 * The XOR checksum is calculated over the first 19 bytes.
 */
function generateCodeFromHexValues(hexValues, returnAsHexBuffer = false) {
  const cmdSection = Buffer.from(hexValues.flat())

  // More than 19 bytes leaves no room for the checksum. Without this the
  // padding length goes negative, which produces an empty pad rather than an
  // error, and the result is a packet longer than 20 bytes that the device
  // will not understand - with nothing said about why
  if (cmdSection.length > 19) {
    throw new Error(`Command is ${cmdSection.length} bytes, which is longer than a packet allows`)
  }

  const padSection = Buffer.from(Array.from({ length: 19 - cmdSection.length }).fill(0))
  const noXSection = Buffer.concat([cmdSection, padSection])
  let checksum = 0
  Object.values(noXSection).forEach((i) => {
    checksum ^= i
  })
  const chkSection = Buffer.from([checksum])
  const finalBuffer = Buffer.concat([noXSection, chkSection])
  return returnAsHexBuffer
    ? finalBuffer
    : finalBuffer.toString('base64')
}

function generateRandomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let nonce = ''
  while (nonce.length < length) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return nonce
}

const getTwoItemPosition = (array, part) => array[part - 1]

const hasProperty = (obj, prop) => Object.hasOwn(obj, prop)

const hexToDecimal = hex => Number.parseInt(hex, 16)

const hexToTwoItems = hex => hex.match(TWO_CHAR_REGEX)

const nearestHalf = num => Math.round(num * 2) / 2

function parseDeviceId(deviceId) {
  return deviceId
    .toString()
    .toUpperCase()
    .replace(DEVICE_ID_CLEAN_REGEX, '')
}

function parseError(err, hideStack = []) {
  let toReturn = err.message
  if (err?.stack?.length > 0 && !hideStack.includes(err.message)) {
    const stack = err.stack.split('\n')
    if (stack[1]) {
      toReturn += stack[1].replace('   ', '')
    }
  }
  return toReturn
}

/**
 * Extracts the certificate and private key from the account's identity file.
 *
 * Parsed entirely in JavaScript, so it works the same everywhere. The file
 * usually arrives protected with the older RC2/3DES ciphers, which the
 * system's own openssl 3 refuses without its legacy provider - relying on it
 * meant this failed on some systems and worked on others (and on anything
 * without openssl installed at all).
 *
 * @param {string} pfxPath path to the PKCS#12 file
 * @param {string} p12Password the password protecting it
 * @returns {Promise<{cert: string, key: string}>} PEM certificate and PKCS#8 key
 */
async function pfxToCertAndKey(pfxPath, p12Password) {
  const der = forge.util.createBuffer(fs.readFileSync(pfxPath).toString('binary'))
  const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(der), p12Password)

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]
    || p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]

  if (!certBags?.length || !keyBags?.length) {
    throw new Error('no certificate or key found in the pfx file')
  }

  const cert = forge.pki.certificateToPem(certBags[0].cert)
  const key = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keyBags[0].key)))

  // The pem blocks come out with windows line endings - the consumers do not
  // care, but keep the output identical to what this returned before
  return {
    cert: cert.replace(/\r\n/g, '\n').trim(),
    key: key.replace(/\r\n/g, '\n').trim(),
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function statusToActionCode(statusCode) {
  const choppedCode = `33${statusCode.slice(2, -2)}`
  const choppedArray = hexToTwoItems(choppedCode)
  const hexValues = choppedArray.map(byte => `0x${byte}`)
  const generatedCode = generateCodeFromHexValues(hexValues)
  return Buffer.from(generatedCode, 'base64').toString('hex')
}

/**
 * Convert a HomeKit RotationSpeed percentage into a device speed step.
 *
 * `steps` is the number of REAL speeds the model has, excluding auto (8 on the
 * H7100 family, 12 on the H7105/H7107/H1370). A percentage of 0 means "off" and
 * is handled by the caller, so this always returns a usable step in 1..steps.
 *
 * Auto is deliberately NOT reachable from here. Auto is a mode, not a speed, so
 * 100% means maximum speed. Exposing auto at the top of the slider is what made
 * the previous behaviour surprising - dragging to full would silently select
 * auto instead of full power.
 */
function hkPercentToFanSpeed(percent, steps) {
  return Math.max(1, Math.min(steps, Math.round((percent * steps) / 100)))
}

/**
 * How many speed steps a fan really has.
 *
 * Govee's api lists a fan's speeds per device, in `fanSpeedMode`, so a device
 * that reports them is the best source there is - it is right for a model
 * nobody has written down, and right when two models share a handler. The H1310
 * and the H1370 do exactly that and have six speeds and twelve (#1352).
 *
 * The option VALUE is what goes on the wire, so the scale is the largest value
 * offered rather than the number of options. `fallback` is the model table, for
 * a device the api says nothing about - a bluetooth-only fan, or an account
 * without api access.
 */
function fanSpeedStepsFrom(openApiCapabilities, fallback) {
  const options = openApiCapabilities?.fanSpeedMode?.parameters?.options
  if (!Array.isArray(options)) {
    return fallback
  }
  const steps = options
    .map(option => Number(option?.value))
    .filter(value => Number.isInteger(value) && value > 0)
  return steps.length > 0 ? Math.max(...steps) : fallback
}

/**
 * Convert a device speed step into a HomeKit RotationSpeed percentage.
 *
 * When the device reports auto, HomeKit is shown 100%, but callers should keep
 * their own cache at `autoSpeed`. That lets the plugin tell "the device is in
 * auto" apart from "the user asked for maximum speed", and so avoid echoing a
 * redundant command straight back to the device.
 */
function fanSpeedToHkPercent(speed, steps, autoSpeed) {
  if (autoSpeed !== undefined && speed === autoSpeed) {
    return 100
  }
  if (!speed || speed < 1) {
    return 0
  }
  return Math.min(100, Math.round((speed / steps) * 100))
}

/**
 * Work out whether a Govee OpenAPI control response is reporting a refusal.
 *
 * Govee signals a refused command in two places, and not always both. Powza's
 * offline water timer (#1324) set a non-200 `code` at the top level, which the
 * request helper already catches. A response can instead come back 200 overall
 * with the refusal only inside `capability.state`, and that shape used to be
 * read as success — the command silently did nothing while HomeKit kept showing
 * the new state.
 *
 * Returns Govee's own wording when the command was refused, or null when it was
 * accepted. Their message is the useful part: "Device is offline. Please check
 * the Wi-Fi connection." tells a user far more than a generic failure would.
 */
function describeControlFailure(responseData) {
  const state = responseData?.capability?.state
  if (!state || String(state.status).toLowerCase() !== 'failure') {
    return null
  }
  return state.errorMsg || responseData?.msg || responseData?.message || 'the device rejected the command'
}

/**
 * Choose the error to report once every connection method has been exhausted.
 *
 * "No connection method available" is only true when nothing could be tried. If
 * a method WAS tried and failed, that failure is the answer worth having — an
 * offline device, a refused command, a Bluetooth timeout. Reporting the generic
 * message instead discards it and points the user at the connection-method
 * documentation, which is the wrong place to look when the connection was fine
 * and the device simply said no (#1324).
 *
 * The original error object is passed through untouched, so flags set on it
 * upstream (`deviceRefusal`) still reach the caller.
 */
function updateFailureError(lastError, fallbackMessage) {
  return lastError ?? new Error(fallbackMessage)
}

export {
  base64ToHex,
  cenToFar,
  describeControlFailure,
  fanSpeedStepsFrom,
  fanSpeedToHkPercent,
  farToCen,
  generateCodeFromHexValues,
  generateRandomString,
  getTwoItemPosition,
  hasProperty,
  hexToBase64,
  hexToDecimal,
  hexToTwoItems,
  hkPercentToFanSpeed,
  nearestHalf,
  parseDeviceId,
  parseError,
  pfxToCertAndKey,
  sleep,
  statusToActionCode,
  updateFailureError,
}
