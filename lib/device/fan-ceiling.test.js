import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDeviceCapabilities } from '../utils/device-capabilities.js'
import { hkPercentToFanSpeed } from '../utils/functions.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceFanCeiling from './fan-ceiling.js'
import deviceIndex from './index.js'

/**
 * The H1310 and R1310 are ceiling fans with lights, and were on the H7100
 * tower fan handler as "the same fan". They are not the same fan at all -
 * Govee's own app files them under Indoor Lighting as "Govee Ceiling Fan",
 * while every H71xx sits under Air Treatment.
 *
 * The cost to an owner was all three of the symptoms in #1352: a fan tile that
 * did nothing, because the tower fan's speed codes mean nothing here; an
 * oscillation control for a fan that cannot oscillate; and no light at all,
 * because the H7100 handler never builds one.
 *
 * The frames below are from that report, and they are exactly the ones this
 * handler already reads.
 */

// aa 36 00 00 - fan power off on an H1370, both lights off on an H1310
const BOTH_LIGHTS_OFF_PAIR = 'qjYAAAAAAAAAAAAAAAAAAAAAAJw='
// aa 31 00 01 00 - not turning, still naming the speed it will return to
const FAN_STOPPED = 'qjEAAQAAAAAAAAAAAAAAAAAAAJo='
// aa 31 01 01 - fan speed 1
const FAN_SPEED_1 = 'qjEBAQAAAAAAAAAAAAAAAAAAAJs='
// aa 31 01 06 - fan speed 6, the top speed on an H1310
const FAN_SPEED_6 = 'qjEBBgAAAAAAAAAAAAAAAAAAAJw='
// aa 31 01 0c - fan speed 12, the top speed on an H1370
const FAN_SPEED_12 = 'qjEBDAAAAAAAAAAAAAAAAAAAAJY='
// aa 31 01 04 00 00 00 01 - swinging, from ekalp's captures on #1358
const FAN_SWINGING = 'qjEBBAAAAAEAAAAAAAAAAAAAAJ8='
// aa 31 01 04 00 00 00 00 - the same fan, still
const FAN_NOT_SWINGING = 'qjEBBAAAAAAAAAAAAAAAAAAAAJ4='

function makeService() {
  const chars = new Map()
  const characteristic = name => ({
    name,
    value: 0,
    onSet() {
      return this
    },
    setProps() {
      return this
    },
  })
  return {
    getCharacteristic(name) {
      if (!chars.has(name)) {
        chars.set(name, characteristic(name))
      }
      return chars.get(name)
    },
    addCharacteristic(name) {
      if (!chars.has(name)) {
        chars.set(name, characteristic(name))
      }
      return chars.get(name)
    },
    updateCharacteristic(name, value) {
      this.getCharacteristic(name).value = value
      return this
    },
    setPrimaryService(isPrimary = true) {
      this.isPrimary = isPrimary
      return this
    },
    testCharacteristic: name => chars.has(name),
    removeCharacteristic(char) {
      if (char) {
        chars.delete(char.name)
      }
    },
    chars,
  }
}

function makePlatform() {
  const proxy = new Proxy({}, { get: (_target, prop) => prop })
  return {
    log: Object.assign(vi.fn(), { warn: vi.fn(), debug: vi.fn() }),
    api: { hap: { Service: proxy, Characteristic: proxy, HapStatusError: class {} } },
    deviceConf: {},
  }
}

function makeAccessory(model) {
  const services = new Map()
  const bySubtype = new Map()
  return {
    displayName: model,
    context: { gvModel: model, gvDeviceId: 'AA:BB' },
    getService: name => services.get(name) || [...services.values()].find(service => service.displayName === name),
    getServiceById(type, subtype) {
      return bySubtype.get(`${type}:${subtype}`)
    },
    addService(type, name, subtype) {
      const service = makeService()
      service.type = type
      service.subtype = subtype || name
      service.name = name || type
      service.displayName = name || type
      services.set(name || type, service)
      if (subtype) {
        bySubtype.set(`${type}:${subtype}`, service)
      }
      return service
    },
    removeService(service) {
      services.delete(service.name)
      if (service.subtype) {
        bySubtype.delete(`${service.type}:${service.subtype}`)
      }
    },
    log: vi.fn(),
    logWarn: vi.fn(),
    logDebug: vi.fn(),
  }
}

describe('the ceiling fans', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  /**
   * ⚠️ All three now share one handler. The H1370 used to run the base class,
   * whose fan power sends `33 36 01 01` - which #1358 proved is the two lights
   * on this model too, so switching the fan on turned the lights on instead.
   */
  it.each(['H1310', 'R1310', 'H1370'])('sends the %s to the ceiling fan handler', (model) => {
    expect(deviceIndex[`deviceFan${model}`]).toBe(deviceFanCeiling)
  })

  it.each(['H1310', 'R1310', 'H1370'])('gives the %s a light, which the tower fan handler never did', (model) => {
    const accessory = makeAccessory(model)
    const Handler = deviceIndex[`deviceFan${model}`]
    const device = new Handler(makePlatform(), accessory)

    expect(device.lightService).toBeTruthy()
  })

  /**
   * The H1310 says whether it is turning in the third byte of its speed frame,
   * not in `aa 36`. Correlating all 69 statuses posted on #1352 settled it:
   * `aa 36`/`aa 42` always agreed with each other about the lights, and the
   * device-wide `onOff` was 1 in every status where either that byte was 01 or
   * a light was lit, and 0 in every status where neither was.
   */
  it.each(['H1310', 'R1310'])('reads the %s fan power its owner actually reported', (model) => {
    const accessory = makeAccessory(model)
    const Handler = deviceIndex[`deviceFan${model}`]
    const device = new Handler(makePlatform(), accessory)

    // start from on, so the frame has to genuinely move it rather than the
    // assertion landing on whatever the cache happened to start as
    device.cacheState = 'on'
    device.externalUpdate({ commands: [FAN_STOPPED], source: 'AWS' })

    expect(device.cacheState).toBe('off')
    expect(accessory.getService('Fanv2').getCharacteristic('Active').value).toBe(0)
  })

  /**
   * `aa 36` is fan power on an H1370 and the two lights on an H1310. Read as
   * the fan it left the fan tile off whenever both lights were off, whatever
   * the fan was doing - which is how it was reported (#1352).
   */
  it.each(['H1310', 'R1310'])('does not let the %s lights switch the fan tile off', (model) => {
    const accessory = makeAccessory(model)
    const device = new deviceIndex[`deviceFan${model}`](makePlatform(), accessory)

    device.cacheState = 'on'
    // both lights off, and nothing at all said about the fan
    device.externalUpdate({ commands: [BOTH_LIGHTS_OFF_PAIR], source: 'AWS' })

    expect(device.cacheState).toBe('on')
  })

  /**
   * ⚠️ The reverse of what this file used to assert. `aa 36` is the two lights
   * on the H1370 as well, so a status saying both lights are off says nothing
   * about the fan - and must leave the fan tile alone. Proven on #1358, where
   * "fan on" reported `aa 36 00 00` with `aa 31` byte three at `01`.
   */
  it('does not read the H1370 fan power from aa 36, which is its lights', () => {
    const accessory = makeAccessory('H1370')
    const Handler = deviceIndex.deviceFanH1370
    const device = new Handler(makePlatform(), accessory)

    device.cacheState = 'on'
    device.externalUpdate({ commands: [BOTH_LIGHTS_OFF_PAIR], source: 'AWS' })

    expect(device.cacheState).toBe('on')
  })

  it('reads the H1370 fan power from the third byte of aa 31', () => {
    const accessory = makeAccessory('H1370')
    const Handler = deviceIndex.deviceFanH1370
    const device = new Handler(makePlatform(), accessory)

    device.cacheState = 'off'
    device.externalUpdate({ commands: [FAN_SPEED_12], source: 'AWS' })
    expect(device.cacheState).toBe('on')

    device.externalUpdate({ commands: [FAN_STOPPED], source: 'AWS' })
    expect(device.cacheState).toBe('off')
  })

  /**
   * Oscillation is the one thing the H1370 has that the H1310 does not, so it
   * is gated on the capability rather than the model. ekalp's captures on
   * #1358 pinned it to the eighth byte of the speed frame: off, on and off
   * again moved that byte and nothing else.
   */
  it('gives an H1370 that reports oscillation a swing control', () => {
    const accessory = makeAccessory('H1370')
    accessory.context.openApiCapabilities = {
      mainLightToggle: {},
      backgroundLightToggle: {},
      fanOscillateToggle: {},
    }
    accessory.context.useOpenApiControl = true
    const device = new deviceFanCeiling(makePlatform(), accessory)

    expect(device.canOscillate).toBe(true)
  })

  it('leaves an H1310 without one, as it cannot oscillate', () => {
    const accessory = makeAccessory('H1310')
    accessory.context.openApiCapabilities = { mainLightToggle: {}, backgroundLightToggle: {} }
    accessory.context.useOpenApiControl = true
    const device = new deviceFanCeiling(makePlatform(), accessory)

    expect(device.canOscillate).toBe(false)
    expect(device.service.testCharacteristic('SwingMode')).toBe(false)
  })

  it('reads oscillation off the eighth byte of the speed frame', () => {
    const accessory = makeAccessory('H1370')
    accessory.context.openApiCapabilities = { fanOscillateToggle: {} }
    accessory.context.useOpenApiControl = true
    const device = new deviceFanCeiling(makePlatform(), accessory)

    device.externalUpdate({ commands: [FAN_SWINGING], source: 'AWS' })
    expect(device.cacheSwing).toBe(1)

    device.externalUpdate({ commands: [FAN_NOT_SWINGING], source: 'AWS' })
    expect(device.cacheSwing).toBe(0)
  })

  it.each(['H1310', 'R1310'])('reads the %s fan speed its owner actually reported', (model) => {
    const accessory = makeAccessory(model)
    const Handler = deviceIndex[`deviceFan${model}`]
    const device = new Handler(makePlatform(), accessory)

    device.externalUpdate({ commands: [FAN_SPEED_1], source: 'AWS' })

    expect(device.cacheSpeed).toBeGreaterThan(0)
  })

  /**
   * The H1310's owner counted six speeds in the Govee app, against the twelve
   * the H1370 was written for. Sharing one scale left the slider wrong at both
   * ends: the fan's top speed showed as half, and asking for full speed sent a
   * step the fan does not have (#1352).
   */
  it.each([['H1310', 6], ['R1310', 6], ['H1370', 12]])('gives the %s its own %i speed steps', (model, steps) => {
    const device = new deviceIndex[`deviceFan${model}`](makePlatform(), makeAccessory(model))

    expect(device.speedSteps).toBe(steps)
  })

  /**
   * Govee's api lists a fan's speeds per device, so it beats the model table -
   * it is right for a model nobody has written down, and it settles a handler
   * shared by two models with different counts. These options are the ones an
   * H1310 reported in #1352.
   */
  it('takes the speed count from the fan rather than the model table', () => {
    const accessory = makeAccessory('H1370')
    accessory.context.openApiCapabilities = {
      fanSpeedMode: {
        type: 'devices.capabilities.mode',
        instance: 'fanSpeedMode',
        parameters: {
          dataType: 'ENUM',
          options: Array.from({ length: 6 }, (_, index) => ({ name: `Speed ${index + 1}`, value: index + 1 })),
        },
      },
    }
    const device = new deviceIndex.deviceFanH1370(makePlatform(), accessory)

    // the table says twelve for an H1370, the fan says six
    expect(device.speedSteps).toBe(6)
  })

  /**
   * A ceiling fan model with no entry of its own still needs a scale. Without
   * a default the steps come back undefined, and every percentage HomeKit
   * sends works out as NaN - so the fan takes no speed at all, silently.
   */
  it('still has a speed scale for a ceiling fan not in the table', () => {
    const steps = getDeviceCapabilities('H9999').fanSpeedSteps

    expect(steps).toBeGreaterThan(0)
    expect(hkPercentToFanSpeed(100, steps)).toBe(steps)
  })

  it('keeps the model table when the api described no speeds', () => {
    const accessory = makeAccessory('H1370')
    accessory.context.openApiCapabilities = { fanToggle: { parameters: { options: [] } } }
    const device = new deviceIndex.deviceFanH1370(makePlatform(), accessory)

    expect(device.speedSteps).toBe(12)
  })

  it.each([['H1310', FAN_SPEED_6], ['R1310', FAN_SPEED_6], ['H1370', FAN_SPEED_12]])(
    'shows the %s at its top speed as 100% in HomeKit',
    (model, topSpeedFrame) => {
      const accessory = makeAccessory(model)
      const device = new deviceIndex[`deviceFan${model}`](makePlatform(), accessory)

      device.externalUpdate({ commands: [topSpeedFrame], source: 'AWS' })

      expect(accessory.getService('Fanv2').getCharacteristic('RotationSpeed').value).toBe(100)
    },
  )

  it.each([['H1310', 6], ['R1310', 6], ['H1370', 12]])(
    'asks the %s for speed %i when HomeKit is set to 100%',
    async (model, topSpeed) => {
      const device = new deviceIndex[`deviceFan${model}`](makePlatform(), makeAccessory(model))
      const sent = []
      device.platform.sendDeviceUpdate = async (_accessory, params) => sent.push(params)

      await device.internalSpeedUpdate(100)

      expect(device.cacheSpeed).toBe(topSpeed)
    },
  )

  /**
   * A stopped fan reports `aa 31 00 <speed>` - the third byte is its running
   * flag, not part of the code. Matching only `3101` meant every status sent
   * while the fan was off was announced as unrecognised, which is the same
   * noise that sent this model's owner to the issue tracker to begin with.
   */
  /**
   * A ceiling fan with lights on it should lead with the fan. Without saying
   * which service leads, the Home app picks one and lands on a light, so the
   * owner taps through a lightbulb to reach the fan (#1352).
   */
  it.each(['H1310', 'R1310', 'H1370'])('leads the %s tile with the fan, not a light', (model) => {
    const device = new deviceIndex[`deviceFan${model}`](makePlatform(), makeAccessory(model))

    expect(device.service.isPrimary).toBe(true)
    expect(device.lightService?.isPrimary).not.toBe(true)
  })

  it.each(['H1310', 'H1370'])('does not call the %s fan-off speed frame unrecognised', (model) => {
    const accessory = makeAccessory(model)
    const device = new deviceIndex[`deviceFan${model}`](makePlatform(), accessory)

    // aa 31 00 01 - stopped, and still naming the speed it will return to
    device.externalUpdate({ commands: ['qjEAAQAAAAAAAAAAAAAAAAAAAJo='], source: 'AWS' })

    const said = [
      ...accessory.logWarn.mock.calls,
      ...accessory.logDebug.mock.calls,
    ].map(call => String(call[0])).join(' ')
    expect(said).not.toMatch(/unrecognised/)
  })

  /**
   * The two frames above were arriving as "unrecognised status" lines on the
   * old handler, which is what sent the owner to the issue tracker.
   */
  it.each(['H1310', 'R1310'])('no longer calls the %s fan frames unrecognised', (model) => {
    const accessory = makeAccessory(model)
    const Handler = deviceIndex[`deviceFan${model}`]
    const device = new Handler(makePlatform(), accessory)

    device.externalUpdate({ commands: [BOTH_LIGHTS_OFF_PAIR, FAN_SPEED_1], source: 'AWS' })

    const said = [
      ...accessory.logWarn.mock.calls,
      ...accessory.logDebug.mock.calls,
    ].map(call => String(call[0])).join(' ')
    expect(said).not.toMatch(/unrecognised/)
  })
})
