import { describe, expect, it } from 'vitest'

import { isCommandAcknowledgement } from '../lib/utils/response-parser.js'

/**
 * Every command the plugin sends comes back with a receipt saying whether it
 * worked. There is no device status in one, so nothing in it can have been
 * missed - but it was being reported as a payload nobody understood, three
 * lines at a time, every time an owner touched a control.
 *
 * That report is the most useful thing a user can send in when asking for a
 * device to be supported, so burying the real ones under receipts costs more
 * than the noise itself (#1352).
 */
describe('spotting a bare command receipt', () => {
  // exactly what an H1310 sent back after its fan was switched on
  const receipt = {
    cmd: 'turn',
    device: '2D:FA:C8:C0:CA:3C:83:2E',
    sku: 'H1310',
    source: 'AWS',
    state: { result: 1 },
    transaction: 'a_1786647446910',
  }

  it('recognises one', () => {
    expect(isCommandAcknowledgement(receipt)).toBe(true)
  })

  it('recognises one that reports a failure', () => {
    expect(isCommandAcknowledgement({ ...receipt, state: { result: 0 } })).toBe(true)
  })

  /**
   * The point of the check is to hide receipts without hiding anything else,
   * so a payload carrying even one real reading has to stay reportable.
   */
  it('leaves a payload carrying a reading alone', () => {
    expect(isCommandAcknowledgement({ ...receipt, state: { onOff: 1, result: 1 } })).toBe(false)
  })

  it('leaves a payload we simply do not understand alone', () => {
    expect(isCommandAcknowledgement({ cmd: 'status', source: 'AWS', state: { somethingNew: 4 } })).toBe(false)
  })

  it('does not treat an empty or missing state as a receipt', () => {
    expect(isCommandAcknowledgement({ cmd: 'turn', source: 'AWS', state: {} })).toBe(false)
    expect(isCommandAcknowledgement({ cmd: 'turn', source: 'AWS' })).toBe(false)
    expect(isCommandAcknowledgement({ source: 'AWS', state: { result: 1 } })).toBe(false)
    expect(isCommandAcknowledgement(undefined)).toBe(false)
  })
})
