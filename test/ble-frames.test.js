import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { buildCommand } from '../lib/utils/command-builder.js'
import platformConsts from '../lib/utils/constants.js'
import { generateCodeFromHexValues } from '../lib/utils/functions.js'

/**
 * Govee bluetooth packets are always twenty bytes, and the last byte is the
 * XOR of the nineteen before it. A packet that breaks either rule is ignored by
 * the device without complaint, so nothing downstream would ever tell us.
 *
 * These checks run over the commands the plugin actually builds, so a bad value
 * is caught when it is added rather than when someone's light stops responding.
 */

const PACKET_LENGTH = 20

function checksumOf(frame) {
  let checksum = 0
  for (let index = 0; index < frame.length - 1; index += 1) {
    checksum ^= frame[index]
  }
  return checksum
}

function expectValidFrame(frame, description) {
  const buffer = Buffer.isBuffer(frame)
    ? frame
    : Buffer.from(frame, 'base64')
  expect(buffer.length, `${description} should be ${PACKET_LENGTH} bytes`).toBe(PACKET_LENGTH)
  expect(checksumOf(buffer), `${description} has a bad checksum`).toBe(buffer[PACKET_LENGTH - 1])
  expect(buffer[0], `${description} should start with the command marker`).toBe(0x33)
}

/**
 * The bluetooth connection turns a command into a packet this way, so the test
 * builds it the same way rather than describing it a second time.
 */
function frameFor(bleParams) {
  return generateCodeFromHexValues([0x33, bleParams.cmd, bleParams.data], true)
}

describe('building a bluetooth packet', () => {
  it('always produces twenty bytes with a valid checksum', () => {
    for (let length = 1; length <= 18; length += 1) {
      const data = Array.from({ length }, (_, index) => (index * 7) % 256)
      expectValidFrame(generateCodeFromHexValues([0x33, ...data], true), `${length} bytes of data`)
    }
  })

  it('refuses a command too long to fit', () => {
    // Silently returning an over-long packet was the old behaviour, and a
    // device given one simply does nothing
    const tooLong = Array.from({ length: 20 }).fill(0x01)
    expect(() => generateCodeFromHexValues(tooLong, true)).toThrow(/longer than a packet allows/)
  })

  it('accepts a command that exactly fills the packet', () => {
    const exact = [
      0x33,
      ...Array.from({ length: 18 }, (_, index) => index + 1),
    ]
    expectValidFrame(generateCodeFromHexValues(exact, true), 'a full packet')
  })
})

describe('the commands the plugin sends', () => {
  const simpleCommands = [
    { cmd: 'state', value: 'on' },
    { cmd: 'state', value: 'off' },
    { cmd: 'stateHumi', value: 'on' },
    { cmd: 'stateHumi', value: 'off' },
    { cmd: 'statePuri', value: 'on' },
    { cmd: 'stateHeat', value: 'on' },
    { cmd: 'stateHeat', value: 'off' },
  ]

  it.each(simpleCommands)('builds a valid packet for $cmd $value', (params) => {
    const { bleParams } = buildCommand(params, { gvModel: 'H7100' })
    expectValidFrame(frameFor(bleParams), `${params.cmd} ${params.value}`)
  })

  it('builds a valid colour packet for every light model', () => {
    const failures = []

    platformConsts.models.rgb.forEach((model) => {
      const context = { gvModel: model, awsColourMode: 'default' }
      try {
        const { bleParams } = buildCommand(
          {
            cmd: 'color',
            value: { r: 255, g: 128, b: 0 },
          },
          context,
        )
        const frame = frameFor(bleParams)
        if (frame.length !== PACKET_LENGTH || checksumOf(frame) !== frame[PACKET_LENGTH - 1]) {
          failures.push(`${model}: ${frame.length} bytes`)
        }
      } catch (err) {
        failures.push(`${model}: ${err.message}`)
      }
    })

    expect(failures).toEqual([])
  })

  it('builds a valid colour temperature packet for every light model', () => {
    const failures = []

    platformConsts.models.rgb.forEach((model) => {
      const context = { gvModel: model, awsColourMode: 'default' }
      try {
        const { bleParams } = buildCommand({ cmd: 'colorTem', value: 4000 }, context)
        const frame = frameFor(bleParams)
        if (frame.length !== PACKET_LENGTH || checksumOf(frame) !== frame[PACKET_LENGTH - 1]) {
          failures.push(`${model}: ${frame.length} bytes`)
        }
      } catch (err) {
        failures.push(`${model}: ${err.message}`)
      }
    })

    expect(failures).toEqual([])
  })

  it('builds a valid brightness packet across the whole range', () => {
    const failures = []

    platformConsts.models.rgb.forEach((model) => {
      const context = { gvModel: model }
      ;[1, 50, 100].forEach((brightness) => {
        try {
          const { bleParams } = buildCommand({ cmd: 'brightness', value: brightness }, context)
          const frame = frameFor(bleParams)
          if (frame.length !== PACKET_LENGTH || checksumOf(frame) !== frame[PACKET_LENGTH - 1]) {
            failures.push(`${model} at ${brightness}: ${frame.length} bytes`)
          }
        } catch (err) {
          failures.push(`${model} at ${brightness}: ${err.message}`)
        }
      })
    })

    expect(failures).toEqual([])
  })
})
