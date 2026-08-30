import { beforeEach, describe, expect, it, vi } from 'vitest'

import { isFirstReport, logUnknownData, reportUnsupportedControl, resetReportedUnknowns } from './report-unknown.js'

function makeAccessory(context = {}) {
  return {
    displayName: 'Test Device',
    context: {
      gvDeviceId: 'AA:BB:CC:DD',
      gvModel: 'H6102',
      firmware: '1.03.01',
      hardware: '2.00.01',
      ...context,
    },
    logWarn: vi.fn(),
    logDebug: vi.fn(),
  }
}

function reported(accessory) {
  return accessory.logWarn.mock.calls[0]?.[0] ?? ''
}

function payloadOf(accessory) {
  const line = reported(accessory)
  return JSON.parse(line.slice(line.indexOf('{')))
}

describe('reporting unrecognised data', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('includes everything needed to add support, without being asked for it', () => {
    const accessory = makeAccessory()

    logUnknownData(accessory, {
      kind: 'scene',
      source: 'AWS',
      raw: 'MwUBAQAAAAAAAAAAAAAAAAAAADY=',
    })

    const payload = payloadOf(accessory)

    // the three things that otherwise always need a follow-up question
    expect(payload.model).toBe('H6102')
    expect(payload.firmware).toBe('1.03.01')
    expect(payload.source).toBe('AWS')
    // and the data itself, in both the forms that get used
    expect(payload.raw).toBe('MwUBAQAAAAAAAAAAAAAAAAAAADY=')
    expect(payload.hex).toBe('3305010100000000000000000000000000000036')
  })

  it('tells the user the line is what to report', () => {
    const accessory = makeAccessory()
    logUnknownData(accessory, { kind: 'scene', source: 'BLE', raw: 'abc' })

    expect(reported(accessory)).toContain('please include this line if you report it')
  })

  it('is a warning the first time so it is actually seen', () => {
    const accessory = makeAccessory()
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', raw: 'abc' })

    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    expect(accessory.logDebug).not.toHaveBeenCalled()
  })

  it('does not shout twice about the same payload', () => {
    const accessory = makeAccessory()
    const entry = { kind: 'scene', source: 'AWS', raw: 'abc' }

    logUnknownData(accessory, entry)
    logUnknownData(accessory, entry)
    logUnknownData(accessory, entry)

    // devices repeat their codes constantly, so this must not flood the log
    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    expect(accessory.logDebug).toHaveBeenCalledTimes(2)
  })

  it('still reports a genuinely different payload', () => {
    const accessory = makeAccessory()

    logUnknownData(accessory, { kind: 'scene', source: 'AWS', raw: 'abc' })
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', raw: 'xyz' })

    expect(accessory.logWarn).toHaveBeenCalledTimes(2)
  })

  it('treats two different devices separately', () => {
    const one = makeAccessory({ gvDeviceId: 'DEVICE:1' })
    const two = makeAccessory({ gvDeviceId: 'DEVICE:2' })

    logUnknownData(one, { kind: 'scene', source: 'AWS', raw: 'abc' })
    logUnknownData(two, { kind: 'scene', source: 'AWS', raw: 'abc' })

    expect(one.logWarn).toHaveBeenCalledTimes(1)
    expect(two.logWarn).toHaveBeenCalledTimes(1)
  })

  it('leaves out fields the device has not told us', () => {
    const accessory = makeAccessory({ firmware: undefined, hardware: undefined })
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', raw: 'abc' })

    const payload = payloadOf(accessory)
    expect(payload).not.toHaveProperty('firmware')
    expect(payload).not.toHaveProperty('hardware')
    expect(payload.model).toBe('H6102')
  })

  it('records an object payload rather than dropping it', () => {
    const accessory = makeAccessory()
    logUnknownData(accessory, { kind: 'payload', source: 'LAN', raw: { foo: 'bar' } })

    expect(payloadOf(accessory).raw).toBe('{"foo":"bar"}')
  })

  it('reports a repeated json command once, whatever its transaction id says', () => {
    // every payload carries a fresh transaction id, so keying on the whole
    // JSON counted each repeat as new - an H66A0 announcing its video mode
    // warned on every single announcement instead of once (#1363)
    const accessory = makeAccessory()

    logUnknownData(accessory, {
      kind: 'payload',
      source: 'AWS',
      raw: { cmd: 'newthing', transaction: 'a_1788123169866', state: { value: 1 } },
    })
    logUnknownData(accessory, {
      kind: 'payload',
      source: 'AWS',
      raw: { cmd: 'newthing', transaction: 'a_1788123999999', state: { value: 2 } },
    })

    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    expect(accessory.logDebug).toHaveBeenCalledTimes(1)
  })

  it('still reports two different json commands separately', () => {
    const accessory = makeAccessory()

    logUnknownData(accessory, { kind: 'payload', source: 'AWS', raw: { cmd: 'newthing', state: {} } })
    logUnknownData(accessory, { kind: 'payload', source: 'AWS', raw: { cmd: 'otherthing', state: {} } })

    expect(accessory.logWarn).toHaveBeenCalledTimes(2)
  })

  it('copes with a payload that is not base64', () => {
    const accessory = makeAccessory()

    expect(() => logUnknownData(accessory, {
      kind: 'scene',
      source: 'AWS',
      raw: 'not base64 !!',
    })).not.toThrow()
    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
  })

  it('says nothing when there is no accessory', () => {
    expect(() => logUnknownData(undefined, { kind: 'scene', raw: 'abc' })).not.toThrow()
  })

  describe('a control that is not worked out yet', () => {
    it('names the control and what was asked for', () => {
      const accessory = makeAccessory()
      reportUnsupportedControl(accessory, { control: 'fan speed', value: 50 })

      const line = reported(accessory)
      expect(line).toContain('fan speed')
      expect(line).toContain('did not happen')

      const payload = JSON.parse(line.slice(line.indexOf('{')))
      expect(payload.model).toBe('H6102')
      expect(payload.firmware).toBe('1.03.01')
      expect(payload.requested).toBe(50)
    })

    it('asks the user to report it', () => {
      const accessory = makeAccessory()
      reportUnsupportedControl(accessory, { control: 'fan speed', value: 1 })

      expect(reported(accessory)).toContain('please report this line')
    })

    it('warns once per control, then keeps quiet', () => {
      const accessory = makeAccessory()

      reportUnsupportedControl(accessory, { control: 'fan speed', value: 25 })
      reportUnsupportedControl(accessory, { control: 'fan speed', value: 50 })

      expect(accessory.logWarn).toHaveBeenCalledTimes(1)
      expect(accessory.logDebug).toHaveBeenCalledTimes(1)
    })

    it('still reports a different control on the same device', () => {
      const accessory = makeAccessory()

      reportUnsupportedControl(accessory, { control: 'fan speed', value: 25 })
      reportUnsupportedControl(accessory, { control: 'ice size', value: 2 })

      expect(accessory.logWarn).toHaveBeenCalledTimes(2)
    })

    it('does not throw when there is no accessory', () => {
      expect(() => reportUnsupportedControl(undefined, { control: 'fan speed' })).not.toThrow()
    })
  })

  describe('isFirstReport', () => {
    it('is true once and false after', () => {
      expect(isFirstReport('a')).toBe(true)
      expect(isFirstReport('a')).toBe(false)
      expect(isFirstReport('b')).toBe(true)
    })
  })

  /**
   * Which unrecognised things are worth interrupting someone for.
   *
   * A device volunteers status frames constantly and sends far more than the
   * plugin reads - three owners in two days had logs full of warnings about
   * devices that were working perfectly (#1340, #1341, #1342). Those are now
   * recorded quietly.
   *
   * The rest must stay loud, or the reporting that gets new devices supported
   * quietly stops working: the point is to be selective, not silent.
   */
  describe('what stays loud', () => {
    it('says nothing out loud about a status frame the device volunteered', () => {
      const accessory = makeAccessory()

      logUnknownData(accessory, { kind: 'status', source: 'AWS', hex: 'aa17000000' })

      expect(accessory.logWarn).not.toHaveBeenCalled()
    })

    it('still records that status frame in full, so it can be worked out later', () => {
      const accessory = makeAccessory()

      logUnknownData(accessory, { kind: 'status', source: 'AWS', hex: 'aa17000000' })

      const line = accessory.logDebug.mock.calls[0][0]
      expect(line).toContain('aa17000000')
      expect(line).toContain('H6102')
    })

    it('records every status frame, not just the first of a shape', () => {
      // no dedup on this path: nothing is being spared, so nothing is lost
      const accessory = makeAccessory()

      logUnknownData(accessory, { kind: 'status', source: 'AWS', hex: 'aa17000000' })
      logUnknownData(accessory, { kind: 'status', source: 'AWS', hex: 'aa17000000' })

      expect(accessory.logDebug).toHaveBeenCalledTimes(2)
    })

    it('still warns when a whole payload was unreadable', () => {
      // the device said something no part of the plugin could make sense of,
      // which is the single most useful thing an owner can send in
      const accessory = makeAccessory()

      logUnknownData(accessory, { kind: 'payload', source: 'AWS', raw: { odd: true } })

      expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    })

    it('still warns about a sensor whose readings are not decoded', () => {
      // these devices have no tiles at all - reporting IS what they do
      const accessory = makeAccessory()

      logUnknownData(accessory, { kind: 'reading', source: 'AWS', hex: 'aa05010262' })

      expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    })

    it('still warns when a control the owner pressed is not worked out', () => {
      const accessory = makeAccessory()

      reportUnsupportedControl(accessory, { control: 'fan speed', value: 50 })

      expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    })
  })
})

describe('a frame whose value changes each time it is sent', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  // The five the H7106 fan sent, twenty minutes apart. Same message each time,
  // carrying a value that drifts - which under the old payload-keyed dedup made
  // every one count as new (#1338)
  const drifting = [
    'aa100103de2b000000000000000000000000004d',
    'aa100103de29000000000000000000000000004f',
    'aa100103da3e000000000000000000000000005c',
    'aa100103da3d000000000000000000000000005f',
    'aa100103da3c000000000000000000000000005e',
  ]

  it('is reported once, not once per value', () => {
    const accessory = makeAccessory()

    drifting.forEach(hex => logUnknownData(accessory, { kind: 'scene', source: 'AWS', hex }))

    expect(accessory.logWarn).toHaveBeenCalledTimes(1)
    // the rest are still available to anyone running with debug on
    expect(accessory.logDebug).toHaveBeenCalledTimes(drifting.length - 1)
  })

  it('reports the first one in full, so the value is not lost', () => {
    const accessory = makeAccessory()

    drifting.forEach(hex => logUnknownData(accessory, { kind: 'scene', source: 'AWS', hex }))

    expect(reported(accessory)).toContain(drifting[0])
  })

  it('still reports a genuinely different message', () => {
    const accessory = makeAccessory()

    // same device, different command byte - a separate kind of message
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', hex: drifting[0] })
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', hex: 'aa1200000000000000000000000000000000000b8' })
    logUnknownData(accessory, { kind: 'scene', source: 'AWS', hex: 'aa2600000000000000000000000000000000008c' })

    expect(accessory.logWarn).toHaveBeenCalledTimes(3)
  })

  it('tells two devices apart even when they send the same message', () => {
    const one = makeAccessory({ gvDeviceId: 'AA:11' })
    const two = makeAccessory({ gvDeviceId: 'BB:22' })

    logUnknownData(one, { kind: 'scene', source: 'AWS', hex: drifting[0] })
    logUnknownData(two, { kind: 'scene', source: 'AWS', hex: drifting[0] })

    expect(one.logWarn).toHaveBeenCalledTimes(1)
    expect(two.logWarn).toHaveBeenCalledTimes(1)
  })

  it('falls back to the whole value when there is no frame to read', () => {
    // not every report is a hex frame - some are plain strings
    const accessory = makeAccessory()

    logUnknownData(accessory, { kind: 'broadcast', source: 'BLE', raw: 'something odd' })
    logUnknownData(accessory, { kind: 'broadcast', source: 'BLE', raw: 'something else' })

    expect(accessory.logWarn).toHaveBeenCalledTimes(2)
  })
})
