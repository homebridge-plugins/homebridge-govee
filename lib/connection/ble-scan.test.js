import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it } from 'vitest'

import { resetReportedUnknowns } from '../utils/report-unknown.js'
import BLEConnection from './ble.js'

/**
 * What the bluetooth scan says about a broadcast it cannot decode.
 *
 * Bluetooth is a broadcast medium, so a scan hears every Govee device within
 * radio range - a neighbour's included. Warning about one of those puts a line
 * in someone's log about a device they do not own and cannot do anything about,
 * and asks them to report it.
 */

const OUR_SENSOR = 'aa:bb:cc:dd:ee:ff'
// The address from the report that prompted this, which turned out to be the
// owner's own H6022 light rather than a stranger's device
const OUR_LIGHT = 'de:b6:41:06:13:73'
const A_STRANGERS = '11:22:33:44:55:66'

function makeClient(sensorAddresses = []) {
  const messages = { warn: [], debug: [] }
  const log = Object.assign(() => {}, {
    warn: msg => messages.warn.push(String(msg)),
    debug: msg => messages.debug.push(String(msg)),
    error: () => {},
  })
  const platform = {
    log,
    config: {},
    hasBleSensor: address => sensorAddresses.includes(String(address).toLowerCase()),
  }
  const client = new BLEConnection(platform)
  client.messages = messages
  return client
}

// a light's broadcast: it carries the sensor signature but not a sensor's shape,
// so it is never decodable here
function broadcast(address, name = 'Govee_H6022_1373', hex = '4388ec00020101') {
  return {
    uuid: 'x',
    address,
    rssi: -70,
    advertisement: {
      localName: name,
      manufacturerData: Buffer.from(hex, 'hex'),
    },
  }
}

describe('a govee broadcast the plugin cannot decode', () => {
  beforeEach(() => {
    resetReportedUnknowns()
  })

  it('warns when the broadcast came from one of this account\'s sensors', () => {
    // The one case worth an owner's attention: readings should be arriving
    // this way and the plugin cannot read them
    const client = makeClient([OUR_SENSOR])

    client.handleDiscoveredPeripheral(broadcast(OUR_SENSOR))

    expect(client.messages.warn).toHaveLength(1)
    expect(client.messages.warn[0]).toContain(OUR_SENSOR)
  })

  it('stays quiet about the owner\'s own light', () => {
    // The report that prompted this. The H6022 was assumed to be a stranger's
    // and turned out to be the owner's own lamp, controlled happily over
    // aws/ble - so there was never anything to decode or report
    const client = makeClient([])

    client.handleDiscoveredPeripheral(broadcast(OUR_LIGHT))

    expect(client.messages.warn).toHaveLength(0)
    expect(client.messages.debug).toHaveLength(1)
  })

  it('stays quiet about a device that is not on this account', () => {
    // Bluetooth is a broadcast medium, so a scan also hears the neighbours
    const client = makeClient([])

    client.handleDiscoveredPeripheral(broadcast(A_STRANGERS))

    expect(client.messages.warn).toHaveLength(0)
    expect(client.messages.debug).toHaveLength(1)
  })

  it('does not call it a sensor, because it may be any kind of device', () => {
    const client = makeClient([OUR_SENSOR])

    client.handleDiscoveredPeripheral(broadcast(OUR_SENSOR))

    expect(client.messages.warn[0]).not.toMatch(/govee sensor/)
    expect(client.messages.warn[0]).toContain('govee device')
  })

  it('says it once, however often the device rebroadcasts', () => {
    const client = makeClient([OUR_SENSOR])

    client.handleDiscoveredPeripheral(broadcast(OUR_SENSOR))
    client.handleDiscoveredPeripheral(broadcast(OUR_SENSOR))
    client.handleDiscoveredPeripheral(broadcast(OUR_SENSOR))

    expect(client.messages.warn).toHaveLength(1)
    // and does not fall through to repeating itself at debug level instead
    expect(client.messages.debug).toHaveLength(0)
  })

  it('says it once about a device it is staying quiet about too', () => {
    // A light rebroadcasts for as long as the plugin runs. Quietening the
    // warning is not enough on its own - without this the debug log fills up
    const client = makeClient([])

    for (let i = 0; i < 50; i += 1) {
      client.handleDiscoveredPeripheral(broadcast(OUR_LIGHT))
    }

    expect(client.messages.warn).toHaveLength(0)
    expect(client.messages.debug).toHaveLength(1)
  })

  it('says nothing when the broadcast carries no manufacturer data', () => {
    // A device sends more than one kind of advertisement and the name-only ones
    // have no manufacturer data. Reporting those had a working H5179 warning
    // about itself while its readings were arriving perfectly well (#1338)
    const client = makeClient([OUR_SENSOR])

    client.handleDiscoveredPeripheral({
      uuid: 'x',
      address: OUR_SENSOR,
      rssi: -70,
      advertisement: { localName: 'Govee_H5179_7C8E' },
    })

    expect(client.messages.warn).toHaveLength(0)
    expect(client.messages.debug).toHaveLength(0)
  })

  it('ignores anything that is not a govee device at all', () => {
    const client = makeClient([OUR_SENSOR])

    client.handleDiscoveredPeripheral(broadcast(OUR_SENSOR, 'SomeoneElsesKettle'))

    expect(client.messages.warn).toHaveLength(0)
    expect(client.messages.debug).toHaveLength(0)
  })
})

describe('a sensor reading from the scan', () => {
  it('reports the address in lower case, as the accessories store it', () => {
    // BlueZ over D-Bus (NOBLE_BINDINGS=dbus) gives addresses in upper case,
    // while hci gives them in lower case. The accessories keep theirs in lower
    // case, so an upper-case reading matched nothing and was dropped as coming
    // from an unknown accessory.
    const client = makeClient([OUR_SENSOR])
    const readings = []
    client.discoverCallback = reading => readings.push(reading)

    client.handleDiscoveredPeripheral(broadcast(OUR_SENSOR.toUpperCase(), 'GVH5075_EEFF', '88ec0003a0a75c00'))

    expect(readings).toHaveLength(1)
    expect(readings[0].address).toBe(OUR_SENSOR)
  })
})
