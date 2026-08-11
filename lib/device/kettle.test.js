import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { resetReportedUnknowns } from '../utils/report-unknown.js'
import deviceKettle from './kettle.js'

/**
 * What a kettle says when it first connects.
 *
 * On startup an H7171 sends nine status frames in a row, five of them listing
 * the temperature held in each of its temperature slots. None of them was
 * understood, so every one was reported as an "unrecognised scene" - nine
 * alarming lines about scenes, on a kettle, for a device that had in fact been
 * set up correctly. The owner reasonably read it as the kettle having failed to
 * be recognised (#1337).
 *
 * These are the exact frames from that report.
 */

// aa 05 <slot> <degrees F>. Slot 1 is the current target, slots 2-5 are the
// four memory presets - see the note in kettle.js for how that was established
const TEMP_SLOTS = [
  'qgUB1AAAAAAAAAAAAAAAAAAAAHo=', // slot 1, 0xd4 = 212F
  'qgUC1AAAAAAAAAAAAAAAAAAAAHk=', // slot 2, 0xd4 = 212F
  'qgUDtAAAAAAAAAAAAAAAAAAAABg=', // slot 3, 0xb4 = 180F
  'qgUEwwAAAAAAAAAAAAAAAAAAAGg=', // slot 4, 0xc3 = 195F
  'qgUFzQAAAAAAAAAAAAAAAAAAAGc=', // slot 5, 0xcd = 205F
]

// the other startup frames, contents not worked out
const OTHER_STARTUP = [
  'qh8IAQAAAAAAAAAAAAAAAAAAALw=', // aa 1f 08 01
  'qh8GAQAAAAAAAAAAAAAAAAAAALI=', // aa 1f 06 01
  'qhcBAIAAAAAAAAAAAAAAAAAAADw=', // aa 17 01 00 80
  'qhkAAAAAAAAAAAAAAAAAAAAAALM=', // aa 19 00
]

function makeKettle() {
  const platform = makePlatform()
  const accessory = makeAccessory('H7171')
  const reported = []
  const logged = []
  accessory.logWarn = msg => reported.push(String(msg))
  accessory.log = msg => logged.push(String(msg))
  const device = new deviceKettle(platform, accessory)
  return { device, reported, logged }
}

function receive(device, commands) {
  device.externalUpdate({ source: 'AWS', commands })
}

describe('a kettle reporting its state on startup', () => {
  // an unknown payload is only reported once per session, so without this the
  // tests below would pass or fail depending on which ran first
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('says nothing about the preset temperatures', () => {
    const { device, reported } = makeKettle()

    receive(device, TEMP_SLOTS)

    expect(reported).toHaveLength(0)
  })

  it('says nothing about the other startup frames either', () => {
    const { device, reported } = makeKettle()

    receive(device, OTHER_STARTUP)

    expect(reported).toHaveLength(0)
  })

  it('stays quiet across the whole run the owner saw', () => {
    const { device, reported } = makeKettle()

    receive(device, [...OTHER_STARTUP.slice(0, 2), ...TEMP_SLOTS, ...OTHER_STARTUP.slice(2)])

    expect(reported).toHaveLength(0)
  })

  it('still records something genuinely unrecognised, so the reporting is not just switched off', () => {
    const { device, reported } = makeKettle()

    // a made-up frame with a valid shape but a command the kettle never sends
    receive(device, [Buffer.from('aa9901000000000000000000000000000000002b', 'hex').toString('base64')])

    // quiet, because the kettle volunteered it - but kept in full, because it
    // is what an owner would be asked for if the code ever needs working out
    expect(reported).toHaveLength(0)
    expect(device.accessory.logDebug.messages().join(' ')).toContain('aa9901')
  })

  it('does not call a kettle status frame a scene', () => {
    // "unrecognised scene" sent the owner looking for a HomeKit scene problem
    const { device } = makeKettle()

    receive(device, [Buffer.from('aa9901000000000000000000000000000000002b', 'hex').toString('base64')])

    expect(device.accessory.logDebug.messages().join(' ')).not.toMatch(/scene/)
  })

  it('puts the slot temperatures in the normal log, where they can be seen', () => {
    const { device, logged } = makeKettle()

    receive(device, TEMP_SLOTS)

    expect(logged).toHaveLength(5)
    expect(logged[0]).toBe('target temperature is set to 212°F [100°C]')
    expect(logged[2]).toBe('memory preset 2 is set to 180°F [82°C]')
  })

  /**
   * Slot 1 is the temperature the kettle is set to right now, not a preset.
   * Two runs from the owner in #1337 show it moving on its own - 212F, then
   * 142F matching the `setTem` of 14200 in the same message - while slots 2-5
   * never budged. So the four memory presets are slots 2-5, and calling slot 1
   * "preset 1" both invents a preset and numbers the real four wrongly.
   */
  it('calls slot 1 the target temperature, and numbers the presets from slot 2', () => {
    const { device, logged } = makeKettle()

    receive(device, TEMP_SLOTS)

    expect(logged[0]).toContain('target temperature')
    expect(logged[0]).not.toContain('preset')
    expect(logged[1]).toContain('memory preset 1')
    expect(logged[4]).toContain('memory preset 4')
  })

  it('logs each slot once, however often the kettle repeats itself', () => {
    // Nothing says a firmware will not re-send these on a timer, and five lines
    // every few minutes would be worse than the noise this replaced
    const { device, logged } = makeKettle()

    receive(device, TEMP_SLOTS)
    receive(device, TEMP_SLOTS)
    receive(device, TEMP_SLOTS)

    expect(logged).toHaveLength(5)
  })

  it('logs a slot again when its temperature actually changes', () => {
    const { device, logged } = makeKettle()

    receive(device, [TEMP_SLOTS[2]]) // slot 3 at 180F
    // slot 3 changed to 175F: aa 05 03 af
    receive(device, [Buffer.from('aa0503af00000000000000000000000000000003', 'hex').toString('base64')])

    expect(logged).toHaveLength(2)
    expect(logged[1]).toContain('175°F')
  })

  /**
   * #1351: an H7173 sends `aa 05 <x> <0|1>` on startup. The fourth byte is a
   * temperature on the H7171 these frames were decoded from, but not here - so
   * the plugin announced "preset 1 is set to 0°F [-18°C]" three times over.
   */
  it('does not call 0 or 1 a preset temperature, since no kettle holds one', () => {
    const { device, logged } = makeKettle()

    // the exact shape from #1351: slot byte 1, fourth byte 00 then 01
    receive(device, [
      Buffer.from('aa0501000000000000000000000000000000007e', 'hex').toString('base64'),
      Buffer.from('aa0501010000000000000000000000000000007f', 'hex').toString('base64'),
    ])

    expect(logged).toHaveLength(0)
  })

  it('reports an unreadable aa 05 frame, so the real meaning can be worked out', () => {
    const { device } = makeKettle()

    receive(device, [Buffer.from('aa0504010000000000000000000000000000007a', 'hex').toString('base64')])

    // At debug rather than as a warning: the kettle volunteered this, and the
    // owner cannot act on it. The raw hex is the part that matters - it is the
    // one thing needed to decode the frame, and nobody can obtain it otherwise
    expect(device.accessory.logDebug.messages().join(' ')).toContain('aa0504')
  })

  it('still reads a real temperature, so the guard has not swallowed the working case', () => {
    const { device, logged } = makeKettle()

    // 0x5a = 90F, the lowest a slot may hold
    receive(device, [Buffer.from('aa05015a000000000000000000000000000000d4', 'hex').toString('base64')])

    expect(logged[0]).toBe('target temperature is set to 90°F [32°C]')
  })

  it('still reacts to a mode change, which shares the same command byte', () => {
    // aa 05 00 <mode> is a mode change, not a preset - the slot byte is the
    // only thing separating them, so the preset branch must not swallow it
    const { device, reported } = makeKettle()

    receive(device, [Buffer.from('aa050002000000000000000000000000000000ad', 'hex').toString('base64')])

    expect(reported).toHaveLength(0)
  })
})

/**
 * The water temperature tile.
 *
 * This kettle had one before and it was taken away again (6b5bb46): it was
 * added at startup and then nothing ever put a new value in it, so owners were
 * left with a tile frozen at whatever it started on. A number that never moves
 * cannot be told apart from a real reading, which makes it worse than no tile.
 *
 * So the tile only appears once there is a genuine reading to put in it, and
 * every reading after that has to reach it. The frame layout is unconfirmed,
 * so a figure that is not a plausible water temperature must leave the tile
 * alone rather than show something wrong.
 */

// aa 10 01 <hundredths of a degree fahrenheit>
const BOILING = 'qhABUtAAAAAAAAAAAAAAAAAAADk=' // 212F
const WARM = 'qhABQ5QAAAAAAAAAAAAAAAAAAGw=' // 173F
const COLD = 'qhABGpAAAAAAAAAAAAAAAAAAADE=' // 68F
const NOT_A_TEMPERATURE = 'qhABAAAAAAAAAAAAAAAAAAAAALs=' // reads as 0F

describe('the kettle water temperature', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('has no tile before a reading has arrived', () => {
    const { device } = makeKettle()

    expect(device.serviceTemp).toBeFalsy()
  })

  it('adds the tile once there is a real reading for it', () => {
    const { device } = makeKettle()

    receive(device, [BOILING])

    expect(device.serviceTemp).toBeTruthy()
  })

  it('shows the reading in celsius', () => {
    const { device } = makeKettle()

    receive(device, [BOILING])

    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(100)
  })

  it('keeps the tile up to date as the water heats', () => {
    // the exact failure that had the tile removed last time
    const { device } = makeKettle()

    receive(device, [COLD])
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(20)

    receive(device, [WARM])
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(78)

    receive(device, [BOILING])
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(100)
  })

  it('logs a reading once rather than on every repeat of it', () => {
    const { device, logged } = makeKettle()

    receive(device, [BOILING])
    receive(device, [BOILING])
    receive(device, [BOILING])

    expect(logged).toHaveLength(1)
  })

  it('shows nothing when the frame does not hold a water temperature', () => {
    const { device, logged } = makeKettle()

    receive(device, [NOT_A_TEMPERATURE])

    expect(device.serviceTemp).toBeFalsy()
    expect(logged).toHaveLength(0)
  })

  it('does not call that frame unrecognised, because it is recognised', () => {
    const { device, reported } = makeKettle()

    receive(device, [NOT_A_TEMPERATURE])

    expect(reported).toHaveLength(0)
    expect(device.accessory.logDebug.messages().join(' ')).toContain('no temperature read')
  })

  // The layout was guesswork until an owner ran the kettle with the log open
  // and told us what it was doing at each point (#1337). These are their frames
  // and their readings, so the decode is pinned against a real kettle.
  it('reads the owner-confirmed run correctly', () => {
    const { device } = makeKettle()

    receive(device, ['qhABHtwBAAAAAAAAAAAAAAAAAHg=']) // cold water, before it was turned on
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(26)

    receive(device, ['qhABN3gBAAAAAAAAAAAAAAAAAPU=']) // the moment it beeped at its 142F target
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(61)

    receive(device, ['qhABOdABAAAAAAAAAAAAAAAAAFM=']) // drifted a little past it afterwards
    expect(device.serviceTemp.getCharacteristic('CurrentTemperature').value).toBe(64)
  })
})

/**
 * What the kettle is doing.
 *
 * Before this the plugin could say the kettle was on its base and how hot the
 * water was, but nothing about whether it was actually working. The kettle was
 * saying so all along in `aa 19 <state>` frames, which were reported as
 * unrecognised because nobody knew what they meant.
 *
 * An owner settled it by running the kettle with debug logging on and writing
 * down what it was doing as each frame arrived (#1337). These are their frames,
 * in the order their kettle sent them.
 */
const IDLE = 'qhkAAAAAAAAAAAAAAAAAAAAAALM=' // aa 19 00
const HEATING = 'qhkBAAAAAAAAAAAAAAAAAAAAALI=' // aa 19 01
const KEEPING_WARM = 'qhkCAAAAAAAAAAAAAAAAAAAAALE=' // aa 19 02
const REACHED_TARGET = 'qhkEAAAAAAAAAAAAAAAAAAAAALc=' // aa 19 04

function contactState(device) {
  return device.serviceHeating.getCharacteristic('ContactSensorState').value
}

describe('what the kettle is doing', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('has no tile before the kettle has said anything', () => {
    const { device } = makeKettle()

    expect(device.serviceHeating).toBeFalsy()
  })

  it('adds the tile once the kettle reports a state', () => {
    const { device } = makeKettle()

    receive(device, [HEATING])

    expect(device.serviceHeating).toBeTruthy()
  })

  it('shows contact only while the kettle is actually heating', () => {
    const { device } = makeKettle()

    receive(device, [HEATING])
    expect(contactState(device)).toBe(0) // CONTACT_DETECTED

    receive(device, [REACHED_TARGET])
    expect(contactState(device)).toBe(1) // CONTACT_NOT_DETECTED

    receive(device, [KEEPING_WARM])
    expect(contactState(device)).toBe(1)

    receive(device, [IDLE])
    expect(contactState(device)).toBe(1)
  })

  it('follows the run the owner recorded, in order', () => {
    const { device, logged } = makeKettle()

    // turned on at 10:08, reached 142F and beeped at 10:09:37, keep warm held
    // it for three and a half minutes, switched off at 10:13
    receive(device, [HEATING])
    receive(device, [REACHED_TARGET])
    receive(device, [KEEPING_WARM])
    receive(device, [IDLE])

    expect(logged).toEqual([
      'current status [heating]',
      'current status [reached target]',
      'current status [keeping warm]',
      'current status [idle]',
    ])
  })

  it('says nothing more while the state stays put', () => {
    // keep warm repeats on every status frame, and the kettle is polled often
    const { device, logged } = makeKettle()

    receive(device, [KEEPING_WARM])
    receive(device, [KEEPING_WARM])
    receive(device, [KEEPING_WARM])

    expect(logged).toHaveLength(1)
  })

  it('no longer calls any of them unrecognised', () => {
    // three of the four used to arrive as "unrecognised status" lines, which is
    // what sent the owner to the issue tracker in the first place
    const { device, reported } = makeKettle()

    receive(device, [IDLE, HEATING, REACHED_TARGET, KEEPING_WARM])

    expect(reported).toHaveLength(0)
    expect(device.accessory.logDebug.messages().join(' ')).not.toMatch(/unrecognised/)
  })

  it('still reports an unseen state, so a fifth one can be found the same way', () => {
    const { device } = makeKettle()

    // aa 19 03 - never observed, so it must not be silently swallowed
    receive(device, [Buffer.from('aa1903000000000000000000000000000000b0', 'hex').toString('base64')])

    expect(device.accessory.logDebug.messages().join(' ')).toMatch(/unrecognised/)
    expect(device.serviceHeating).toBeFalsy()
  })
})
