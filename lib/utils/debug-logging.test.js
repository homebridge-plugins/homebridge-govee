import { describe, expect, it, vi } from 'vitest'

import GoveePlatform from '../platform.js'

/**
 * Where debug lines are decided.
 *
 * The plugin used to work out whether debug logging was on by looking for `-D`
 * in its own process arguments. That is right in the main Homebridge process
 * and wrong in a child bridge: Homebridge only passes `-D` to a child bridge
 * that has its own debug setting turned on, so with debug enabled globally the
 * plugin concluded debug was off and replaced Homebridge's working debug logger
 * with a function that does nothing. Anyone running the plugin in a child
 * bridge - which the Homebridge UI encourages - got no debug output at all.
 *
 * Homebridge already prints debug lines only when debug is on, in both kinds of
 * process, so the plugin's job is simply to hand its debug lines over and let
 * Homebridge decide.
 */

function makeLog() {
  const log = Object.assign(vi.fn(), {
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })
  return log
}

function makePlatform(config = {}) {
  const platform = Object.create(GoveePlatform.prototype)
  platform.log = makeLog()
  platform.config = config
  return platform
}

function makeAccessory() {
  return { displayName: 'Kitchen Lamp' }
}

describe('an accessory\'s debug logging', () => {
  it('goes to homebridge\'s debug logger, so homebridge decides if it prints', () => {
    const platform = makePlatform()
    const accessory = makeAccessory()

    platform.applyAccessoryLogging(accessory)
    accessory.logDebug('something worth tracing')

    expect(platform.log.debug).toHaveBeenCalledTimes(1)
    expect(platform.log.debug.mock.calls[0]).toContain('Kitchen Lamp')
  })

  it('is never replaced by a function that throws the line away', () => {
    // The whole bug: a plugin-side decision that debug was off, made from
    // process arguments a child bridge never receives
    const platform = makePlatform()
    const accessory = makeAccessory()

    platform.applyAccessoryLogging(accessory)
    accessory.logDebug('a')
    accessory.logDebugWarn('b')

    expect(platform.log.debug).toHaveBeenCalledTimes(2)
  })

  it('does not print debug lines as ordinary log lines', () => {
    // They used to be printed through the normal logger, which meant they
    // showed at info level and could not be filtered as debug
    const platform = makePlatform()
    const accessory = makeAccessory()

    platform.applyAccessoryLogging(accessory)
    accessory.logDebug('tracing')

    expect(platform.log).not.toHaveBeenCalled()
    expect(platform.log.warn).not.toHaveBeenCalled()
  })

  it('keeps working when the owner has turned device logging off', () => {
    // `disableDeviceLogging` is about routine chatter. Someone who has also
    // turned debug on is diagnosing a problem and still needs the debug lines
    const platform = makePlatform({ disableDeviceLogging: true })
    const accessory = makeAccessory()

    platform.applyAccessoryLogging(accessory)
    accessory.log('routine')
    accessory.logWarn('routine warning')
    accessory.logDebug('tracing')

    expect(platform.log).not.toHaveBeenCalled()
    expect(platform.log.warn).not.toHaveBeenCalled()
    expect(platform.log.debug).toHaveBeenCalledTimes(1)
  })

  it('still logs normally when device logging is left on', () => {
    const platform = makePlatform({ disableDeviceLogging: false })
    const accessory = makeAccessory()

    platform.applyAccessoryLogging(accessory)
    accessory.log('routine')
    accessory.logWarn('routine warning')

    expect(platform.log).toHaveBeenCalledTimes(1)
    expect(platform.log.warn).toHaveBeenCalledTimes(1)
  })
})
