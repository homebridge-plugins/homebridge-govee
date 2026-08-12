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

  // The H6102 is the same RGBIC generation as the H617A above. It was on the
  // 0x0D command, which it accepts but silently ignores - on, off and
  // brightness worked while colour did nothing. Which colour command it wants
  // depends on its firmware, so the choice is made in firmwareOverrides below
  // and only the brightness scale is fixed here (#1332)
  H6102: { bleBrightnessScale: 0x64 },

  // Later ice makers number their ice sizes the natural way round. The older
  // ones run the other way, small being the highest byte, so the two families
  // share a handler and differ only here
  H8121: { iceSizeAscending: true },
  H8122: { iceSizeAscending: true },

  // The H1310 shares the H1370's ceiling fan handler but is a different
  // product - Govee's own catalogue gives it goodsType 359 against the
  // H1370's 368. Its owner reports six fan speeds in the app rather than
  // twelve, so the two need separate scales (#1352)
  H1310: { fanSpeedSteps: 6 },
  R1310: { fanSpeedSteps: 6 },

  // AWS outlet uses 17/16 for on/off instead of 1/0
  H5080: { awsPowerOn: 17, awsPowerOff: 16 },
  H5083: { awsPowerOn: 17, awsPowerOff: 16 },

  // H615B uses alternate BLE write characteristic UUID
  H615B: { bleWriteUuid: UUID.WRITE_ALT },

  // Bluetooth-only solar string lights (#1328). Every frame is wrapped in
  // AES-128-GCM, so this model needs the key handshake in ble-crypto.js before
  // any command is accepted. Its colour and brightness formats, observed on
  // the wire:
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

  // H1250: proven live on hardware 2026-08-08 - a HomeKit write of 100 sent
  // val:254 and came out visibly dimmer than the Govee app's own 100%, then the
  // AWS echo of {"brightness":100} was rescaled down to 39%, matching every
  // step of a slider drag exactly (98->39, 69->27, 42->17, 97->38, 43->17)
  H1250: { awsBrightnessNoScale: true },
}

/**
 * Overrides that depend on the device's firmware version as well as its model.
 *
 * Each entry gives a `minVersion` and the capabilities to apply from that
 * version upwards. Versions are the dotted `versionSoft` string reported by the
 * device, compared part by part, so "1.03.01" sorts above "1.02.99". A device
 * whose firmware is unknown keeps the plain model defaults, which is the safer
 * of the two branches.
 */
const firmwareOverrides = {
  // Older H6102 firmware takes the standard 0x02 colour command. From 1.03.01
  // the strip moves to the newer extended format, the same one the H617A and
  // H617E need (#1332)
  H6102: [
    {
      minVersion: '1.03.01',
      caps: { bleColorCmd: COLOR_SUB.RGB_EXTENDED, bleColorCmdSuffix: [0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F] },
    },
  ],
}

/**
 * Compare two dotted version strings. Returns a positive number if `a` is
 * newer than `b`, negative if older, and zero if they match. Missing parts
 * count as zero, so "1.03" and "1.03.00" are equal.
 */
export function compareVersions(a, b) {
  const aParts = String(a).split('.')
  const bParts = String(b).split('.')
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const diff = (Number.parseInt(aParts[i], 10) || 0) - (Number.parseInt(bParts[i], 10) || 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
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
  readsSwingStatus: true,
  iceSizeAscending: false,
  // Ceiling fan speed steps. 12 is what the H1370 reports, from a real
  // device's status in #1307
  fanSpeedSteps: 12,
  // false for the great majority of models, which take the plain 20-byte frame.
  // 'v2' selects the AES-128-GCM transport in ble-crypto.js.
  bleEncryption: false,
}

export function getDeviceCapabilities(model, firmware) {
  const overrides = modelOverrides[model] || {}

  // Layer on any firmware-gated capabilities, oldest matching rule first so a
  // newer rule wins. Skipped entirely when the device has not told us its
  // firmware version.
  const firmwareCaps = {}
  if (firmware) {
    const rules = [...(firmwareOverrides[model] || [])]
      .sort((a, b) => compareVersions(a.minVersion, b.minVersion))
    rules.forEach((rule) => {
      if (compareVersions(firmware, rule.minVersion) >= 0) {
        Object.assign(firmwareCaps, rule.caps)
      }
    })
  }

  return { ...defaults, ...overrides, ...firmwareCaps }
}
