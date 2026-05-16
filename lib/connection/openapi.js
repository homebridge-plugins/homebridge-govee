import axios from 'axios'
import mqtt from 'mqtt'

import { k2rgb } from '../utils/colour.js'
import { parseError } from '../utils/functions.js'

const BASE_URL = 'https://openapi.api.govee.com'

function normalizeOptions(options = []) {
  return Array.isArray(options) ? options.filter(option => option && Object.hasOwn(option, 'value')) : []
}

function capabilityLookup(capabilities = []) {
  const byInstance = {}
  capabilities.forEach((capability) => {
    if (capability?.instance) {
      byInstance[capability.instance] = capability
    }
  })
  return byInstance
}

function findRange(capability) {
  const range = capability?.parameters?.range
    || capability?.range
    || capability?.options?.range
    || capability?.struct?.range
  if (!range) {
    return null
  }
  const min = Number(range.min)
  const max = Number(range.max)
  return Number.isFinite(min) && Number.isFinite(max)
    ? { min, max }
    : null
}

function intToRgb(value) {
  const rgb = Number(value)
  if (!Number.isFinite(rgb)) {
    return null
  }
  return {
    r: (rgb >> 16) & 0xFF,
    g: (rgb >> 8) & 0xFF,
    b: rgb & 0xFF,
  }
}

function rgbDistance(a, b) {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY
  }
  return Math.abs(a.r - b[0]) + Math.abs(a.g - b[1]) + Math.abs(a.b - b[2])
}

function inferKelvinFromRgb(rgb) {
  let bestKelvin = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let kelvin = 2000; kelvin <= 7100; kelvin += 100) {
    const candidate = k2rgb(kelvin)
    const distance = rgbDistance(rgb, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      bestKelvin = kelvin
    }
  }

  // Only treat RGB as white temperature if it is very close to one of the known
  // Kelvin RGB values. This avoids reclassifying obvious colors like red/blue.
  return bestDistance <= 40 ? bestKelvin : null
}

function getDevicesFromPayload(data) {
  return data?.payload?.devices
    || data?.data?.devices
    || (Array.isArray(data?.data) ? data.data : null)
    || data?.devices
    || (Array.isArray(data) ? data : null)
    || []
}

function getCapabilitiesFromPayload(data) {
  return data?.payload?.capabilities
    || data?.payload?.state?.capabilities
    || data?.data?.capabilities
    || data?.capabilities
    || []
}

function getCapabilityValue(capability) {
  if (capability?.state && Object.hasOwn(capability.state, 'value')) {
    return capability.state.value
  } else if (capability?.state && Array.isArray(capability.state)) {
    return capability.state[0].value
  }
  return capability?.value
}

function getCapabilityOptions(capability) {
  return normalizeOptions(capability?.parameters?.options)
}

function cloneCapabilities(capabilities = []) {
  return capabilities.map(capability => ({
    ...capability,
    parameters: capability?.parameters
      ? {
          ...capability.parameters,
          options: normalizeOptions(capability.parameters.options),
        }
      : capability?.parameters,
  }))
}

function capabilityHasSceneOptions(capability) {
  return getCapabilityOptions(capability).length > 0
}

function mergeSceneCapabilities(baseCapabilities = [], sceneCapabilities = []) {
  if (!Array.isArray(sceneCapabilities) || sceneCapabilities.length === 0) {
    return baseCapabilities
  }

  const scenesByInstance = {}
  sceneCapabilities.forEach((sceneCapability) => {
    if (sceneCapability?.instance) {
      scenesByInstance[sceneCapability.instance] = sceneCapability
    }
  })

  return baseCapabilities.map((capability) => {
    const sceneCapability = scenesByInstance[capability?.instance]
    if (!sceneCapability) {
      return capability
    }
    return {
      ...capability,
      parameters: {
        ...(capability?.parameters || {}),
        ...(sceneCapability?.parameters || {}),
        options: normalizeOptions(sceneCapability?.parameters?.options),
      },
    }
  })
}

function findOptionByName(capability, name) {
  const lowered = `${name}`.trim().toLowerCase()
  return getCapabilityOptions(capability).find(option => `${option?.name || ''}`.trim().toLowerCase() === lowered)
}

function validateRangeValue(capability, value, cmd) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    throw new TypeError(`invalid numeric value for ${cmd}`)
  }

  const range = findRange(capability)
  if (!range) {
    return numeric
  }

  const clamped = Math.max(range.min, Math.min(range.max, numeric))
  if (range.precision && range.precision >= 1) {
    return Math.round(clamped / range.precision) * range.precision
  }
  return clamped
}

export default class {
  constructor(platform) {
    this.apiKey = platform.config.apiKey
    this.log = platform.log
    this.platform = platform
  }

  async request({ method, path, data }) {
    try {
      const res = await axios({
        url: `${BASE_URL}${path}`,
        method,
        headers: this.headers(),
        data,
        timeout: 30000,
      })

      if (Number(res?.data?.code) && Number(res.data.code) !== 200) {
        throw new Error(res?.data?.message || res?.data?.msg || `OpenAPI code ${res.data.code}`)
      }

      return res.data
    } catch (err) {
      throw new Error(parseError(err))
    }
  }

  headers() {
    return {
      'Content-Type': 'application/json',
      'Govee-API-Key': this.apiKey,
    }
  }

  async getScenes(sku, device) {
    const data = await this.request({
      method: 'post',
      path: '/router/api/v1/device/scenes',
      data: {
        requestId: `hb-scenes-${Date.now()}`,
        payload: { sku, device },
      },
    })

    return getCapabilitiesFromPayload(data)
  }

  async getDevices() {
    const data = await this.request({
      method: 'get',
      path: '/router/api/v1/user/devices',
    })

    const devices = getDevicesFromPayload(data)
    const parsedDevices = await Promise.all(
      devices
        .filter(device => device?.sku && device?.device)
        .map(async (device) => {
          let capabilities = cloneCapabilities(Array.isArray(device.capabilities) ? device.capabilities : [])

          if (capabilities.some(capability => capability?.type === 'devices.capabilities.dynamic_scene' && !capabilityHasSceneOptions(capability))) {
            try {
              const sceneCapabilities = await this.getScenes(device.sku, device.device)
              capabilities = mergeSceneCapabilities(capabilities, sceneCapabilities)
            } catch (err) {
              this.log.debug?.(`[OPENAPI] could not fetch scenes for ${device.device}: ${parseError(err)}`)
            }
          }

          const byInstance = capabilityLookup(capabilities)
          const colorTempRange = findRange(byInstance.colorTemperatureK)
          const brightnessRange = findRange(byInstance.brightness)
          const properties = {}
          const supportCmds = []

          if (byInstance.powerSwitch) {
            supportCmds.push('turn')
          }

          if (brightnessRange) {
            supportCmds.push('bright')
            properties.bright = { range: brightnessRange }
          }

          if (byInstance.colorRgb) {
            supportCmds.push('colour')
          }

          if (colorTempRange) {
            supportCmds.push('colorTem')
            properties.colorTem = { range: colorTempRange }
          }

          return {
            device: device.device,
            deviceName: device.deviceName || device.name || device.device,
            model: device.sku,
            openApiInfo: {
              capabilities,
              byInstance,
              category: device.category || device.type || null,
              image: device.skuUrl || null,
            },
            properties,
            supportCmds,
          }
        }),
    )

    return parsedDevices
  }

  async requestUpdate(accessory) {
    const state = await this.getState(accessory.context.gvModel, accessory.context.gvDeviceId)
    this.platform.receiveUpdateOpenAPI(accessory.context.gvDeviceId, state)
  }

  async getState(sku, device) {
    const data = await this.request({
      method: 'post',
      path: '/router/api/v1/device/state',
      data: {
        requestId: `hb-state-${Date.now()}`,
        payload: { sku, device },
      },
    })

    const capabilities = getCapabilitiesFromPayload(data)
    const normalized = {}
    let colorRgb = null
    let colorTemInKelvin = null

    capabilities.forEach((capability) => {
      const value = getCapabilityValue(capability)
      switch (capability?.instance) {
        case 'online':
          normalized.online = !!value
          break
        case 'powerSwitch':
          normalized.onOff = Number(value)
          break
        case 'brightness':
          normalized.brightness = Number(value)
          break
        case 'colorRgb': {
          const rgb = intToRgb(value)
          if (rgb) {
            colorRgb = rgb
          }
          break
        }
        case 'colorTemperatureK':
          colorTemInKelvin = Number(value)
          break
        case 'workMode':
          normalized.workMode = value
          break
        case 'sensorTemperature':
          normalized.sensorTemperature = Number(value)
          break
        case 'sensorHumidity':
          normalized.sensorHumidity = Number(value)
          break
        case 'humidity':
          normalized.targetHumidity = Number(value)
          break
        case 'targetTemperature':
        case 'sliderTemperature':
          normalized.targetTemperature = value
          break
        default:
          if (capability?.instance?.endsWith('Toggle')) {
            normalized.toggles = normalized.toggles || {}
            normalized.toggles[capability.instance] = Number(value) === 1
          }
          break
      }
    })

    if (Number.isFinite(colorTemInKelvin) && colorTemInKelvin > 0) {
      normalized.colorTemInKelvin = colorTemInKelvin
    }

    if (colorRgb) {
      if (Number.isFinite(colorTemInKelvin) && colorTemInKelvin > 0) {
        const kelvinRgb = k2rgb(colorTemInKelvin)

        // OpenAPI reports both RGB and Kelvin even in white mode, so only treat RGB as active
        // when it differs materially from the RGB equivalent of the reported Kelvin.
        if (rgbDistance(colorRgb, kelvinRgb) > 30) {
          normalized.color = colorRgb
          delete normalized.colorTemInKelvin
        }
      } else {
        const inferredKelvin = inferKelvinFromRgb(colorRgb)
        if (inferredKelvin) {
          normalized.colorTemInKelvin = inferredKelvin
        } else {
          normalized.color = colorRgb
        }
      }
    }

    return normalized
  }

  getCapability(accessory, instance, fallbackType) {
    const lookup = accessory.context.openApiCapabilities || {}
    const capability = lookup[instance]
    if (capability?.type && capability?.instance) {
      return capability
    }
    return {
      type: fallbackType,
      instance,
      parameters: {},
    }
  }

  buildCapabilityPayload(accessory, params) {
    let capability

    switch (params.cmd) {
      case 'state': {
        const base = this.getCapability(accessory, 'powerSwitch', 'devices.capabilities.on_off')
        capability = {
          type: base.type,
          instance: base.instance,
          value: params.value === 'on' ? 1 : 0,
        }
        break
      }
      case 'brightness': {
        const base = this.getCapability(accessory, 'brightness', 'devices.capabilities.range')
        capability = {
          type: base.type,
          instance: base.instance,
          value: validateRangeValue(base, params.value, params.cmd),
        }
        break
      }
      case 'color': {
        const base = this.getCapability(accessory, 'colorRgb', 'devices.capabilities.color_setting')
        capability = {
          type: base.type,
          instance: base.instance,
          value: (params.value.r << 16) + (params.value.g << 8) + params.value.b,
        }
        break
      }
      case 'colorTem': {
        const base = this.getCapability(accessory, 'colorTemperatureK', 'devices.capabilities.color_setting')
        capability = {
          type: base.type,
          instance: base.instance,
          value: validateRangeValue(base, params.value, params.cmd),
        }
        break
      }
      case 'stateOutlet': {
        // stateOutlet receives 'on'/'off' strings
        const base = this.getCapability(accessory, 'powerSwitch', 'devices.capabilities.on_off')
        capability = {
          type: base.type,
          instance: base.instance,
          value: params.value === 'on' ? 1 : 0,
        }
        break
      }
      case 'stateHumi':
      case 'statePuri':
      case 'stateHeat': {
        // These receive numeric (1/0) or boolean values
        const base = this.getCapability(accessory, 'powerSwitch', 'devices.capabilities.on_off')
        capability = {
          type: base.type,
          instance: base.instance,
          value: params.value ? 1 : 0,
        }
        break
      }
      case 'stateDual': {
        const base = this.getCapability(accessory, 'powerSwitch', 'devices.capabilities.on_off')
        capability = {
          type: base.type,
          instance: base.instance,
          value: params.value,
        }
        break
      }
      case 'lightScene':
      case 'diyScene':
      case 'scene': {
        const instance = params.instance || (params.cmd === 'diyScene' ? 'diyScene' : 'lightScene')
        const base = this.getCapability(accessory, instance, 'devices.capabilities.dynamic_scene')
        let value = params.value

        if (typeof value === 'string') {
          const matched = findOptionByName(base, value)
          if (!matched) {
            throw new Error(`scene not available via OpenAPI [${value}]`)
          }
          value = matched.value
        }

        capability = {
          type: base.type,
          instance: base.instance,
          value,
        }
        break
      }
      case 'openApi': {
        const base = this.getCapability(accessory, params.instance, params.capabilityType || 'devices.capabilities.work_mode')
        capability = {
          type: base.type,
          instance: base.instance,
          value: params.value,
        }
        break
      }
      default:
        throw new Error(`command not supported via OpenAPI [${params.cmd}]`)
    }

    return capability
  }

  async updateDevice(accessory, params) {
    const capability = this.buildCapabilityPayload(accessory, params)

    await this.request({
      method: 'post',
      path: '/router/api/v1/device/control',
      data: {
        requestId: `hb-control-${Date.now()}`,
        payload: {
          sku: accessory.context.gvModel,
          device: accessory.context.gvDeviceId,
          capability,
        },
      },
    })
  }

  async connectMQTT() {
    if (this.mqttClient) {
      return
    }

    const topic = `GA/${this.apiKey}`

    try {
      this.mqttClient = await mqtt.connectAsync('mqtts://mqtt.openapi.govee.com:8883', {
        username: this.apiKey,
        password: this.apiKey,
        reconnectPeriod: 5000,
        connectTimeout: 30000,
      })

      this.mqttClient.on('close', () => {
        this.log.debug('[OPENAPI MQTT] connection closed.')
        this.mqttConnected = false
      })

      this.mqttClient.on('reconnect', () => {
        this.log.debug('[OPENAPI MQTT] reconnecting...')
      })

      this.mqttClient.on('offline', () => {
        this.log.debug('[OPENAPI MQTT] offline.')
        this.mqttConnected = false
      })

      this.mqttClient.on('error', (err) => {
        this.log.debug('[OPENAPI MQTT] error: %s.', parseError(err))
        this.mqttConnected = false
      })

      this.mqttClient.on('message', (receivedTopic, payload) => {
        try {
          const message = JSON.parse(payload.toString())
          this.log.debug('[OPENAPI MQTT] message: %s', JSON.stringify(message))

          if (!message?.device || !Array.isArray(message?.capabilities)) {
            return
          }

          // Normalize capabilities into state format matching getState() output
          const normalized = {}
          message.capabilities.forEach((capability) => {
            const value = getCapabilityValue(capability)
            switch (capability?.instance) {
              case 'bodyAppearedEvent':
                normalized.leakDetected = !(Number(value) - 1)
                break
              case 'online':
                normalized.online = !!value
                break
              case 'powerSwitch':
                normalized.onOff = Number(value)
                break
              case 'brightness':
                normalized.brightness = Number(value)
                break
              case 'colorRgb': {
                const rgb = intToRgb(value)
                if (rgb) {
                  normalized.color = rgb
                }
                break
              }
              case 'colorTemperatureK':
                if (Number.isFinite(Number(value)) && Number(value) > 0) {
                  normalized.colorTemInKelvin = Number(value)
                }
                break
              case 'workMode':
                normalized.workMode = value
                break
              case 'sensorTemperature':
                normalized.sensorTemperature = Number(value)
                break
              case 'sensorHumidity':
                normalized.sensorHumidity = Number(value)
                break
              case 'humidity':
                normalized.targetHumidity = Number(value)
                break
              case 'targetTemperature':
              case 'sliderTemperature':
                normalized.targetTemperature = value
                break
              default:
                if (capability?.instance?.endsWith('Toggle')) {
                  normalized.toggles = normalized.toggles || {}
                  normalized.toggles[capability.instance] = Number(value) === 1
                }
                break
            }
          })

          if (Object.keys(normalized).length > 0) {
            this.platform.receiveUpdateOpenAPI(message.device, normalized)
          }
        } catch (err) {
          this.log.debug('[OPENAPI MQTT] failed to parse message: %s.', parseError(err))
        }
      })

      await this.mqttClient.subscribeAsync(topic)
      this.mqttConnected = true
      this.log('[OPENAPI MQTT] connected and subscribed to %s.', topic)
    } catch (err) {
      this.log.warn('[OPENAPI MQTT] failed to connect: %s.', parseError(err))
      this.mqttClient = null
      this.mqttConnected = false
    }
  }

  async disconnectMQTT() {
    if (this.mqttClient) {
      try {
        await this.mqttClient.endAsync()
      } catch {
        // Ignore errors during shutdown
      }
      this.mqttClient = null
      this.mqttConnected = false
    }
  }
}
