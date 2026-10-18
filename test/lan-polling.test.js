import { describe, expect, it } from 'vitest'

import GoveePlatform from '../lib/platform.js'

/**
 * The scan at start-up is one multicast request, and it counts as finished two
 * seconds after the last reply. A device that is slow to answer, or a network
 * that is not quite ready when the plugin starts, makes it find nothing.
 *
 * Finding nothing used to be final. The scan that repeats every minute and the
 * status requests were only started when the first scan had found something, so
 * a missed first scan meant the plugin never looked again. Every device the
 * cloud listed was then set up without LAN control, and for anyone who has the
 * other connection methods turned off every command failed with "no connection
 * method available" until Homebridge was restarted and got lucky.
 *
 * Nothing needs to be found first for the repeat to be worth running: a device
 * that turns up later is picked up by `receiveUpdateLAN`, which enables LAN
 * control on an accessory that was set up without it.
 */

function lanClientStub() {
  const started = []
  return {
    started,
    lanDevices: [],
    startDevicesPolling: () => started.push('devices'),
    startStatusPolling: () => started.push('status'),
  }
}

describe('lAN polling', () => {
  it('starts the repeating scan and the status polling when the first scan found no devices', () => {
    const lanClient = lanClientStub()

    GoveePlatform.prototype.startLanPolling.call({ lanClient })

    expect(lanClient.started).toEqual(['devices', 'status'])
  })

  it('starts them when the first scan did find devices', () => {
    const lanClient = lanClientStub()
    lanClient.lanDevices.push({ device: 'AA:BB', ip: '192.168.1.10' })

    GoveePlatform.prototype.startLanPolling.call({ lanClient })

    expect(lanClient.started).toEqual(['devices', 'status'])
  })

  it('does nothing when the LAN client is switched off or failed to start', () => {
    expect(() => GoveePlatform.prototype.startLanPolling.call({ lanClient: false })).not.toThrow()
    expect(() => GoveePlatform.prototype.startLanPolling.call({})).not.toThrow()
  })
})
