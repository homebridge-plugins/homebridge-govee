import { beforeEach, describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceSensorBasic from './sensor-basic.js'

/**
 * This handler exists for sensors whose readings have not been worked out. It
 * offers no tiles and instead prints what the device sends, so one owner's log
 * is enough to build the real thing.
 *
 * That only works if the payload is actually in the line. It read a `scene`
 * field that nothing anywhere sets, so every report went out carrying just the
 * model and the word "scene" - no frame, nothing to decode. These pin that a
 * report contains something an owner could act on.
 */

function build(model = 'H5123') {
  const accessory = makeAccessory(model)
  const device = new deviceSensorBasic(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

const A_FRAME = 'qgUBAgAAAAAAAAAAAAAAAAAAAKw='

describe('a sensor whose readings are not understood yet', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('puts the frame it received in the report', () => {
    const device = build()
    device.externalUpdate({
      commands: [A_FRAME],
      source: 'AWS',
    })

    const reported = device.accessory.logWarn.messages().join(' ')
    expect(reported).toContain(A_FRAME)
  })

  it('includes the hex, which is the form that gets read', () => {
    const device = build()
    device.externalUpdate({
      commands: [A_FRAME],
      source: 'AWS',
    })

    const reported = device.accessory.logWarn.messages().join(' ')
    expect(reported).toContain('aa050102')
  })

  it('reports every frame in an update, not just the first', () => {
    const device = build()
    device.externalUpdate({
      commands: [A_FRAME, 'qn8AAAAAAAAAAAAAAAAAAAAAANU='],
      source: 'AWS',
    })

    expect(device.accessory.logWarn.messages()).toHaveLength(2)
  })

  it('reports fields that arrive on the update itself, since the readings may be there instead', () => {
    const device = build()
    device.externalUpdate({ source: 'AWS', battery: 88 })

    const reported = device.accessory.logWarn.messages().join(' ')
    expect(reported).toContain('battery')
    expect(reported).toContain('88')
  })

  it('says nothing when there is nothing to say', () => {
    const device = build()
    device.externalUpdate({ source: 'AWS' })

    expect(device.accessory.logWarn.messages()).toHaveLength(0)
  })

  it('never reports a line with no payload in it', () => {
    // the shape of the bug: a report naming the model and nothing else
    const device = build()
    device.externalUpdate({
      commands: [A_FRAME],
      source: 'AWS',
      battery: 88,
    })

    device.accessory.logWarn.messages().forEach((line) => {
      expect(line).toMatch(/"raw":/)
    })
  })
})
