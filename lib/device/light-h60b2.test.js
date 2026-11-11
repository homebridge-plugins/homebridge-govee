import { Buffer } from 'node:buffer'

import { describe, expect, it, vi } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { buildCommand } from '../utils/command-builder.js'
import deviceLight from './light.js'

/**
 * The H60B2 tree floor lamp has three heads that switch, dim and colour
 * independently (#1395). Each is a zone of one light segment, bottom first.
 *
 * Every frame and report below was checked on a real lamp (firmware 1.00.17),
 * by eye and against the lamp's own `aa 36` / `aa a5` reports.
 */

function build(context = {}) {
  const sent = []
  const platform = makePlatform({
    sendDeviceUpdate: async (_accessory, params) => {
      sent.push(params)
    },
  })
  const accessory = makeAccessory('H60B2', context)
  const device = new deviceLight(platform, accessory)
  device.accessory = accessory
  return { accessory, device, sent }
}

function tiles(accessory) {
  return accessory.services
    .filter(service => service.type === 'Lightbulb' && service.subtype)
    .map(service => service.displayName)
}

// The 20-byte frame as hex, from the base64 a command carries
function frameHex(params) {
  return Buffer.from(params.data.command[0], 'base64').toString('hex')
}

// Reported by the lamp: bottom on, middle off, top on
const MIDDLE_OFF = 'qjYBAAEAAAAAAAAAAAAAAAAAAJw='
// Reported by the lamp: every head warm white, the middle one at 20%
const MIDDLE_AT_20 = 'qqUBZP+2YhT/tmJk/7ZiAAAAADE='

describe('the h60b2\'s heads', () => {
  it('are three tiles, bottom to top, with lan and a govee login', () => {
    const { accessory } = build({ useLanControl: true, useAwsControl: true })

    expect(tiles(accessory)).toEqual(['Bottom Light', 'Middle Light', 'Top Light'])
  })

  it('are three tiles over aws alone', () => {
    const { accessory } = build({ useLanControl: false, useAwsControl: true })

    expect(tiles(accessory)).toHaveLength(3)
  })

  it('are not offered over lan alone, with no govee login to report their state', () => {
    const { accessory } = build({ useLanControl: true, useAwsControl: false })

    expect(tiles(accessory)).toEqual([])
  })

  it('are not offered with only an api key, which cannot send the head frames', () => {
    const { accessory } = build({ useLanControl: false, useAwsControl: false, useOpenApiControl: true })

    expect(tiles(accessory)).toEqual([])
  })

  it('switch with the head\'s own power frame, over lan as well as aws', async () => {
    const { accessory, sent } = build({ useLanControl: true, useAwsControl: true })
    await accessory.getService('Top Light').getCharacteristic('On').setHandler(true)

    const built = buildCommand(sent.at(-1))
    expect(frameHex(built.lanParams)).toBe(`33360201${'00'.repeat(15)}06`)
    expect(built.awsParams).toEqual(built.lanParams)
  })

  it('map bottom, middle and top to heads 0, 1 and 2', async () => {
    const { accessory, sent } = build({ useLanControl: true, useAwsControl: true })
    for (const name of ['Bottom Light', 'Middle Light', 'Top Light']) {
      await accessory.getService(name).getCharacteristic('On').setHandler(true)
    }

    expect(sent.map(params => frameHex(buildCommand(params).lanParams).slice(0, 8)))
      .toEqual(['33360001', '33360101', '33360201'])
  })

  it('dim one head by its light segment, over lan', async () => {
    const { device, sent } = build({ useLanControl: true, useAwsControl: true })

    await device.internalZoneBrightnessUpdate('light2Toggle', 'light2', 'Middle Light', 20)

    expect(frameHex(buildCommand(sent[0]).lanParams)).toBe(`3305150214020000${'00'.repeat(11)}37`)
  })

  it('colour one head by its light segment, over lan', async () => {
    const { accessory, device, sent } = build({ useLanControl: true, useAwsControl: true })
    accessory.getService('Middle Light').getCharacteristic('Saturation').value = 100

    await device.internalZoneColourUpdate('light2Toggle', 'light2', 'Middle Light', 0)

    expect(frameHex(buildCommand(sent[0]).lanParams).slice(0, 30))
      .toBe(`33051501ff0000${'00'.repeat(5)}020000`)
  })

  it('read their on/off back from the lamp\'s report', () => {
    const { accessory, device } = build({ useLanControl: true, useAwsControl: true })
    device.initialised = true

    device.externalUpdate({
      commands: [MIDDLE_OFF],
      source: 'AWS',
    })

    expect(['Bottom Light', 'Middle Light', 'Top Light']
      .map(name => accessory.getService(name).getCharacteristic('On').value))
      .toEqual([true, false, true])
  })

  it('read their brightness back from the lamp\'s report', () => {
    const { accessory, device } = build({ useLanControl: true, useAwsControl: true })
    device.initialised = true

    device.externalUpdate({
      commands: [MIDDLE_AT_20],
      source: 'AWS',
    })

    expect(['Bottom Light', 'Middle Light', 'Top Light']
      .map(name => accessory.getService(name).getCharacteristic('Brightness').value))
      .toEqual([100, 20, 100])
  })
})

describe('the h60b2 changed as a whole', () => {
  it('asks the lamp for its heads straight after, so their tiles follow', async () => {
    vi.useFakeTimers()
    try {
      const { device, sent } = build({ useLanControl: true, useAwsControl: true })
      const asked = []
      device.platform.awsClient = {
        requestUpdate: async accessory => asked.push(accessory),
      }

      await device.internalStateUpdate(true)
      await vi.advanceTimersByTimeAsync(2000)

      expect(sent.at(-1).cmd).toBe('state')
      expect(asked).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a two-zone light\'s frames', () => {
  it('still stay off lan, which the h1250 ignores', async () => {
    const built = buildCommand({
      cmd: 'zoneBrightness',
      lightSegments: [16],
      value: 40,
    })

    expect(built.lanParams).toBeUndefined()
  })
})
