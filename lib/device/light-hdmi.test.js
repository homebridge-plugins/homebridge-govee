import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { normalizeMqttMessage } from '../connection/openapi.js'
import { parseDeviceUpdate } from '../utils/response-parser.js'
import deviceLight from './light.js'

/**
 * The sync boxes' HDMI inputs (#1289). Govee's official API lists them as the
 * `hdmiSource` mode, as glodoski found, with options HDMI 1 to HDMI 4.
 */

const HDMI_SOURCE = {
  type: 'devices.capabilities.mode',
  instance: 'hdmiSource',
  parameters: {
    dataType: 'ENUM',
    options: [1, 2, 3, 4].map(value => ({ name: `HDMI ${value}`, value })),
  },
}

function build(context = {}) {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params)
    },
  })
  const accessory = makeAccessory('H6604', {
    useOpenApiControl: true,
    openApiCapabilities: { hdmiSource: HDMI_SOURCE },
    ...context,
  })
  const device = new deviceLight(platform, accessory)
  device.accessory = accessory
  return { accessory, device, sent }
}

function inputsOn(accessory) {
  return accessory.services
    .filter(service => /^hdmi\d$/.test(service.subtype ?? ''))
    .filter(service => service.getCharacteristic('On').value)
    .map(service => service.subtype)
}

describe('a sync box with hdmi inputs', () => {
  it('gets a switch for each input the api lists', () => {
    const { accessory } = build()

    const switches = accessory.services.filter(service => /^hdmi\d$/.test(service.subtype ?? ''))
    expect(switches.map(service => service.getCharacteristic('ConfiguredName').value))
      .toEqual(['HDMI 1', 'HDMI 2', 'HDMI 3', 'HDMI 4'])
  })

  it('gets none without the api key, as there is no other way to switch input', () => {
    const { accessory } = build({ useOpenApiControl: false })

    expect(accessory.services.filter(service => /^hdmi\d$/.test(service.subtype ?? ''))).toHaveLength(0)
  })

  it('picks an input through the api and shows only that one on', async () => {
    const { accessory, device, sent } = build()

    await device.internalHdmiUpdate(2, true)

    expect(sent).toEqual([
      {
        cmd: 'openApi',
        openApi: { instance: 'hdmiSource', capabilityType: 'devices.capabilities.mode', value: 2 },
      },
    ])
    expect(inputsOn(accessory)).toEqual(['hdmi2'])
  })

  it('follows the input the box reports', () => {
    const { accessory, device } = build()

    const state = normalizeMqttMessage({
      sku: 'H6604',
      capabilities: [
        {
          type: 'devices.capabilities.mode',
          instance: 'hdmiSource',
          state: { value: 3 },
        },
      ],
    })
    device.externalUpdate(parseDeviceUpdate({ source: 'OPENAPI', state }, accessory.context))

    expect(inputsOn(accessory)).toEqual(['hdmi3'])
  })

  it('sends nothing when the input in use is switched off', async () => {
    const { device, sent } = build()
    await device.internalHdmiUpdate(1, true)
    sent.length = 0

    await device.internalHdmiUpdate(1, false)

    expect(sent).toEqual([])
  })
})
