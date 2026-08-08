import { describe, expect, it } from 'vitest'

import deviceTypes from '../device/index.js'
import platformConsts from './constants.js'
import { resolveDeviceType } from './dispatch.js'

/**
 * The model snapshot runs with default settings, so it never reaches a branch
 * that only opens through config - which is most of what a single socket can be
 * shown as. Those are pinned here.
 */

const single = model => ({ model, device: 'AA:BB', deviceName: model })

describe('choosing a handler', () => {
  it('gives every supported model a handler', () => {
    const missing = []
    Object.entries(platformConsts.models).forEach(([list, models]) => {
      if (!Array.isArray(models)) {
        return
      }
      models.forEach((model) => {
        const route = resolveDeviceType({ model, device: 'AA:BB', deviceName: model })
        if (!route?.handler) {
          missing.push(`${model} (${list})`)
        }
      })
    })
    expect(missing).toEqual([])
  })

  it('says nothing for a model it does not know', () => {
    expect(resolveDeviceType(single('H0000'))).toBeNull()
  })
})

describe('showing a single socket as something else', () => {
  const model = 'H5080'

  it.each([
    ['switch', 'deviceSwitchSingle'],
    ['purifier', 'devicePurifierSingle'],
    ['tap', 'deviceTapSingle'],
    ['valve', 'deviceValveSingle'],
  ])('shows it as a %s', (showAs, expected) => {
    expect(resolveDeviceType(single(model), { showAs }).handlerKey).toBe(expected)
  })

  it('falls back to an outlet when nothing is chosen', () => {
    expect(resolveDeviceType(single(model), {}).handlerKey).toBe('deviceOutletSingle')
  })

  it.each([
    ['audio', 34],
    ['box', 35],
    ['stick', 36],
  ])('publishes a %s as its own accessory', (showAs, category) => {
    const route = resolveDeviceType(single(model), { showAs })
    expect(route.handlerKey).toBe('deviceTVSingle')
    expect(route.externalCategory).toBe(category)
  })

  it.each(['heater', 'cooler'])('refuses to stand in for a %s without a temperature to read', (showAs) => {
    expect(resolveDeviceType(single(model), { showAs }).skip).toBe('needsTemperatureSource')
  })

  it.each([
    ['heater', 'deviceHeater2Single'],
    ['cooler', 'deviceCoolerSingle'],
  ])('stands in for a %s once given one', (showAs, expected) => {
    const route = resolveDeviceType(single(model), { showAs, temperatureSource: 'AA:BB' })
    expect(route.handlerKey).toBe(expected)
  })
})

describe('the other choices that depend on settings', () => {
  it('shows a light as a switch when asked', () => {
    expect(resolveDeviceType(single('H6102'), { showAs: 'switch' }).handlerKey).toBe('deviceLightSwitch')
    expect(resolveDeviceType(single('H6102'), {}).handlerKey).toBe('deviceLight')
  })

  it.each([
    ['H5082', 'deviceSwitchDouble', 'deviceOutletDouble'],
    ['H5160', 'deviceSwitchTriple', 'deviceOutletTriple'],
  ])('shows the %s as switches or outlets', (model, asSwitch, asOutlet) => {
    expect(resolveDeviceType(single(model), { showAs: 'switch' }).handlerKey).toBe(asSwitch)
    expect(resolveDeviceType(single(model), { showAs: 'outlet' }).handlerKey).toBe(asOutlet)
  })

  it('adds the extra switch to a thermo sensor when asked', () => {
    expect(resolveDeviceType(single('H5075'), { showExtraSwitch: true }).handlerKey).toBe('deviceSensorThermoSwitch')
    expect(resolveDeviceType(single('H5075'), {}).handlerKey).toBe('deviceSensorThermo')
  })
})

describe('deciding whether a heater reports the room temperature', () => {
  const heater = { ...single('H7130') }

  it('takes govee\'s word for it when the device says so', () => {
    const device = { ...heater, openApiInfo: { byInstance: { sensorTemperature: {} } } }
    expect(resolveDeviceType(device, {}).handlerKey).toBe('deviceHeater1B')
  })

  it('uses what a previous run learnt when the api says nothing', () => {
    expect(resolveDeviceType(heater, {}, { supportsAmbientTemp: true }).handlerKey).toBe('deviceHeater1B')
    expect(resolveDeviceType(heater, {}, {}).handlerKey).toBe('deviceHeater1A')
  })

  it('lets the owner\'s setting win, so nobody\'s tile changes under them', () => {
    const device = { ...heater, openApiInfo: { byInstance: { sensorTemperature: {} } } }
    expect(resolveDeviceType(device, { tempReporting: false }).handlerKey).toBe('deviceHeater1A')
    expect(resolveDeviceType(heater, { tempReporting: true }).handlerKey).toBe('deviceHeater1B')
  })
})

describe('which devices need their status asking for', () => {
  it.each(['H7130', 'H7131', 'H7141', 'H7150', 'H7120', 'H7161', 'H5106'])('polls the %s over AWS', (model) => {
    expect(resolveDeviceType(single(model), {}).awsPolling).toBe(true)
  })

  it.each(['H6102', 'H5080', 'H5075'])('does not poll the %s', (model) => {
    expect(resolveDeviceType(single(model), {}).awsPolling).toBe(false)
  })

  it('polls a light with a light segment layout, since its zone data only ever arrives over AWS', () => {
    expect(resolveDeviceType(single('H1250'), {}).awsPolling).toBe(true)
  })

  it('does not poll a light with no light segment layout', () => {
    expect(resolveDeviceType(single('H6102'), {}).awsPolling).toBe(false)
  })
})

describe('a model of a known type that nobody has worked out', () => {
  it('falls back to the basic handler rather than being left unsupported', () => {
    const fallbacks = {
      fan: deviceTypes.deviceFanBasic,
      humidifier: deviceTypes.deviceHumidifierBasic,
      dehumidifier: deviceTypes.deviceDehumidifierBasic,
      purifier: deviceTypes.devicePurifierBasic,
      iceMaker: deviceTypes.deviceIceMakerBasic,
      diffuser: deviceTypes.deviceDiffuserBasic,
    }
    Object.entries(fallbacks).forEach(([list, expected]) => {
      // a model in the list with no handler named after it
      const invented = { model: 'H9999', device: 'AA:BB', deviceName: 'invented' }
      const saved = platformConsts.models[list]
      platformConsts.models[list] = [...saved, 'H9999']
      try {
        expect(resolveDeviceType(invented, {}).handler, list).toBe(expected)
      } finally {
        platformConsts.models[list] = saved
      }
    })
  })
})
