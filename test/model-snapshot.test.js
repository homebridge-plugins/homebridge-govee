import { describe, expect, it } from 'vitest'

import deviceTypes from '../lib/device/index.js'
import GoveePlatform from '../lib/platform.js'
import platformConsts from '../lib/utils/constants.js'
import { deviceIdFor, makePlatform } from './harness.js'

/**
 * A record of what every supported model turns into: which handler takes it,
 * which HomeKit services it gets, and which characteristics sit on those
 * services.
 *
 * This exists so that a refactor can be shown to have changed nothing. The
 * failure it is guarding against is silent - a model quietly loses its speed
 * control, nobody notices, and it surfaces as an issue weeks later. Any diff
 * here must be explained before it is accepted.
 *
 * Run `npx vitest -u` to accept an intended change.
 */

// Homebridge adds this one itself with the same contents for every accessory,
// so recording it would be 615 identical blocks of noise
const IGNORED_SERVICE = 'AccessoryInformation'

function everyModel() {
  const seen = new Map()
  Object.entries(platformConsts.models).forEach(([type, models]) => {
    if (!Array.isArray(models)) {
      return
    }
    models.forEach((model) => {
      // A model in two lists would be a mistake worth knowing about, so keep
      // the first and let the duplicate test below report it
      if (!seen.has(model)) {
        seen.set(model, type)
      }
    })
  })
  return [
    ...seen.entries(),
  ].sort(([a], [b]) => a.localeCompare(b))
}

/**
 * Builds one device through the real platform code, rather than a copy of its
 * decisions, so the snapshot reflects what actually happens at startup.
 */
function buildDevice(model) {
  const platform = makePlatform()
  const instance = new GoveePlatform()
  Object.assign(instance, platform)

  const device = {
    device: deviceIdFor(model),
    deviceName: model,
    model,
  }

  instance.initialiseDevice(device)

  const uuid = instance.api.hap.uuid.generate(device.device)
  return { instance, uuid, device }
}

function describeAccessory(instance, uuid) {
  const accessory = instance.accessories.get(uuid)
  if (!accessory) {
    return null
  }
  return accessory
}

/**
 * Names the handler a model ended up with.
 *
 * Most device files still export an anonymous class, so the fallback is the
 * handler's key in the device index. Several keys can point at one class,
 * because a model that behaves identically to another is aliased rather than
 * copied, and the first key alphabetically is used.
 *
 * ⚠️ That fallback moves when an alphabetically earlier alias is added, which
 * shows up as label churn in this file for models that did not change. A file
 * that gives its class a real name gets that name instead and stops moving, so
 * name the class whenever you touch one.
 */
const handlerNames = new Map()
Object.entries(deviceTypes)
  .sort(([a], [b]) => a.localeCompare(b))
  .forEach(([name, deviceClass]) => {
    if (!handlerNames.has(deviceClass)) {
      handlerNames.set(deviceClass, name)
    }
  })

function nameOfHandler(control) {
  if (!control) {
    return 'NONE'
  }
  const given = control.constructor?.name
  if (given && given !== '_default' && !given.startsWith('__vite')) {
    return given
  }
  return handlerNames.get(control.constructor) ?? `unknown (${given})`
}

function formatProps(props) {
  const entries = Object.entries(props).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) {
    return ''
  }
  const parts = entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  return `  [${parts.join(', ')}]`
}

function formatAccessory(accessory) {
  const lines = []
  lines.push(`  handler: ${nameOfHandler(accessory.control)}`)

  const services = accessory.services
    .filter(service => service.type !== IGNORED_SERVICE)
    .sort((a, b) => `${a.type}${a.subtype ?? ''}`.localeCompare(`${b.type}${b.subtype ?? ''}`))

  services.forEach((service) => {
    const subtype = service.subtype
      ? ` (${service.subtype})`
      : ''
    const primary = service.isPrimary ? ' *primary' : ''
    lines.push(`  service: ${service.type}${subtype}${primary}`)

    const chars = [
      ...service.characteristics.values(),
    ]
      .sort((a, b) => a.name.localeCompare(b.name))
    chars.forEach((characteristic) => {
      lines.push(`    ${characteristic.name}${formatProps(characteristic.props)}`)
    })
  })

  return lines
}

describe('what every supported model becomes', () => {
  const models = everyModel()

  it('covers every model in the plugin', () => {
    // If this number moves, models were added or removed - which is fine, but
    // it should be a thing someone meant to do
    expect(models.length).toBeGreaterThan(600)
  })

  it('gives every model a handler', () => {
    const failures = []

    models.forEach(([model, type]) => {
      const { instance, uuid } = buildDevice(model)
      const accessory = describeAccessory(instance, uuid)

      if (!accessory) {
        failures.push(`${model} (${type}): no accessory was created`)
        return
      }
      if (!accessory.control) {
        const warnings = instance.log.entries
          .filter(entry => entry.level === 'warn')
          .map(entry => entry.args.join(' '))
        failures.push(`${model} (${type}): no handler - ${warnings.join(' | ') || 'no warning logged'}`)
      }
    })

    expect(failures).toEqual([])
  })

  it('builds each model the same way it did before', async () => {
    const lines = []

    models.forEach(([model, type]) => {
      const { instance, uuid } = buildDevice(model)
      const accessory = describeAccessory(instance, uuid)

      lines.push(`${model} (${type})`)
      lines.push(...(accessory
        ? formatAccessory(accessory)
        : ['  NOT CREATED']))
      lines.push('')
    })

    await expect(lines.join('\n')).toMatchFileSnapshot('./model-snapshot.txt')
  })
})

describe('the model lists themselves', () => {
  it('never lists the same model as two different types', () => {
    const owners = new Map()
    const duplicates = []

    Object.entries(platformConsts.models).forEach(([type, models]) => {
      if (!Array.isArray(models)) {
        return
      }
      models.forEach((model) => {
        if (owners.has(model)) {
          duplicates.push(`${model} is in both ${owners.get(model)} and ${type}`)
        } else {
          owners.set(model, type)
        }
      })
    })

    expect(duplicates).toEqual([])
  })

  it('uses a consistent model format throughout', () => {
    const odd = []
    Object.entries(platformConsts.models).forEach(([type, models]) => {
      if (!Array.isArray(models)) {
        return
      }
      models.forEach((model) => {
        if (!/^[A-Z][0-9A-Z]{4}$/.test(model)) {
          odd.push(`${type}: ${model}`)
        }
      })
    })

    expect(odd).toEqual([])
  })
})
