import { describeSources, resolveControls } from '../utils/capabilities.js'
import { base64ToHex, getTwoItemPosition, hexToTwoItems } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData, reportUnsupportedControl } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

/**
 * A starting point for any appliance whose power command is known but whose
 * other controls are not.
 *
 * Govee uses the same on/off command for every appliance the plugin handles, so
 * power can be offered with confidence for a model nobody has tested. The
 * settings that differ per model - speeds, modes, sizes - are the risky part,
 * and getting one wrong is worse than not offering it. So those controls appear
 * but report what they need and fail the request, rather than sending a guess.
 *
 * Failing rather than doing nothing is deliberate: HomeKit shows the control as
 * not responding, which is what sends the owner to the log, where they find a
 * line to paste into an issue. That turns every owner of an untested model into
 * the source of the data needed to finish it.
 *
 * Once that data arrives the model gets a proper handler and stops using this.
 */
class ApplianceBasic extends GoveeDevice {
  constructor(platform, accessory, config) {
    super(platform, accessory)
    // Set up variables from the accessory
    this.config = config

    // Work out what this particular device can do, rather than what its model
    // generally can - for a model nobody has written down, what the device
    // itself reported is all there is to go on
    const resolved = resolveControls({
      model: accessory.context.gvModel,
      family: config.family,
      firmware: accessory.context.firmware,
      openApiCapabilities: accessory.context.openApiCapabilities,
      deviceConf: platform.deviceConf?.[accessory.context.gvDeviceId],
    })
    this.controls = resolved.controls
    this.cacheToggles = {}
    this.discoveredControls = []

    // Some appliances can have a richer tile, but only if the device reports
    // the reading that tile needs - HomeKit's humidifier, for example, has to
    // show a current humidity, and plenty of Govee humidifiers never send one.
    // Where the device says it has that sensor, use the better tile; otherwise
    // fall back to the plain one, which needs nothing extra.
    const hasSensor = config.richControl && this.controls[config.richControl]
    const serviceName = (config.richService && hasSensor)
      ? config.richService
      : config.service
    this.usingRichService = serviceName === config.richService

    // Drop the other service if this device has switched between the two
    const otherName = this.usingRichService ? config.service : config.richService
    if (otherName && this.hapServ[otherName]) {
      const stale = this.accessory.getService(this.hapServ[otherName])
      if (stale) {
        this.accessory.removeService(stale)
      }
    }

    const serviceType = this.hapServ[serviceName]
    this.service = this.accessory.getService(serviceType)
      || this.accessory.addService(serviceType)
    this.setupFilterMaintenance(this.service)

    // The plain Fan service switches on a boolean `On`, while Fanv2 and
    // AirPurifier use `Active`. Follow whichever this service uses, so these
    // tiles behave like the hand-written handlers for the same kind of device.
    const usesOn = serviceName === 'Fan' || serviceName === 'Switch'
    this.powerChar = usesOn ? this.hapChar.On : this.hapChar.Active
    this.powerOn = usesOn ? true : 1
    this.powerOff = usesOn ? false : 0

    // Add the set handler to the power characteristic
    this.service
      .getCharacteristic(this.powerChar)
      .onSet(async value => this.internalStateUpdate(value))
    this.cacheState = this.service.getCharacteristic(this.powerChar).value
      ? 'on'
      : 'off'

    // Some services need a current-state characteristic to look right in the
    // Home app. It belongs to the richer tile, so it is skipped when a device
    // has fallen back to the plain fan for want of a sensor.
    const fellBackToPlain = !!config.richService && !this.usingRichService
    if (config.currentStateChar && !fellBackToPlain) {
      this.currentStateChar = this.hapChar[config.currentStateChar]
      this.service.updateCharacteristic(
        this.currentStateChar,
        this.cacheState === 'on'
          ? config.currentStateOn
          : config.currentStateOff,
      )
    }

    // Offer the variable control so the device can be asked about it, but make
    // it clear it does nothing yet rather than sending a guessed command. The
    // richer services name this control differently, so follow the service.
    const variableChar = this.usingRichService && config.richVariableChar
      ? config.richVariableChar
      : config.variableChar
    if (variableChar) {
      this.variableChar = this.hapChar[variableChar]
      this.service
        .getCharacteristic(this.variableChar)
        .onSet(async value => this.internalVariableUpdate(value))
      this.cacheVariable = this.service.getCharacteristic(this.variableChar).value
    }

    // A control the device told us about can be driven through Govee's own api
    // by name, without knowing this model's command bytes. So unlike the
    // settings above, these work rather than asking to be reported.
    this.addDiscoveredToggle('swing', 'SwingMode', 'oscillationToggle')
    this.addDiscoveredToggle('lock', 'LockPhysicalControls', 'lockToggle')

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
    this.accessory.logDebug(`controls: ${describeSources(resolved.sources)}`)

    const working = ['on and off', ...this.discoveredControls]
    this.accessory.log(`${working.join(', ')} ${working.length > 1
      ? 'are'
      : 'is'} supported for this model, the ${config.variableLabel || 'other settings'} are not known yet`)
  }

  /**
   * Offer a control the device said it has, driven through Govee's api by the
   * name the device gave it.
   *
   * This is the one place a model nobody has tested gets something that really
   * works beyond power: the api takes the capability name, so the command bytes
   * for this model never have to be known.
   */
  addDiscoveredToggle(control, characteristic, instance) {
    const char = this.hapChar[characteristic]

    // The device has to have named this capability itself. Knowing the model
    // usually has a turning head is not enough - the api is driven by the name
    // the device reported, so without it there is nothing to send, and the
    // switch would fail every time it was touched.
    const reported = !!this.accessory.context.openApiCapabilities?.[instance]

    if (!reported || !this.controls[control] || !char) {
      if (this.service.testCharacteristic?.(char)) {
        this.service.removeCharacteristic(this.service.getCharacteristic(char))
      }
      return
    }

    this.service
      .getCharacteristic(char)
      .onSet(async value => this.internalToggleUpdate(control, char, instance, value))
    this.cacheToggles[control] = this.service.getCharacteristic(char).value

    this.discoveredControls.push(control === 'swing'
      ? 'oscillation'
      : 'the child lock')
  }

  async internalToggleUpdate(control, characteristic, instance, value) {
    const previous = this.cacheToggles[control]
    try {
      if (previous === value) {
        return
      }

      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'openApi',
        openApi: {
          instance,
          capabilityType: 'devices.capabilities.toggle',
          value: value ? 1 : 0,
        },
      })

      this.cacheToggles[control] = value
      this.accessory.log(`current ${control} [${value ? 'on' : 'off'}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(characteristic, previous)
      })
    }
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (this.cacheState === newValue) {
        return
      }

      // This power command is the same for every govee appliance, so it is safe
      // to send for a model that has not been tested
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'ptReal',
        value: value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI=',
        openApi: this.accessory.context.openApiCapabilities?.powerSwitch
          ? {
              instance: 'powerSwitch',
              capabilityType: 'devices.capabilities.on_off',
              value: value ? 1 : 0,
            }
          : undefined,
      })

      // Cache the new state and log if appropriate
      this.cacheState = newValue
      if (this.currentStateChar) {
        this.service.updateCharacteristic(
          this.currentStateChar,
          value ? this.config.currentStateOn : this.config.currentStateOff,
        )
      }
      this.accessory.log(`${platformLang.curState} [${newValue}]`)
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on'
          ? 1
          : 0)
      })
    }
  }

  async internalVariableUpdate(value) {
    // 0 is the control following the device being turned off, not a request
    if (value === 0) {
      return
    }

    reportUnsupportedControl(this.accessory, {
      control: this.config.variableLabel || 'setting',
      value,
    })

    // Put the control back, and fail the request so HomeKit shows it as not
    // responding - that is what sends the owner to the log
    setTimeout(() => {
      this.service.updateCharacteristic(this.variableChar, this.cacheVariable)
    }, 2000)
    throw new this.hapErr(-70402)
  }

  externalUpdate(params) {
    this.updateFilterLife(params.filterLife)

    // Feed the sensor reading through when the richer tile is in use - HomeKit
    // needs it, and it is the reason that tile was chosen
    if (this.usingRichService && this.config.richReadingChar && params.humidity !== undefined) {
      const reading = Number(params.humidity)
      if (Number.isFinite(reading) && reading !== this.cacheReading) {
        this.cacheReading = reading
        this.service.updateCharacteristic(this.hapChar[this.config.richReadingChar], reading)
      }
    }

    // Power is the one thing that can be read back with confidence
    if (params.state && params.state !== this.cacheState) {
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on'
        ? 1
        : 0)
      if (this.currentStateChar) {
        this.service.updateCharacteristic(
          this.currentStateChar,
          this.cacheState === 'on'
            ? this.config.currentStateOn
            : this.config.currentStateOff,
        )
      }
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Everything else gets reported so the model can be finished off
    ;(params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      // The power report is understood, anything else is worth sending in
      if (getTwoItemPosition(hexParts, 2) === '01') {
        const newState = getTwoItemPosition(hexParts, 3) === '01'
          ? 'on'
          : 'off'
        if (this.cacheState !== newState) {
          this.cacheState = newState
          this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on'
            ? 1
            : 0)
          this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
        }
        return
      }

      logUnknownData(this.accessory, {
        kind: 'status',
        source: params.source,
        raw: command,
        hex: hexString,
      })
    })
  }
}

/**
 * Build a basic handler for a kind of appliance.
 *
 * @param {object} config how this kind of appliance should appear
 * @returns {Function} a handler class the platform can construct
 */
export function makeBasicAppliance(config) {
  return class extends ApplianceBasic {
    constructor(platform, accessory) {
      super(platform, accessory, config)
    }
  }
}

// Fan-shaped appliances: a speed slider that is not worked out yet
export const deviceFanBasic = makeBasicAppliance({
  family: 'fan',
  service: 'Fanv2',
  variableChar: 'RotationSpeed',
  variableLabel: 'fan speed',
})

// Ice makers reuse the fan tile, with the slider standing in for ice size
export const deviceIceMakerBasic = makeBasicAppliance({
  family: 'iceMaker',
  service: 'Fanv2',
  variableChar: 'RotationSpeed',
  variableLabel: 'ice size',
})

// Humidifiers get the plain fan tile by default, because HomeKit's humidifier
// has to show a current humidity and many Govee humidifiers never report one.
// A model that does report it gets the proper humidifier tile instead.
export const deviceHumidifierBasic = makeBasicAppliance({
  family: 'humidifier',
  service: 'Fan',
  variableChar: 'RotationSpeed',
  variableLabel: 'mist level',
  richService: 'HumidifierDehumidifier',
  richControl: 'humiditySensor',
  richVariableChar: 'RelativeHumidityHumidifierThreshold',
  richReadingChar: 'CurrentRelativeHumidity',
  currentStateChar: 'CurrentHumidifierDehumidifierState',
  currentStateOn: 2, // humidifying
  currentStateOff: 0, // inactive
})

export const deviceDehumidifierBasic = makeBasicAppliance({
  family: 'dehumidifier',
  service: 'Fan',
  variableChar: 'RotationSpeed',
  variableLabel: 'fan speed',
  richService: 'HumidifierDehumidifier',
  richControl: 'humiditySensor',
  richVariableChar: 'RelativeHumidityDehumidifierThreshold',
  richReadingChar: 'CurrentRelativeHumidity',
  currentStateChar: 'CurrentHumidifierDehumidifierState',
  currentStateOn: 3, // dehumidifying
  currentStateOff: 0, // inactive
})

// Diffusers are power only, so there is no variable control to offer. They use
// the same tile as the models already handled, so a new one looks the same
export const deviceDiffuserBasic = makeBasicAppliance({
  family: 'diffuser',
  service: 'AirPurifier',
  currentStateChar: 'CurrentAirPurifierState',
  currentStateOn: 2, // purifying air
  currentStateOff: 0, // inactive
})

// A composter is on or off. It has a mode and a light too, but neither is
// worked out, so they are left off rather than shown as controls that do nothing
export const deviceComposterBasic = makeBasicAppliance({
  family: 'composter',
  service: 'Switch',
})

export const devicePurifierBasic = makeBasicAppliance({
  family: 'purifier',
  service: 'AirPurifier',
  variableChar: 'RotationSpeed',
  variableLabel: 'fan speed',
  currentStateChar: 'CurrentAirPurifierState',
  currentStateOn: 2, // purifying air
  currentStateOff: 0, // inactive
})
