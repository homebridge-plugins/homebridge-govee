import { describe, expect, it, vi } from 'vitest'

import OpenApiClient from '../lib/connection/openapi.js'
import devicePurifierH7120 from '../lib/device/purifier-H7120.js'
import devicePurifierH7126 from '../lib/device/purifier-H7126.js'
import GoveePlatform from '../lib/platform.js'
import { parseDeviceUpdate } from '../lib/utils/response-parser.js'
import { makeAccessory, makePlatform } from './harness.js'

/**
 * Govee's OpenAPI reports how much life a purifier's filter has left, as a
 * percentage, under `filterLifeTime`. Nothing read it, so the Home app could
 * never say when a filter was due.
 */

const FILTER = { type: 'devices.capabilities.property', instance: 'filterLifeTime' }

function build(handler, model, capabilities = { filterLifeTime: FILTER }) {
  const accessory = makeAccessory(model, { openApiCapabilities: capabilities })
  const device = new handler(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

// The OpenAPI state request, answered with the capabilities given
async function stateFromOpenApi(capabilities) {
  const client = new OpenApiClient({
    config: { apiKey: 'test-key' },
    log: Object.assign(() => {}, {
      warn: () => {},
      debug: () => {},
    }),
  })
  client.request = async () => ({
    payload: { capabilities },
  })
  return client.getState('H7126', 'AA:BB')
}

describe('a purifier that reports its filter life', () => {
  it('reads the filter life from the openapi state', async () => {
    const state = await stateFromOpenApi([
      {
        ...FILTER,
        state: { value: 42 },
      },
    ])

    expect(state.filterLife).toBe(42)
  })

  it('shows it on a filter tile inside the purifier', async () => {
    const device = build(devicePurifierH7126, 'H7126')
    const state = await stateFromOpenApi([
      {
        ...FILTER,
        state: { value: 42 },
      },
    ])
    device.externalUpdate(parseDeviceUpdate({ source: 'OPENAPI', state }, device.accessory.context))

    const filter = device.accessory.getService('FilterMaintenance')
    expect(filter.getCharacteristic('FilterLifeLevel').value).toBe(42)
    expect(filter.getCharacteristic('FilterChangeIndication').value).toBe(0)
    expect(device.service.linked).toContain(filter)
  })

  it('asks for a change once the filter is nearly done', () => {
    const device = build(devicePurifierH7120, 'H7120')
    device.externalUpdate(parseDeviceUpdate({
      source: 'OPENAPI',
      state: { filterLife: 8 },
    }, device.accessory.context))

    expect(device.accessory.getService('FilterMaintenance').getCharacteristic('FilterChangeIndication').value).toBe(1)
  })

  it('gets no filter tile when the device does not report one', () => {
    const device = build(devicePurifierH7126, 'H7126', {})

    expect(device.accessory.getService('FilterMaintenance')).toBeUndefined()
  })
})

/**
 * A purifier on AWS is not polled over the OpenAPI, as AWS already brings its
 * state. Its filter life only comes from the OpenAPI though, so that is still
 * asked for - once an hour, as it changes over weeks.
 */
describe('asking an aws purifier for its filter life', () => {
  function accessory(capabilities) {
    return {
      UUID: 'uuid-1',
      context: { openApiCapabilities: capabilities },
    }
  }

  it('asks once an hour', () => {
    vi.useFakeTimers()
    const platform = Object.assign(new GoveePlatform(), {
      openApiReadingAsked: new Map(),
    })
    const purifier = accessory({ filterLifeTime: FILTER })

    expect(platform.openApiOnlyReadingDue(purifier)).toBe(true)
    expect(platform.openApiOnlyReadingDue(purifier)).toBe(false)
    vi.advanceTimersByTime(3600000)
    expect(platform.openApiOnlyReadingDue(purifier)).toBe(true)
    vi.useRealTimers()
  })

  it('never asks a device with no such reading', () => {
    const platform = Object.assign(new GoveePlatform(), {
      openApiReadingAsked: new Map(),
    })

    expect(platform.openApiOnlyReadingDue(accessory({}))).toBe(false)
  })
})
