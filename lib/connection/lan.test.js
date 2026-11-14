import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import LANConnection from './lan.js'

vi.mock('node:dgram', () => ({
  default: {
    createSocket: vi.fn(),
  },
}))

const DEVICE_ID = 'AA:BB:CC:DD:EE:FF:00:11'
const OLD_IP = '192.0.2.10'
const NEW_IP = '192.0.2.20'

function makeSocket() {
  return Object.assign(new EventEmitter(), {
    bind: vi.fn(),
    close: vi.fn(),
    send: vi.fn((...args) => args.at(-1)()),
  })
}

function makeClient(deviceConf = {}) {
  const platform = {
    config: {},
    deviceConf,
    log: Object.assign(vi.fn(), {
      debug: vi.fn(),
      warn: vi.fn(),
    }),
    receiveUpdateLAN: vi.fn(),
  }
  const client = new LANConnection(platform)
  return { client, platform }
}

function scan(client, ip, address = ip, device = DEVICE_ID) {
  client.receiver.emit('message', Buffer.from(JSON.stringify({
    msg: {
      cmd: 'scan',
      data: { device, sku: 'H6008', ip },
    },
  })), { address })
}

function accessory() {
  return {
    context: { gvDeviceId: DEVICE_ID },
    logDebug: vi.fn(),
    logDebugWarn: vi.fn(),
  }
}

describe('lAN rediscovery after an address change', () => {
  beforeEach(() => {
    vi.mocked(dgram.createSocket).mockReset().mockImplementation(makeSocket)
  })

  it('refreshes the existing entry and notifies the platform of the new address', () => {
    const { client, platform } = makeClient()
    scan(client, OLD_IP)
    const entry = client.lanDevices[0]
    platform.receiveUpdateLAN.mockClear()

    scan(client, NEW_IP)

    expect(client.lanDevices).toHaveLength(1)
    expect(client.lanDevices[0]).toBe(entry)
    expect(entry.ip).toBe(NEW_IP)
    expect(platform.receiveUpdateLAN).toHaveBeenCalledExactlyOnceWith(DEVICE_ID, {}, NEW_IP)
  })

  it('routes both controls and status requests to the rediscovered address', async () => {
    const { client } = makeClient()
    scan(client, OLD_IP)
    scan(client, NEW_IP)

    await client.updateDevice(accessory(), {
      cmd: 'turn',
      data: { value: 1 },
    })
    await client.sendDeviceStateRequest(client.lanDevices[0])

    expect(client.sender.send).toHaveBeenCalledTimes(2)
    expect(client.sender.send).toHaveBeenNthCalledWith(1, JSON.stringify({
      msg: {
        cmd: 'turn',
        data: { value: 1 },
      },
    }), 4003, NEW_IP, expect.any(Function))
    expect(client.sender.send).toHaveBeenNthCalledWith(2, JSON.stringify({
      msg: { cmd: 'devStatus', data: {} },
    }), 4003, NEW_IP, expect.any(Function))
  })

  it('accepts status from the new address and stops attributing the old address to the device', () => {
    const { client, platform } = makeClient()
    scan(client, OLD_IP)
    scan(client, NEW_IP)
    platform.receiveUpdateLAN.mockClear()
    const status = { onOff: 1, brightness: 50 }
    const message = Buffer.from(JSON.stringify({
      msg: { cmd: 'devStatus', data: status },
    }))

    client.receiver.emit('message', message, { address: NEW_IP })
    client.receiver.emit('message', message, { address: OLD_IP })

    expect(platform.receiveUpdateLAN).toHaveBeenCalledExactlyOnceWith(DEVICE_ID, status, NEW_IP)
  })

  it('uses the reply source when a rediscovery response omits its IP', () => {
    const { client, platform } = makeClient()
    scan(client, OLD_IP)
    platform.receiveUpdateLAN.mockClear()

    scan(client, undefined, NEW_IP)

    expect(client.lanDevices[0].ip).toBe(NEW_IP)
    expect(platform.receiveUpdateLAN).toHaveBeenCalledExactlyOnceWith(DEVICE_ID, {}, NEW_IP)
  })

  it('does not notify the platform again when the address is unchanged', () => {
    const { client, platform } = makeClient()
    scan(client, OLD_IP)
    platform.receiveUpdateLAN.mockClear()

    scan(client, OLD_IP)

    expect(client.lanDevices[0].ip).toBe(OLD_IP)
    expect(platform.receiveUpdateLAN).not.toHaveBeenCalled()
  })

  it('keeps a known address when the reply contains no usable IP or source address', () => {
    const { client, platform } = makeClient()
    scan(client, OLD_IP)
    platform.receiveUpdateLAN.mockClear()

    scan(client, undefined)

    expect(client.lanDevices[0].ip).toBe(OLD_IP)
    expect(platform.receiveUpdateLAN).not.toHaveBeenCalled()
  })

  it('does not evict a rediscovered manual device when sending a command fails', async () => {
    const { client } = makeClient({
      [DEVICE_ID]: { customIPAddress: OLD_IP },
    })
    scan(client, OLD_IP)
    scan(client, NEW_IP)
    client.sender.send.mockImplementationOnce((...args) => args.at(-1)(new Error('Send failed')))

    await expect(client.updateDevice(accessory(), {
      cmd: 'turn',
      data: { value: 1 },
    })).rejects.toThrow('Send failed')

    expect(client.lanDevices).toHaveLength(1)
    expect(client.lanDevices[0]).toMatchObject({ ip: NEW_IP, isManual: true })
  })

  it('preserves manual-device bookkeeping when a discovered manual device moves', () => {
    const { client, platform } = makeClient({
      [DEVICE_ID]: { customIPAddress: OLD_IP },
    })
    expect(client.lanDevices[0].isPendingDiscovery).toBe(true)
    scan(client, OLD_IP)
    platform.receiveUpdateLAN.mockClear()

    scan(client, NEW_IP)

    expect(client.lanDevices).toHaveLength(1)
    expect(client.lanDevices[0]).toMatchObject({ device: DEVICE_ID, ip: NEW_IP, isManual: true })
    expect(client.lanDevices[0].isPendingDiscovery).toBeUndefined()
    expect(platform.receiveUpdateLAN).toHaveBeenCalledExactlyOnceWith(DEVICE_ID, {}, NEW_IP)
  })
})

const SECOND_DEVICE = 'AA:BB:CC:DD:EE:FF:00:22'

describe('lAN address ownership after reuse', () => {
  beforeEach(() => {
    vi.mocked(dgram.createSocket).mockReset().mockImplementation(makeSocket)
  })

  it.each([
    'known',
    'new',
    'manual',
    'pending manual',
  ])('attributes a reused address to its latest %s claimant', (kind) => {
    const { client, platform } = makeClient(kind.includes('manual')
      ? {
          [SECOND_DEVICE]: { customIPAddress: NEW_IP },
        }
      : {})
    scan(client, OLD_IP)
    if (kind === 'known' || kind === 'manual') {
      scan(client, NEW_IP, NEW_IP, SECOND_DEVICE)
    }
    const displaced = client.lanDevices.find(d => d.device === DEVICE_ID)
    scan(client, OLD_IP, OLD_IP, SECOND_DEVICE)
    platform.receiveUpdateLAN.mockClear()
    const status = { onOff: 1, brightness: 50 }

    client.receiver.emit('message', Buffer.from(JSON.stringify({
      msg: { cmd: 'devStatus', data: status },
    })), { address: OLD_IP })

    expect(platform.receiveUpdateLAN).toHaveBeenCalledExactlyOnceWith(SECOND_DEVICE, status, OLD_IP)
    expect(displaced.ip).toBeUndefined()
  })

  it('blocks displaced controls and polls, then recovers the same manual entry on rediscovery', async () => {
    const { client } = makeClient({
      [DEVICE_ID]: { customIPAddress: OLD_IP },
    })
    scan(client, OLD_IP)
    const displaced = client.lanDevices[0]
    scan(client, OLD_IP, OLD_IP, SECOND_DEVICE)

    await expect(client.updateDevice(accessory(), {
      cmd: 'turn',
      data: { value: 1 },
    })).rejects.toThrow()
    await expect(client.sendDeviceStateRequest(displaced)).rejects.toThrow()
    expect(client.sender.send).not.toHaveBeenCalled()

    scan(client, NEW_IP)
    expect(client.lanDevices.find(d => d.device === DEVICE_ID)).toBe(displaced)
    expect(displaced.isManual).toBe(true)
    await client.updateDevice(accessory(), {
      cmd: 'turn',
      data: { value: 1 },
    })
    await client.sendDeviceStateRequest(displaced)
    expect(client.sender.send).toHaveBeenCalledTimes(2)
    expect(client.sender.send.mock.calls.every(call => call[2] === NEW_IP)).toBe(true)
  })

  it('skips displaced entries in periodic status polling', async () => {
    vi.useFakeTimers()
    const { client, platform } = makeClient()
    try {
      scan(client, OLD_IP)
      scan(client, OLD_IP, OLD_IP, SECOND_DEVICE)
      client.config.lanRefreshTime = 1
      client.startStatusPolling()
      await vi.advanceTimersByTimeAsync(1000)
      expect(client.sender.send).toHaveBeenCalledExactlyOnceWith(expect.any(String), 4003, OLD_IP, expect.any(Function))
      expect(platform.log.warn).not.toHaveBeenCalled()
    } finally {
      client.close()
      vi.useRealTimers()
    }
  })

  it('recovers both routes after two devices exchange addresses', () => {
    const { client, platform } = makeClient()
    scan(client, OLD_IP)
    scan(client, NEW_IP, NEW_IP, SECOND_DEVICE)
    scan(client, OLD_IP, OLD_IP, SECOND_DEVICE)
    scan(client, NEW_IP)
    platform.receiveUpdateLAN.mockClear()
    const status = { brightness: 50 }
    const message = Buffer.from(JSON.stringify({
      msg: { cmd: 'devStatus', data: status },
    }))
    client.receiver.emit('message', message, { address: OLD_IP })
    client.receiver.emit('message', message, { address: NEW_IP })
    expect(platform.receiveUpdateLAN.mock.calls).toEqual([
      [SECOND_DEVICE, status, OLD_IP],
      [DEVICE_ID, status, NEW_IP],
    ])
  })

  it('does not guess ownership for duplicate manual addresses before discovery', async () => {
    const { client, platform } = makeClient({
      [DEVICE_ID]: { customIPAddress: OLD_IP },
      [SECOND_DEVICE]: { customIPAddress: OLD_IP },
    })
    client.receiver.emit('message', Buffer.from(JSON.stringify({
      msg: {
        cmd: 'devStatus',
        data: { onOff: 1 },
      },
    })), { address: OLD_IP })
    expect(platform.receiveUpdateLAN).not.toHaveBeenCalled()
    await expect(client.updateDevice(accessory(), {
      cmd: 'turn',
      data: { value: 1 },
    })).rejects.toThrow()
    await expect(client.sendDeviceStateRequest(client.lanDevices[0])).rejects.toThrow()
    expect(client.sender.send).not.toHaveBeenCalled()

    scan(client, OLD_IP, OLD_IP, SECOND_DEVICE)
    expect(client.lanDevices.filter(d => d.ip === OLD_IP)).toHaveLength(1)
  })
})
