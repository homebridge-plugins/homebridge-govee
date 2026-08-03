import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { buildHandshake, isHandshakeFrame, parseHandshakeResponse, V2Session } from './ble-crypto.js'
import { BLE_STAGE_TIMEOUTS, BLE_UPDATE_TIMEOUT } from './ble-protocol.js'
import { getDeviceCapabilities } from './device-capabilities.js'

/**
 * Vectors below are real frames captured from the official Govee app driving an
 * H3001, so these tests pin the implementation to observed device behaviour
 * rather than to itself.
 */
const HS_REQUEST = Buffer.from('e711010e02e79909b331d0601c9d370cfa8a05bc90a0ff9095c658d69f9c03c63a5f6d5d', 'hex')
const HS_RESPONSE = Buffer.from('e711004b42365199783477c70e12fd47c4b550a8f903b75415181afbe40044fd3ccccf0a5d5d878c04774f32d1de', 'hex')
const TX_IV_KEY = Buffer.from('636a4c22846bbcf8', 'hex')
const DEV_INFO = Buffer.from('48333030310f97dfc1c4fb', 'hex')
const DATA_FRAME = Buffer.from('00000001a99194e788ebeaf1d31d1600c05f61298b38e21dcfa0fdb0976cb57c9a10f11a', 'hex')
const DATA_PLAIN = Buffer.from('33090b010c0701fc000208ea07b85b6f6a0000c7', 'hex')

describe('bLE v2 handshake', () => {
  it('rebuilds the captured request byte for byte', () => {
    // Same ivKey and same GCM iv as the capture, so the output must match
    // exactly - this is what proves the AAD and layout are right.
    const { frame } = buildHandshake(TX_IV_KEY, HS_REQUEST.subarray(3, 15))
    expect(frame.toString('hex')).toBe(HS_REQUEST.toString('hex'))
    expect(frame).toHaveLength(36)
    expect(frame[15]).toBe(12) // declared tag length
  })

  it('generates a fresh key and iv each call', () => {
    const a = buildHandshake()
    const b = buildHandshake()
    expect(a.txIvKey.toString('hex')).not.toBe(b.txIvKey.toString('hex'))
    expect(a.frame.toString('hex')).not.toBe(b.frame.toString('hex'))
  })

  it('extracts the device identity from the reply', () => {
    const { devInfo, sku, mac } = parseHandshakeResponse(HS_RESPONSE)
    expect(devInfo.toString('hex')).toBe(DEV_INFO.toString('hex'))
    expect(sku).toBe('H3001')
    expect(mac).toBe('fb:c4:c1:df:97:0f')
  })

  it('rejects a reply whose authentication tag does not verify', () => {
    const tampered = Buffer.from(HS_RESPONSE)
    tampered[20] ^= 0x01
    expect(() => parseHandshakeResponse(tampered)).toThrow()
  })

  it('reports a non-zero status byte rather than trying to decrypt', () => {
    const rejected = Buffer.from(HS_RESPONSE)
    rejected[2] = 0x02
    expect(() => parseHandshakeResponse(rejected)).toThrow(/status/)
  })

  it('tells a handshake frame apart from a data frame', () => {
    expect(isHandshakeFrame(HS_REQUEST)).toBe(true)
    expect(isHandshakeFrame(HS_RESPONSE)).toBe(true)
    expect(isHandshakeFrame(DATA_FRAME)).toBe(false)
    expect(isHandshakeFrame(Buffer.from('e7', 'hex'))).toBe(false)
  })

  it('has its own timeout stage, inside the overall update budget', () => {
    expect(BLE_STAGE_TIMEOUTS.handshake).toBeGreaterThan(0)
    expect(BLE_UPDATE_TIMEOUT).toBeGreaterThan(
      BLE_STAGE_TIMEOUTS.connect + BLE_STAGE_TIMEOUTS.handshake + BLE_STAGE_TIMEOUTS.write,
    )
  })
})

describe('bLE v2 session', () => {
  const session = () => new V2Session({ txIvKey: TX_IV_KEY, devInfo: DEV_INFO })

  it('seals a command into the exact bytes the app sent', () => {
    // Matching the capture here also proves the device key derivation, since a
    // wrong key cannot produce these bytes.
    expect(session().seal(DATA_PLAIN, 1).toString('hex')).toBe(DATA_FRAME.toString('hex'))
  })

  it('numbers frames from one and increments per command', () => {
    const s = session()
    expect(s.seal(DATA_PLAIN).readUInt32BE(0)).toBe(1)
    expect(s.seal(DATA_PLAIN).readUInt32BE(0)).toBe(2)
    expect(s.seal(DATA_PLAIN).readUInt32BE(0)).toBe(3)
  })

  it('never repeats a nonce, so identical commands look different on air', () => {
    const s = session()
    expect(s.seal(DATA_PLAIN).toString('hex')).not.toBe(s.seal(DATA_PLAIN).toString('hex'))
  })

  it('adds 16 bytes of overhead: 4 counter plus a 12 byte tag', () => {
    expect(session().seal(DATA_PLAIN)).toHaveLength(DATA_PLAIN.length + 16)
  })
})

describe('h3001 capabilities', () => {
  it('selects the encrypted transport, and leaves every other model alone', () => {
    expect(getDeviceCapabilities('H3001').bleEncryption).toBe('v2')
    expect(getDeviceCapabilities('H6199').bleEncryption).toBe(false)
    expect(getDeviceCapabilities('H615B').bleEncryption).toBe(false)
    expect(getDeviceCapabilities('unknown-model').bleEncryption).toBe(false)
  })

  it('builds the colour frame the light actually accepts', () => {
    // Mirrors buildColorCommand: [...bleColorCmd, r, g, b, ...suffix]
    const caps = getDeviceCapabilities('H3001')
    const data = [...caps.bleColorCmd, 0xFF, 0x00, 0x00, ...caps.bleColorCmdSuffix]
    expect(Buffer.from([0x33, 0x05, ...data]).toString('hex'))
      .toBe('33051501ff00000000000000ff')
  })

  it('scales brightness to the 0-100 range this model expects', () => {
    const { bleBrightnessScale } = getDeviceCapabilities('H3001')
    expect(Math.floor((30 / 100) * bleBrightnessScale)).toBe(0x1E)
    expect(Math.floor((100 / 100) * bleBrightnessScale)).toBe(0x64)
  })
})
