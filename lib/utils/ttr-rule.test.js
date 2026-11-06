import { describe, expect, it } from 'vitest'

import { collectTapToRunRules, parseTapToRunRule } from './response-parser.js'

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

// A Govee preset tap-to-run ('Meditation') as the endpoint now returns it: the
// cloud command sits in effectCommand, without the msg wrapper
const MEDITATION = ['owABBQICIwACCAMCAf+WAAAAAOc=', 'owEA+jIEAAB4ADJ4AAD/AHv/AyQ=', 'owIAgAAAAAAgAAEAMgIB/zIAAPw=', 'owMyAAD6MgMAAHgAAFAHB/8DAI0=', 'o/+AAAAAAAAAAAAAAAAAAAAAANw=', 'MwUEkgEAAAAAAAAAAAAAAAAAAKE=']
const presetRule = {
  name: 'Meditation Scene',
  onOff: '1',
  effectCommand: JSON.stringify({ cmdVersion: 0, data: { command: MEDITATION }, cmd: 'ptReal', type: 1 }),
  onOffIotMsg: null,
  blueMsg: '',
  iotMsg: '',
  effect: null,
}
const presetOneClick = {
  name: 'Meditation',
  execRules: [{
    actionPresetId: 11107,
    name: 'Turn on Meditation Scene',
    devices: [
      { sku: 'H6076', deviceName: 'Lamp A', rule: presetRule },
      { sku: 'H6076', deviceName: 'Lamp B', rule: presetRule },
    ],
  }],
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

  it('reads the scene code from effectCommand on a preset rule', () => {
    expect(parseTapToRunRule(presetRule)).toEqual({
      awsCmd: 'ptReal',
      bleType: undefined,
      awsCode: MEDITATION.join(','),
      bleCode: undefined,
    })
  })

  it('prefers iotMsg over effectCommand when both are set', () => {
    const parsed = parseTapToRunRule({ ...turnOnRule, effectCommand: presetRule.effectCommand })
    expect(parsed.awsCmd).toBe('turn')
    expect(parsed.awsCode).toBeUndefined()
  })

  it('handles a rule with empty or missing messages', () => {
    const empty = { awsCmd: undefined, bleType: undefined, awsCode: undefined, bleCode: undefined }
    expect(parseTapToRunRule({ iotMsg: '', blueMsg: '' })).toEqual(empty)
    expect(parseTapToRunRule({})).toEqual(empty)
    expect(parseTapToRunRule(undefined)).toEqual(empty)
  })
})

describe('collectTapToRunRules', () => {
  it('flattens a user-built tap-to-run (iotRules)', () => {
    const oneClick = {
      name: 'SceneSwitch',
      iotRules: [{ deviceObj: { name: 'Hobbyraum', sku: 'H6076' }, rule: [turnOnRule, sceneRule] }],
    }
    expect(collectTapToRunRules(oneClick)).toEqual([
      { deviceName: 'Hobbyraum', sku: 'H6076', rule: turnOnRule },
      { deviceName: 'Hobbyraum', sku: 'H6076', rule: sceneRule },
    ])
  })

  it('flattens a Govee preset tap-to-run (execRules)', () => {
    expect(collectTapToRunRules(presetOneClick)).toEqual([
      { deviceName: 'Lamp A', sku: 'H6076', rule: presetRule },
      { deviceName: 'Lamp B', sku: 'H6076', rule: presetRule },
    ])
  })

  it('returns nothing for a tap-to-run with no rules or a malformed one', () => {
    expect(collectTapToRunRules({ name: 'Empty' })).toEqual([])
    expect(collectTapToRunRules({ iotRules: [{ deviceObj: {} }], execRules: [{ devices: [{ sku: 'H6076' }] }] })).toEqual([])
    expect(collectTapToRunRules(undefined)).toEqual([])
  })
})
