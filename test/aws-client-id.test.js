import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import AwsClient from '../lib/connection/aws.js'

// A stand-in for the AWS IoT connection that records the options it was made with
const created = []
vi.mock('aws-iot-device-sdk', () => ({
  device: (options) => {
    created.push(options)
    return new EventEmitter()
  },
}))

function makePlatform(extra = {}) {
  return {
    accountTopic: 'account',
    accountId: '1',
    iotEndpoint: 'example.invalid',
    log: Object.assign(vi.fn(), {
      debug: vi.fn(),
      debugWarn: vi.fn(),
    }),
    receiveUpdateAWS: vi.fn(),
    ...extra,
  }
}

/**
 * AWS keeps one connection per client id and drops the older one when another
 * arrives with the same id. Two Homebridge instances on one Govee account must
 * therefore never share one, or only one of them can work at a time (#590).
 */
describe('the id the aws connection uses', () => {
  it('differs between two instances on the same account', () => {
    created.length = 0
    const login = { clientId: 'hb0123456789abcdef0123456789abcd' }
    const first = new AwsClient(makePlatform(login), { key: 'k', cert: 'c' })
    const second = new AwsClient(makePlatform(login), { key: 'k', cert: 'c' })

    expect(first).not.toBe(second)
    expect(created).toHaveLength(2)
    expect(created[0].clientId).not.toBe(created[1].clientId)
  })

  it('stays under the account, even when the login came from the cache', () => {
    created.length = 0
    // A restart that reuses the cached login has no login client id at all
    const client = new AwsClient(makePlatform(), { key: 'k', cert: 'c' })

    expect(client).toBeTruthy()
    expect(created[0].clientId).toMatch(/^AP\/1\/hb[0-9a-f]{30}$/)
  })
})
