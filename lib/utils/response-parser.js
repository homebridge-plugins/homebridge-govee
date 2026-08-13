import platformConsts from './constants.js'
import { getDeviceCapabilities } from './device-capabilities.js'

const hasProperty = (obj, prop) => Object.hasOwn(obj, prop)

/**
 * Works out which unit an OpenAPI `sensorTemperature` value is in.
 *
 * Govee's OpenAPI reports this value in whatever unit the Govee app is set to, and
 * sends no unit alongside it. The HTTP API always reports hundredths of a degree
 * Celsius, so where a device has both we can compare the two and see which fits.
 *
 * @param {number} value - The raw OpenAPI sensorTemperature value
 * @param {object} context - Accessory context
 * @returns {'c'|'f'|null} The unit, or null if it cannot be determined
 */
function resolveOpenApiTempUnit(value, context) {
  // An explicit setting always wins
  if (context.openApiTempUnit === 'c' || context.openApiTempUnit === 'f') {
    return context.openApiTempUnit
  }

  // Govee may declare the unit on the capability itself
  const declared = context.openApiCapabilities?.sensorTemperature?.parameters?.unit
  if (typeof declared === 'string') {
    if (declared.toLowerCase().startsWith('f')) {
      return 'f'
    }
    if (declared.toLowerCase().startsWith('c')) {
      return 'c'
    }
  }

  // Otherwise compare against the last HTTP reading, which is always Celsius
  const reference = context.lastHttpTempCelsius
  if (typeof reference === 'number') {
    const asCelsius = Math.abs(value - reference)
    const asFahrenheit = Math.abs(((value - 32) * 5) / 9 - reference)
    if (asFahrenheit + 0.5 < asCelsius) {
      return 'f'
    }
    if (asCelsius + 0.5 < asFahrenheit) {
      return 'c'
    }
  }

  return null
}

/**
 * Whether a payload is only govee's receipt for a command we sent.
 *
 * These carry a command name and a `result` and nothing else - no status at
 * all - so there is nothing in them to have failed to understand. Anything
 * that names even one other field is a real payload and is not this.
 *
 * @param {object} params - Raw payload with source, cmd, state, etc.
 * @returns {boolean} true if the payload is a bare acknowledgement
 */
export function isCommandAcknowledgement(params) {
  if (!params?.cmd || !params.state || typeof params.state !== 'object') {
    return false
  }
  const keys = Object.keys(params.state)
  return keys.length > 0 && keys.every(key => key === 'result')
}

/**
 * Parses a raw device update payload into a standardised data object.
 * Handles different payload structures from AWS, LAN, OpenAPI, and legacy devices.
 *
 * @param {object} params - Raw payload with source, state, op, bulb, etc.
 * @param {object} context - Accessory context (gvModel, awsBrightnessNoScale)
 * @returns {object} Standardised data object for device handler externalUpdate()
 */
export function parseDeviceUpdate(params, context) {
  const data = {}

  // Legacy devices (H6104 etc.) send status in data instead of state
  if (params.data && !params.state) {
    params.state = []
    if (hasProperty(params.data, 'turn')) {
      params.state.onOff = params.data.turn
    }
    if (hasProperty(params.data, 'brightness')) {
      params.state.brightness = params.data.brightness
    }
  }

  // ON/OFF
  if (params.state && hasProperty(params.state, 'onOff')) {
    if (platformConsts.models.switchDouble.includes(context.gvModel)) {
      switch (params.state.onOff) {
        case 0:
          data.state = ['off', 'off']
          break
        case 1:
          data.state = ['on', 'off']
          break
        case 2:
          data.state = ['off', 'on']
          break
        case 3:
          data.state = ['on', 'on']
          break
      }
    } else {
      // H5080/H5083 use 17 for on, most use 1
      data.state = [1, 17].includes(params.state.onOff) ? 'on' : 'off'
    }
  }

  // BRIGHTNESS
  if (params.state && hasProperty(params.state, 'brightness')) {
    // AWS reports 0-254 on most devices, so it has to come back down to
    // HomeKit's 0-100. Without this every AWS reading of 100 or more clamped
    // to full brightness (#1262). The other sources already report 0-100.
    if (params.source === 'AWS') {
      const noScale = context.awsBrightnessNoScale
        || getDeviceCapabilities(context.gvModel).awsBrightnessNoScale
      data.brightness = noScale
        ? params.state.brightness
        : Math.round(params.state.brightness / 2.54)
    } else {
      data.brightness = params.state.brightness
    }
  }
  // Govee occasionally sends a value outside [0, 100] anyway
  if (hasProperty(data, 'brightness')) {
    data.brightness = Math.max(Math.min(data.brightness, 100), 0)
  }

  // COLOUR (RGB)
  if (params.state && hasProperty(params.state, 'color')) {
    data.rgb = params.state.color
  }

  // COLOUR TEMP (KELVIN)
  if (params.state && params.state.colorTemInKelvin) {
    data.kelvin = params.state.colorTemInKelvin
  }
  if (hasProperty(data, 'kelvin') && (data.kelvin < 2000 || data.kelvin > 7143)) {
    data.kelvinOutOfRange = data.kelvin > 9000
    data.kelvin = Math.max(Math.min(data.kelvin, 7143), 2000)
  }

  // BATTERY
  if (hasProperty(params, 'battery')) {
    data.battery = Math.min(Math.max(params.battery, 0), 100)
  }

  // LEAK DETECTED
  if (hasProperty(params, 'leakDetected')) {
    data.leakDetected = params.leakDetected
  } else if (params?.state?.leakDetected) {
    data.leakDetected = params.state.leakDetected
  }
  if (params?.state && hasProperty(params.state, 'online')) {
    data.online = params.state.online
  }

  // CURRENT TEMPERATURE
  if (hasProperty(params, 'temperature')) {
    data.temperature = params.temperature

    // The HTTP value is always Celsius, so keep it as a reference for the OpenAPI value
    if (params.source === 'HTTP' && Number.isFinite(params.temperature)) {
      context.lastHttpTempCelsius = params.temperature / 100
    }
  } else if (params?.state?.sta && hasProperty(params.state.sta, 'curTem')) {
    data.temperature = params.state.sta.curTem
  }
  if (hasProperty(params, 'temperatureF')) {
    data.temperatureF = params.temperatureF
  }

  // SET TEMPERATURE
  if (params.state?.sta && hasProperty(params.state.sta, 'setTem')) {
    data.setTemperature = params.state.sta.setTem
  }

  // HUMIDITY
  if (hasProperty(params, 'humidity')) {
    data.humidity = params.humidity
  }

  // WORK MODE (OpenAPI)
  if (params.state?.workMode) {
    data.workMode = params.state.workMode
  }

  // TOGGLES (OpenAPI)
  if (params.state?.toggles) {
    data.toggles = params.state.toggles
  }

  // TARGET TEMPERATURE (OpenAPI)
  if (params.state?.targetTemperature) {
    data.targetTemperature = params.state.targetTemperature
  }

  // TARGET HUMIDITY (OpenAPI)
  if (params.state && hasProperty(params.state, 'targetHumidity')) {
    data.targetHumidity = params.state.targetHumidity
  }

  // SENSOR TEMPERATURE (OpenAPI property)
  if (params.state && hasProperty(params.state, 'sensorTemperature')) {
    const sensorTemp = Number(params.state.sensorTemperature)
    const unit = resolveOpenApiTempUnit(sensorTemp, context)
    if (unit === 'f') {
      data.temperature = Math.round((((sensorTemp - 32) * 5) / 9) * 100)
    } else if (unit === 'c') {
      data.temperature = Math.round(sensorTemp * 100)
    } else {
      // Unit unknown, so report nothing rather than a wrong reading
      data.temperatureUnitUnknown = true
    }
  }

  // SENSOR HUMIDITY (OpenAPI property)
  if (params.state && hasProperty(params.state, 'sensorHumidity')) {
    data.humidity = params.state.sensorHumidity * 100
  }

  // COMMANDS (light scenes, modes)
  if (params.commands) {
    data.commands = params.commands
    data.baseCmd = 'none'
  } else if (params.op) {
    if (params.op.command) {
      data.commands = params.op.command
      data.baseCmd = 'op'
    } else if (params.op.mode && Array.isArray(params.op.value)) {
      data.commands = params.op.value
      data.baseCmd = 'opMode'
    } else if (params.op.opcode === 'mode' && Array.isArray(params.op.modeValue)) {
      data.commands = params.op.modeValue
      data.baseCmd = 'opCodeMode'
    }
  } else if (params.bulb) {
    data.commands = params.bulb
    data.baseCmd = 'bulb'
  } else if (params.data?.op === 'mode' && Array.isArray(params.data.value)) {
    data.commands = params.data.value
    data.baseCmd = 'opMode'
  }

  data.source = params.source
  return data
}
