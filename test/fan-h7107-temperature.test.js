import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import deviceFanH7107 from '../lib/device/fan-H7107.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * The H7107 reports the room temperature from its own sensor in an `aa 10`
 * status frame, and nothing read it (#1394). The reading is in Fahrenheit, as
 * the Govee app reads it for this model, so 21.1°C arrives as 69.9°F.
 */

// Build an `aa 10` frame, with its XOR checksum, as the fan sends it over AWS
function frame(flags, reading) {
  const bytes = [
    0xAA,
    0x10,
    flags,
    (reading >> 16) & 0xFF,
    (reading >> 8) & 0xFF,
    reading & 0xFF,
  ]
  while (bytes.length < 19) {
    bytes.push(0)
  }
  bytes.push(bytes.reduce((a, b) => a ^ b, 0))
  return Buffer.from(bytes).toString('base64')
}

function build() {
  const accessory = makeAccessory('H7107')
  const device = new deviceFanH7107(makePlatform(), accessory)
  return { accessory, device }
}

function temperature(accessory) {
  return accessory.getService('TemperatureSensor')?.getCharacteristic('CurrentTemperature').value
}

describe('h7107 room temperature', () => {
  it('reads the frame from #1394 as the 21.1°C the Govee app showed', () => {
    const { accessory, device } = build()
    // The exact frame from the reporter's log, while the app showed 21.1°C
    device.externalUpdate({
      source: 'AWS',
      commands: ['qhCBCq2YAAAAAAAAAAAAAAAAAAQ='],
    })
    expect(temperature(accessory)).toBe(21.1)
  })

  it('adds no temperature tile until the fan sends a reading', () => {
    const { accessory } = build()
    expect(accessory.getService('TemperatureSensor')).toBeUndefined()
  })

  it('reads a temperature below freezing', () => {
    const { accessory, device } = build()
    // 14.0°F with the sign bit clear is -10°C
    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame(0x80, 140000),
      ],
    })
    expect(temperature(accessory)).toBe(-10)
    // Bit 23 set makes the Fahrenheit value itself negative: -4.0°F is -20°C
    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame(0x80, 0x800000 | 40000),
      ],
    })
    expect(temperature(accessory)).toBe(-20)
  })

  it('ignores a frame with no reading, or one from a linked thermometer only', () => {
    const { accessory, device } = build()
    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame(0x80, 0xFFFFFF),
      ],
    })
    device.externalUpdate({
      source: 'AWS',
      commands: [
        frame(0x01, 699800),
      ],
    })
    expect(accessory.getService('TemperatureSensor')).toBeUndefined()
  })

  it('no longer reports the frame as unknown', () => {
    const { accessory, device } = build()
    device.externalUpdate({
      source: 'AWS',
      commands: ['qhCBCq2YAAAAAAAAAAAAAAAAAAQ='],
    })
    const logged = [
      ...accessory.log.messages(),
      ...accessory.logDebug.messages(),
    ]
    expect(logged.some(line => line.includes('aa1081'))).toBe(false)
  })
})
