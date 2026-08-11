import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import FakeGatoStorage from './fakegato-storage.js'

/**
 * History files live in the same directory HAP-NodeJS keeps its own storage in,
 * and are named after the accessory - which means the name a user gave their
 * device in the app ends up inside a file path.
 */

const hostname = os.hostname().split('.')[0]

let dir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakegato-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function makeStorage() {
  return new FakeGatoStorage({ log: () => {} })
}

function addWriter(storage, service) {
  return new Promise(resolve => storage.addWriter(service, { path: dir, onReady: resolve }))
}

function write(storage, service, data) {
  return new Promise(resolve => storage.write({ service, data, callback: () => resolve() }))
}

function read(storage, service) {
  return new Promise(resolve => storage.read({ service, callback: (err, data) => resolve({ err, data }) }))
}

describe('a device whose name is not a safe filename', () => {
  /**
   * A slash in the name used to make `path.join` treat it as a directory, so
   * the write failed with ENOENT. Nothing passes a callback to write(), so the
   * error went nowhere - the history was simply never saved, silently.
   */
  it('still saves the history of a device with a slash in its name', async () => {
    const storage = makeStorage()
    const service = { accessoryName: 'Kitchen/Diner Sensor' }

    await addWriter(storage, service)
    await write(storage, service, JSON.stringify({ history: [1, 2, 3] }))

    expect(fs.readdirSync(dir)).toEqual([`${hostname}_Kitchen-Diner Sensor_persist.json`])
  })

  it('reads that history back, so it survives a restart', async () => {
    const service = { accessoryName: 'Kitchen/Diner Sensor' }

    const before = makeStorage()
    await addWriter(before, service)
    await write(before, service, JSON.stringify({ history: [1, 2, 3] }))

    // a fresh storage, as a restart would build
    const after = makeStorage()
    await addWriter(after, service)
    const { err, data } = await read(after, service)

    expect(err).toBeFalsy()
    expect(JSON.parse(data).history).toEqual([1, 2, 3])
  })

  /**
   * Only true separators are replaced. Renaming the file of a name that always
   * worked would orphan that accessory's history rather than protect it.
   */
  it('leaves an ordinary name exactly as it was', async () => {
    const storage = makeStorage()
    const service = { accessoryName: 'Kitchen Sensor' }

    await addWriter(storage, service)
    await write(storage, service, '{}')

    expect(fs.readdirSync(dir)).toEqual([`${hostname}_Kitchen Sensor_persist.json`])
  })

  it('leaves a backslash alone away from windows, where it is a normal character', async () => {
    const storage = makeStorage()
    const service = { accessoryName: 'Kitchen\\Diner Sensor' }

    await addWriter(storage, service)
    await write(storage, service, '{}')

    const expected = process.platform === 'win32'
      ? `${hostname}_Kitchen-Diner Sensor_persist.json`
      : `${hostname}_Kitchen\\Diner Sensor_persist.json`
    expect(fs.readdirSync(dir)).toEqual([expected])
  })
})

describe('a history write that does not complete', () => {
  /**
   * HAP-NodeJS made its own writes atomic because a truncated `AccessoryInfo`
   * reads back as an accessory that lost its pairings. A history file in the
   * same directory has the same problem: a partial write will not parse, and
   * the history is gone.
   */
  it('leaves the previous history intact when the write fails', async () => {
    const storage = makeStorage()
    const service = { accessoryName: 'Kitchen Sensor' }

    await addWriter(storage, service)
    await write(storage, service, JSON.stringify({ history: ['good'] }))

    // a write that cannot land, standing in for one cut short
    const writer = storage.getWriter(service)
    const realWriteFile = writer.storageHandler.writeFile
    writer.storageHandler = {
      ...fs,
      writeFile: (loc, data, enc, cb) => cb(new Error('ENOSPC: no space left on device')),
    }
    const err = await new Promise(resolve => storage.write({ service, data: '{"history":["bad"', callback: resolve }))
    writer.storageHandler.writeFile = realWriteFile

    expect(err).toBeInstanceOf(Error)

    const fileLoc = path.join(dir, `${hostname}_Kitchen Sensor_persist.json`)
    expect(JSON.parse(fs.readFileSync(fileLoc, 'utf8')).history).toEqual(['good'])
  })

  it('does not leave a temporary file for HAP-NodeJS to load forever', async () => {
    const storage = makeStorage()
    const service = { accessoryName: 'Kitchen Sensor' }

    await addWriter(storage, service)
    await write(storage, service, '{}')

    expect(fs.readdirSync(dir)).toEqual([`${hostname}_Kitchen Sensor_persist.json`])
  })

  /**
   * Any temporary file that does survive a crash must start with a dot, or
   * HAP-NodeJS reads it in at every startup from then on.
   */
  it('hides its temporary file from the HAP-NodeJS storage it shares a directory with', async () => {
    const storage = makeStorage()
    const service = { accessoryName: 'Kitchen Sensor' }

    await addWriter(storage, service)
    const writer = storage.getWriter(service)
    let tempName
    writer.storageHandler = {
      ...fs,
      writeFile: (loc, data, enc, cb) => {
        tempName = path.basename(loc)
        fs.writeFile(loc, data, enc, cb)
      },
    }
    await write(storage, service, '{}')

    expect(tempName.startsWith('.')).toBe(true)
  })
})
