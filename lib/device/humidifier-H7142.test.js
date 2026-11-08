import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceHumidifier from './humidifier-H7142.js'

/**
 * The H7142 reports humidity as aa 10 <flags> <3-byte reading>. Flag bit 7 is
 * its own sensor, bit 0 a linked thermometer. The reading holds a temperature
 * in its thousands and the humidity in tenths of a percent below that (#1294).
 */

function build() {
  const accessory = makeAccessory('H7142')
  const device = new deviceHumidifier(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

/** A status frame as the device sends it, base64 over AWS. */
function frame(hex) {
  return Buffer.from(hex.replace(/ /g, ''), 'hex').toString('base64')
}

function humidity(device) {
  return device.humiService.getCharacteristic('CurrentRelativeHumidity').value
}

describe('the h7142 humidity reading', () => {
  it('reads the humidifier\'s own sensor, as this one reported at 53%', () => {
    const device = build()

    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame('aa 10 81 00 02 12 00 00 00 00 00 00 00 00 00 00 00 00 00 2b'),
      ],
    })

    expect(humidity(device)).toBe(53)
  })

  it('leaves out the temperature a linked thermometer adds to the reading', () => {
    const device = build()

    // 22.5°C and 53.0% is 225530, or 03 70 fa
    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame('aa 10 01 03 70 fa 00 00 00 00 00 00 00 00 00 00 00 00 00 00'),
      ],
    })

    expect(humidity(device)).toBe(53)
  })

  it('keeps the last humidity when the sensor has no reading', () => {
    const device = build()
    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame('aa 10 81 00 02 12 00 00 00 00 00 00 00 00 00 00 00 00 00 2b'),
      ],
    })

    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame('aa 10 81 ff ff ff 00 00 00 00 00 00 00 00 00 00 00 00 00 00'),
      ],
    })

    expect(humidity(device)).toBe(53)
  })

  it('does not report its other known status frames as unrecognised', () => {
    const device = build()

    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame('aa 08 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 a2'),
        frame('aa 12 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 b8'),
        frame('aa 17 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 bd'),
        frame('aa 1e 02 02 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 b4'),
        frame('aa 30 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 9b'),
      ],
    })

    const logged = [
      ...device.accessory.logDebug.calls,
      ...device.accessory.logWarn.calls,
    ].flat().map(String)
    expect(logged.filter(line => line.includes('unrecognised'))).toEqual([])
  })
})
