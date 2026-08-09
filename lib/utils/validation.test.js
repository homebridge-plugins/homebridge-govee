import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { decodeAny } from './decode.js'
import { isHt5074, isHt5075, isHt5101, isHt5179, isValidPeripheral } from './validation.js'

function peripheral(hex) {
  return { advertisement: { manufacturerData: Buffer.from(hex, 'hex') } }
}

// Real broadcasts from a reporter's H607C and H706C lights, which the plugin
// drives over aws/lan/ble and never reads a sensor value from (#1350).
const LIGHT_BROADCASTS = ['4388ec00020100', '4388ec00030100', '0388ec00010200']

describe('isHt5101', () => {
  // ⚠️ The bug. `0100` is four hex digits, and it lands inside broadcasts from
  // devices that are not sensors at all. Without a length check those were
  // claimed for the H5101 decoder, which needs sixteen characters and threw on
  // fourteen - so a working light logged "error processing discovered
  // peripheral" on every broadcast it sent.
  it.each(LIGHT_BROADCASTS)('does not claim the light broadcast %s', (hex) => {
    expect(isHt5101(hex)).toBe(false)
  })

  it('still recognises a broadcast long enough for the decoder to read', () => {
    expect(isHt5101('0100000186a05a00')).toBe(true)
  })

  // The guard has to agree with what decodeH5101Values actually reads, or one
  // of the two is wrong. It reads up to character sixteen.
  it('accepts exactly the length the decoder needs, and one short of it fails', () => {
    expect(isHt5101('0100000186a05a00')).toBe(true)
    expect(isHt5101('0100000186a05a0')).toBe(false)
  })

  // Deliberately >= rather than ===, unlike its siblings: the H5111 and H5220
  // share this format and there is no sample of either to prove their length.
  it('does not reject a longer payload of the same family', () => {
    expect(isHt5101('0100000186a05a00ffff')).toBe(true)
  })
})

describe('isValidPeripheral', () => {
  // The gate that matters. A broadcast that fails it goes to the "unrecognised
  // broadcast" report, which says it once and stays quiet; one that passes goes
  // to a decoder that throws if it guessed wrong.
  it.each(LIGHT_BROADCASTS)('sends the light broadcast %s to the unrecognised path', (hex) => {
    expect(isValidPeripheral(peripheral(hex))).toBe(false)
  })

  it('has nothing to say about an advertisement with no manufacturer data', () => {
    expect(isValidPeripheral({ advertisement: {} })).toBe(false)
    expect(isValidPeripheral({})).toBe(false)
  })
})

describe('decodeAny no longer throws on those broadcasts', () => {
  // Before the guard, two of these reached decodeH5101Values and threw
  // "H5101 stream too short". They are simply not sensor broadcasts.
  it.each(LIGHT_BROADCASTS)('reports %s as unsupported rather than as a short H5101', (hex) => {
    expect(() => decodeAny(hex)).toThrow(/Unsupported stream update/)
  })
})

describe('the sibling checks still pin an exact length', () => {
  it('keeps H5074, H5075 and H5179 as they were', () => {
    expect(isHt5074('88ec0011112222330000')).toBe(false) // 20, wants 18
    expect(isHt5075('88ec001111222233')).toBe(true)
    expect(isHt5075('88ec0011112222')).toBe(false)
    expect(isHt5179('0188') && isHt5179('01880011112222334455')).toBe(false)
  })
})
