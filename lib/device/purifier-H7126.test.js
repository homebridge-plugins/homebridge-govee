import { beforeEach, describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import devicePurifierH7126 from './purifier-H7126.js'

/**
 * A purifier sends a burst of status frames when the connection comes up. This
 * handler acts on three of them and had nothing to say about the rest, so an
 * owner with two working purifiers got ten warnings in one second asking them
 * to report it (#1340). A warning is how the plugin asks for help with
 * something it cannot do, so spending it on frames that are simply not needed
 * buries the ones that matter.
 */

function build(model = 'H7126') {
  const accessory = makeAccessory(model)
  const device = new devicePurifierH7126(makePlatform(), accessory)
  device.accessory = accessory
  return device
}

// exactly as reported on #1340
const ON_CONNECT = [
  'qhcCAAAAAAAAAAAAAAAAAAAAAL8=', // 1702
  'qhkAAAAGAAAAAAAAAAAAAAAAALU=', // 1900
  'qhICAAAAAAAAAAAAAAAAAAAAALo=', // 1202
  'qhMAgRIAAAECAAAAAAAAAAAAACk=', // 1300
  'qhMBgAYAAAEBAAAAAAAAAAAAAD4=', // 1301
  'qiYAAAAAAAAAAAAAAAAAAAAAAIw=', // 2600
  'qgUAAQAAAAAAAAAAAAAAAAAAAK4=', // 0500
  'qgUCAAMACgAAAgAKAAAB/////60=', // 0502
  'qgUDAAAOAAAAAAAAAAAAAAAAAKI=', // 0503
  'qggAAAAAAAAAAAAAAAAAAAAAAKI=', // 0800
]

describe('the status frames an H7126 sends on connect', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('does not warn about any of them', () => {
    const device = build()
    device.externalUpdate({ commands: ON_CONNECT, source: 'AWS' })

    expect(device.accessory.logWarn.messages()).toHaveLength(0)
  })

  it('still records each one at debug, so they can be worked out later', () => {
    const device = build()
    device.externalUpdate({ commands: ON_CONNECT, source: 'AWS' })

    expect(device.accessory.logDebug.messages()).toHaveLength(ON_CONNECT.length)
  })

  it('stays quiet about a frame it has never seen either', () => {
    const device = build()
    // 7f00, a code that appears in no list anywhere - still just the purifier
    // describing itself, so no more worth interrupting for than the rest
    device.externalUpdate({
      commands: ['qn8AAAAAAAAAAAAAAAAAAAAAANU='],
      source: 'AWS',
    })

    expect(device.accessory.logWarn.messages()).toHaveLength(0)
  })

  it('calls them status rather than scenes, because that is what they are', () => {
    const device = build()
    device.externalUpdate({
      commands: ['qn8AAAAAAAAAAAAAAAAAAAAAANU='],
      source: 'AWS',
    })

    const logged = device.accessory.logDebug.messages().join(' ')
    expect(logged).toContain('unrecognised status')
    expect(logged).not.toContain('scene')
  })

  it('still reads the speed it does understand', () => {
    // the quietened codes all start 05 as well, so this pins that the real
    // speed frame did not get swept up with them
    const device = build()
    device.externalUpdate({
      commands: ['qgUBAgAAAAAAAAAAAAAAAAAAAKw='],
      source: 'AWS',
    })

    expect(device.accessory.logWarn.messages()).toHaveLength(0)
    expect(device.cacheSpeed).toBeDefined()
  })
})
