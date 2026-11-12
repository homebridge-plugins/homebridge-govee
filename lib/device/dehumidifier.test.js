import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceDehumidifier from './dehumidifier-H7150.js'

/**
 * The H7152 used to have its own copy of this file, which only logged the mode
 * it was told about and never moved the speed slider. Sharing the handler gives
 * it the same speed feedback the H7150 and H7151 already had.
 *
 * The model snapshot cannot see this - it covers which controls a device is
 * given, not what a status report does to them.
 */

function build(model) {
  const accessory = makeAccessory(model)
  const device = new deviceDehumidifier(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

describe.each(['H7150', 'H7151', 'H7152'])('speed feedback on the %s', (model) => {
  it('moves the slider to the speed the device reports', () => {
    const device = build(model)

    device.externalUpdate({
      workMode: { workMode: 1, modeValue: 5 },
    })

    expect(device.cacheSpeed).toBe(5)
    expect(device.service.getCharacteristic('RotationSpeed').value).toBe(5)
  })

  it('ignores a speed outside the range this device has', () => {
    const device = build(model)

    device.externalUpdate({
      workMode: { workMode: 1, modeValue: 99 },
    })

    expect(device.service.getCharacteristic('RotationSpeed').value).not.toBe(99)
  })

  it('does not log the same speed twice', () => {
    const device = build(model)
    device.externalUpdate({
      workMode: { workMode: 1, modeValue: 3 },
    })
    const afterFirst = device.accessory.log.calls.length

    device.externalUpdate({
      workMode: { workMode: 1, modeValue: 3 },
    })

    expect(device.accessory.log.calls.length).toBe(afterFirst)
  })
})
