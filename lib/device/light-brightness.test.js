import { describe, expect, it, vi } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import GoveePlatform from '../platform.js'
import { buildCommand } from '../utils/command-builder.js'
import { isCommandAcknowledgement, parseDeviceUpdate } from '../utils/response-parser.js'
import deviceLight from './light.js'

function build(model = 'H6008') {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params)
    },
  })
  const accessory = makeAccessory(model, { useAwsControl: true })
  const device = new deviceLight(platform, accessory)
  device.accessory = accessory
  device.initialised = true
  device.cacheState = 'on'
  device.cacheBright = 40
  device.cacheBrightRaw = 40
  device.service.updateCharacteristic('Brightness', 40)
  return { device, sent }
}

async function homekitBrightness(device, value) {
  const characteristic = device.service.getCharacteristic('Brightness')
  await characteristic.setHandler(value)
  characteristic.value = value
}

function awsBrightness(device, brightness) {
  const report = parseDeviceUpdate(
    { source: 'AWS', state: { brightness } },
    { gvModel: device.accessory.context.gvModel },
  )
  device.externalUpdate(report)
}

describe('reported brightness after a HomeKit write', () => {
  it('corrects an optimistic 80% when the bulb still reports 40%', async () => {
    const { device, sent } = build()
    await homekitBrightness(device, 80)

    expect(sent).toEqual([{ cmd: 'brightness', value: 80 }])
    expect(device.cacheBright).toBe(80)
    expect(device.cacheBrightRaw).toBe(40)
    expect(device.service.getCharacteristic('Brightness').value).toBe(80)

    awsBrightness(device, 40)
    expect(device.cacheBrightRaw).toBe(40)
    expect(device.cacheBright).toBe(40)
    expect(device.service.getCharacteristic('Brightness').value).toBe(40)
  })

  it('records a matching report without another HomeKit update', async () => {
    const { device } = build()
    await homekitBrightness(device, 80)
    const update = vi.spyOn(device.service, 'updateCharacteristic')

    awsBrightness(device, 80)
    expect(device.cacheBrightRaw).toBe(80)
    expect(device.cacheBright).toBe(80)
    expect(device.service.getCharacteristic('Brightness').value).toBe(80)
    expect(update).not.toHaveBeenCalledWith('Brightness', 80)
  })

  it('does not update an already stable characteristic', () => {
    const { device } = build()
    const update = vi.spyOn(device.service, 'updateCharacteristic')

    awsBrightness(device, 40)
    expect(update).not.toHaveBeenCalledWith('Brightness', 40)
  })

  it('follows old and then new reports in arrival order', async () => {
    const { device } = build()
    await homekitBrightness(device, 80)

    awsBrightness(device, 40)
    expect(device.service.getCharacteristic('Brightness').value).toBe(40)
    awsBrightness(device, 80)
    expect(device.cacheBrightRaw).toBe(80)
    expect(device.cacheBright).toBe(80)
    expect(device.service.getCharacteristic('Brightness').value).toBe(80)
  })

  it('keeps the latest value from a rapid slider drag', async () => {
    const { device, sent } = build()
    await Promise.all([20, 40, 60, 80].map(value => homekitBrightness(device, value)))

    expect(sent).toEqual([{ cmd: 'brightness', value: 80 }])
    expect(device.cacheBright).toBe(80)
  })

  it('does not treat a bare AWS receipt as a brightness report', async () => {
    const { device } = build()
    await homekitBrightness(device, 80)
    const receipt = { source: 'AWS', cmd: 'brightness', state: { result: 1 } }

    expect(isCommandAcknowledgement(receipt)).toBe(true)
    device.externalUpdate(parseDeviceUpdate(receipt, device.accessory.context))
    expect(device.cacheBrightRaw).toBe(40)
    expect(device.cacheBright).toBe(80)
  })

  it('does not change color temperature or Adaptive Lighting on a brightness report', () => {
    const { device } = build()
    const controller = { isAdaptiveLightingActive: () => true, disableAdaptiveLighting: vi.fn() }
    device.alController = controller
    const colorTemperature = device.service.getCharacteristic('ColorTemperature').value
    const hue = device.service.getCharacteristic('Hue').value
    const saturation = device.service.getCharacteristic('Saturation').value

    awsBrightness(device, 50)
    expect(device.service.getCharacteristic('ColorTemperature').value).toBe(colorTemperature)
    expect(device.service.getCharacteristic('Hue').value).toBe(hue)
    expect(device.service.getCharacteristic('Saturation').value).toBe(saturation)
    expect(controller.disableAdaptiveLighting).not.toHaveBeenCalled()
  })

  it('preserves the on-state minimum brightness display for a zero report', () => {
    const { device } = build()

    awsBrightness(device, 0)
    expect(device.cacheBrightRaw).toBe(0)
    expect(device.cacheBright).toBe(1)
    expect(device.service.getCharacteristic('Brightness').value).toBe(1)
    expect(device.cacheState).toBe('on')
  })
})

describe('unchanged AWS brightness scaling', () => {
  it('keeps H6008 brightness at 0–100', () => {
    for (const value of [1, 20, 50, 80, 100]) {
      expect(buildCommand({ cmd: 'brightness', value }, { gvModel: 'H6008' }).awsParams.data.val).toBe(value)
      expect(parseDeviceUpdate({ source: 'AWS', state: { brightness: value } }, { gvModel: 'H6008' }).brightness).toBe(value)
    }
  })

  it('retains 0–254 scaling for the models listed as counting to 254', () => {
    expect(buildCommand({ cmd: 'brightness', value: 50 }, { gvModel: 'H6054' }).awsParams.data.val).toBe(127)
    expect(parseDeviceUpdate({ source: 'AWS', state: { brightness: 127 } }, { gvModel: 'H6054' }).brightness).toBe(50)
  })

  it('keeps every other model at 0–100, the default since v11.39.1', () => {
    expect(buildCommand({ cmd: 'brightness', value: 50 }, { gvModel: 'H6102' }).awsParams.data.val).toBe(50)
    expect(parseDeviceUpdate({ source: 'AWS', state: { brightness: 50 } }, { gvModel: 'H6102' }).brightness).toBe(50)
  })
})

describe('unchanged AWS/BLE send selection', () => {
  function sender(awsUpdate) {
    const accessory = makeAccessory('H6008', { useAwsControl: true, useBleControl: true })
    const bleUpdate = vi.fn().mockResolvedValue(undefined)
    const platform = {
      awsClient: { updateDevice: awsUpdate },
      bleClient: { updateDevice: bleUpdate },
      queue: { add: task => task() },
    }
    return { accessory, bleUpdate, platform }
  }

  it('falls back to BLE when the AWS publish rejects', async () => {
    const awsUpdate = vi.fn().mockRejectedValue(new Error('AWS publish failed'))
    const { accessory, bleUpdate, platform } = sender(awsUpdate)

    await expect(GoveePlatform.prototype.sendDeviceUpdate.call(platform, accessory, {
      cmd: 'brightness',
      value: 80,
    })).resolves.toBe(true)
    expect(awsUpdate).toHaveBeenCalledOnce()
    expect(bleUpdate).toHaveBeenCalledOnce()
  })

  it('does not fall back when AWS only confirms publish', async () => {
    const awsUpdate = vi.fn().mockResolvedValue(undefined)
    const { accessory, bleUpdate, platform } = sender(awsUpdate)

    await expect(GoveePlatform.prototype.sendDeviceUpdate.call(platform, accessory, {
      cmd: 'brightness',
      value: 80,
    })).resolves.toBe(true)
    expect(bleUpdate).not.toHaveBeenCalled()
  })
})
