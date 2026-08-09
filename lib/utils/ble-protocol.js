/**
 * BLE Protocol Constants for Govee Devices
 *
 * Govee BLE packets are always 20 bytes with XOR checksum:
 * ┌──────────┬─────────┬──────────┬──────────────────┬──────────┐
 * │ ID (1B)  │ Cmd(1B) │ Sub(1B)  │ Data (16B)       │ XOR (1B) │
 * └──────────┴─────────┴──────────┴──────────────────┴──────────┘
 *
 * Reference: https://github.com/lasswellt/govee-homeassistant/blob/master/docs/govee-protocol-reference.md
 */

// Packet identifiers (byte 0)
export const PACKET_ID = {
  COMMAND: 0x33, // Outbound commands to device
  STATUS: 0xAA, // Status/state data in MQTT responses
  DIY: 0xA1, // DIY mode data
  SCENE_MULTI: 0xA3, // Multi-packet scene data
}

// Command types (byte 1, when PACKET_ID is COMMAND)
export const CMD = {
  POWER: 0x01,
  BRIGHTNESS: 0x04,
  COLOR_MODE: 0x05,
  SEGMENT: 0x0B,
  GRADIENT: 0x14,
  SCENE: 0x21,
  NIGHTLIGHT: 0x36,
}

// Color/mode sub-commands (byte 2, when CMD is COLOR_MODE)
export const COLOR_SUB = {
  VIDEO: 0x00, // DreamView mode (H6199)
  MUSIC: 0x01, // Music mode (H6127)
  RGB_DEFAULT: 0x02, // Manual RGB (H6127 and most devices)
  SCENE_PRESET: 0x04, // Scene activation (little-endian code)
  DIY: 0x0A, // DIY animation
  SEGMENT_CT: 0x0B, // Segment + color temp (H6199)
  RGB_ALT: 0x0D, // Manual RGB alternate (H615B, H6052, etc)
  RGB_EXTENDED: [0x15, 0x01], // Extended RGB (H6053, H6072, H6199)
}

// Status packet sub-types (byte 1, when PACKET_ID is STATUS)
export const STATUS_TYPE = {
  MODE: 0x05,
  SLEEP_TIMER: 0x07,
  SETTINGS: 0x11,
  EXTENDED_SETTINGS: 0x12,
  CURRENT_COLOR: 0x13, // [?, R, G, B]
  SEGMENT_CONFIG: 0x23,
  STATUS_FLAGS: 0x26,
  SEGMENT_COLORS: 0xA5, // 4 RGB triplets per packet
}

// BLE service and characteristic UUIDs
export const UUID = {
  SERVICE: '00010203-0405-0607-0809-0a0b0c0d1910',
  WRITE_DEFAULT: '000102030405060708090a0b0c0d2b11',
  WRITE_ALT: '000102030405060708090a0b0c0d2b10', // H615B
  // The same attribute as WRITE_ALT, named for the role it plays on encrypted
  // models: they answer the key handshake here.
  NOTIFY: '000102030405060708090a0b0c0d2b10',
}

// Total BLE packet size
export const PACKET_SIZE = 20

// Timeouts for the individual stages of a single BLE updateDevice() call.
// They live here, rather than beside the code that uses them, so the platform
// can size its queue from them without importing the BLE client — that client
// pulls in a native module which is not present on every install.
export const BLE_STAGE_TIMEOUTS = {
  powerOn: 5000,
  connect: 10000,
  write: 5000,
  // Encrypted models exchange a session key before the first real command (see
  // ble-crypto.js). A light answers in about 30ms, so this is a generous
  // ceiling rather than an expected cost.
  // Models that need no handshake never spend any of it.
  handshake: 5000,
  settle: 100, // let the controller transmit before disconnecting

  // Discovering services, and the disconnect on the way out, have no timeout of
  // their own, so leave them room in the total.
  untimedStages: 3000,

  // Headroom on top, so that a stage which times out reports its own error
  // instead of being cut short by the queue's much vaguer one.
  queueHeadroom: 2000,
}

/**
 * The longest a single BLE updateDevice() call can legitimately take.
 *
 * The platform queue sizes its own timeout from this. It is meant as a backstop
 * for a task that has hung, not a second deadline racing the stage timeouts.
 * Both used to be a flat 10 seconds, which meant the queue killed a connection
 * attempt at the exact moment that attempt gave up — and a light that connected
 * slowly never got as far as sending its command at all (#1328).
 */
export const BLE_UPDATE_TIMEOUT = Object
  .values(BLE_STAGE_TIMEOUTS)
  .reduce((total, stage) => total + stage, 0)

/**
 * What a noble adapter state means for the person reading the log.
 *
 * ⚠️ The plugin used to report only noble's own message — "Timeout waiting for
 * Noble to be powered on" — for every one of these. That reads as a stuck
 * adapter no matter which it is, and the three real causes need completely
 * different fixes: a blocked radio, a missing capability, or no adapter at all.
 * Working out which cost a reporter four days of back-and-forth (#1344), and it
 * was knowable from the state noble had already reported.
 *
 * Returns undefined when the state does not point at a specific cause, so the
 * caller can fall back to noble's own wording.
 */
export function describeAdapterState(state, lang) {
  switch (state) {
    case 'poweredOff':
      return lang.blePowerBlocked
    case 'unauthorized':
      return lang.blePowerUnauthorized
    case 'unsupported':
      return lang.blePowerNoAdapter
    case 'unknown':
      return lang.blePowerUnknown
    default:
      return undefined
  }
}
