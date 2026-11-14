import { beforeEach, describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import devicePurifierH7123 from './purifier-H7123.js'

/**
 * The H7124 used to have its own copy of this file, and the air quality fix
 * from #1261 was only ever applied to the H7123's copy. Collapsing the two gave
 * the H7124 that fix, so these pin the behaviour both models now share.
 *
 * The model snapshot cannot see any of this - it covers which controls a device
 * is given, not how a reading is turned into a value.
 */

// aa19 status frames carrying a govee air quality reading
const QUALITY_EXCELLENT = 'qhkAAAEAAAAAAAAAAAAAAAAAALI='
const QUALITY_POOR = 'qhkAAAQAAAAAAAAAAAAAAAAAALc='
const QUALITY_NONSENSE = 'qhkAAAkAAAAAAAAAAAAAAAAAALo='

function build(model) {
  const accessory = makeAccessory(model)
  const device = new devicePurifierH7123(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

describe.each(['H7123', 'H7124'])('air quality on the %s', (model) => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('maps the worst govee reading onto the value HomeKit uses for poor', () => {
    const device = build(model)
    device.externalUpdate({
      commands: [QUALITY_POOR],
      source: 'AWS',
    })

    expect(device.cacheAir).toBe(5)
    expect(device.airService.getCharacteristic('AirQuality').value).toBe(5)
  })

  it('names that reading in the log rather than logging undefined', () => {
    const device = build(model)
    device.externalUpdate({
      commands: [QUALITY_POOR],
      source: 'AWS',
    })

    const logged = device.accessory.log.messages().join(' ')
    expect(logged).toContain('poor')
    expect(logged).not.toContain('undefined')
  })

  it('remembers the reading, so an unchanged one is not logged twice', () => {
    const device = build(model)
    device.externalUpdate({
      commands: [QUALITY_EXCELLENT],
      source: 'AWS',
    })
    const afterFirst = device.accessory.log.calls.length

    device.externalUpdate({
      commands: [QUALITY_EXCELLENT],
      source: 'AWS',
    })

    expect(device.accessory.log.calls.length).toBe(afterFirst)
  })

  it('never sends HomeKit a value outside the range it accepts', () => {
    const device = build(model)
    device.externalUpdate({
      commands: [QUALITY_NONSENSE],
      source: 'AWS',
    })

    const value = device.airService.getCharacteristic('AirQuality').value
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(5)
  })
})

/**
 * A purifier sends a burst of status frames when the connection comes up. The
 * handler has nothing to do with most of them, and warning about each one put
 * three lines in an owner's log for a purifier that was working perfectly
 * (#1340). The point of the warning is to prompt a report, so it has to be
 * spent on frames that might actually mean something is wrong.
 */
describe('the status frames an H7123 sends on connect', () => {
  // exactly as reported on #1340
  const ON_CONNECT = [
    'qhcCAAAAAAAAAAAAAAAAAAAAAL8=', // aa17
    'qhIAAAAAAAAAAAAAAAAAAAAAALg=', // aa12
    'qh8CAAAAAAAAAAAAAAAAAAAAALc=', // aa1f
  ]

  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('does not warn about any of them', () => {
    const device = build('H7123')
    device.externalUpdate({ commands: ON_CONNECT, source: 'AWS' })

    expect(device.accessory.logWarn.messages()).toHaveLength(0)
  })

  it('still records each one at debug, so they can be worked out later', () => {
    const device = build('H7123')
    device.externalUpdate({ commands: ON_CONNECT, source: 'AWS' })

    const debug = device.accessory.logDebug.messages().join(' ')
    expect(debug).toContain('aa17')
    expect(debug).toContain('aa12')
    expect(debug).toContain('aa1f')
  })

  it('stays quiet about a frame it has never seen either', () => {
    const device = build('H7123')
    // aa7f, a code that appears in no list anywhere - it is still just the
    // purifier describing itself, so it is no more worth interrupting for
    device.externalUpdate({
      commands: ['qn8AAAAAAAAAAAAAAAAAAAAAANU='],
      source: 'AWS',
    })

    expect(device.accessory.logWarn.messages()).toHaveLength(0)
  })

  it('calls them status rather than scenes, because that is what they are', () => {
    const device = build('H7123')
    device.externalUpdate({
      commands: ['qn8AAAAAAAAAAAAAAAAAAAAAANU='],
      source: 'AWS',
    })

    const logged = device.accessory.logDebug.messages().join(' ')
    expect(logged).toContain('unrecognised status')
    expect(logged).not.toContain('scene')
  })

  it('keeps the model and the frame in the line, so it is still worth reading', () => {
    const device = build('H7123')
    device.externalUpdate({
      commands: ['qn8AAAAAAAAAAAAAAAAAAAAAANU='],
      source: 'AWS',
    })

    const logged = device.accessory.logDebug.messages().join(' ')
    expect(logged).toContain('H7123')
    expect(logged).toContain('aa7f')
  })
})
