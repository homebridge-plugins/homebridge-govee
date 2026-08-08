import deviceTypes from '../device/index.js'
import platformConsts from './constants.js'

/**
 * Works out which handler a device should get.
 *
 * This used to be a long chain of `else if` inside the platform, which meant
 * adding a device type involved editing the file that also does config parsing,
 * discovery and connection setup. It is a table now, read top to bottom, so a
 * new type is a row.
 *
 * Only the choice lives here. Creating the accessory stays with the platform,
 * because that talks to Homebridge - so this returns what to build rather than
 * building it, and can be tested on its own.
 */

/**
 * How a model list picks its handler.
 *
 * - `handler`  one handler for every model in the list
 * - `prefix`   look for a handler named after the model, eg `deviceFanH7100`
 * - `fallback` used when `prefix` finds nothing, so a model nobody has worked
 *              out still gets power rather than being left unsupported
 * - `choose`   for the few lists where the answer depends on the device or the
 *              owner's settings
 * - `awsPolling` these devices need their status asking for over AWS. Either a
 *   boolean for every model in the list, or a function of the same args as
 *   `choose`, for a list where only some models need it.
 */
const routes = [
  {
    list: 'rgb',
    choose: ({ deviceConf }) => (deviceConf.showAs === 'switch' ? 'deviceLightSwitch' : 'deviceLight'),
    // A light segment layout means this model's zone data only ever arrives
    // in reply to a full AWS status request - LAN never carries it. Every
    // other light gets everything it needs from LAN polling, so only these
    // need the extra AWS traffic
    awsPolling: ({ device }) => Boolean(platformConsts.zoneLightModels[device.model]),
  },
  { list: 'switchSingle', choose: chooseSingleSwitch },
  {
    list: 'switchDouble',
    choose: ({ deviceConf }) => (showAs(deviceConf) === 'switch' ? 'deviceSwitchDouble' : 'deviceOutletDouble'),
  },
  {
    list: 'switchTriple',
    choose: ({ deviceConf }) => (showAs(deviceConf) === 'switch' ? 'deviceSwitchTriple' : 'deviceOutletTriple'),
  },
  { list: 'sensorLeak', handler: 'deviceSensorLeak' },
  { list: 'sensorPresence', handler: 'deviceSensorPresence' },
  {
    list: 'sensorThermo',
    choose: ({ deviceConf }) => (deviceConf.showExtraSwitch ? 'deviceSensorThermoSwitch' : 'deviceSensorThermo'),
  },
  { list: 'composter', handler: 'deviceComposterBasic', awsPolling: true },
  { list: 'sensorProbe', handler: 'deviceSensorProbe' },
  { list: 'sensorMonitor', handler: 'deviceSensorMonitor', awsPolling: true },
  { list: 'sensorCO2', handler: 'deviceSensorCO2', awsPolling: true },
  { list: 'fan', prefix: 'deviceFan', fallback: 'deviceFanBasic' },
  { list: 'heater1', choose: chooseHeater, awsPolling: true },
  { list: 'heater2', handler: 'deviceHeater2', awsPolling: true },
  { list: 'humidifier', prefix: 'deviceHumidifier', fallback: 'deviceHumidifierBasic', awsPolling: true },
  { list: 'dehumidifier', prefix: 'deviceDehumidifier', fallback: 'deviceDehumidifierBasic', awsPolling: true },
  { list: 'purifier', prefix: 'devicePurifier', fallback: 'devicePurifierBasic', awsPolling: true },
  { list: 'diffuser', prefix: 'deviceDiffuser', fallback: 'deviceDiffuserBasic', awsPolling: true },
  { list: 'sensorButton', handler: 'deviceSensorButton' },
  { list: 'sensorContact', handler: 'deviceSensorContact' },
  { list: 'sensorUnknown', handler: 'deviceSensorBasic' },
  { list: 'kettle', handler: 'deviceKettle' },
  { list: 'iceMaker', prefix: 'deviceIceMaker', fallback: 'deviceIceMakerBasic' },
  { list: 'template', handler: 'deviceTemplate' },
]

function showAs(deviceConf) {
  return deviceConf.showAs || platformConsts.defaultValues.showAs
}

/**
 * A single socket can be shown as all sorts of things, because people use them
 * for all sorts of things. Three of those are televisions, which Homebridge has
 * to publish as their own accessory rather than as a tile on the bridge.
 */
function chooseSingleSwitch({ deviceConf }) {
  switch (showAs(deviceConf)) {
    case 'audio':
      return { handler: 'deviceTVSingle', externalCategory: 34 }
    case 'box':
      return { handler: 'deviceTVSingle', externalCategory: 35 }
    case 'stick':
      return { handler: 'deviceTVSingle', externalCategory: 36 }
    case 'cooler':
      // Standing in for a cooler means reading a temperature from somewhere
      // else, and without that there is nothing to show
      return deviceConf.temperatureSource
        ? { handler: 'deviceCoolerSingle' }
        : { skip: 'needsTemperatureSource' }
    case 'heater':
      return deviceConf.temperatureSource
        ? { handler: 'deviceHeater2Single' }
        : { skip: 'needsTemperatureSource' }
    case 'purifier':
      return 'devicePurifierSingle'
    case 'switch':
      return 'deviceSwitchSingle'
    case 'tap':
      return 'deviceTapSingle'
    case 'valve':
      return 'deviceValveSingle'
    default:
      return 'deviceOutletSingle'
  }
}

/**
 * Some of these heaters report the room temperature and some do not, and the
 * two need different tiles - a plain fan against a heater with a temperature
 * readout. Rather than leave the owner to work that out and tick a box, take
 * Govee's own word for it where the device says so, and otherwise use what a
 * previous run learnt from the readings themselves. An owner who has already
 * set the option still wins, so nobody's tile changes under them.
 */
function chooseHeater({ device, deviceConf, cachedContext }) {
  const reportsTemperature = device.openApiInfo?.byInstance?.sensorTemperature
    ? true
    : cachedContext?.supportsAmbientTemp
  return (deviceConf.tempReporting ?? reportsTemperature)
    ? 'deviceHeater1B'
    : 'deviceHeater1A'
}

function normalise(answer) {
  return typeof answer === 'string' ? { handler: answer } : answer
}

/**
 * Decide what to build for a device.
 *
 * @param {object} device the device as Govee describes it
 * @param {object} [deviceConf] this device's settings
 * @param {object} [cachedContext] the context of the accessory from a previous
 *   run, where there is one - some choices depend on what was learnt before
 * @returns {object|null} `{ handler, handlerKey, awsPolling, externalCategory,
 *   skip }`, or null when the model is not one we handle
 */
export function resolveDeviceType(device, deviceConf = {}, cachedContext = undefined) {
  const route = routes.find(entry => platformConsts.models[entry.list]?.includes(device.model))
  if (!route) {
    return null
  }

  const chosen = route.choose
    ? normalise(route.choose({ device, deviceConf, cachedContext }))
    : { handler: route.handler ?? (deviceTypes[`${route.prefix}${device.model}`] ? `${route.prefix}${device.model}` : route.fallback) }

  if (chosen.skip) {
    return { skip: chosen.skip, list: route.list }
  }

  const awsPolling = typeof route.awsPolling === 'function'
    ? route.awsPolling({ device, deviceConf, cachedContext })
    : !!route.awsPolling

  return {
    list: route.list,
    handlerKey: chosen.handler,
    handler: deviceTypes[chosen.handler],
    awsPolling,
    externalCategory: chosen.externalCategory,
  }
}

export { routes }
