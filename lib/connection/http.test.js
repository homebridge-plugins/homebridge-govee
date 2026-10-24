import { beforeEach, describe, expect, it, vi } from 'vitest'

import HttpClient from './http.js'

vi.mock('axios', () => ({
  default: vi.fn(),
}))

const { default: axios } = await import('axios')

/**
 * The account login, as Govee's servers answer it.
 *
 * Every response here is made up, but each has the shape the real servers send:
 * the account login and the iot key from app2.govee.com, and the tap-to-run
 * token from a different server altogether.
 */

function makeClient() {
  return new HttpClient({
    config: { username: 'someone@example.com', password: 'secret' },
    api: {
      hap: {
        uuid: {
          generate: () => '0123456789abcdef0123456789abcdef',
        },
      },
    },
    log: Object.assign(() => {}, {
      warn: () => {},
      debug: () => {},
    }),
  })
}

function answer({ ttr }) {
  return async ({ url }) => {
    if (url.endsWith('/v2/login')) {
      return {
        data: {
          client: { token: 'account-token', accountId: 1, topic: 'GA/topic' },
        },
      }
    }
    if (url.endsWith('/iot/key')) {
      return {
        data: {
          data: { endpoint: 'iot.example.com', p12: 'cDEy', p12Pass: 'pass' },
        },
      }
    }
    if (url.includes('community-api')) {
      return ttr()
    }
    throw new Error(`unexpected request to ${url}`)
  }
}

describe('logging in to the govee account', () => {
  beforeEach(() => {
    axios.mockReset()
  })

  it('still logs in when the tap-to-run server is down', async () => {
    axios.mockImplementation(answer({
      ttr: async () => {
        throw Object.assign(new Error('Request failed with status code 503'), {
          response: { status: 503 },
        })
      },
    }))

    const data = await makeClient().login()

    expect(data.token).toBe('account-token')
    expect(data.endpoint).toBe('iot.example.com')
    expect(data.tokenTTR).toBeUndefined()
  })

  it('keeps the tap-to-run token when that server answers', async () => {
    axios.mockImplementation(answer({
      ttr: async () => ({
        data: {
          data: { token: 'ttr-token' },
        },
      }),
    }))

    const data = await makeClient().login()

    expect(data.token).toBe('account-token')
    expect(data.tokenTTR).toBe('ttr-token')
  })
})
