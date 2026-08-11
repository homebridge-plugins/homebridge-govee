import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import fakeGatoHistoryFactory from './fakegato-history.js'

/**
 * What happens when the stored history cannot be read.
 *
 * A history file that will not parse is not a hypothetical: until the write was
 * made atomic, any restart landing in the middle of one left a truncated file
 * behind. What the service did with it mattered more than it looked - the
 * result decided whether the plugin recovered or spun.
 */

const hostname = os.hostname().split('.')[0]

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakegato-'))
  fs.mkdirSync(path.join(dir, 'persist'), { recursive: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

class FakeService {
  constructor(displayName, uuid) {
    this.displayName = displayName
    this.UUID = uuid
    this.chars = new Map()
  }

  getCharacteristic(name) {
    if (!this.chars.has(name)) {
      const characteristic = {
        onGet: () => characteristic,
        onSet: () => characteristic,
      }
      this.chars.set(name, characteristic)
    }
    return this.chars.get(name)
  }

  addCharacteristic(name) {
    return this.getCharacteristic(name)
  }
}

class FakeCharacteristic {}
FakeCharacteristic.Formats = { DATA: 'data', STRING: 'string' }
FakeCharacteristic.Perms = { READ: 'r', WRITE: 'w', NOTIFY: 'n', HIDDEN: 'h' }

const NAME = 'Kitchen Sensor'

function historyFile() {
  return path.join(dir, 'persist', `${hostname}_${NAME}_persist.json`)
}

function makeHistory() {
  const logged = []
  // a fresh homebridge each time: the storage and timer are cached on it
  const homebridge = {
    hap: { Service: FakeService, Characteristic: FakeCharacteristic },
    user: { storagePath: () => dir },
  }
  const FakeGatoHistory = fakeGatoHistoryFactory(homebridge)
  const accessory = {
    displayName: NAME,
    getService: () => undefined,
    addService: (type, name) => new FakeService(name, 'uuid'),
  }
  const history = new FakeGatoHistory('energy', accessory, {
    log: (...args) => logged.push(args.map(String).join(' ')),
  })
  return { history, logged }
}

function settle() {
  return new Promise(resolve => setTimeout(resolve, 150))
}

describe('restoring a history that cannot be read', () => {
  /**
   * `save()` waits on `loaded` and retries itself every 100ms until it is set.
   * The error path never set it, so one unreadable file used to leave the
   * plugin retrying ten times a second for as long as it ran.
   */
  it('still becomes ready after a truncated file, rather than retrying forever', async () => {
    fs.writeFileSync(historyFile(), '{"history":[{"time":1,')

    const { history } = makeHistory()
    await settle()

    expect(history.loaded).toBe(true)
  })

  it('starts from an empty history rather than a half-read one', async () => {
    fs.writeFileSync(historyFile(), '{"history":[{"time":1,')

    const { history } = makeHistory()
    await settle()

    expect(history.history).toEqual(['noValue'])
    expect(history.usedMemory).toBe(0)
  })

  /**
   * The failure used to be reported and then contradicted: the callback ran
   * twice, once with the error and once claiming success, so the log said the
   * history was loaded from storage immediately after saying it could not be.
   */
  it('does not claim the history loaded after saying it could not', async () => {
    fs.writeFileSync(historyFile(), '{"history":[{"time":1,')

    const { logged } = makeHistory()
    await settle()

    expect(logged.some(line => line.includes('load error'))).toBe(true)
    expect(logged.some(line => line.includes('loaded from storage'))).toBe(false)
  })

  /**
   * A write cut short at the very start leaves nothing in the file. That
   * answered neither success nor failure, so the callback never ran at all and
   * the service was left waiting to be loaded.
   */
  it('becomes ready after an empty file, which used to answer nothing at all', async () => {
    fs.writeFileSync(historyFile(), '')

    const { history } = makeHistory()
    await settle()

    expect(history.loaded).toBe(true)
  })

  it('still restores a history that is intact', async () => {
    fs.writeFileSync(historyFile(), JSON.stringify({
      firstEntry: 1,
      lastEntry: 2,
      usedMemory: 2,
      refTime: 100,
      initialTime: 100,
      history: ['noValue', { time: 1, power: 5 }, { time: 2, power: 6 }],
      extra: {},
    }))

    const { history, logged } = makeHistory()
    await settle()

    expect(history.loaded).toBe(true)
    expect(history.usedMemory).toBe(2)
    expect(history.history).toHaveLength(3)
    expect(logged.some(line => line.includes('loaded from storage'))).toBe(true)
  })

  it('becomes ready on a first run, when there is no file yet', async () => {
    const { history } = makeHistory()
    await settle()

    expect(history.loaded).toBe(true)
    expect(history.history).toEqual(['noValue'])
  })
})
