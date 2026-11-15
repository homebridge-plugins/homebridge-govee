import axios from 'axios'
import { afterEach, describe, expect, it } from 'vitest'

import HttpClient, { describeGoveeReply } from '../lib/connection/http.js'

/**
 * A user's device sync failed every 30 seconds with only "no data received
 * from Govee server", so there was no way to tell why (#1402). Govee answers
 * such a request with a status and message in the body, so the error now
 * carries them.
 */

const defaultAdapter = axios.defaults.adapter
afterEach(() => {
  axios.defaults.adapter = defaultAdapter
})

function makeClient(reply) {
  const log = () => {}
  log.warn = () => {}
  log.debug = () => {}
  const client = new HttpClient({
    accountToken: 'token',
    api: {
      hap: {
        uuid: {
          generate: id => `uuid-${id}`,
        },
      },
    },
    config: { username: 'someone@example.com', password: 'password' },
    log,
  })
  axios.defaults.adapter = async config => ({
    config,
    data: reply,
    headers: {},
    status: 200,
    statusText: 'OK',
  })
  return client
}

describe('an empty device list from govee', () => {
  it('says what govee replied', async () => {
    const client = makeClient({ status: 401, message: 'Login expired' })
    await expect(client.getDevices(true)).rejects.toThrow('[govee status: 401, message: Login expired]')
  })

  it('names the fields when there is no status or message', () => {
    expect(describeGoveeReply({ data: {} })).toBe(' [reply had no status or message, fields: data]')
  })

  it('copes with no body at all', () => {
    expect(describeGoveeReply(undefined)).toBe(' [no reply body: null]')
  })
})
