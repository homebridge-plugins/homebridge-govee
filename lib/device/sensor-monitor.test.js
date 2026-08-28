import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceSensorMonitor from './sensor-monitor.js'

function build(context = {}) {
  const accessory = makeAccessory('H5106', {
    offTemp: 0,
    offHumi: 0,
    ...context,
  })
  const device = new deviceSensorMonitor(makePlatform(), accessory)
  return device
}

function readings(device) {
  return {
    temperature: device.tempService.getCharacteristic('CurrentTemperature').value,
    humidity: device.humiService.getCharacteristic('CurrentRelativeHumidity').value,
  }
}

// Synthetic H5106 status frame: bytes 1-2 are temperature in hundredths,
// bytes 10-11 are humidity in hundredths, and bytes 19-20 are PM2.5.
const COMPACT_STATUS_HEX = '092e0000000000000015b800000000000000000c'
const commandFromHex = hex => Buffer.from(hex, 'hex').toString('base64')

describe('the monitor sensor readings', () => {
  it('ignores a command ack frame instead of reading it as an impossible temperature (#1296)', async () => {
    // `33 18 ...` is an ack, but the catch-all frame parser read its leading
    // bytes as 13080 hundredths - so the owner's room showed 130.8°C / 267.4°F
    const device = build()
    await device.externalUpdate({ temperature: 2430, humidity: 5100 })

    await device.externalUpdate({ commands: [commandFromHex('3318000000000000000000000000000000000000')] })

    expect(readings(device)).toEqual({ temperature: 24.3, humidity: 51 })
  })

  it('normalises raw hundredths into HomeKit temperature and humidity', async () => {
    const device = build()

    await device.externalUpdate({ temperature: 2150, humidity: 5560 })

    expect(readings(device)).toEqual({ temperature: 21.5, humidity: 55.6 })
  })

  it('applies configured temperature and humidity offsets before normalising', async () => {
    const device = build({ offTemp: 150, offHumi: -250 })

    await device.externalUpdate({ temperature: 2150, humidity: 5560 })

    expect(readings(device)).toEqual({ temperature: 23, humidity: 53.1 })
  })

  it('keeps humidity within HomeKit’s zero to one-hundred range', async () => {
    const device = build()

    await device.externalUpdate({ humidity: 10001 })
    expect(readings(device).humidity).toBe(100)

    await device.externalUpdate({ humidity: -1 })
    expect(readings(device).humidity).toBe(0)
  })

  it('keeps valid readings when a later update is missing or malformed', async () => {
    const device = build()
    await device.externalUpdate({ temperature: 2150, humidity: 5560 })

    await device.externalUpdate({})
    await device.externalUpdate({ temperature: 'not-a-number', humidity: 'not-a-number' })

    expect(readings(device)).toEqual({ temperature: 21.5, humidity: 55.6 })
  })

  it('decodes compact twenty-byte monitor status frames', async () => {
    const device = build()

    await device.externalUpdate({ commands: [commandFromHex(COMPACT_STATUS_HEX)] })

    expect(readings(device)).toEqual({ temperature: 23.5, humidity: 56 })
    expect(device.airService.getCharacteristic('PM2_5Density').value).toBe(12)
  })

  it('ignores monitor status frames shorter than twenty bytes', async () => {
    const device = build()

    await device.externalUpdate({ commands: [commandFromHex(COMPACT_STATUS_HEX.slice(0, -2))] })

    expect(readings(device)).toEqual({ temperature: 0, humidity: 0 })
  })

  it('keeps decoding legacy monitor status frames with a trailing byte', async () => {
    const device = build()

    await device.externalUpdate({ commands: [commandFromHex(`${COMPACT_STATUS_HEX}00`)] })

    expect(readings(device)).toEqual({ temperature: 23.5, humidity: 56 })
    expect(device.airService.getCharacteristic('PM2_5Density').value).toBe(12)
  })
})
