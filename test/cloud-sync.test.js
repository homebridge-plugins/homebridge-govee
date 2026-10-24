import { afterEach, describe, expect, it } from 'vitest'

import GoveePlatform from '../lib/platform.js'

/**
 * The OpenAPI's real-time (MQTT) connection keeps retrying until the broker
 * answers, so waiting for it can take for ever. AWS was set up after that wait,
 * which left an outlet's power readings and a presence sensor's updates - both
 * AWS only - stopped after a restart while the broker could not be reached
 * (#1383).
 */

let platform

function platformStub() {
  const calls = []
  return {
    calls,
    config: { openApiRefreshTime: 30 },
    log: { warn: msg => calls.push(`warn ${msg}`) },
    openApiClient: {
      // the broker never answering
      connectMQTT: () => new Promise(() => {}),
    },
    awsClient: {
      connect: async () => calls.push('aws connect'),
    },
    goveeOpenApiSync: () => calls.push('openapi sync'),
    goveeAWSSync: () => calls.push('aws sync'),
    runPeriodicSync: () => {},
  }
}

afterEach(() => {
  clearInterval(platform?.refreshOpenApiInterval)
  clearInterval(platform?.refreshAWSInterval)
})

describe('starting the cloud syncs', () => {
  it('sets up AWS even while the OpenAPI real-time connection is still trying', async () => {
    platform = platformStub()

    const started = GoveePlatform.prototype.startCloudSync.call(platform, { openApiNeeded: true, awsNeeded: true })
    const outcome = await Promise.race([
      started.then(() => 'finished'),
      new Promise(resolve => setTimeout(resolve, 200, 'still waiting')),
    ])

    expect(outcome).toBe('finished')
    expect(platform.calls).toEqual(['openapi sync', 'aws connect', 'aws sync'])
  })

  it('logs a failed OpenAPI real-time connection without stopping AWS', async () => {
    platform = platformStub()
    platform.openApiClient.connectMQTT = async () => {
      throw new Error('refused')
    }

    await GoveePlatform.prototype.startCloudSync.call(platform, { openApiNeeded: true, awsNeeded: true })
    await new Promise(resolve => setImmediate(resolve))

    expect(platform.calls).toContain('aws connect')
    expect(platform.calls.some(call => call.startsWith('warn'))).toBe(true)
  })
})
