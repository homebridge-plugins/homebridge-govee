import { describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import GoveePlatform from '../lib/platform.js'
import { buildCommand } from '../lib/utils/command-builder.js'
import { deviceIdFor, makePlatform } from './harness.js'

/**
 * The H713B heater, back on the handler it worked on.
 *
 * Until v10 it sat with the heater2 models, sent its commands over AWS as
 * `multiSync`, and showed its night light - an owner confirmed it working on
 * the same firmware as today's reporter (#569). Moved in with the H7130, it
 * sends `ptReal` instead, which the heater acknowledges and then ignores, for
 * power and target temperature alike (#1386).
 */
function buildH713B() {
  const sent = []
  const instance = new GoveePlatform()
  Object.assign(instance, makePlatform({
    sendDeviceUpdate: async (_accessory, params) => sent.push(params),
  }))
  const device = {
    device: deviceIdFor('H713B'),
    deviceName: 'H713B',
    model: 'H713B',
  }
  instance.initialiseDevice(device)
  const accessory = instance.accessories.get(instance.api.hap.uuid.generate(device.device))
  return { accessory, sent }
}

describe('the H713B heater', () => {
  it('is set up on the heater2 handler', () => {
    const { accessory } = buildH713B()

    expect(accessory.control).toBeInstanceOf(deviceTypes.deviceHeater2)
  })

  it('switches power with a command AWS sends as multiSync', async () => {
    const { accessory, sent } = buildH713B()
    accessory.control.cacheState = 'on'

    await accessory.control.internalStateUpdate(0)

    expect(sent).toHaveLength(1)
    expect(buildCommand(sent[0]).awsParams.cmd).toBe('multiSync')
  })
})
