import { describe, expect, it, vi } from 'vitest'

import GoveePlatform from '../lib/platform.js'
import { isInformationalBroadcast } from '../lib/utils/response-parser.js'

/**
 * Some payloads are the device talking about its own goings-on, with nothing
 * in them a HomeKit tile could show - a camera-based TV backlight announces
 * its video-sync mode every time it changes. Nothing is wrong and nothing can
 * be done about it, but it was being warned about as a payload nobody
 * understood, over and over (#1363).
 */
describe('spotting an informational broadcast', () => {
  // exactly what an H66A0 (TV Backlight 3 Pro) sent when its video mode changed
  const broadcast = {
    cmd: 'videomode',
    device: '1A:43:C0:17:55:BF:F5:94',
    sku: 'H66A0',
    source: 'AWS',
    state: { bsDetectType: 1, bsOnOff: 1 },
    transaction: 'a_1788123169866',
  }

  it('recognises the video mode announcement', () => {
    expect(isInformationalBroadcast(broadcast)).toBe(true)
  })

  /**
   * The point is to hush known chatter without hushing anything else - a
   * command the plugin has never seen still has to be reported.
   */
  it('leaves a command it has never seen alone', () => {
    expect(isInformationalBroadcast({ ...broadcast, cmd: 'somethingNew' })).toBe(false)
  })

  it('copes with a payload that has no command at all', () => {
    expect(isInformationalBroadcast({ source: 'AWS', state: { onOff: 1 } })).toBe(false)
    expect(isInformationalBroadcast(undefined)).toBe(false)
  })

  /**
   * The whole point, end to end: a video mode announcement arriving for a real
   * accessory goes to the debug log, not the warning log.
   */
  it('logs the announcement at debug rather than warning about it', () => {
    const accessory = {
      displayName: 'TV Backlight 3 Pro',
      context: { gvDeviceId: broadcast.device, gvModel: 'H66A0' },
      control: { externalUpdate: vi.fn() },
      logDebug: vi.fn(),
      logWarn: vi.fn(),
    }

    GoveePlatform.prototype.receiveDeviceUpdate.call({}, accessory, broadcast)

    expect(accessory.logWarn).not.toHaveBeenCalled()
    expect(accessory.control.externalUpdate).not.toHaveBeenCalled()
    expect(accessory.logDebug).toHaveBeenCalledWith(expect.stringContaining('videomode'))
  })
})
