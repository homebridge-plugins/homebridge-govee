import { describe, expect, it } from 'vitest'

import { normalizeMqttMessage } from '../lib/connection/openapi.js'
import deviceHumidifierH7141 from '../lib/device/humidifier-H7141.js'
import { parseDeviceUpdate } from '../lib/utils/response-parser.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * Govee's live connection says when a humidifier's tank has run dry, as
 * `lackWaterEvent`, and nothing read it. There is no event for a tank filled
 * again, so a humidifier switched back on is taken as the refill.
 */

const EVENT = { type: 'devices.capabilities.event', instance: 'lackWaterEvent' }

// The tank shows as a contact sensor: closed with water, open once empty
const CLOSED = 0
const OPEN = 1

function build(capabilities = { lackWaterEvent: EVENT }) {
  const accessory = makeAccessory('H7141', { openApiCapabilities: capabilities })
  const device = new deviceHumidifierH7141(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

function tank(device) {
  return device.accessory.getService('Water Tank').getCharacteristic('ContactSensorState').value
}

// The path a live message takes, from the connection to the device's handler
function deliverEvent(device) {
  const state = normalizeMqttMessage({
    sku: 'H7141',
    device: 'AA:BB',
    capabilities: [
      {
        ...EVENT,
        state: [
          { name: 'lack', value: 1 },
        ],
      },
    ],
  })
  device.externalUpdate(parseDeviceUpdate({ source: 'OPENAPI', state }, device.accessory.context))
}

describe('a humidifier running out of water', () => {
  it('opens the water tank tile', () => {
    const device = build()
    deliverEvent(device)

    expect(tank(device)).toBe(OPEN)
  })

  it('stays empty while the humidifier is off', () => {
    const device = build()
    device.externalUpdate({ state: 'off' })
    deliverEvent(device)
    device.externalUpdate({ state: 'off' })

    expect(tank(device)).toBe(OPEN)
  })

  it('closes again once the humidifier is switched back on', () => {
    const device = build()
    device.externalUpdate({ state: 'off' })
    deliverEvent(device)
    device.externalUpdate({ state: 'on' })

    expect(tank(device)).toBe(CLOSED)
  })

  it('gets no tile when the device does not report its tank', () => {
    const device = build({})

    expect(device.accessory.getService('Water Tank')).toBeUndefined()
  })
})
