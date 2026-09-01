import { describe, expect, it } from 'vitest'

import { hasUnacknowledgedLeak } from './response-parser.js'

/**
 * Whether a leak sensor's cloud record says an alarm is waiting to be seen.
 *
 * The record for a gateway-attached sensor was captured while the sensor was
 * sounding and the owner had deliberately left the app closed. The warning
 * message list came back empty every time, while the record itself carried the
 * alarm time and said it was unread - which is exactly what the app's own home
 * screen goes by (#1356).
 */
describe('deciding whether a leak alarm is waiting', () => {
  // the record as it came back during the alarm, app untouched
  const alarming = { online: true, gwonline: true, lastTime: 1788286239000, read: false }
  const gateway = { behindGateway: true }

  it('reports a leak from an unread record behind a gateway, even with no messages', () => {
    expect(hasUnacknowledgedLeak(alarming, [], gateway)).toBe(true)
  })

  it('clears once the owner has acknowledged the alarm', () => {
    expect(hasUnacknowledgedLeak({ ...alarming, read: true }, [], gateway)).toBe(false)
  })

  it('reports nothing for a sensor that has never alarmed', () => {
    expect(hasUnacknowledgedLeak({ lastTime: 0, read: false }, [], gateway)).toBe(false)
    expect(hasUnacknowledgedLeak(undefined, [], gateway)).toBe(false)
  })

  it('still reports a leak from an unread alert message, gateway or not', () => {
    const messages = [{ message: 'Leakage Alert', time: 1788286239000, read: false, probe: 0 }]
    expect(hasUnacknowledgedLeak({ ...alarming, read: true }, messages, gateway)).toBe(true)
    expect(hasUnacknowledgedLeak({ ...alarming, read: true }, messages)).toBe(true)
  })

  it('ignores messages that are read or are not leak alerts', () => {
    const messages = [
      { message: 'Leakage Alert', read: true },
      { message: 'Low battery', read: false },
    ]
    expect(hasUnacknowledgedLeak({ ...alarming, read: true }, messages, gateway)).toBe(false)
  })

  it('leaves the record flag alone for a sensor that is not behind a gateway', () => {
    // the flag was tried on those once and taken out again, and nothing has
    // been captured since to say what it means there
    expect(hasUnacknowledgedLeak(alarming, [])).toBe(false)
  })
})
