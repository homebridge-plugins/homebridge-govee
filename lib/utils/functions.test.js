import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  base64ToHex,
  cenToFar,
  describeControlFailure,
  fanSpeedToHkPercent,
  farToCen,
  generateCodeFromHexValues,
  getTwoItemPosition,
  hasProperty,
  hexToBase64,
  hexToDecimal,
  hexToTwoItems,
  hkPercentToFanSpeed,
  nearestHalf,
  parseDeviceId,
  parseError,
  updateFailureError,
} from './functions.js'

/**
 * The fan speed mapping is the one worth pinning hardest. Before #1310/#1326
 * the plugin sent the raw HomeKit percentage as a speed, so a slider at 100%
 * asked an 8-step fan for speed 100, and the Home app displayed speeds like
 * "7%". These tests cover the round trip on both step counts we ship.
 */
describe('fan speed mapping', () => {
  it('maps the top of the slider to the fastest speed', () => {
    expect(hkPercentToFanSpeed(100, 8)).toBe(8)
    expect(hkPercentToFanSpeed(100, 12)).toBe(12)
  })

  it('never returns speed 0, which would mean "off" to the device', () => {
    // HomeKit sends 0 when the fan is switched off. Speed 0 is not a valid
    // speed, so the mapping clamps to the slowest instead.
    expect(hkPercentToFanSpeed(0, 8)).toBe(1)
    expect(hkPercentToFanSpeed(1, 8)).toBe(1)
  })

  it('never exceeds the number of steps the model has', () => {
    expect(hkPercentToFanSpeed(150, 8)).toBe(8)
  })

  it('round trips every speed on an 8 step model', () => {
    for (let speed = 1; speed <= 8; speed++) {
      expect(hkPercentToFanSpeed(fanSpeedToHkPercent(speed, 8), 8)).toBe(speed)
    }
  })

  it('round trips every speed on a 12 step model', () => {
    for (let speed = 1; speed <= 12; speed++) {
      expect(hkPercentToFanSpeed(fanSpeedToHkPercent(speed, 12), 12)).toBe(speed)
    }
  })

  it('reports a stopped fan as 0 percent', () => {
    expect(fanSpeedToHkPercent(0, 8)).toBe(0)
    expect(fanSpeedToHkPercent(undefined, 8)).toBe(0)
  })

  it('shows auto mode at the top of the slider', () => {
    // Chosen so the two paths disagree: without the auto case, speed 5 of 8
    // would map to 63%. An auto speed that happens to sit above the step count
    // would return 100 either way and would not prove the branch runs.
    expect(fanSpeedToHkPercent(5, 8, 5)).toBe(100)
    expect(fanSpeedToHkPercent(5, 8, undefined)).toBe(63)
  })

  it('does not treat auto as special when the model has no auto speed', () => {
    expect(fanSpeedToHkPercent(4, 8, undefined)).toBe(50)
  })
})

describe('parseDeviceId', () => {
  it('uppercases and strips punctuation the api does not use', () => {
    expect(parseDeviceId('ab:cd:ef')).toBe('AB:CD:EF')
    expect(parseDeviceId('ab cd-ef')).toBe('ABCDEF')
  })

  it('keeps the separators govee device ids actually contain', () => {
    // Colons and underscores are meaningful in a Govee device id, so the
    // cleaner must not strip them along with the rest.
    expect(parseDeviceId('AB:CD_EF')).toBe('AB:CD_EF')
  })

  it('accepts a non-string id without throwing', () => {
    expect(parseDeviceId(123456)).toBe('123456')
  })
})

describe('hex helpers', () => {
  it('splits a hex string into byte pairs', () => {
    expect(hexToTwoItems('aabbcc')).toEqual(['aa', 'bb', 'cc'])
  })

  it('reads a byte by its 1-based position, as the device handlers do', () => {
    // Callers index from 1 because they are reading a protocol spec, not an
    // array. Getting this off by one silently misreads every payload.
    const parts = hexToTwoItems('aa1b0164')
    expect(getTwoItemPosition(parts, 1)).toBe('aa')
    expect(getTwoItemPosition(parts, 2)).toBe('1b')
    expect(getTwoItemPosition(parts, 4)).toBe('64')
  })

  it('converts hex to decimal', () => {
    expect(hexToDecimal('64')).toBe(100)
    expect(hexToDecimal('ff')).toBe(255)
  })

  it('round trips base64 and hex', () => {
    const hex = '330501000000000000000000000000000000000037'
    expect(base64ToHex(hexToBase64(hex))).toBe(hex)
  })
})

describe('generateCodeFromHexValues', () => {
  it('builds a 20 byte packet', () => {
    // Every Govee BLE/IoT command is exactly 20 bytes: 19 of payload plus a
    // trailing XOR checksum.
    const packet = Buffer.from(generateCodeFromHexValues(['0x33', '0x05', '0x01']), 'base64')
    expect(packet).toHaveLength(20)
  })

  it('ends with an xor checksum over the first 19 bytes', () => {
    const packet = Buffer.from(generateCodeFromHexValues(['0x33', '0x05', '0x01']), 'base64')
    let expected = 0
    for (let i = 0; i < 19; i++) {
      expected ^= packet[i]
    }
    expect(packet[19]).toBe(expected)
  })

  it('pads short commands with zeroes rather than leaving them short', () => {
    const packet = Buffer.from(generateCodeFromHexValues(['0x33', '0x01']), 'base64')
    expect(packet.subarray(2, 19).every(b => b === 0)).toBe(true)
  })
})

describe('temperature conversion', () => {
  it('converts celsius to fahrenheit to one decimal place', () => {
    expect(cenToFar(0)).toBe(32)
    expect(cenToFar(100)).toBe(212)
    expect(cenToFar(21.5)).toBe(70.7)
  })

  it('converts fahrenheit to whole celsius', () => {
    expect(farToCen(32)).toBe(0)
    expect(farToCen(212)).toBe(100)
  })

  it('rounds to the nearest half', () => {
    expect(nearestHalf(21.24)).toBe(21)
    expect(nearestHalf(21.26)).toBe(21.5)
    expect(nearestHalf(21.75)).toBe(22)
  })
})

describe('misc helpers', () => {
  it('detects own properties only', () => {
    expect(hasProperty({ a: 1 }, 'a')).toBe(true)
    expect(hasProperty({}, 'toString')).toBe(false)
  })

  it('appends the first stack frame to an error message', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n    at thing (/a.js:1:1)'
    expect(parseError(err)).toContain('boom')
    expect(parseError(err)).toContain('at thing')
  })

  it('can be told to hide the stack for expected errors', () => {
    // Some errors are routine (a device being offline) and their stack is
    // noise in the log, so callers pass them in hideStack.
    const err = new Error('offline')
    err.stack = 'Error: offline\n    at thing (/a.js:1:1)'
    expect(parseError(err, ['offline'])).toBe('offline')
  })
})

/**
 * Govee can accept a control request and still refuse the command, reporting it
 * only inside `capability.state`. That shape used to read as success, so the
 * device ignored the command while HomeKit kept showing the new state (#1324).
 */
describe('describeControlFailure', () => {
  it('returns govee\'s own wording for the offline water timer in #1324', () => {
    const response = {
      requestId: 'test-control-turn-on',
      msg: 'Device is offline. Please check the Wi-Fi connection.',
      code: 400,
      capability: {
        type: 'devices.capabilities.on_off',
        instance: 'powerSwitch',
        state: {
          status: 'failure',
          errorCode: 400,
          errorMsg: 'Device is offline. Please check the Wi-Fi connection.',
        },
        value: 1,
      },
    }

    expect(describeControlFailure(response)).toBe('Device is offline. Please check the Wi-Fi connection.')
  })

  it('catches a refusal even when the response is 200 overall', () => {
    // The case the old code missed entirely: nothing at the top level says
    // anything went wrong.
    const response = {
      code: 200,
      msg: 'success',
      capability: {
        state: { status: 'failure', errorMsg: 'Device is busy' },
      },
    }

    expect(describeControlFailure(response)).toBe('Device is busy')
  })

  it('falls back to the top-level message when no errorMsg is given', () => {
    const response = {
      msg: 'Device is offline',
      capability: {
        state: { status: 'failure' },
      },
    }

    expect(describeControlFailure(response)).toBe('Device is offline')
  })

  it('still describes a refusal that carries no wording at all', () => {
    expect(describeControlFailure({
      capability: {
        state: { status: 'failure' },
      },
    }))
      .toBe('the device rejected the command')
  })

  it('returns null when the command was accepted', () => {
    const accepted = {
      code: 200,
      msg: 'success',
      capability: {
        state: { status: 'success' },
      },
    }

    expect(describeControlFailure(accepted)).toBeNull()
  })

  it('returns null for responses with no capability state', () => {
    expect(describeControlFailure({ code: 200, msg: 'success' })).toBeNull()
    expect(describeControlFailure({})).toBeNull()
    expect(describeControlFailure(undefined)).toBeNull()
  })
})

/**
 * The bug (#1324): when a command had a Bluetooth fallback, every earlier
 * failure was thrown away and replaced with "no connection method available".
 * That is worse than vague — it is untrue, and its link sends the user off to
 * configure connection methods when the real answer was that Govee had said
 * the device was offline.
 */
describe('updateFailureError', () => {
  it('reports govee\'s own refusal rather than the generic message', () => {
    const refusal = new Error('Device is offline. Please check the Wi-Fi connection.')
    const chosen = updateFailureError(refusal, 'no connection method available')

    expect(chosen.message).toBe('Device is offline. Please check the Wi-Fi connection.')
  })

  it('passes the original error through, so upstream flags survive', () => {
    const refusal = new Error('Device is offline. Please check the Wi-Fi connection.')
    refusal.deviceRefusal = true

    const chosen = updateFailureError(refusal, 'no connection method available')

    // Same object, not a copy - platform.js reads `deviceRefusal` off it to
    // decide whether to print a stack line.
    expect(chosen).toBe(refusal)
    expect(chosen.deviceRefusal).toBe(true)
  })

  it('falls back to the generic message only when nothing was tried', () => {
    expect(updateFailureError(undefined, 'no connection method available').message)
      .toBe('no connection method available')
    expect(updateFailureError(null, 'no connection method available').message)
      .toBe('no connection method available')
  })

  it('keeps a bluetooth timeout rather than masking it', () => {
    const bleFailure = new Error('BLE update failed: Connection timeout')

    expect(updateFailureError(bleFailure, 'no connection method available').message)
      .toBe('BLE update failed: Connection timeout')
  })
})
