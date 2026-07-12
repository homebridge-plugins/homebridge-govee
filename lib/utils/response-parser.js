import platformConsts from './constants.js'

const hasProperty = (obj, prop) => Object.hasOwn(obj, prop)

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
    data.brightness = params.state.brightness
  }
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
    data.temperature = params.state.sensorTemperature * 100
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
