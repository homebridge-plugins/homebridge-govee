import { describe, expect, it } from 'vitest'

import { awsBrightnessIsScaled } from './device-capabilities.js'
import { parseDeviceUpdate } from './response-parser.js'

/**
 * AWS brightness is 0-100 for most models and 0-254 for a few. The plugin
 * carried a list of the 0-254 models from 2021 to 2023, flipped to scaling
 * everything with a per-device opt-out, and then had to grow that opt-out list
 * release after release (#1321, #1347, #1352, #1223, #1364) - while dropping
 * the scaling altogether broke the 0-254 models the other way (#1262). So the
 * default is 0-100 again, with the 0-254 models listed.
 */
describe('which scale a device uses for AWS brightness', () => {
  it('is 0-100 unless the model is listed', () => {
    expect(awsBrightnessIsScaled({ gvModel: 'H601A' })).toBe(false)
    expect(awsBrightnessIsScaled({ gvModel: 'H6010' })).toBe(false)
    expect(awsBrightnessIsScaled({ gvModel: 'H1310' })).toBe(false)
    expect(awsBrightnessIsScaled({ gvModel: 'HXXXX' })).toBe(false)
  })

  it('is 0-254 for the listed models', () => {
    ;['H6054', 'H6143', 'H6144', 'H6002', 'H6083', 'H6085', 'H6135', 'H6137', 'H7005'].forEach((model) => {
      expect(awsBrightnessIsScaled({ gvModel: model })).toBe(true)
    })
  })

  it('follows the device config over the list, with no-scale winning', () => {
    expect(awsBrightnessIsScaled({ gvModel: 'H6054', awsBrightnessNoScale: true })).toBe(false)
    expect(awsBrightnessIsScaled({ gvModel: 'H601A', awsBrightnessScale: true })).toBe(true)
    expect(awsBrightnessIsScaled({ gvModel: 'H601A', awsBrightnessScale: true, awsBrightnessNoScale: true })).toBe(false)
  })
})

describe('reading an AWS brightness report', () => {
  it('takes a 0-100 report as it is', () => {
    // the H601A site's status echoes: rescaling these showed 5% for a full light (#1364)
    const data = parseDeviceUpdate({ source: 'AWS', state: { brightness: 100 } }, { gvModel: 'H601A' })
    expect(data.brightness).toBe(100)
  })

  it('brings a 0-254 report down to 0-100 for a listed model', () => {
    const data = parseDeviceUpdate({ source: 'AWS', state: { brightness: 254 } }, { gvModel: 'H6054' })
    expect(data.brightness).toBe(100)
    expect(parseDeviceUpdate({ source: 'AWS', state: { brightness: 127 } }, { gvModel: 'H6054' }).brightness).toBe(50)
  })

  it('never rescales a report from another connection', () => {
    expect(parseDeviceUpdate({ source: 'LAN', state: { brightness: 100 } }, { gvModel: 'H6054' }).brightness).toBe(100)
  })
})
