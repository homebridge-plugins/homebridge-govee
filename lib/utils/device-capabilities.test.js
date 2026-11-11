import { describe, expect, it } from 'vitest'

import { COLOR_SUB } from './ble-protocol.js'
import { getDeviceCapabilities } from './device-capabilities.js'

/**
 * The bug these guard against (#1332): the H6102 was sent the 0x0D colour
 * command, which it accepts and then ignores, so on, off and brightness worked
 * while colour silently did nothing. Which colour command the strip wants
 * depends on its firmware, so the capability lookup has to take the version
 * into account rather than picking one for every H6102.
 */
describe('device capabilities', () => {
  it('gives an unlisted model the defaults', () => {
    const caps = getDeviceCapabilities('H0000')

    expect(caps.bleColorCmd).toEqual([COLOR_SUB.RGB_DEFAULT])
    expect(caps.bleColorCmdSuffix).toEqual([])
    expect(caps.bleBrightnessScale).toBe(0xFF)
  })

  describe('h6102 colour command by firmware', () => {
    it('uses the extended command from 1.03.01 upwards', () => {
      const caps = getDeviceCapabilities('H6102', '1.03.01')

      expect(caps.bleColorCmd).toEqual(COLOR_SUB.RGB_EXTENDED)
      expect(caps.bleColorCmdSuffix).toEqual([
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xFF,
        0x7F,
      ])
    })

    it('uses the extended command on later firmware too', () => {
      expect(getDeviceCapabilities('H6102', '1.06.00').bleColorCmd).toEqual(COLOR_SUB.RGB_EXTENDED)
    })

    it('keeps the standard command below 1.03.01', () => {
      const caps = getDeviceCapabilities('H6102', '1.02.99')

      expect(caps.bleColorCmd).toEqual([COLOR_SUB.RGB_DEFAULT])
      expect(caps.bleColorCmdSuffix).toEqual([])
    })

    it('keeps the standard command when the firmware is unknown', () => {
      expect(getDeviceCapabilities('H6102').bleColorCmd).toEqual([COLOR_SUB.RGB_DEFAULT])
    })

    it('keeps the brightness scale whatever the firmware', () => {
      expect(getDeviceCapabilities('H6102').bleBrightnessScale).toBe(0x64)
      expect(getDeviceCapabilities('H6102', '1.06.00').bleBrightnessScale).toBe(0x64)
    })
  })

  it('compares version parts as numbers, not text', () => {
    // "1.10.00" is newer than "1.03.01" even though it sorts earlier as text
    expect(getDeviceCapabilities('H6102', '1.10.00').bleColorCmd).toEqual(COLOR_SUB.RGB_EXTENDED)
    // and a shorter string is padded rather than treated as newer
    expect(getDeviceCapabilities('H6102', '1.3').bleColorCmd).toEqual([COLOR_SUB.RGB_DEFAULT])
  })

  it('leaves a firmware-gated model alone when another model matches', () => {
    // the H617A is not firmware gated, so its override applies at any version
    expect(getDeviceCapabilities('H617A', '1.00.00').bleColorCmd).toEqual(COLOR_SUB.RGB_EXTENDED)
  })
})
