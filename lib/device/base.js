import { parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

/**
 * What every device handler needs, in one place.
 *
 * Each handler used to open with the same five assignments, build its tiles the
 * same way, and end every control with the same six-line failure block. That
 * last one was written out a hundred times over, which meant the delay before a
 * control snaps back, and the error HomeKit is given, were a hundred separate
 * decisions that happened to agree.
 */
export default class GoveeDevice {
  constructor(platform, accessory) {
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.platform = platform
    this.accessory = accessory
  }

  /**
   * The line at startup saying which of this device's settings are not the
   * defaults.
   */
  logInitOptions(options = {}) {
    this.platform.log(
      '[%s] %s %s.',
      this.accessory.displayName,
      platformLang.devInitOpts,
      JSON.stringify(options),
    )
  }

  /**
   * Get a tile, making it if it is not there yet.
   */
  getOrAddService(serviceType, name, subtype) {
    return this.accessory.getService(name ?? serviceType)
      || this.accessory.addService(serviceType, name, subtype)
  }

  /**
   * Drop a tile if the device has one, for when a setting has changed what this
   * device should look like. Leaving the old one behind gives the owner a tile
   * that no longer does anything.
   */
  removeServiceIfPresent(serviceType) {
    const existing = this.accessory.getService(serviceType)
    if (existing) {
      this.accessory.removeService(existing)
    }
    return !!existing
  }

  updateBattery(battery) {
    if (!this.battService || !Number.isFinite(battery) || battery < 0 || battery > 100) {
      return
    }

    if (battery !== this.cacheBatt) {
      this.cacheBatt = battery
      this.battService.updateCharacteristic(this.hapChar.BatteryLevel, this.cacheBatt)
      this.accessory.log(`${platformLang.curBatt} [${this.cacheBatt}%]`)
    }

    const lowBattery = battery <= this.lowBattThreshold ? 1 : 0
    const currentLowBattery = Number(this.battService
      .getCharacteristic(this.hapChar.StatusLowBattery)
      .value)

    if (lowBattery !== currentLowBattery) {
      this.battService.updateCharacteristic(this.hapChar.StatusLowBattery, lowBattery)
    }
  }

  /**
   * Give up on a control, put it back the way it was, and tell HomeKit.
   *
   * The three parts matter together: the log line says what went wrong, the
   * revert stops the tile showing a state the device is not in, and the error
   * is what makes HomeKit show it as not responding rather than quietly
   * accepting a change that never happened.
   *
   * `revert` is a function rather than a value so it is read when it runs, two
   * seconds later, which is the behaviour this replaced.
   *
   * @param {Error} err whatever went wrong
   * @param {Function} [revert] puts the control back
   * @throws {object} always - the caller is expected to let this bubble up
   */
  failUpdate(err, revert) {
    this.accessory.logWarn(`${platformLang.devNotUpdated} ${parseError(err)}`)

    if (revert) {
      setTimeout(revert, 2000)
    }

    throw new this.hapErr(-70402)
  }
}
