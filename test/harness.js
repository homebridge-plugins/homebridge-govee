/**
 * A stand-in for Homebridge, good enough to build a device and look at what it
 * created.
 *
 * Services and characteristics are identified by their name rather than by a
 * real HAP UUID. The point of this harness is to notice when a change alters
 * what a device offers, and a name is what someone reading that diff can act
 * on. It does mean the harness cannot tell us whether HomeKit would accept a
 * given characteristic on a given service - that is a job for a real device.
 */

/**
 * Returns an object where any property read gives back its own name, so
 * `Service.Fan` is the string 'Fan'. Homebridge hands out classes here; we only
 * ever need something unique and readable to use as a key.
 */
function nameProxy() {
  return new Proxy({}, {
    get: (_target, prop) => (typeof prop === 'string' ? prop : undefined),
    has: () => true,
  })
}

class FakeCharacteristic {
  constructor(name) {
    this.name = name
    this.props = {}
    this.value = defaultValueFor(name)
  }

  onGet(fn) {
    this.getHandler = fn
    return this
  }

  onSet(fn) {
    this.setHandler = fn
    return this
  }

  setProps(props) {
    Object.assign(this.props, props)
    return this
  }

  updateValue(value) {
    this.value = value
    return this
  }

  getValue() {
    return this.value
  }
}

/**
 * HomeKit characteristics start at a sensible zero value. A handler often reads
 * one back during setup to seed its cache, so returning undefined here would
 * change behaviour rather than just observe it.
 */
function defaultValueFor(name) {
  if (name === 'On' || name === 'OutletInUse' || name === 'StatusLowBattery') {
    return false
  }
  if (name === 'ColorTemperature') {
    return 140
  }
  return 0
}

class FakeService {
  constructor(type, name, subtype) {
    this.type = type
    this.displayName = name
    this.subtype = subtype
    this.characteristics = new Map()
    this.isPrimary = false
    this.linked = []
  }

  getCharacteristic(name) {
    // Real HAP adds an optional characteristic on first read, so this does too
    if (!this.characteristics.has(name)) {
      this.characteristics.set(name, new FakeCharacteristic(name))
    }
    return this.characteristics.get(name)
  }

  testCharacteristic(name) {
    return this.characteristics.has(name)
  }

  addCharacteristic(name) {
    return this.getCharacteristic(name)
  }

  removeCharacteristic(characteristic) {
    this.characteristics.delete(characteristic?.name ?? characteristic)
  }

  updateCharacteristic(name, value) {
    this.getCharacteristic(name).value = value
    return this
  }

  setCharacteristic(name, value) {
    this.getCharacteristic(name).value = value
    return this
  }

  setPrimaryService(isPrimary = true) {
    this.isPrimary = isPrimary
    return this
  }

  addLinkedService(service) {
    this.linked.push(service)
    return this
  }
}

class FakeAccessory {
  constructor(displayName, uuid) {
    this.displayName = displayName
    this.UUID = uuid
    this.context = {}
    this.services = []
    this.controllers = []

    // Homebridge always provides this one, before any handler runs
    this.addService('AccessoryInformation')
  }

  /**
   * Homebridge looks a service up by its type or by its display name, and
   * handlers rely on the name form to find and clear out a tile left behind
   * from a previous setting. Matching only the type would silently skip that.
   */
  getService(nameOrType) {
    return this.services.find(service => service.type === nameOrType)
      || this.services.find(service => service.displayName === nameOrType)
  }

  addService(type, name, subtype) {
    const service = new FakeService(type, name, subtype)
    this.services.push(service)
    return service
  }

  removeService(service) {
    this.services = this.services.filter(existing => existing !== service)
  }

  configureController(controller) {
    this.controllers.push(controller)
  }
}

/**
 * Every log call is captured rather than printed. A device that fails to
 * initialise is only reported through a warning, so a snapshot that ignored
 * these would record the failure as though it were the intended result.
 */
function makeLog() {
  const entries = []
  const record = level => (...args) => entries.push({ level, args })
  const log = record('info')
  log.warn = record('warn')
  log.error = record('error')
  log.debug = record('debug')
  log.entries = entries
  return log
}

/**
 * A device id for a test device.
 *
 * The platform keeps a module-level map of everything it has already set up,
 * and reuses the cached accessory when it sees a device id it knows. That is
 * right in production and wrong here, where each build should start from
 * nothing - so every call gets its own id.
 */
let deviceCounter = 0
function deviceIdFor(model) {
  deviceCounter += 1
  const hex = [...model].map(char => char.charCodeAt(0).toString(16).padStart(2, '0'))
  const suffix = deviceCounter.toString(16).padStart(6, '0').match(/../g)
  return [...hex.slice(0, 4), ...suffix].join(':').toUpperCase()
}

export function makePlatform(overrides = {}) {
  const log = makeLog()
  const accessories = new Map()

  const platform = {
    log,
    config: { disableDeviceLogging: false },
    deviceConf: {},
    accessories,
    api: {
      hap: {
        Service: nameProxy(),
        Characteristic: nameProxy(),
        Categories: nameProxy(),
        uuid: { generate: input => `uuid-${input}` },
        HapStatusError: class extends Error {},
        AdaptiveLightingController: class {
          constructor(service, options) {
            this.service = service
            this.options = options
          }
        },
      },
      platformAccessory: FakeAccessory,
      updatePlatformAccessories: () => {},
      // The platform keeps its own private list of accessories, so these are
      // where a test can get hold of what was actually built
      registerPlatformAccessories: (_name, _alias, added) => {
        added.forEach(accessory => accessories.set(accessory.UUID, accessory))
      },
      publishExternalAccessories: (_name, added) => {
        added.forEach(accessory => accessories.set(accessory.UUID, accessory))
      },
      unregisterPlatformAccessories: (_name, _alias, removed) => {
        removed.forEach(accessory => accessories.delete(accessory.UUID))
      },
    },
    cusChar: nameProxy(),
    eveChar: nameProxy(),
    eveService: class {
      constructor(type, accessory) {
        this.type = type
        this.accessory = accessory
      }

      addEntry() {}
      getInitialTime() {
        return 0
      }
    },
    storageClientData: false,
    storageData: { getItem: async () => null, setItem: async () => {} },
    sendDeviceUpdate: async () => {},
    updateAccessoryStatus: () => {},
    ...overrides,
  }

  return platform
}

/**
 * Records every call, so a test can look at what was logged without pulling in
 * a mocking library here.
 */
function recorder() {
  const calls = []
  const fn = (...args) => calls.push(args)
  fn.calls = calls
  fn.messages = () => calls.map(call => String(call[0]))
  return fn
}

/**
 * An accessory ready to hand to a device handler directly, for the behaviour
 * the model snapshot cannot see - how a device reads a message back.
 */
export function makeAccessory(model, context = {}) {
  const accessory = new FakeAccessory(model, `uuid-${model}`)
  Object.assign(accessory.context, { gvModel: model, gvDeviceId: 'AA:BB' }, context)
  accessory.log = recorder()
  accessory.logWarn = recorder()
  accessory.logDebug = recorder()
  accessory.logDebugWarn = recorder()
  return accessory
}

export { deviceIdFor, FakeAccessory, FakeService }
