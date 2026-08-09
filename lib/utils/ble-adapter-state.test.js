import { describe, expect, it } from 'vitest'

import { describeAdapterState } from './ble-protocol.js'
import platformLang from './lang-en.js'

/**
 * #1344: a Pi whose bluetooth radio was rfkill-blocked logged nothing but
 * noble's "Timeout waiting for Noble to be powered on" every few minutes. That
 * message reads as a stuck adapter whichever of the three real causes it is,
 * and sorting out which took four days of back-and-forth - from a state noble
 * had already reported.
 */
describe('what a bluetooth adapter state tells the owner', () => {
  it('sends a blocked radio to rfkill, which is what #1344 turned out to be', () => {
    const advice = describeAdapterState('poweredOff', platformLang)

    expect(advice).toContain('rfkill')
    expect(advice).toContain('unblock')
  })

  it('sends a missing capability to setcap, and warns that a node upgrade wipes it', () => {
    const advice = describeAdapterState('unauthorized', platformLang)

    expect(advice).toContain('setcap')
    expect(advice).toContain('cap_net_raw')
  })

  it('tells someone with no adapter that there is no adapter', () => {
    expect(describeAdapterState('unsupported', platformLang)).toContain('no bluetooth adapter')
  })

  it('points a silent adapter at the bluetooth service', () => {
    expect(describeAdapterState('unknown', platformLang)).toContain('bluetooth service')
  })

  it('gives each cause its own advice, so none is mistaken for another', () => {
    const states = ['poweredOff', 'unauthorized', 'unsupported', 'unknown']
    const advice = states.map(state => describeAdapterState(state, platformLang))

    expect(new Set(advice).size).toBe(states.length)
  })

  it('says nothing for a state that does not point at a cause, so noble\'s own wording is kept', () => {
    expect(describeAdapterState('resetting', platformLang)).toBeUndefined()
    expect(describeAdapterState('poweredOn', platformLang)).toBeUndefined()
    expect(describeAdapterState(undefined, platformLang)).toBeUndefined()
  })
})
