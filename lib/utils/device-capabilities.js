import { COLOR_SUB, UUID } from './ble-protocol.js'

/**
 * Per-model overrides for device-specific protocol quirks.
 * Models not listed here use the defaults returned by getDeviceCapabilities().
 *
 * Reference: https://github.com/lasswellt/govee-homeassistant/blob/master/docs/govee-protocol-reference.md
 */
const modelOverrides = {
  // BLE color sub-command: 0x0D instead of 0x02
  H6005: { bleColorCmd: [COLOR_SUB.RGB_ALT] },
  H6052: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H6058: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H6102: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H613B: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },
  H613D: { bleColorCmd: [COLOR_SUB.RGB_ALT], bleBrightnessScale: 0x64 },

  // BLE color sub-command: 0x15 0x01 (extended) with trailing bytes
  H6053: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F] },
  H6072: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F] },
  H6199: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F] },
  // H617A is the same RGBIC family as the H617E below - the simple RGB command
  // is accepted but the LEDs never change, so it needs the extended format too.
  // Brightness works on the default 0xFF scale, so only the colour command is
  // overridden (#1332)
  H617A: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F] },
  // H617E is an RGBIC strip which ignores the 0x0D command - it needs the
  // segment-based extended format, as seen in its own TTR rule data (#1290)
  H617E: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F], bleBrightnessScale: 0x64 },

  // AWS outlet uses 17/16 for on/off instead of 1/0
  H5080: { awsPowerOn: 17, awsPowerOff: 16 },
  H5083: { awsPowerOn: 17, awsPowerOff: 16 },

  // H615B uses alternate BLE write characteristic UUID
  H615B: { bleWriteUuid: UUID.WRITE_ALT },

  // Bluetooth-only solar string lights (#1328). Every frame is wrapped in
  // AES-128-GCM, so this model needs the key handshake in ble-crypto.js before
  // any command is accepted. Its colour and brightness formats were read off a
  // capture of the official app:
  //   colour     33 05 15 01 RR GG BB 00 00 00 00 00 FF  (then zero padding)
  //   brightness 33 04 <0-100>          e.g. 0x1e for 30%, 0x64 for 100%
  // Writes are unacknowledged, so without the wrapper the light silently
  // ignores everything and the plugin cannot tell.
  H3001: {
    bleEncryption: 'v2',
    bleColorCmd: COLOR_SUB.RGB_EXTENDED,
    bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF],
    bleBrightnessScale: 0x64,
  },

  // H6121 requires cmdVersion 1 for status requests
  H6121: { awsStatusCmdVersion: 1 },

  // These send and expect AWS brightness as 0-100 rather than the usual 0-254,
  // so scaling drives them to full on the way out and to 1% on the way back in
  // (#1321). Same effect as ticking `awsBrightnessNoScale` per device.
  // H6022: proven by its AWS echo of a LAN-set 50% coming back as 50, which the
  // rescale then turned into 20% and HomeKit flickered between the two
  H1401: { awsBrightnessNoScale: true },
  H6008: { awsBrightnessNoScale: true },
  H6022: { awsBrightnessNoScale: true },
}

const defaults = {
  bleColorCmd: [COLOR_SUB.RGB_DEFAULT],
  bleColorCmdSuffix: [],
  bleBrightnessScale: 0xFF,
  awsPowerOn: 1,
  awsPowerOff: 0,
  bleWriteUuid: UUID.WRITE_DEFAULT,
  awsStatusCmdVersion: 2,
  awsBrightnessNoScale: false,
  // false for the great majority of models, which take the plain 20-byte frame.
  // 'v2' selects the AES-128-GCM transport in ble-crypto.js.
  bleEncryption: false,
}

export function getDeviceCapabilities(model) {
  const overrides = modelOverrides[model] || {}
  return { ...defaults, ...overrides }
}
