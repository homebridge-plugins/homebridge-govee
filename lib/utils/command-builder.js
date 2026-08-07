import { CMD } from './ble-protocol.js'
import { k2rgb } from './colour.js'
import { getDeviceCapabilities } from './device-capabilities.js'
import { base64ToHex, generateCodeFromHexValues } from './functions.js'

/**
 * Builds connection-specific command params from a high-level device command.
 * Returns { awsParams, bleParams, lanParams, openApiParams } — any may be undefined.
 */
export function buildCommand(params, context) {
  switch (params.cmd) {
    case 'state':
      return buildStateCommand(params)
    case 'stateDual':
      return buildStateDualCommand(params)
    case 'stateOutlet':
      return buildStateOutletCommand(params, context)
    case 'stateHumi':
    case 'statePuri':
      return buildStateApplianceCommand(params)
    case 'stateHeat':
      return buildStateHeatCommand(params)
    case 'multiSync':
    case 'ptIot':
    case 'ptReal':
      return buildPtRealCommand(params)
    case 'openApi':
      return buildOpenApiCommand(params)
    case 'zoneState':
      return buildZoneStateCommand(params)
    case 'brightness':
      return buildBrightnessCommand(params, context)
    case 'color':
      return buildColorCommand(params, context)
    case 'colorTem':
      return buildColorTempCommand(params, context)
    case 'rgbScene':
      return buildSceneCommand(params)
    default:
      throw new Error('Invalid command')
  }
}

function buildStateCommand(params) {
  const isOn = params.value === 'on'
  return {
    awsParams: { cmd: 'turn', data: { val: isOn ? 1 : 0 } },
    bleParams: { cmd: CMD.POWER, data: isOn ? 0x1 : 0x0 },
    lanParams: { cmd: 'turn', data: { value: isOn ? 1 : 0 } },
    openApiParams: { cmd: 'state', value: params.value },
  }
}

function buildStateDualCommand(params) {
  const result = {
    awsParams: { cmd: 'turn', data: { val: params.value } },
  }

  // The OpenAPI only offers one on/off switch per device, with no way to say
  // which outlet, and it rejects anything other than 0 or 1. Sending it a
  // per-outlet value got "Parameter value out of range" back on every press
  // (#1323). Only the whole-device values can be expressed, so leave the rest
  // to the other connections rather than making a request that cannot work
  if (params.value === 51 || params.value === 48) {
    result.openApiParams = { cmd: 'stateDual', value: params.value === 51 ? 1 : 0 }
  }

  return result
}

function buildStateOutletCommand(params, context) {
  const caps = getDeviceCapabilities(context.gvModel, context.firmware)
  return {
    awsParams: {
      cmd: 'turn',
      data: { val: params.value === 'on' ? caps.awsPowerOn : caps.awsPowerOff },
    },
    openApiParams: { cmd: 'stateOutlet', value: params.value },
  }
}

function buildStateApplianceCommand(params) {
  return {
    awsParams: { cmd: 'turn', data: { val: params.value } },
    bleParams: { cmd: CMD.POWER, data: params.value ? 0x1 : 0x0 },
    openApiParams: { cmd: params.cmd, value: params.value },
  }
}

function buildStateHeatCommand(params) {
  const fullCode = params.value ? 'MwEBAAAAAAAAAAAAAAAAAAAAADM=' : 'MwEAAAAAAAAAAAAAAAAAAAAAADI='
  return {
    awsParams: { cmd: 'multiSync', data: { command: [fullCode] } },
    bleParams: { cmd: 'ptReal', data: base64ToHex(fullCode) },
    openApiParams: { cmd: 'stateHeat', value: params.value },
  }
}

function buildPtRealCommand(params) {
  if (!params.value) {
    throw new Error(`Missing command value for ${params.cmd}`)
  }
  const result = {
    awsParams: { cmd: params.cmd, data: { command: [params.value] } },
    bleParams: { cmd: 'ptReal', data: base64ToHex(params.value) },
  }
  if (params.openApi) {
    result.openApiParams = { cmd: 'openApi', ...params.openApi }
  }
  return result
}

function buildOpenApiCommand(params) {
  if (!params.openApi?.instance) {
    throw new Error(`Missing openApi instance for ${params.cmd}`)
  }
  return {
    openApiParams: { cmd: 'openApi', ...params.openApi },
  }
}

// A two-zone light reports its zones as `aa 30 <main> <background>` and takes
// `33 30 <zone> <state>` to set one of them, where zone 00 is the main panel
// and 01 the background ring (#1333)
const ZONE_BYTE = { main: 0x00, background: 0x01 }

function buildZoneStateCommand(params) {
  const zone = ZONE_BYTE[params.zone]
  if (zone === undefined) {
    // Falling back to the main panel would switch the wrong light, which is far
    // harder to notice than an outright failure
    throw new Error(`Unknown light zone [${params.zone}] for ${params.cmd}`)
  }

  // Deliberately no lanParams. This model ignores `ptReal` over LAN, and LAN is
  // fire-and-forget UDP, so sending it there would resolve and count as done -
  // the command would never be retried over AWS. Leaving lanParams off lets the
  // existing guard skip LAN for this one command, and every other command on
  // the device carries on taking the faster local path.
  return {
    awsParams: {
      cmd: 'ptReal',
      data: { command: [generateCodeFromHexValues([0x33, 0x30, zone, params.value ? 0x01 : 0x00])] },
    },
  }
}

function buildBrightnessCommand(params, context) {
  const caps = getDeviceCapabilities(context.gvModel, context.firmware)
  return {
    awsParams: {
      cmd: 'brightness',
      // Most devices take 0-254 over AWS, so HomeKit's 0-100 has to be scaled
      // up. A handful expect 0-100 already - those are listed in
      // device-capabilities.js, or opted out per device with
      // `awsBrightnessNoScale`. Dropping this scaling made every AWS device
      // land at roughly a third of the requested brightness (#1262).
      data: {
        val: context.awsBrightnessNoScale || caps.awsBrightnessNoScale
          ? params.value
          : Math.round(params.value * 2.54),
      },
    },
    bleParams: {
      cmd: CMD.BRIGHTNESS,
      data: Math.floor((params.value / 100) * caps.bleBrightnessScale),
    },
    lanParams: { cmd: 'brightness', data: { value: params.value } },
    openApiParams: { cmd: 'brightness', value: params.value },
  }
}

function buildColorCommand(params, context) {
  const caps = getDeviceCapabilities(context.gvModel, context.firmware)
  const { r, g, b } = params.value

  let awsParams
  switch (context.awsColourMode) {
    case 'rgb':
      awsParams = { cmd: 'color', data: params.value }
      break
    case 'redgreenblue':
      awsParams = { cmd: 'color', data: { red: r, green: g, blue: b } }
      break
    default:
      awsParams = {
        cmd: 'colorwc',
        data: {
          color: { r, g, b, red: r, green: g, blue: b },
          colorTemInKelvin: 0,
        },
      }
      break
  }

  return {
    awsParams,
    bleParams: {
      cmd: CMD.COLOR_MODE,
      data: [...caps.bleColorCmd, r, g, b, ...caps.bleColorCmdSuffix],
    },
    lanParams: {
      cmd: 'colorwc',
      data: { color: { r, g, b }, colorTemInKelvin: 0 },
    },
    openApiParams: { cmd: 'color', value: params.value },
  }
}

function buildColorTempCommand(params, context) {
  const caps = getDeviceCapabilities(context.gvModel, context.firmware)
  const [r, g, b] = k2rgb(params.value)

  let awsParams
  switch (context.awsColourMode) {
    case 'rgb':
      awsParams = {
        cmd: 'colorTem',
        data: { colorTemInKelvin: params.value, color: { r, g, b } },
      }
      break
    case 'redgreenblue':
      awsParams = {
        cmd: 'colorTem',
        data: { color: { red: r, green: g, blue: b }, colorTemInKelvin: params.value },
      }
      break
    default:
      awsParams = {
        cmd: 'colorwc',
        data: { color: { r, g, b }, colorTemInKelvin: params.value },
      }
      break
  }

  return {
    awsParams,
    bleParams: {
      cmd: CMD.COLOR_MODE,
      data: [...caps.bleColorCmd, 0xFF, 0xFF, 0xFF, 0x01, r, g, b],
    },
    lanParams: {
      cmd: 'colorwc',
      data: { color: { r, g, b }, colorTemInKelvin: params.value },
    },
    openApiParams: { cmd: 'colorTem', value: params.value },
  }
}

function buildSceneCommand(params) {
  const result = {}
  if (params.value[0]) {
    const splitCode = params.value[0].split(',')
    result.awsParams = { cmd: 'ptReal', data: { command: splitCode } }
    // The local api accepts `ptReal` even though it is not in the documented
    // command set, which is what lets scenes work without the cloud
    result.lanParams = { cmd: 'ptReal', data: { command: splitCode } }
  }
  if (params.value[1]) {
    result.bleParams = { cmd: 'ptReal', data: params.value[1] }
  }
  if (params.openApi) {
    result.openApiParams = { cmd: 'openApi', ...params.openApi }
  }
  return result
}
