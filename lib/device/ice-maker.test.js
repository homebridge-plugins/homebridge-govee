import { describe, expect, it } from 'vitest'

import { makeAccessory, makePlatform } from '../../test/harness.js'
import { base64ToHex } from '../utils/functions.js'
import deviceIceMaker from './ice-maker-H7172.js'

/**
 * Every one of these models sends `33 05 <size>`, but the older ones number the
 * sizes the opposite way round. Both families share this handler now, and the
 * order comes from the model.
 *
 * Getting this wrong swaps small and large silently - the device accepts the
 * command and makes the wrong ice - so it is pinned per model rather than left
 * to the shape of the code.
 */

function sizeByteFor(model, size) {
  const device = new deviceIceMaker(makePlatform(), makeAccessory(model))
  return base64ToHex(device.sizeCodes[size]).slice(4, 6)
}

describe('which byte means which ice size', () => {
  describe.each(['H7172', 'H717D', 'H8120'])('the older %s', (model) => {
    it('counts down, so small is the highest byte', () => {
      expect(sizeByteFor(model, 1)).toBe('03')
      expect(sizeByteFor(model, 2)).toBe('02')
      expect(sizeByteFor(model, 3)).toBe('01')
    })
  })

  describe.each(['H8121', 'H8122'])('the newer %s', (model) => {
    it('counts up, so small is the lowest byte', () => {
      expect(sizeByteFor(model, 1)).toBe('01')
      expect(sizeByteFor(model, 2)).toBe('02')
      expect(sizeByteFor(model, 3)).toBe('03')
    })
  })

  it('sends the same command bytes it always did', () => {
    // The codes used to be written out as base64 by hand; these are those exact
    // strings, so building them cannot have changed what goes on the wire
    const older = new deviceIceMaker(makePlatform(), makeAccessory('H7172'))
    expect(older.sizeCodes).toEqual({
      1: 'MwUDAAAAAAAAAAAAAAAAAAAAADU=',
      2: 'MwUCAAAAAAAAAAAAAAAAAAAAADQ=',
      3: 'MwUBAAAAAAAAAAAAAAAAAAAAADc=',
    })

    const newer = new deviceIceMaker(makePlatform(), makeAccessory('H8121'))
    expect(newer.sizeCodes).toEqual({
      1: 'MwUBAAAAAAAAAAAAAAAAAAAAADc=',
      2: 'MwUCAAAAAAAAAAAAAAAAAAAAADQ=',
      3: 'MwUDAAAAAAAAAAAAAAAAAAAAADU=',
    })
  })
})

/**
 * The H8120's LED night light (#1250). The send side is OpenAPI-only - the
 * status frame aa 1b 01 is proven from an owner's captures, but no write
 * command has ever been seen, and bytes are never guessed - so the tile only
 * exists when the account declares the control.
 */
describe('the ice maker night light', () => {
  const capable = { openApiCapabilities: { nightlightToggle: {}, brightness: {} } }

  it('has no light tile without the openapi capability', () => {
    const device = new deviceIceMaker(makePlatform(), makeAccessory('H8120'))
    expect(device.lightService).toBeUndefined()
  })

  it('gains the light tile when the account declares the control', () => {
    const device = new deviceIceMaker(makePlatform(), makeAccessory('H8120', capable))
    expect(device.lightService).toBeDefined()
  })

  it('gains colour controls only when the account declares colorRgb', () => {
    const withColour = new deviceIceMaker(makePlatform(), makeAccessory('H8120', {
      openApiCapabilities: { nightlightToggle: {}, brightness: {}, colorRgb: {} },
    }))
    expect(withColour.lightService.testCharacteristic('Hue')).toBe(true)

    const withoutColour = new deviceIceMaker(makePlatform(), makeAccessory('H8120', capable))
    expect(withoutColour.lightService.testCharacteristic('Hue')).toBe(false)
  })

  it('drops a cached light tile when the capability has gone', () => {
    const platform = makePlatform()
    const accessory = makeAccessory('H8120', capable)
    const first = new deviceIceMaker(platform, accessory)
    expect(first.lightService).toBeDefined()
    expect(accessory.getService('Lightbulb')).toBeDefined()

    // the api key was removed - the restored accessory still carries the tile
    accessory.context.openApiCapabilities = {}
    const second = new deviceIceMaker(platform, accessory)
    expect(second.lightService).toBeUndefined()

    expect(accessory.getService('Lightbulb')).toBeUndefined()
  })

  it('reads the owner-captured status frame: on at full brightness', () => {
    const device = new deviceIceMaker(makePlatform(), makeAccessory('H8120', capable))

    // aa 1b 01 01 64 - the exact frame from the owner's log with the light on
    device.externalUpdate({ source: 'AWS', commands: ['qhsBAWQAAAAAAAAAAAAAAAAAANU='] })

    expect(device.cacheLightState).toBe('on')
    expect(device.cacheLightBright).toBe(100)
  })

  it('reads the off form of the same frame, keeping the brightness', () => {
    const device = new deviceIceMaker(makePlatform(), makeAccessory('H8120', capable))

    device.externalUpdate({ source: 'AWS', commands: ['qhsBAWQAAAAAAAAAAAAAAAAAANU='] })
    // aa 1b 01 00 64 - the light off, brightness byte still 100
    device.externalUpdate({ source: 'AWS', commands: ['qhsBAGQAAAAAAAAAAAAAAAAAANQ='] })

    expect(device.cacheLightState).toBe('off')
    expect(device.cacheLightBright).toBe(100)
  })

  it('no longer reports the light frame as unrecognised', () => {
    const platform = makePlatform()
    const accessory = makeAccessory('H8120', capable)
    const device = new deviceIceMaker(platform, accessory)
    const debugs = []
    accessory.logDebug = message => debugs.push(String(message))

    device.externalUpdate({ source: 'AWS', commands: ['qhsBAWQAAAAAAAAAAAAAAAAAANU='] })

    expect(debugs.join(' ')).not.toContain('aa1b')
  })
})
