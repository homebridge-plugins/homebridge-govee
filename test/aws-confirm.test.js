import { Buffer } from 'node:buffer'
import { EventEmitter } from 'node:events'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AwsClient from '../lib/connection/aws.js'
import platformLang from '../lib/utils/lang-en.js'

// A stand-in for the AWS IoT connection: records what is published, and lets
// a test deliver a message as if a device had sent it
const published = []
let fakeDevice
vi.mock('aws-iot-device-sdk', () => ({
  device: () => {
    fakeDevice = new EventEmitter()
    fakeDevice.publish = (topic, message, options, callback) => {
      published.push({ topic, msg: JSON.parse(message).msg })
      callback()
    }
    return fakeDevice
  },
}))

/**
 * A device answers a command with a status message that carries the command's
 * own transaction id, and that answer is the only sign a command arrived.
 * Three lights once answered the evening's "on" and then none of them answered
 * the "off" - still online, still sending their own updates, but left on all
 * night while Home showed them off (#1370).
 */
describe('a command the device does not answer', () => {
  let client
  let platform

  function makeAccessory(id = 'AA:BB') {
    return {
      context: { gvDeviceId: id, awsTopic: `topic/${id}` },
      logDebug: vi.fn(),
      logWarn: vi.fn(),
    }
  }

  // The device's answer: a status message echoing the transaction it was sent
  function answer(accessory, transaction) {
    fakeDevice.emit('message', 'account', Buffer.from(JSON.stringify({
      device: accessory.context.gvDeviceId,
      cmd: 'status',
      transaction,
      state: { onOff: 0 },
    })))
  }

  // Teach the client that this device answers commands, as it learns in use
  async function provenToAnswer(accessory) {
    await client.updateDevice(accessory, { cmd: 'turn', data: { val: 1 } })
    answer(accessory, published.at(-1).msg.transaction)
    published.length = 0
  }

  beforeEach(() => {
    vi.useFakeTimers()
    published.length = 0
    platform = {
      accountTopic: 'account',
      accountId: '1',
      clientId: '2',
      iotEndpoint: 'example.invalid',
      log: Object.assign(vi.fn(), { debug: vi.fn(), debugWarn: vi.fn() }),
      receiveUpdateAWS: vi.fn(),
    }
    client = new AwsClient(platform, { key: 'k', cert: 'c' })
    client.connected = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends it again when a device that answers goes quiet', async () => {
    const accessory = makeAccessory()
    await provenToAnswer(accessory)

    await client.updateDevice(accessory, { cmd: 'turn', data: { val: 0 } })
    await vi.advanceTimersByTimeAsync(5000)

    expect(published).toHaveLength(2)
    expect(published[1].msg).toMatchObject({ cmd: 'turn', data: { val: 0 } })
    // a fresh transaction, so the answer to the second try can be told apart
    expect(published[1].msg.transaction).not.toBe(published[0].msg.transaction)
  })

  it('sends nothing more once the device has answered', async () => {
    const accessory = makeAccessory()
    await provenToAnswer(accessory)

    await client.updateDevice(accessory, { cmd: 'turn', data: { val: 0 } })
    answer(accessory, published[0].msg.transaction)
    await vi.advanceTimersByTimeAsync(20000)

    expect(published).toHaveLength(1)
    expect(accessory.logWarn).not.toHaveBeenCalled()
  })

  it('warns by name when the second try goes unanswered too', async () => {
    const accessory = makeAccessory()
    await provenToAnswer(accessory)

    await client.updateDevice(accessory, { cmd: 'turn', data: { val: 0 } })
    await vi.advanceTimersByTimeAsync(10000)

    expect(published).toHaveLength(2)
    expect(accessory.logWarn).toHaveBeenCalledWith(`[AWS] ${platformLang.awsNoReply}`)
  })

  /**
   * Not every model answers. Chasing one that never does would send every
   * command twice for nothing.
   */
  it('leaves alone a device that has never answered', async () => {
    const accessory = makeAccessory()

    await client.updateDevice(accessory, { cmd: 'turn', data: { val: 0 } })
    await vi.advanceTimersByTimeAsync(20000)

    expect(published).toHaveLength(1)
    expect(accessory.logWarn).not.toHaveBeenCalled()
  })

  it('never resends an older command over a newer one', async () => {
    const accessory = makeAccessory()
    await provenToAnswer(accessory)

    await client.updateDevice(accessory, { cmd: 'brightness', data: { val: 20 } })
    await client.updateDevice(accessory, { cmd: 'brightness', data: { val: 80 } })
    answer(accessory, published[1].msg.transaction)
    await vi.advanceTimersByTimeAsync(20000)

    expect(published.map(p => p.msg.data.val)).toEqual([20, 80])
  })

  it('gives each of several commands sent together its own transaction', async () => {
    const lights = [makeAccessory('A'), makeAccessory('B'), makeAccessory('C')]
    for (const light of lights) {
      await client.updateDevice(light, { cmd: 'turn', data: { val: 0 } })
    }

    expect(new Set(published.map(p => p.msg.transaction)).size).toBe(3)
  })

  it('still passes every message on to the platform', () => {
    const accessory = makeAccessory()
    answer(accessory, 'a_1')

    expect(platform.receiveUpdateAWS).toHaveBeenCalledWith(expect.objectContaining({ device: 'AA:BB', transaction: 'a_1' }))
  })
})
