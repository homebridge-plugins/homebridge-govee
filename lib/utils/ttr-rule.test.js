import { describe, expect, it } from 'vitest'

import { parseTapToRunRule } from './response-parser.js'

// Shapes taken from a real tap-to-run response, with a made-up account topic
const TOPIC = 'GA/0123456789abcdef0123456789abcdef'

const turnOnRule = {
  cmdType: 0,
  deviceType: 2,
  cmdVal: '{"open":1}',
  iotMsg: JSON.stringify({ msg: { type: 1, data: { val: 1 }, accountTopic: TOPIC, transaction: 'v_1', cmdVersion: 0, cmd: 'turn', origin: 35 } }),
  blueMsg: JSON.stringify({ bleCmd: 'MwEBAAAAAAAAAAAAAAAAAAAAADM=', type: 'switch' }),
  effect: null,
}

const sceneRule = {
  cmdType: 0,
  deviceType: 2,
  cmdVal: '{"name":"Arbeit","scenesCode":2460}',
  iotMsg: JSON.stringify({ msg: { type: 1, data: { command: ['owABAgIBHQAAAAECAf//AAAAALw=', 'o/8A9JYC////j///AAAAAAAAAEw=', 'MwUEnAkAAAAAAAAAAAAAAAAAAKc='] }, accountTopic: TOPIC, transaction: 'v_2', cmdVersion: 0, cmd: 'ptReal', origin: 35 } }),
  blueMsg: JSON.stringify({ type: 'scene', modeCmd: 'MwUEnAkAAAAAAAAAAAAAAAAAAKc=' }),
  effect: null,
}

describe('parseTapToRunRule', () => {
  it('returns the scene codes for a scene rule', () => {
    expect(parseTapToRunRule(sceneRule)).toEqual({
      awsCmd: 'ptReal',
      bleType: 'scene',
      awsCode: 'owABAgIBHQAAAAECAf//AAAAALw=,o/8A9JYC////j///AAAAAAAAAEw=,MwUEnAkAAAAAAAAAAAAAAAAAAKc=',
      bleCode: 'MwUEnAkAAAAAAAAAAAAAAAAAAKc=',
    })
  })

  it('returns only the command types for a rule that is not a scene', () => {
    expect(parseTapToRunRule(turnOnRule)).toEqual({
      awsCmd: 'turn',
      bleType: 'switch',
      awsCode: undefined,
      bleCode: undefined,
    })
  })

  it('never returns the account topic, so the debug line cannot leak it', () => {
    for (const rule of [turnOnRule, sceneRule]) {
      expect(JSON.stringify(parseTapToRunRule(rule))).not.toContain(TOPIC)
    }
  })

  it('still reads the bluetooth side when the cloud message is malformed', () => {
    const parsed = parseTapToRunRule({ ...sceneRule, iotMsg: '{not json' })
    expect(parsed.awsCmd).toBeUndefined()
    expect(parsed.awsCode).toBeUndefined()
    expect(parsed.bleCode).toBe('MwUEnAkAAAAAAAAAAAAAAAAAAKc=')
  })

  it('handles a rule with empty or missing messages', () => {
    const empty = { awsCmd: undefined, bleType: undefined, awsCode: undefined, bleCode: undefined }
    expect(parseTapToRunRule({ iotMsg: '', blueMsg: '' })).toEqual(empty)
    expect(parseTapToRunRule({})).toEqual(empty)
    expect(parseTapToRunRule(undefined)).toEqual(empty)
  })
})
