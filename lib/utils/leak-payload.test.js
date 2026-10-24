import { describe, expect, it } from 'vitest'

import { parseDeviceUpdate } from './response-parser.js'

/**
 * A leak sensor's state as the OpenAPI reports it, `{ state: { leakDetected } }`.
 */
describe('reading a leak sensor update from the openapi', () => {
  it('clears the leak when the sensor reports dry (#1381)', () => {
    // the exact payload an h5059 sent after a wet/dry test, which was turned
    // away as unrecognised because false was read as "not there"
    const data = parseDeviceUpdate({
      source: 'OPENAPI',
      state: { leakDetected: false },
    }, { gvModel: 'H5059' })
    expect(data.leakDetected).toBe(false)
  })

  it('reports the leak when the sensor reports wet', () => {
    const data = parseDeviceUpdate({
      source: 'OPENAPI',
      state: { leakDetected: true },
    }, { gvModel: 'H5059' })
    expect(data.leakDetected).toBe(true)
  })
})
