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
 * The connection id must be the same on every start. A random id per start
 * was followed by commands that no longer reached the lights, while their
 * status updates still arrived (#1370).
 */
describe('the id the aws connection uses', () => {
  it('is the same on every start of the same account', () => {
    created.length = 0
    const login = { clientId: 'hb0123456789abcdef0123456789abcd' }
    expect(new AwsClient(makePlatform(login), { key: 'k', cert: 'c' })).toBeTruthy()
    expect(new AwsClient(makePlatform(login), { key: 'k', cert: 'c' })).toBeTruthy()

    expect(created).toHaveLength(2)
    expect(created[0].clientId).toBe('AP/1/hb0123456789abcdef0123456789abcd')
    expect(created[1].clientId).toBe(created[0].clientId)
  })

  it('is the same on every start that reuses the cached login', () => {
    created.length = 0
    // A restart that reuses the cached login has no login client id at all
    expect(new AwsClient(makePlatform(), { key: 'k', cert: 'c' })).toBeTruthy()
    expect(new AwsClient(makePlatform(), { key: 'k', cert: 'c' })).toBeTruthy()

    expect(created[1].clientId).toBe(created[0].clientId)
  })
})
