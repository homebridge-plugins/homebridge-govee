import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import eveChars from '../utils/eve-chars.js'
import deviceOutletSingle from './outlet-single.js'

/**
 * An H5086 reports its power to the hundredth of a watt, but the reading was
 * published in whole watts, so 5.49W came out as 5W and 5.5W as 6W. An
 * automation that waits for the power to stay below 6W kept resetting (#1379).
 */

// Just enough of HAP for the Eve characteristics to describe themselves
const fakeApi = {
  hap: {
    Characteristic: class {
      setProps(props) {
        this.props = props
      }

      getDefaultValue() {
        return 0
      }
    },
    Formats: { FLOAT: 'float', UINT16: 'uint16', UINT32: 'uint32' },
    Perms: { PAIRED_READ: 'pr', NOTIFY: 'ev' },
    Units: { SECONDS: 'seconds' },
  },
}

describe('an H5086 power reading', () => {
  it('is published with its decimals', () => {
    const consumption = new (new eveChars(fakeApi).CurrentConsumption)()
    expect(consumption.props.format).toBe('float')
    expect(consumption.props.minStep).toBe(0.01)
  })

  it('stops rounding on an outlet cached in the old whole-watt format', () => {
    const platform = makePlatform()
    const accessory = makeAccessory('H5086')
    // what the outlet looks like when restored from the cache
    accessory.addService(platform.api.hap.Service.Outlet)
      .addCharacteristic(platform.eveChar.CurrentConsumption)
      .setProps({ format: 'uint16', minStep: 1 })

    const device = new deviceOutletSingle(platform, accessory)
    const props = device.service.getCharacteristic(platform.eveChar.CurrentConsumption).props
    expect(props.format).toBe('float')
    expect(props.minStep).toBe(0.01)
  })
})
