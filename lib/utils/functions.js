import { Buffer } from 'node:buffer'
import fs from 'node:fs'

import NodeRSA from 'node-rsa'
import pem from 'pem'

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

async function pfxToCertAndKey(pfxPath, p12Password) {
  return new Promise((resolve, reject) => {
    pem.readPkcs12(fs.readFileSync(pfxPath), { p12Password }, (err, cert) => {
      if (err) {
        reject(err)
        return
      }
      try {
        const key = new NodeRSA(cert.key)
        resolve({
          cert: cert.cert,
          key: key.exportKey('pkcs8'),
        })
      } catch (error) {
        reject(error)
      }
    })
  })
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

export {
  base64ToHex,
  cenToFar,
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
}
