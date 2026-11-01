import { describe, expect, it } from 'vitest'

import { awsBrightnessIsScaled } from '../lib/utils/device-capabilities.js'
import { applyDeviceContext } from '../lib/utils/device-context.js'

/**
 * A light's AWS brightness can be forced either way with two per-device
 * settings. Only "no scale" used to be copied onto the device, so ticking
 * "AWS Brightness Scale To 254" did nothing.
 */
function setUp(deviceConf) {
  const accessory = {
    context: { gvModel: 'H6199' },
    displayName: 'Light',
  }
  const device = {
    device: 'AA:BB:CC:DD:EE:FF:00:11',
    deviceName: 'Light',
    httpInfo: {
      deviceExt: {
        deviceSettings: JSON.stringify({ topic: 'GD/abc' }),
      },
    },
  }
  const platform = {
    awsClient: {},
    log: {
      debugWarn: () => {},
    },
  }
  applyDeviceContext(platform, accessory, device, deviceConf, {
    awsDevices: [],
    awsDevicesToPoll: [],
    doAWSPolling: false,
  })
  return accessory.context
}

describe('the aws brightness settings', () => {
  it('scales a light when its scale setting is ticked', () => {
    expect(awsBrightnessIsScaled(setUp({ awsBrightnessScale: true }))).toBe(true)
  })

  it('does not scale it when the no-scale setting is ticked', () => {
    expect(awsBrightnessIsScaled(setUp({ awsBrightnessNoScale: true }))).toBe(false)
  })
})
