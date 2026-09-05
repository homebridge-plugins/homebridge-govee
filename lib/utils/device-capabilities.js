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

  // The H1310's oscillation status message has never been confirmed to mean
  // the same thing, so reading it back stays off. While it is off, an owner's
  // fan reporting one produces a line in the log saying so - which is the
  // evidence needed to turn this on.
  //
  // Six speeds against the H1370's twelve: Govee's own catalogue makes them
  // different products, goodsType 359 against 368. The api confirms it and is
  // read first, leaving these as the fallback.
  //
  // Brightness goes on the 0-100 scale rather than 0-254, the same as the H1250
  // below. Proven from an owner's log in #1352: sent values above 100 came back
  // clamped (109, 168 and 165 all echoed as 100) while values below it echoed
  // unchanged (89 -> 89, 97 -> 97, 23 -> 23), and rescaling that 100 on the way
  // back in showed 39% - the identical symptom the H1250 was diagnosed from
  H1310: { readsSwingStatus: false, fanSpeedSteps: 6 },
  H1370: { fanSpeedSteps: 12 },
  R1310: { readsSwingStatus: false, fanSpeedSteps: 6 },

  // Later ice makers number their ice sizes the natural way round. The older
  // ones run the other way, small being the highest byte, so the two families
  // share a handler and differ only here
  H8121: { iceSizeAscending: true },
  H8122: { iceSizeAscending: true },

  // The H8120's ice making is plain device power over the universal
  // `33 01 <0/1>` frame (#1250 - the owner's live test proved `33 01 00` is
  // absolute OFF, not the toggle the app capture first suggested). It has no
  // ice size option in the app at all, and its night light colour is set
  // over AWS multiSync (`3a b6 15 fc 01 r g b`) - the OpenAPI colorRgb
  // write is accepted but does nothing on this model
  H8120: { icePowerOnOff: true, iceSizes: false, nightlightColourAws: true },

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

  // AWS brightness is sent and reported as 0-100 by default, the same scale
  // HomeKit uses. A few models count to 254 instead, and for those every value
  // has to be scaled up on the way out and back down on the way in, or a 100%
  // in Home lands at about 39% on the light (#1262). The plugin kept exactly
  // this list - models TO scale - from 2021 to 2023, then flipped to scaling
  // everything with a per-device opt-out, and the opt-out list grew with
  // every release as owners of 0-100 models reported dim lights (#1321,
  // #1347, #1352, #1223, #1364). The 0-100 models are the majority, so the
  // default is back to 0-100 and this is the exception list.
  //
  // H6054, H6143, H6144: an owner's 100% arrived on the light as 35-39%
  // while the scaling was missing, and was right once restored (#1262).
  // H6002, H6083, H6085, H6135, H6137, H7005: the list the plugin carried
  // until v8.0.0, when the lists were replaced by the per-device setting.
  // Not re-confirmed since - if one of these turns out to count to 100 now,
  // `awsBrightnessNoScale` on the device puts it right without a release.
  H6002: { awsBrightnessScale: true },
  H6054: { awsBrightnessScale: true },
  H6083: { awsBrightnessScale: true },
  H6085: { awsBrightnessScale: true },
  H6135: { awsBrightnessScale: true },
  H6137: { awsBrightnessScale: true },
  H6143: { awsBrightnessScale: true },
  H6144: { awsBrightnessScale: true },
  H7005: { awsBrightnessScale: true },
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
  awsBrightnessScale: false,
  readsSwingStatus: true,
  iceSizeAscending: false,
  icePowerOnOff: false,
  iceSizes: true,
  nightlightColourAws: false,
  // Ceiling fan speed steps, for a model on that handler with no entry of its
  // own. 12 is what the H1370 reports, from a real device's status in #1307.
  // Without it an unlisted model works out its speeds as NaN
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

/**
 * Whether a device's AWS brightness runs 0-254 rather than 0-100.
 *
 * The per-device settings win, then the model's own entry. Two settings rather
 * than one so an owner can override the list in either direction.
 */
export function awsBrightnessIsScaled(context, caps = getDeviceCapabilities(context.gvModel, context.firmware)) {
  if (context.awsBrightnessNoScale) {
    return false
  }
  return !!(context.awsBrightnessScale || caps.awsBrightnessScale)
}
