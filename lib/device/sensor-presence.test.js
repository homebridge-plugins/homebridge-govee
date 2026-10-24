import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { normalizeMqttMessage } from '../connection/openapi.js'
import { parseDeviceUpdate } from '../utils/response-parser.js'
import deviceSensorPresence from './sensor-presence.js'

/**
 * Govee's live connection sends the same event, `bodyAppearedEvent`, for two
 * different sensors. On a leak sensor 1 means wet and 2 dry (#1312). On a
 * presence sensor 1 means someone is there. Every one was read as a leak, so a
 * presence sensor's update reached nothing that could show it.
 */

function event(sku, value) {
  return {
    sku,
    device: 'AA:BB',
    capabilities: [
      {
        type: 'devices.capabilities.event',
        instance: 'bodyAppearedEvent',
        state: [
          { name: 'synthetic', value },
        ],
      },
    ],
  }
}

// The path a live message takes, from the connection to the device's handler
function deliver(device, message) {
  const state = normalizeMqttMessage(message)
  device.externalUpdate(parseDeviceUpdate({ source: 'OPENAPI', state }, device.accessory.context))
}

function build() {
  const accessory = makeAccessory('H5127')
  const device = new deviceSensorPresence(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

describe('a presence event from the live connection', () => {
  it('shows someone there', () => {
    const device = build()
    deliver(device, event('H5127', 1))

    expect(device.service.getCharacteristic('OccupancyDetected').value).toBe(1)
  })

  it('shows nobody there once they leave', () => {
    const device = build()
    deliver(device, event('H5127', 1))
    deliver(device, event('H5127', 2))

    expect(device.service.getCharacteristic('OccupancyDetected').value).toBe(0)
  })

  it('still reads the same event as a leak on a leak sensor', () => {
    expect(normalizeMqttMessage(event('H5058', 1))).toEqual({ leakDetected: true })
    expect(normalizeMqttMessage(event('H5058', 2))).toEqual({ leakDetected: false })
  })
})
