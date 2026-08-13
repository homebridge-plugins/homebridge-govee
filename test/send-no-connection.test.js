import { describe, expect, it } from 'vitest'

import GoveePlatform from '../lib/platform.js'

/**
 * A command that can only travel one way, on a connection the device does not
 * have enabled, used to report success.
 *
 * `sendDeviceUpdate` tries LAN, then AWS, then OpenAPI, and falls through to
 * bluetooth. A command built for one route only - `cmd: 'openApi'` produces
 * `openApiParams` and nothing else - skipped every branch when that route was
 * off, reached the bluetooth fall-through with no bluetooth frame to send, and
 * returned true having sent nothing at all.
 *
 * HomeKit takes that as done and leaves the tile showing a state the device was
 * never asked for. It looks identical to a device ignoring the command, which
 * is the hardest kind of fault to report and the hardest to believe. Found
 * while wiring the H1310's two lights to their own api toggles (#1352), which
 * only exist over OpenAPI.
 */

function accessoryWithout(...disabled) {
  const context = {
    gvModel: 'H1310',
    gvDeviceId: 'AA:BB',
    useLanControl: true,
    useAwsControl: true,
    useOpenApiControl: true,
    useBleControl: true,
  }
  disabled.forEach((key) => {
    context[key] = false
  })
  return {
    displayName: 'Master Ceiling Fan',
    context,
    log: () => {},
    logWarn: () => {},
    logDebug: () => {},
  }
}

// A per-light toggle, which the H1310 only accepts over the api
const PER_LIGHT = {
  cmd: 'openApi',
  openApi: {
    instance: 'mainLightToggle',
    capabilityType: 'devices.capabilities.toggle',
    value: 1,
  },
}

function platformWith(overrides = {}) {
  return Object.assign(Object.create(GoveePlatform.prototype), {
    lanClient: { updateDevice: async () => {} },
    awsClient: { updateDevice: async () => {} },
    openApiClient: { updateDevice: async () => {} },
    bleClient: { updateDevice: async () => {} },
    queue: { add: async fn => fn() },
    ...overrides,
  })
}

describe('sending a command with no connection to send it on', () => {
  it('refuses an api-only command when the device has no api control', async () => {
    const platform = platformWith()

    await expect(platform.sendDeviceUpdate(accessoryWithout('useOpenApiControl'), PER_LIGHT))
      .rejects
      .toThrow()
  })

  it('says which route the command needed', async () => {
    const said = []
    const accessory = accessoryWithout('useOpenApiControl')
    accessory.logWarn = message => said.push(String(message))

    await platformWith().sendDeviceUpdate(accessory, PER_LIGHT).catch(() => {})

    expect(said.join(' ')).toContain('openapi')
  })

  it('still sends the same command when api control is on', async () => {
    const sent = []
    const platform = platformWith({
      openApiClient: { updateDevice: async (_accessory, params) => sent.push(params) },
    })

    await expect(platform.sendDeviceUpdate(accessoryWithout(), PER_LIGHT)).resolves.toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].instance).toBe('mainLightToggle')
  })
})
