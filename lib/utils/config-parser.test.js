import { describe, expect, it } from 'vitest'

import { applyUserConfig } from './config-parser.js'
import platformConsts from './constants.js'

/**
 * Config parsing had no cover at all, and it decides what every setting a user
 * types actually means. These went in when it was lifted out of the platform,
 * so the move could be shown to have changed nothing.
 */

function parse(userConfig) {
  const warnings = []
  const platform = {
    log: Object.assign(() => {}, { warn: (...args) => warnings.push(args.join(' ')) }),
    config: { ...platformConsts.defaultConfig },
    deviceConf: {},
    ignoredDevices: [],
  }
  applyUserConfig(platform, { platform: 'Govee', name: 'Govee', ...userConfig })
  return { ...platform, warnings }
}

describe('reading the account settings', () => {
  it('keeps a value that was filled in', () => {
    expect(parse({ username: 'someone@example.com' }).config.username).toBe('someone@example.com')
  })

  it.each(['', 123, null])('ignores %p rather than trying to use it', (value) => {
    const { config, warnings } = parse({ username: value })
    expect(config.username).toBe(platformConsts.defaultConfig.username)
    expect(warnings.join(' ')).toContain('username')
  })
})

describe('reading a switch that was typed as text', () => {
  it('treats the word false as off, which is what the user meant', () => {
    // Some config editors write booleans as strings, and "false" is truthy
    expect(parse({ bleDisable: 'false' }).config.bleDisable).toBe(false)
  })

  it('says it had to interpret it', () => {
    expect(parse({ bleDisable: 'false' }).warnings.join(' ')).toContain('bleDisable')
  })

  it('takes a real boolean as it is', () => {
    expect(parse({ bleDisable: true }).config.bleDisable).toBe(true)
    expect(parse({ bleDisable: false }).config.bleDisable).toBe(false)
  })
})

describe('reading a number', () => {
  it('raises one below the minimum, rather than using it', () => {
    const { config, warnings } = parse({ httpRefreshTime: 1 })
    expect(config.httpRefreshTime).toBe(platformConsts.minValues.httpRefreshTime)
    expect(warnings.join(' ')).toContain('httpRefreshTime')
  })

  it('falls back to the default when it is not a number at all', () => {
    const { config } = parse({ httpRefreshTime: 'often' })
    expect(config.httpRefreshTime).toBe(platformConsts.defaultValues.httpRefreshTime)
  })

  it('keeps a sensible one', () => {
    expect(parse({ httpRefreshTime: 60 }).config.httpRefreshTime).toBe(60)
  })
})

describe('reading the subnets to scan', () => {
  it('keeps the ones that look like subnets', () => {
    const { config } = parse({ lanScanSubnets: '192.168.1.0/24, 10.0.0.0/8' })
    expect(config.lanScanSubnets).toEqual(['192.168.1.0/24', '10.0.0.0/8'])
  })

  it('drops anything that is not one', () => {
    const { config } = parse({ lanScanSubnets: '192.168.1.0/24, not-a-subnet' })
    expect(config.lanScanSubnets).toEqual(['192.168.1.0/24'])
  })

  it('ignores the setting when none of it makes sense', () => {
    const { warnings } = parse({ lanScanSubnets: 'nonsense' })
    expect(warnings.join(' ')).toContain('lanScanSubnets')
  })
})

describe('reading the per-device settings', () => {
  it('files them under the device id', () => {
    const { deviceConf } = parse({
      lightDevices: [{ deviceId: 'AA:BB:CC:DD', label: 'Hallway' }],
    })
    expect(deviceConf['AA:BB:CC:DD'].label).toBe('Hallway')
  })

  it('skips an entry with no device id, since there is nothing to attach it to', () => {
    const { deviceConf, warnings } = parse({ lightDevices: [{ label: 'Nowhere' }] })
    expect(Object.keys(deviceConf)).toHaveLength(0)
    expect(warnings.join(' ')).toContain('lightDevices')
  })

  it('remembers a device the owner asked to ignore', () => {
    const { ignoredDevices } = parse({
      lightDevices: [{ deviceId: 'AA:BB:CC:DD', ignoreDevice: true }],
    })
    expect(ignoredDevices).toHaveLength(1)
  })

  it('only accepts a choice that is one of the offered ones', () => {
    const good = parse({ switchDevices: [{ deviceId: 'AA:BB', showAs: 'switch' }] })
    expect(good.deviceConf['AA:BB'].showAs).toBe('switch')

    const bad = parse({ switchDevices: [{ deviceId: 'AA:BB', showAs: 'teapot' }] })
    expect(bad.deviceConf['AA:BB'].showAs).toBeUndefined()
    expect(bad.warnings.join(' ')).toContain('showAs')
  })

  it('strips spaces out of an address someone pasted', () => {
    const { deviceConf } = parse({
      lightDevices: [{ deviceId: 'AA:BB', customIPAddress: ' 192.168.1.50 ' }],
    })
    expect(deviceConf['AA:BB'].customIPAddress).toBe('192.168.1.50')
  })
})

describe('reading the openapi settings', () => {
  // These two were in the schema and read by the platform, but had no case here,
  // so the user was told to remove them and the values never took effect
  it('turns openapi off when the box is ticked', () => {
    const { config, warnings } = parse({ openApiDisable: true })
    expect(config.openApiDisable).toBe(true)
    expect(warnings.join(' ')).not.toContain('openApiDisable')
  })

  it('keeps the refresh interval that was asked for', () => {
    const { config, warnings } = parse({ openApiRefreshTime: 300 })
    expect(config.openApiRefreshTime).toBe(300)
    expect(warnings.join(' ')).not.toContain('openApiRefreshTime')
  })

  it('raises a refresh interval below the minimum', () => {
    expect(parse({ openApiRefreshTime: 5 }).config.openApiRefreshTime)
      .toBe(platformConsts.minValues.openApiRefreshTime)
  })
})

describe('settings it should not comment on', () => {
  it('says nothing about the two Homebridge adds itself', () => {
    expect(parse({}).warnings).toEqual([])
  })

  it('warns about one it does not recognise, so a typo is visible', () => {
    expect(parse({ nonsenseSetting: true }).warnings.join(' ')).toContain('nonsenseSetting')
  })
})
