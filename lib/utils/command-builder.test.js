import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { buildCommand } from './command-builder.js'
import platformConsts from './constants.js'

/**
 * What the plugin puts on the wire, for each of the four ways it can talk to a
 * device.
 *
 * The bluetooth side was checked command by command against the app. The other
 * three never were, and nothing tested them at all - which matters because they
 * fail quietly. A wrong value over AWS is accepted and applied wrongly; a wrong
 * capability name over the api is accepted and ignored. Neither throws.
 */

// The instance names the api is known to accept. A typo here is invisible at
// runtime: the request succeeds and the device does nothing
const KNOWN_INSTANCES = [
  'powerSwitch',
  'brightness',
  'colorRgb',
  'colorTemperatureK',
  'workMode',
  'nightlightToggle',
  'oscillationToggle',
  'lockToggle',
  'displayToggle',
  'mainLightToggle',
  'backgroundLightToggle',
  'targetTemperature',
  'lightScene',
  'diyScene',
]

const KNOWN_CAPABILITY_TYPES = [
  'devices.capabilities.on_off',
  'devices.capabilities.toggle',
  'devices.capabilities.range',
  'devices.capabilities.mode',
  'devices.capabilities.work_mode',
  'devices.capabilities.color_setting',
  'devices.capabilities.segment_color_setting',
  'devices.capabilities.temperature_setting',
  'devices.capabilities.dynamic_scene',
  'devices.capabilities.music_setting',
  'devices.capabilities.property',
  'devices.capabilities.event',
]

// The commands Govee's local network api answers to. `ptReal` is not in the
// documented set but is accepted, which is how scenes work without the cloud
const KNOWN_LAN_COMMANDS = ['turn', 'brightness', 'colorwc', 'ptReal']

const light = { gvModel: 'H6102' }

function checksumOf(frame) {
  let checksum = 0
  for (let index = 0; index < frame.length - 1; index += 1) {
    checksum ^= frame[index]
  }
  return checksum
}

describe('what goes out over AWS', () => {
  it('always names a command and carries data with it', () => {
    const commands = [
      [{ cmd: 'state', value: 'on' }, light],
      [{ cmd: 'stateDual', value: 51 }, light],
      [{ cmd: 'stateOutlet', value: 'on' }, light],
      [{ cmd: 'stateHumi', value: 'on' }, light],
      [{ cmd: 'stateHeat', value: true }, light],
      [{ cmd: 'brightness', value: 50 }, light],
      [{ cmd: 'color', value: { r: 1, g: 2, b: 3 } }, light],
      [{ cmd: 'colorTem', value: 4000 }, light],
    ]

    commands.forEach(([params, context]) => {
      const { awsParams } = buildCommand(params, context)
      expect(typeof awsParams.cmd, params.cmd).toBe('string')
      expect(awsParams.data, params.cmd).toBeDefined()
    })
  })

  it('wraps a raw command as a packet the device can actually read', () => {
    // These carry a bluetooth packet inside a base64 string. A malformed one is
    // accepted by AWS and ignored by the device
    const raw = 'MwUBAQAAAAAAAAAAAAAAAAAAADY='
    const { awsParams } = buildCommand({ cmd: 'ptReal', value: raw }, light)

    const frame = Buffer.from(awsParams.data.command[0], 'base64')
    expect(frame.length).toBe(20)
    expect(checksumOf(frame)).toBe(frame[19])
  })

  it('wraps the heater power command the same way', () => {
    ;[true, false].forEach((value) => {
      const { awsParams } = buildCommand({ cmd: 'stateHeat', value }, light)
      const frame = Buffer.from(awsParams.data.command[0], 'base64')

      expect(frame.length).toBe(20)
      expect(checksumOf(frame)).toBe(frame[19])
      expect(frame[0]).toBe(0x33)
    })
  })

  it('scales brightness up, because AWS counts to 254 and HomeKit to 100', () => {
    // Dropping this left every AWS device at about a third of what was asked
    // for (#1262)
    expect(buildCommand({ cmd: 'brightness', value: 100 }, light).awsParams.data.val).toBe(254)
    expect(buildCommand({ cmd: 'brightness', value: 50 }, light).awsParams.data.val).toBe(127)
    expect(buildCommand({ cmd: 'brightness', value: 1 }, light).awsParams.data.val).toBe(3)
  })

  it('leaves it alone for the models that already count to 100', () => {
    // These echo a value back unscaled, and rescaling it made HomeKit flicker
    // between two brightnesses (#1321)
    expect(buildCommand({ cmd: 'brightness', value: 50 }, { gvModel: 'H6008' }).awsParams.data.val).toBe(50)
    expect(buildCommand({ cmd: 'brightness', value: 50 }, { gvModel: 'H6102', awsBrightnessNoScale: true }).awsParams.data.val).toBe(50)
    // H1250: scaling sent a 100% HomeKit write out as 254, and the device came
    // out visibly dimmer than the Govee app's own 100% - confirmed on hardware
    expect(buildCommand({ cmd: 'brightness', value: 100 }, { gvModel: 'H1250' }).awsParams.data.val).toBe(100)
  })

  it('uses the odd on and off values the plugs need', () => {
    // The H5080 answers to 17 and 16 rather than 1 and 0
    const plug = { gvModel: 'H5080' }
    expect(buildCommand({ cmd: 'stateOutlet', value: 'on' }, plug).awsParams.data.val).toBe(17)
    expect(buildCommand({ cmd: 'stateOutlet', value: 'off' }, plug).awsParams.data.val).toBe(16)

    const other = { gvModel: 'H6102' }
    expect(buildCommand({ cmd: 'stateOutlet', value: 'on' }, other).awsParams.data.val).toBe(1)
  })

  it('sends colour in whichever shape the owner chose', () => {
    const value = { r: 10, g: 20, b: 30 }

    const plain = buildCommand({ cmd: 'color', value }, { ...light, awsColourMode: 'rgb' }).awsParams
    expect(plain.data).toMatchObject({ r: 10, g: 20, b: 30 })

    const named = buildCommand({ cmd: 'color', value }, { ...light, awsColourMode: 'redgreenblue' }).awsParams
    expect(named.data).toMatchObject({ red: 10, green: 20, blue: 30 })

    const both = buildCommand({ cmd: 'color', value }, light).awsParams
    expect(both.data.color).toMatchObject({ r: 10, g: 20, b: 30, red: 10, green: 20, blue: 30 })
  })
})

describe('what goes out over the local network', () => {
  const withLan = [
    { cmd: 'state', value: 'on' },
    { cmd: 'brightness', value: 50 },
    { cmd: 'color', value: { r: 1, g: 2, b: 3 } },
    { cmd: 'colorTem', value: 4000 },
  ]

  it('only ever sends a command the local api answers to', () => {
    withLan.forEach((params) => {
      const { lanParams } = buildCommand(params, light)
      expect(KNOWN_LAN_COMMANDS, params.cmd).toContain(lanParams.cmd)
      expect(lanParams.data, params.cmd).toBeDefined()
    })
  })

  it('⚠️ sends brightness unscaled, unlike AWS', () => {
    // The two connections genuinely differ. Making them match would send every
    // local device to full brightness
    const built = buildCommand({ cmd: 'brightness', value: 50 }, light)

    expect(built.lanParams.data.value).toBe(50)
    expect(built.awsParams.data.val).toBe(127)
  })

  it('sends a colour temperature as kelvin alongside the colour', () => {
    const { lanParams } = buildCommand({ cmd: 'colorTem', value: 4000 }, light)

    expect(lanParams.data.colorTemInKelvin).toBe(4000)
    expect(lanParams.data.color).toHaveProperty('r')
  })

  it('sends nothing locally for an appliance, because the local api is lights only', () => {
    // Govee's local network api covers lights and nothing else, so an appliance
    // command has no local form to send. These belong to the other connections
    expect(buildCommand({ cmd: 'stateHumi', value: 'on' }, light).lanParams).toBeUndefined()
    expect(buildCommand({ cmd: 'stateHeat', value: true }, light).lanParams).toBeUndefined()
    expect(buildCommand({ cmd: 'ptReal', value: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=' }, light).lanParams).toBeUndefined()
  })
})

describe('what goes out over the public api', () => {
  it('names a capability the api knows, whenever one is named', () => {
    const commands = [
      { cmd: 'openApi', openApi: { instance: 'workMode', capabilityType: 'devices.capabilities.work_mode', value: 1 } },
      { cmd: 'openApi', openApi: { instance: 'oscillationToggle', capabilityType: 'devices.capabilities.toggle', value: 1 } },
      { cmd: 'openApi', openApi: { instance: 'lockToggle', capabilityType: 'devices.capabilities.toggle', value: 0 } },
    ]

    commands.forEach((params) => {
      const { openApiParams } = buildCommand(params, light)
      expect(KNOWN_INSTANCES, openApiParams.instance).toContain(openApiParams.instance)
      expect(KNOWN_CAPABILITY_TYPES, openApiParams.capabilityType).toContain(openApiParams.capabilityType)
    })
  })

  it('refuses to build one without a capability to name', () => {
    // Sending a nameless capability is accepted and quietly does nothing
    expect(() => buildCommand({ cmd: 'openApi', openApi: {} }, light)).toThrow(/instance/)
  })

  it('only speaks for a double switch when the whole device is meant (#1323)', () => {
    // The api has one switch per device and rejects anything else, so the
    // per-outlet values are left to the other connections
    expect(buildCommand({ cmd: 'stateDual', value: 51 }, light).openApiParams.value).toBe(1)
    expect(buildCommand({ cmd: 'stateDual', value: 48 }, light).openApiParams.value).toBe(0)

    expect(buildCommand({ cmd: 'stateDual', value: 17 }, light).openApiParams).toBeUndefined()
    expect(buildCommand({ cmd: 'stateDual', value: 16 }, light).openApiParams).toBeUndefined()
  })

  it('sends brightness and colour in HomeKit\'s own units', () => {
    expect(buildCommand({ cmd: 'brightness', value: 50 }, light).openApiParams.value).toBe(50)
    expect(buildCommand({ cmd: 'colorTem', value: 4000 }, light).openApiParams.value).toBe(4000)
  })
})

describe('the four connections agreeing with each other', () => {
  it('means the same thing by on, whichever way it is sent', () => {
    const on = buildCommand({ cmd: 'state', value: 'on' }, light)

    expect(on.awsParams.data.val).toBe(1)
    expect(on.lanParams.data.value).toBe(1)
    expect(on.openApiParams.value).toBe('on')
    expect(on.bleParams.data).toBe(0x01)
  })

  it('means the same thing by off', () => {
    const off = buildCommand({ cmd: 'state', value: 'off' }, light)

    expect(off.awsParams.data.val).toBe(0)
    expect(off.lanParams.data.value).toBe(0)
    expect(off.openApiParams.value).toBe('off')
    expect(off.bleParams.data).toBe(0x00)
  })

  it('sends the same colour down every connection', () => {
    const value = { r: 12, g: 34, b: 56 }
    const built = buildCommand({ cmd: 'color', value }, light)

    expect(built.lanParams.data.color).toMatchObject(value)
    expect(built.openApiParams.value).toMatchObject(value)
    expect(built.awsParams.data.color).toMatchObject(value)

    // the bluetooth packet carries the three bytes after its sub-command
    const bleData = built.bleParams.data
    expect(bleData).toContain(12)
    expect(bleData).toContain(34)
    expect(bleData).toContain(56)
  })

  it('refuses a command it does not know rather than sending something empty', () => {
    expect(() => buildCommand({ cmd: 'nonsense', value: 1 }, light)).toThrow(/Invalid command/)
  })
})

describe('every light model builds a sendable command on every connection', () => {
  it('never produces a broken payload for any of the 488 light models', () => {
    const failures = []

    platformConsts.models.rgb.forEach((model) => {
      const context = { gvModel: model }
      ;[
        { cmd: 'state', value: 'on' },
        { cmd: 'brightness', value: 50 },
        { cmd: 'color', value: { r: 1, g: 2, b: 3 } },
        { cmd: 'colorTem', value: 4000 },
      ].forEach((params) => {
        try {
          const built = buildCommand(params, context)
          if (built.awsParams && built.awsParams.data === undefined) {
            failures.push(`${model} ${params.cmd}: aws data missing`)
          }
          if (built.lanParams && !KNOWN_LAN_COMMANDS.includes(built.lanParams.cmd)) {
            failures.push(`${model} ${params.cmd}: unknown lan command ${built.lanParams.cmd}`)
          }
          if (built.bleParams && built.bleParams.data === undefined) {
            failures.push(`${model} ${params.cmd}: ble data missing`)
          }
        } catch (err) {
          failures.push(`${model} ${params.cmd}: ${err.message}`)
        }
      })
    })

    expect(failures).toEqual([])
  })
})

/**
 * The H1250 ceiling light has two independently controllable zones - a main
 * downlight panel and a background ring. Govee lists `mainLightToggle` and
 * `backgroundLightToggle` for it and answers `{"status":"success"}` to both,
 * but the command never reaches the device (#1333).
 *
 * What the device does accept is the frame it reports its own zones with:
 *
 *   33 30 <zone> <state>    zone 00 = main, 01 = background
 *                           state 00 = off, 01 = on
 *
 * The four frames below were confirmed against the hardware, so they are
 * pinned exactly rather than rebuilt from the same helper that produces them.
 */
describe('what goes out for a light zone', () => {
  const frameFor = params => buildCommand(params).awsParams.data.command[0]

  it('turns the main panel on', () => {
    expect(frameFor({ cmd: 'zoneState', zone: 'main', value: true }))
      .toBe('MzAAAQAAAAAAAAAAAAAAAAAAAAI=')
  })

  it('turns the main panel off', () => {
    expect(frameFor({ cmd: 'zoneState', zone: 'main', value: false }))
      .toBe('MzAAAAAAAAAAAAAAAAAAAAAAAAM=')
  })

  it('turns the background ring on', () => {
    expect(frameFor({ cmd: 'zoneState', zone: 'background', value: true }))
      .toBe('MzABAQAAAAAAAAAAAAAAAAAAAAM=')
  })

  it('turns the background ring off', () => {
    expect(frameFor({ cmd: 'zoneState', zone: 'background', value: false }))
      .toBe('MzABAAAAAAAAAAAAAAAAAAAAAAI=')
  })

  it('goes over aws only, since this model ignores the frame over lan', () => {
    // LAN is fire-and-forget, so offering it there would count as sent and the
    // command would never reach the device
    const built = buildCommand({ cmd: 'zoneState', zone: 'main', value: true })
    expect(built.awsParams.cmd).toBe('ptReal')
    expect(built.lanParams).toBeUndefined()
  })

  it('refuses a zone it does not know', () => {
    // Quietly treating this as the main panel would switch the wrong light,
    // which is far harder to spot than an outright failure
    expect(() => buildCommand({ cmd: 'zoneState', zone: 'ceiling', value: true }))
      .toThrow(/zone/i)
  })
})
