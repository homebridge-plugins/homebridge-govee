import { base64ToHex, getTwoItemPosition, hexToTwoItems } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import { logUnknownData } from '../utils/report-unknown.js'
import GoveeDevice from './base.js'

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)
    // Add the occupancy sensor if it does not already exist
    this.service = this.accessory.getService(this.hapServ.OccupancySensor) || this.accessory.addService(this.hapServ.OccupancySensor)
    this.cacheState = this.service.getCharacteristic(this.hapChar.OccupancyDetected).value

    // Output the customised options to the log
    const opts = JSON.stringify({})
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
  }

  externalUpdate(params) {
    // The OpenAPI live connection reports presence on its own, not as a frame
    if (Object.hasOwn(params, 'presenceDetected')) {
      this.updateOccupancy(params.presenceDetected ? 1 : 0)
    }

    // Check the status frames for anything else that changed
    (params.commands || []).forEach((command) => {
      const hexString = base64ToHex(command)
      const hexParts = hexToTwoItems(hexString)

      // Return now if not a device query update code
      if (getTwoItemPosition(hexParts, 1) !== 'aa') {
        return
      }

      const deviceFunction = `${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}`

      switch (deviceFunction) {
        case 'aa01': { // lock
          this.updateOccupancy(getTwoItemPosition(hexParts, 3) === '01'
            ? 1
            : 0)
          break
        }
        default:
          logUnknownData(this.accessory, {
            kind: 'status',
            source: params.source,
            raw: command,
            hex: hexString,
          })
          break
      }
    })
  }

  updateOccupancy(newState) {
    if (newState !== this.cacheState) {
      this.cacheState = newState
      this.service.updateCharacteristic(this.hapChar.OccupancyDetected, this.cacheState)
      this.accessory.log(`${platformLang.curOcc} [${this.cacheState === 1
        ? 'yes'
        : 'no'}]`)
    }
  }
}
