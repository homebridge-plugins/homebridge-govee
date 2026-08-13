import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import deviceSensorThermoSwitch from './sensor-thermo-switch.js'
import deviceSensorThermo from './sensor-thermo.js'

/**
 * `showExtraSwitch` exists to make the temperature the thing you see. It swaps
 * the temperature sensor for a thermostat, which HomeKit gives a full tile.
 *
 * An accessory carrying a thermostat, a humidity sensor and a battery has to
 * say which one leads, or the Home app picks for itself - and it picked
 * humidity, so an owner who turned this on to see the temperature got a
 * percentage instead and had to open the accessory to find it (#1354).
 *
 * The plain thermo handler has set this since it was written. This one did not.
 */

function build(Handler, model = 'H5179') {
  const accessory = makeAccessory(model)
  const device = new Handler(makePlatform(), accessory)
  return { accessory, device }
}

describe('a thermo sensor shown as a thermostat', () => {
  it('leads with the temperature rather than the humidity', () => {
    const { device } = build(deviceSensorThermoSwitch)

    expect(device.thermoService.isPrimary).toBe(true)
    expect(device.humiService.isPrimary).not.toBe(true)
  })

  it('still builds the humidity and battery alongside it', () => {
    const { device } = build(deviceSensorThermoSwitch)

    expect(device.humiService).toBeTruthy()
    expect(device.battService).toBeTruthy()
  })

  it('leads with the temperature in the plain handler too', () => {
    const { device } = build(deviceSensorThermo)

    expect(device.tempService.isPrimary).toBe(true)
  })
})
