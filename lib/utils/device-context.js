import platformConsts from './constants.js'
import { getDeviceCapabilities } from './device-capabilities.js'
import { hasProperty } from './functions.js'
import platformLang from './lang-en.js'

/**
 * Fills in everything a handler needs to know about a device before it is
 * built: which connections are available, what firmware it reports, the limits
 * it works within, and what Govee's api says it can do.
 *
 * Lifted out of the platform unchanged. It is data assembly rather than
 * anything to do with Homebridge, and it was making the one method that sets a
 * device up twice as long as it needed to be.
 *
 * @param {object} platform the platform, for logging and settings
 * @param {object} accessory the accessory being set up
 * @param {object} device the device as Govee describes it
 * @param {object} deviceConf this device's settings
 * @param {object} joins where to record the connections this device can use -
 *   `awsDevices`, `awsDevicesToPoll`, and whether this kind of device needs its
 *   status asking for over AWS
 */
export function applyDeviceContext(platform, accessory, device, deviceConf, joins) {
  const { awsDevices, awsDevicesToPoll, doAWSPolling } = joins
  // Add the temperatureSource config to the context if exists
  if (deviceConf.temperatureSource) {
    accessory.context.temperatureSource = deviceConf.temperatureSource
  }

  // Add the openApiTempUnit config to the context if set to something other than auto
  if (deviceConf.openApiTempUnit && deviceConf.openApiTempUnit !== 'auto') {
    accessory.context.openApiTempUnit = deviceConf.openApiTempUnit
  } else {
    delete accessory.context.openApiTempUnit
  }

  // Get a supported command list if provided, with their options
  if (device.supportCmds && Array.isArray(device.supportCmds)) {
    accessory.context.supportedCmds = device.supportCmds
    accessory.context.supportedCmdsOpts = {}

    device.supportCmds.forEach((cmd) => {
      if (device?.properties?.[cmd]) {
        accessory.context.supportedCmdsOpts[cmd] = device.properties[cmd]
      }
    })
  }

  // Add some initial context information which is changed later
  accessory.context.hasAwsControl = false
  accessory.context.useAwsControl = false
  accessory.context.hasOpenApiControl = false
  accessory.context.useOpenApiControl = false
  accessory.context.hasBleControl = false
  accessory.context.useBleControl = false
  accessory.context.hasLanControl = device.isLanDevice
  accessory.context.useLanControl = accessory.context.hasLanControl
  accessory.context.firmware = false
  accessory.context.hardware = false
  accessory.context.image = false

  // Overrides for when a custom IP is provided, for a light which is not BLE only
  if (
    deviceConf.customIPAddress
    && accessory.context.hasLanControl
    && accessory.context.hasAwsControl
    && platformConsts.models.rgb.includes(device.model)
  ) {
    accessory.context.hasLanControl = true
    accessory.context.useLanControl = true
  }

  // Keep the name in step with Govee - or, for a LAN-only device, with the
  // label in the configuration.
  //
  // ⚠️ This used to run for LAN-only devices only, so every other device kept
  // whatever name it was discovered under, forever. A name HAP complains about
  // (brackets, say) could then not be cleared without deleting the cached
  // accessory and losing its room and automations (#1344).
  //
  // ⚠️ This does NOT rename anything in the Home app. HomeKit fixes the name a
  // user sees when the accessory is first added, and a rename made there never
  // comes back to us either. What this fixes is the name Homebridge itself
  // shows and, through the Name characteristic, the HAP warning.
  //
  // `updateDisplayName` is the supported way to do it - assigning to
  // `displayName` sets only Homebridge's copy and leaves the HAP accessory
  // behind. It arrived in Homebridge v1.10.0, and this plugin still supports
  // ^1.6.0, hence the check.
  if (device.deviceName && accessory.displayName !== device.deviceName) {
    platform.log('[%s] %s [%s].', accessory.displayName, platformLang.devRenamed, device.deviceName)

    if (typeof accessory.updateDisplayName === 'function') {
      accessory.updateDisplayName(device.deviceName)
    } else {
      accessory.displayName = device.deviceName
    }

    const hapChar = platform.api?.hap?.Characteristic
    const infoService = accessory.getService?.(platform.api?.hap?.Service?.AccessoryInformation)
    if (hapChar && infoService) {
      infoService.updateCharacteristic(hapChar.Name, device.deviceName)
      infoService.updateCharacteristic(hapChar.ConfiguredName, device.deviceName)
    }
  }

  // See if we have extra HTTP client info for this device
  if (device.httpInfo) {
    // Save the hardware and firmware versions
    accessory.context.firmware = device.httpInfo.versionSoft
    accessory.context.hardware = device.httpInfo.versionHard

    // It's possible to show a nice little icon of the device in the Homebridge UI
    if (device.httpInfo.deviceExt && device.httpInfo.deviceExt.extResources) {
      try {
        const parsed = JSON.parse(device.httpInfo.deviceExt.extResources)
        if (parsed && parsed.skuUrl) {
          accessory.context.image = parsed.skuUrl
        }
      } catch {
        // Ignore malformed extResources
      }
    }

    // HTTP info lets us see if AWS/BLE connection methods are available
    if (device.httpInfo.deviceExt && device.httpInfo.deviceExt.deviceSettings) {
      let parsed
      try {
        parsed = JSON.parse(device.httpInfo.deviceExt.deviceSettings)
      } catch {
        platform.log.debugWarn('[%s] failed to parse deviceSettings, skipping AWS/BLE setup.', accessory.displayName)
      }

      // Check to see if AWS is possible
      if (parsed) {
        if (parsed.topic) {
          accessory.context.hasAwsControl = true
          accessory.context.awsTopic = parsed.topic

          if (platform.awsClient) {
            accessory.context.useAwsControl = true
            accessory.context.awsBrightnessNoScale = deviceConf.awsBrightnessNoScale
            accessory.context.awsColourMode = deviceConf.awsColourMode || platformConsts.defaultValues.awsColourMode
            awsDevices.push(device.device)

            // Certain models need AWS polling
            if (doAWSPolling) {
              awsDevicesToPoll.push(device.device)
            }
          }
        }

        // Check to see if BLE is possible
        if (parsed.bleName) {
          const providedBle = parsed.address ? parsed.address.toLowerCase() : device.device.substring(6).toLowerCase()
          accessory.context.hasBleControl = !!parsed.bleName
          accessory.context.bleAddress = deviceConf.customAddress
            ? deviceConf.customAddress.toLowerCase()
            : providedBle
          accessory.context.bleName = parsed.bleName
          accessory.context.bleWriteUuid = getDeviceCapabilities(accessory.context.gvModel).bleWriteUuid
          if (platform.bleClient) {
            accessory.context.useBleControl = true
          }
        }

        // Gateway subdevices (e.g. leak sensors paired to an H5044) include
        // their gateway id and slot number, which we need to match real-time
        // leak events relayed by the gateway over AWS (#1276)
        if (hasProperty(parsed, 'sno') && parsed.gatewayInfo?.device) {
          accessory.context.gatewaySno = parsed.sno
          accessory.context.gatewayDevice = parsed.gatewayInfo.device
        }

        // Get a min and max temperature/humidity range to show in the homebridge-ui
        if (hasProperty(parsed, 'temCali')) {
          accessory.context.minTemp = parsed.temMin / 100
          accessory.context.maxTemp = parsed.temMax / 100
          accessory.context.offTemp = parsed.temCali
        }
        if (hasProperty(parsed, 'humCali')) {
          accessory.context.minHumi = parsed.humMin / 100
          accessory.context.maxHumi = parsed.humMax / 100
          accessory.context.offHumi = parsed.humCali
        }
      }
    }
  }

  if (device.openApiInfo) {
    accessory.context.hasOpenApiControl = true
    accessory.context.useOpenApiControl = !!platform.openApiClient
    accessory.context.openApiCapabilities = device.openApiInfo.byInstance || {}

    // Log what Govee says this device can do. Working out whether a model
    // exposes something like a night light otherwise means reverse
    // engineering its status messages, when the answer is right here
    const instances = Object.entries(accessory.context.openApiCapabilities)
      .map(([instance, capability]) => `${instance} (${capability?.type ?? 'unknown type'})`)
    platform.log.debug(
      '[%s] openapi category [%s] capabilities [%s].',
      accessory.displayName,
      device.openApiInfo.category || 'unknown',
      instances.join(', ') || 'none',
    )

    // The names alone say a capability exists, not what it accepts. A mode
    // lists its options, a range gives its bounds - and those are the numbers
    // that otherwise have to be guessed from a model's paperwork or asked of
    // its owner, one device support request at a time. So print the lot.
    if (instances.length > 0) {
      platform.log.debug(
        '[%s] openapi capability detail %s.',
        accessory.displayName,
        JSON.stringify(accessory.context.openApiCapabilities),
      )
    }
  }

  // Create the instance for this device type
}
