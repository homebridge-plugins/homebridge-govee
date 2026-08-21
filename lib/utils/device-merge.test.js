import { describe, expect, it } from 'vitest'

import { cloudListsWereFetched, planDeviceSetup, planRedundantAccessories } from './device-merge.js'

/**
 * Merging Govee's three device lists, and deciding which cached accessories no
 * longer belong.
 *
 * This was the middle of a 558-line setup method with no cover at all, and it
 * is where four separate bugs have been fixed - each one about a device being
 * added or removed when it should not have been. Those four have a test each
 * below, named by their issue.
 */

const http = (device, sku = 'H6102', extra = {}) => ({ device, sku, deviceName: device, ...extra })
const lan = (device, extra = {}) => ({ device, sku: 'H6102', ...extra })
const openApi = (device, model = 'H6102', extra = {}) => ({ device, model, deviceName: device, ...extra })

describe('reading the ids Govee sends', () => {
  it('puts the separators back into an id that has none', () => {
    const { devices } = planDeviceSetup({ httpDevices: [http('abcd1234abcd1234')] })

    expect(devices[0].device).toBe('AB:CD:12:34:AB:CD:12:34')
  })

  it('keeps the suffix of an add-on sensor', () => {
    const { devices } = planDeviceSetup({ httpDevices: [http('abcd1234abcd1234_1')] })

    expect(devices[0].device).toBe('AB:CD:12:34:AB:CD:12:34_1')
  })

  it('leaves an id that already has them alone', () => {
    const { devices } = planDeviceSetup({ httpDevices: [http('AA:BB:CC:DD')] })

    expect(devices[0].device).toBe('AA:BB:CC:DD')
  })
})

describe('combining what the three lists know', () => {
  it('sets a device up once, even when all three mention it', () => {
    const { devices } = planDeviceSetup({
      httpDevices: [http('AA:BB')],
      lanDevices: [lan('AA:BB')],
      openApiDevices: [openApi('AA:BB')],
    })

    expect(devices).toHaveLength(1)
  })

  it('carries the api capabilities onto a device the account list found', () => {
    const { devices } = planDeviceSetup({
      httpDevices: [http('AA:BB')],
      openApiDevices: [openApi('AA:BB', 'H6102', { openApiInfo: { byInstance: { powerSwitch: {} } } })],
    })

    expect(devices[0].openApiInfo.byInstance.powerSwitch).toBeDefined()
  })

  it('marks a device found on the network as reachable there', () => {
    const { devices } = planDeviceSetup({
      httpDevices: [http('AA:BB')],
      lanDevices: [lan('AA:BB', { ip: '192.168.1.5' })],
    })

    expect(devices[0].isLanDevice).toBe(true)
    expect(devices[0].ip).toBe('192.168.1.5')
  })

  it('still sets up a device the network scan missed', () => {
    const { devices } = planDeviceSetup({ httpDevices: [http('AA:BB')] })

    expect(devices).toHaveLength(1)
    expect(devices[0].isLanDevice).toBeUndefined()
  })

  it('sets up one only the api knows about', () => {
    const { devices } = planDeviceSetup({ openApiDevices: [openApi('AA:BB')] })

    expect(devices).toHaveLength(1)
  })

  it('sets up one only the network scan found, naming it from the owner\'s label', () => {
    const { devices } = planDeviceSetup({
      lanDevices: [lan('AA:BB')],
      deviceConf: { 'AA:BB': { label: 'Hallway' } },
    })

    expect(devices[0].deviceName).toBe('Hallway')
    expect(devices[0].isLanOnly).toBe(true)
  })

  it('falls back to the id when there is no label', () => {
    const { devices } = planDeviceSetup({ lanDevices: [lan('AA:BB')] })

    expect(devices[0].deviceName).toBe('AABB')
  })

  it('says when nothing at all was found', () => {
    expect(planDeviceSetup({}).anyInitialised).toBe(false)
    expect(planDeviceSetup({ httpDevices: [http('AA:BB')] }).anyInitialised).toBe(true)
  })
})

describe('devices that should be left alone', () => {
  it('skips one the owner asked to ignore, from any list', () => {
    const ignoredDevices = ['AA:BB']

    expect(planDeviceSetup({ httpDevices: [http('AA:BB')], ignoredDevices }).devices).toHaveLength(0)
    expect(planDeviceSetup({ openApiDevices: [openApi('AA:BB')], ignoredDevices }).devices).toHaveLength(0)
    expect(planDeviceSetup({ lanDevices: [lan('AA:BB')], ignoredDevices }).devices).toHaveLength(0)
  })

  it('skips an app group, which is not a real device (#1309)', () => {
    const { devices, skippedGroups } = planDeviceSetup({
      httpDevices: [http('AA:BB', 'BaseGroup'), http('CC:DD', 'SameModeGroup')],
    })

    expect(devices).toHaveLength(0)
    expect(skippedGroups).toHaveLength(2)
  })

  it('skips a feature hub group, which arrives from the openapi list (#1357)', () => {
    // These come through with a numeric id rather than a MAC, a null category
    // and nothing but an on/off capability. Before this they were reported as
    // an unsupported device, so every group owner was asked to file a ticket.
    const { devices, skippedGroups } = planDeviceSetup({
      openApiDevices: [openApi('2591068', 'DreamViewScenic'), openApi('24634329', 'DreamViewScenic')],
    })

    expect(devices).toHaveLength(0)
    expect(skippedGroups).toHaveLength(2)
  })

  it('skips a matter model when the owner has turned those off', () => {
    // H1401 really is on the matter list; picking one that is not made this
    // pass for the wrong reason first time round
    const withMatter = planDeviceSetup({ httpDevices: [http('AA:BB', 'H1401')], ignoreMatter: true })
    expect(withMatter.devices).toHaveLength(0)

    const without = planDeviceSetup({ httpDevices: [http('AA:BB', 'H1401')] })
    expect(without.devices).toHaveLength(1)
  })

  it('does not re-add a matter model found on the network (#1315)', () => {
    // Skipped by the lists above, its network record is still unmatched. Adding
    // it here meant it was removed again by the cleanup on every restart
    const { devices } = planDeviceSetup({
      httpDevices: [http('AA:BB', 'H1401')],
      lanDevices: [{ device: 'AA:BB', sku: 'H1401' }],
      ignoreMatter: true,
    })

    expect(devices).toHaveLength(0)
  })
})

describe('knowing which periodic syncs are needed', () => {
  it('asks for both when there is a thermo sensor', () => {
    const plan = planDeviceSetup({ httpDevices: [http('AA:BB', 'H5075')] })

    expect(plan.bleSyncNeeded).toBe(true)
    expect(plan.httpSyncNeeded).toBe(true)
  })

  it('asks only for the http one when there is a leak sensor', () => {
    const plan = planDeviceSetup({ httpDevices: [http('AA:BB', 'H5054')] })

    expect(plan.bleSyncNeeded).toBe(false)
    expect(plan.httpSyncNeeded).toBe(true)
  })

  it('asks for neither when there are neither', () => {
    const plan = planDeviceSetup({ httpDevices: [http('AA:BB', 'H6102')] })

    expect(plan.bleSyncNeeded).toBe(false)
    expect(plan.httpSyncNeeded).toBe(false)
  })
})

describe('which lists produced something', () => {
  // Each of these starts a different periodic sync, so a missed one means a
  // whole connection quietly never polls

  it('reports the account list on its own', () => {
    const plan = planDeviceSetup({ httpDevices: [http('AA:BB')] })

    expect(plan.httpDevicesWereInitialised).toBe(true)
    expect(plan.lanDevicesWereInitialised).toBe(false)
    expect(plan.openApiDevicesWereInitialised).toBe(false)
  })

  it('counts the network as used when an account device was found on it', () => {
    // Easy one to lose: the device came from the account list, but it is the
    // network that will be polled for it
    const plan = planDeviceSetup({
      httpDevices: [http('AA:BB')],
      lanDevices: [lan('AA:BB')],
    })

    expect(plan.httpDevicesWereInitialised).toBe(true)
    expect(plan.lanDevicesWereInitialised).toBe(true)
  })

  it('counts the network when an api device was found on it', () => {
    const plan = planDeviceSetup({
      openApiDevices: [openApi('AA:BB')],
      lanDevices: [lan('AA:BB')],
    })

    expect(plan.openApiDevicesWereInitialised).toBe(true)
    expect(plan.lanDevicesWereInitialised).toBe(true)
  })

  it('counts the network for one only it found', () => {
    const plan = planDeviceSetup({ lanDevices: [lan('AA:BB')] })

    expect(plan.lanDevicesWereInitialised).toBe(true)
    expect(plan.httpDevicesWereInitialised).toBe(false)
  })
})

describe('letting go of a cached accessory', () => {
  const accessory = (id, context = {}) => ({ context: { gvDeviceId: id, gvModel: 'H6102', ...context } })

  it('lets go of one the owner now ignores', () => {
    const removals = planRedundantAccessories({
      accessories: [accessory('AA:BB')],
      ignoredDevices: ['AA:BB'],
      cloudListsFetched: true,
    })

    expect(removals).toHaveLength(1)
  })

  it('lets go of a matter model once those are turned off (#1287)', () => {
    // Govee still lists it, so only the matter rule can be what removes it
    const base = {
      accessories: [accessory('AA:BB', { gvModel: 'H1401' })],
      httpDevices: [http('AA:BB', 'H1401')],
      cloudListsFetched: true,
    }

    expect(planRedundantAccessories({ ...base, ignoreMatter: true })).toHaveLength(1)
    expect(planRedundantAccessories(base)).toHaveLength(0)
  })

  it('lets go of one Govee no longer lists', () => {
    const removals = planRedundantAccessories({
      accessories: [accessory('AA:BB')],
      httpDevices: [http('CC:DD')],
      cloudListsFetched: true,
    })

    expect(removals).toHaveLength(1)
  })

  it('⚠️ keeps one when the cloud lists never arrived (#1264)', () => {
    // A failed request must never look like a deleted device. Getting this
    // wrong destroys the HomeKit scenes and automations the tile is part of
    const removals = planRedundantAccessories({
      accessories: [accessory('AA:BB')],
      httpDevices: [],
      cloudListsFetched: false,
    })

    expect(removals).toHaveLength(0)
  })

  it('keeps a network-only device that missed a scan (#1264)', () => {
    const removals = planRedundantAccessories({
      accessories: [accessory('AA:BB', { hasLanControl: true, firmware: false })],
      cloudListsFetched: true,
    })

    expect(removals).toHaveLength(0)
  })

  it('still lets go of an ignored device even without the cloud lists', () => {
    const removals = planRedundantAccessories({
      accessories: [accessory('AA:BB')],
      ignoredDevices: ['AA:BB'],
      cloudListsFetched: false,
    })

    expect(removals).toHaveLength(1)
  })

  it('keeps one that any of the three lists still mentions', () => {
    const base = { accessories: [accessory('AA:BB')], cloudListsFetched: true }

    expect(planRedundantAccessories({ ...base, httpDevices: [http('AA:BB')] })).toHaveLength(0)
    expect(planRedundantAccessories({ ...base, lanDevices: [lan('AA:BB')] })).toHaveLength(0)
    expect(planRedundantAccessories({ ...base, openApiDevices: [openApi('AA:BB')] })).toHaveLength(0)
  })
})

describe('deciding whether the cloud lists can be trusted', () => {
  it('trusts them when nothing cloud-based was configured', () => {
    expect(cloudListsWereFetched({}, {})).toBe(true)
  })

  it('does not trust them when a configured client failed to connect', () => {
    expect(cloudListsWereFetched({ username: 'a' }, {})).toBe(false)
    expect(cloudListsWereFetched({ apiKey: 'k' }, {})).toBe(false)
  })

  it('trusts them once the configured clients are up', () => {
    expect(cloudListsWereFetched({ username: 'a', apiKey: 'k' }, { httpClient: {}, openApiClient: {} })).toBe(true)
  })

  it('trusts them when the api was turned off rather than failing', () => {
    expect(cloudListsWereFetched({ apiKey: 'k', openApiDisable: true }, {})).toBe(true)
  })
})
