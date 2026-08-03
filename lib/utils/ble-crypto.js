/**
 * Govee "V2" BLE encryption (EncryptionManagerV2 in the Govee Home app).
 *
 * Used by newer Bluetooth-only devices such as the H3001 solar string lights.
 * Older devices take the plain 20-byte frame; these wrap it in AES-128-GCM and
 * silently ignore anything that is not wrapped.
 *
 * Wire format on 00010203-0405-0607-0809-0a0b0c0d2b11 (write) and ...2b10 (notify):
 *
 *   handshake request   e7 11 01 | iv(12) | tagLen(1) | GCM{ txIvKey(8) }
 *                       AAD = frame[0..15]                     key = KEY_HANDSHAKE
 *   handshake response  e7 11 00 | iv(12) |            GCM{ rxIvKey(8) ++ devInfo(11) }
 *                       AAD = frame[0..14]                     key = KEY_HANDSHAKE
 *
 *   deviceKey = AES-128-ECB-encrypt(KEY_DEVICE, devInfo ++ 00*5)
 *
 *   data frame          counter(4, big endian) | GCM{ 20-byte Govee frame }
 *                       nonce = txIvKey(8) ++ counter(4)
 *                       AAD   = counter(4)
 *                       key   = deviceKey
 *                       tag   = 12 bytes appended
 *
 * devInfo is the ASCII SKU (5 bytes, e.g. "H3001") followed by the MAC address
 * in reverse byte order, so the per-device key needs no cloud lookup.
 *
 * Counters are per-direction, start at 1, and increment by one per frame. They
 * reset on every connection, so a handshake is required per connection.
 *
 * No new dependencies: node:crypto provides aes-128-gcm and aes-128-ecb.
 */
import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// Application-wide constants, recovered from the Govee Home app's string
// resources (LibTools KEY_COMMUNICATION_X / _Y).
const KEY_HANDSHAKE = Buffer.from('fc03783c7c42cb83e202a1643648aff6', 'hex')
const KEY_DEVICE = Buffer.from('ae028b630bae6ecc4bff1b249e22f955', 'hex')

const TAG_LEN = 12 // 96-bit tag; the app falls back to 128-bit
const HDR = { MAGIC0: 0xE7, MAGIC1: 0x11, SUB_REQUEST: 0x01, STATUS_OK: 0x00 }

/** True if `data` is an e711 handshake frame rather than a data frame. */
export function isHandshakeFrame(data) {
  return data.length >= 3 && data[0] === HDR.MAGIC0 && data[1] === HDR.MAGIC1
}

function gcmSeal(key, iv, aad, plaintext) {
  const c = createCipheriv('aes-128-gcm', key, iv, { authTagLength: TAG_LEN })
  c.setAAD(aad)
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()])
}

function gcmOpen(key, iv, blob, aad) {
  const d = createDecipheriv('aes-128-gcm', key, iv, { authTagLength: TAG_LEN })
  d.setAAD(aad)
  d.setAuthTag(blob.subarray(blob.length - TAG_LEN))
  return Buffer.concat([d.update(blob.subarray(0, blob.length - TAG_LEN)), d.final()]) // throws on a bad tag
}

/**
 * Build the handshake to write first on every new connection.
 * Returns { frame, txIvKey } -- keep txIvKey, it seeds the nonce for writes.
 */
export function buildHandshake(txIvKey = randomBytes(8), iv = randomBytes(12)) {
  const frame = Buffer.alloc(36)
  frame[0] = HDR.MAGIC0
  frame[1] = HDR.MAGIC1
  frame[2] = HDR.SUB_REQUEST
  iv.copy(frame, 3)
  frame[15] = TAG_LEN
  gcmSeal(KEY_HANDSHAKE, iv, frame.subarray(0, 16), txIvKey).copy(frame, 16)
  return { frame, txIvKey }
}

/**
 * Parse the light's handshake reply. Returns { rxIvKey, devInfo, sku, mac }.
 * Throws if the GCM tag does not verify or the device reports an error status.
 */
export function parseHandshakeResponse(frame) {
  if (!isHandshakeFrame(frame)) {
    throw new Error(`not an e711 response: ${frame.subarray(0, 4).toString('hex')}`)
  }
  if (frame[2] !== HDR.STATUS_OK) {
    throw new Error(`handshake rejected, status 0x${frame[2].toString(16)}`)
  }
  // Note the AAD here is 15 bytes: the reply carries no tag-length byte.
  const blob = gcmOpen(KEY_HANDSHAKE, frame.subarray(3, 15), frame.subarray(15), frame.subarray(0, 15))
  if (blob.length !== 19) {
    throw new Error(`expected a 19-byte handshake blob, got ${blob.length}`)
  }
  const devInfo = blob.subarray(8, 19)
  return {
    rxIvKey: blob.subarray(0, 8),
    devInfo,
    sku: devInfo.subarray(0, 5).toString('ascii'),
    mac: Buffer.from(devInfo.subarray(5, 11)).reverse().toString('hex').replace(/(..)(?=.)/g, '$1:'),
  }
}

/** deviceKey = AES-128-ECB-encrypt(KEY_DEVICE, devInfo padded to 16 with zeros). */
function deriveDeviceKey(devInfo) {
  const block = Buffer.alloc(16)
  devInfo.copy(block)
  const c = createCipheriv('aes-128-ecb', KEY_DEVICE, null)
  c.setAutoPadding(false)
  return Buffer.concat([c.update(block), c.final()])
}

/** Per-connection session, wrapping outgoing 20-byte frames. */
export class V2Session {
  constructor({ txIvKey, devInfo }) {
    this.txIvKey = txIvKey
    this.deviceKey = deriveDeviceKey(devInfo)
    this.txCounter = 1
  }

  /** Wrap a plain 20-byte Govee frame for writing. */
  seal(frame20, counter = this.txCounter) {
    const ctr = Buffer.alloc(4)
    ctr.writeUInt32BE(counter >>> 0, 0)
    const out = Buffer.concat([
      ctr,
      gcmSeal(this.deviceKey, Buffer.concat([this.txIvKey, ctr]), ctr, frame20),
    ])
    if (counter === this.txCounter) {
      this.txCounter += 1
    }
    return out
  }
}
