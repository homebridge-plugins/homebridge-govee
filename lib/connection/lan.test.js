import { Buffer } from 'node:buffer'
import dgram from 'node:dgram'
import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import LANConnection from './lan.js'

vi.mock('node:dgram', () => ({
  default: { createSocket: vi.fn() },
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
    log: Object.assign(vi.fn(), { debug: vi.fn(), warn: vi.fn() }),
    receiveUpdateLAN: vi.fn(),
  }
  const client = new LANConnection(platform)
  return { client, platform }
}

function scan(client, ip, address = ip) {
  client.receiver.emit('message', Buffer.from(JSON.stringify({
    msg: { cmd: 'scan', data: { device: DEVICE_ID, sku: 'H6008', ip } },
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

    await client.updateDevice(accessory(), { cmd: 'turn', data: { value: 1 } })
    await client.sendDeviceStateRequest(client.lanDevices[0])

    expect(client.sender.send).toHaveBeenCalledTimes(2)
    expect(client.sender.send).toHaveBeenNthCalledWith(1, JSON.stringify({ msg: { cmd: 'turn', data: { value: 1 } } }), 4003, NEW_IP, expect.any(Function))
    expect(client.sender.send).toHaveBeenNthCalledWith(2, JSON.stringify({ msg: { cmd: 'devStatus', data: {} } }), 4003, NEW_IP, expect.any(Function))
  })

  it('accepts status from the new address and stops attributing the old address to the device', () => {
    const { client, platform } = makeClient()
    scan(client, OLD_IP)
    scan(client, NEW_IP)
    platform.receiveUpdateLAN.mockClear()
    const status = { onOff: 1, brightness: 50 }
    const message = Buffer.from(JSON.stringify({ msg: { cmd: 'devStatus', data: status } }))

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
    const { client } = makeClient({ [DEVICE_ID]: { customIPAddress: OLD_IP } })
    scan(client, OLD_IP)
    scan(client, NEW_IP)
    client.sender.send.mockImplementationOnce((...args) => args.at(-1)(new Error('Send failed')))

    await expect(client.updateDevice(accessory(), { cmd: 'turn', data: { value: 1 } })).rejects.toThrow('Send failed')

    expect(client.lanDevices).toHaveLength(1)
    expect(client.lanDevices[0]).toMatchObject({ ip: NEW_IP, isManual: true })
  })

  it('preserves manual-device bookkeeping when a discovered manual device moves', () => {
    const { client, platform } = makeClient({ [DEVICE_ID]: { customIPAddress: OLD_IP } })
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
