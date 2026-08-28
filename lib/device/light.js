import {
  hs2rgb,
  k2rgb,
  m2hs,
  rgb2hs,
} from '../utils/colour.js'
import platformConsts from '../utils/constants.js'
import {
  base64ToHex,
  generateCodeFromHexValues,
  generateRandomString,
  getTwoItemPosition,
  hasProperty,
  hexToTwoItems,
  parseError,
  sleep,
} from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'
import GoveeDevice from './base.js'

/**
 * The zone state of a light that reports both of its zones in one frame, as
 * `aa 30 <main> <background>`.
 *
 * Reported under the same capability instances the OpenAPI uses, so zone state
 * reads the same whichever connection carried it. This frame arrives unprompted
 * whenever the zones change, including from the Govee app or the wall switch,
 * which is how the tiles stay right rather than only echoing our own writes -
 * all the toggles could ever manage on these models (#1333).
 *
 * @param {string[]} [commands] the base64 frames from the payload
 * @returns {object} the zones found, keyed by capability instance
 */
function readZoneFrame(commands = []) {
  const zones = {}
  commands.forEach((command) => {
    const hexParts = hexToTwoItems(base64ToHex(command))
    if (`${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}` !== 'aa30') {
      return
    }
    zones.mainLightToggle = getTwoItemPosition(hexParts, 3) === '01'
    zones.backgroundLightToggle = getTwoItemPosition(hexParts, 4) === '01'
  })
  return zones
}

/**
 * The zone on/off state a segmented-capability light reports, as a bitmask in
 * `aa 07 08 <device brightness> <mask>`: bit 1 is the main light, bit 2 the
 * background, and bit 0 is set whenever anything is lit.
 *
 * Derived from the H601F captures in #1223, where the mask read 03 with only
 * the main light on, 05 with only the background on, and 00 with both off -
 * three states that pin all three bits. A future segmented model should have
 * its own frames checked before trusting this shape.
 *
 * @param {string[]} [commands] the base64 frames from the payload
 * @returns {object} the zones found, keyed by capability instance
 */
function readSegmentedZoneStateFrame(commands = []) {
  const zones = {}
  commands.forEach((command) => {
    const hexParts = hexToTwoItems(base64ToHex(command))
    if (`${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}` !== 'aa07') {
      return
    }
    if (getTwoItemPosition(hexParts, 3) !== '08') {
      return
    }
    const mask = Number.parseInt(getTwoItemPosition(hexParts, 5), 16)
    zones.mainLightToggle = (mask & 0x02) !== 0
    zones.backgroundLightToggle = (mask & 0x04) !== 0
  })
  return zones
}

/**
 * The brightness and color a two-zone light reports for every one of its
 * light segments, as `aa a5 <page>` followed by four groups of
 * `<level> <r> <g> <b>`.
 *
 * Pages run from 01 and each covers four light segments, so page N describes
 * segments (N-1)*4 upward. A light whose segment count is not a multiple of
 * four pads the last page with zeroes, and those are skipped rather than
 * reported as black segments that do not exist (#1333).
 *
 * @param {string[]} [commands] the base64 frames from the payload
 * @returns {object} what each light segment reported, keyed by segment number
 */
function readLightSegmentFrames(commands = []) {
  const lightSegments = {}
  commands.forEach((command) => {
    const hexParts = hexToTwoItems(base64ToHex(command))
    if (`${getTwoItemPosition(hexParts, 1)}${getTwoItemPosition(hexParts, 2)}` !== 'aaa5') {
      return
    }
    const page = Number.parseInt(getTwoItemPosition(hexParts, 3), 16)
    for (let group = 0; group < 4; group += 1) {
      const at = 4 + (group * 4)
      const level = Number.parseInt(getTwoItemPosition(hexParts, at), 16)
      const r = Number.parseInt(getTwoItemPosition(hexParts, at + 1), 16)
      const g = Number.parseInt(getTwoItemPosition(hexParts, at + 2), 16)
      const b = Number.parseInt(getTwoItemPosition(hexParts, at + 3), 16)
      if (level === 0 && r === 0 && g === 0 && b === 0) {
        continue
      }
      lightSegments[((page - 1) * 4) + group] = { level, r, g, b }
    }
  })
  return lightSegments
}

/**
 * The two zones a light of this kind has. Fixed, unlike which light segments
 * each one owns, which varies by model - see `zoneLightModels` in constants.js.
 */
const ZONE_DEFS = [
  { instance: 'mainLightToggle', zone: 'main', name: 'Main Light' },
  { instance: 'backgroundLightToggle', zone: 'background', name: 'Background Light' },
]

/**
 * Real HAP's AdaptiveLightingController adds these three characteristics to
 * the service it attaches to. When adaptive lighting has just been switched
 * off, only these need to go - the whole Lightbulb service used to be thrown
 * away and rebuilt here, which does hide the icon but presents Home with what
 * looks like a different light, and an owner can lose that light's room and
 * its automations as a result.
 *
 * @param {object} service the HAP service to remove the characteristics from
 * @param {object} hapChar the platform's Characteristic lookup
 */
function clearAdaptiveLightingCharacteristics(service, hapChar) {
  [
    'SupportedCharacteristicValueTransitionConfiguration',
    'CharacteristicValueTransitionControl',
    'CharacteristicValueActiveTransitionCount',
  ].forEach((charName) => {
    const char = hapChar[charName]
    if (char && service.testCharacteristic(char)) {
      service.removeCharacteristic(service.getCharacteristic(char))
    }
  })
}

export default class extends GoveeDevice {
  constructor(platform, accessory) {
    super(platform, accessory)

    // Set up variables from the platform
    this.cusChar = platform.cusChar

    // Set up variables from the accessory
    this.colourSafeMode = platform.config.colourSafeMode
    this.minKelvin = accessory.context?.supportedCmdsOpts?.colorTem?.range?.min || 2000
    this.maxKelvin = accessory.context?.supportedCmdsOpts?.colorTem?.range?.max || 9000
    this.isBLEOnly = !accessory.context.useAwsControl && !accessory.context.useLanControl && !accessory.context.useOpenApiControl

    // Set up custom variables for this device type
    const deviceConf = platform.deviceConf[accessory.context.gvDeviceId] || {}
    this.alShift = deviceConf.adaptiveLightingShift || platformConsts.defaultValues.adaptiveLightingShift
    this.brightStep = deviceConf.brightnessStep
      ? Math.min(deviceConf.brightnessStep, 100)
      : platformConsts.defaultValues.brightnessStep

    // Remove any switch service if it exists
    if (accessory.getService(this.hapServ.Switch)) {
      accessory.removeService(accessory.getService(this.hapServ.Switch))
    }

    // Add the main lightbulb service if it doesn't already exist
    this.service = this.accessory.getService(this.hapServ.Lightbulb)
      || this.accessory.addService(this.hapServ.Lightbulb)

    // Adaptive lighting has just been switched off, so take away the three
    // characteristics that make Home offer it. Only these need to go: the whole
    // Lightbulb service used to be thrown away and rebuilt here, which does hide
    // the icon but presents Home with what looks like a different light, and an
    // owner can lose that light's room and its automations as a result.
    if ((this.colourSafeMode || this.alShift === -1) && this.accessory.context.adaptiveLighting) {
      clearAdaptiveLightingCharacteristics(this.service, this.hapChar)
      this.accessory.context.adaptiveLighting = false
    }

    // Setup custom characteristics for different scenes and modes
    this.usedCodes = [];

    [
      'DiyMode',
      'DiyModeTwo',
      'DiyModeThree',
      'DiyModeFour',
      'MusicMode',
      'MusicModeTwo',
      'Scene',
      'SceneTwo',
      'SceneThree',
      'SceneFour',
      'Segmented',
      'SegmentedTwo',
      'SegmentedThree',
      'SegmentedFour',
      'VideoMode',
      'VideoModeTwo',
    ].forEach((charName) => {
      const confName = charName.charAt(0).toLowerCase() + charName.slice(1)
      const confCode = deviceConf[confName]

      // Check if any code has been entered in the config by the user
      if (confCode?.sceneCode) {
        const { bleCode, sceneCode } = confCode

        // Add to the global enabled scenes list
        this.usedCodes.push(charName)

        // Add the characteristic if not already
        if (confCode?.showAs === 'switch') {
          // Remove the Eve switch if exists
          if (this.service.testCharacteristic(this.cusChar[charName])) {
            this.service.removeCharacteristic(this.service.getCharacteristic(this.cusChar[charName]))
          }

          // Add the accessory service switch
          if (!this.accessory.getService(charName)) {
            this.accessory.addService(this.hapServ.Switch, charName, charName)
          }

          // Add the set handler and also mark all as off when initialising accessory
          this.accessory.getService(charName)
            .getCharacteristic(this.hapChar.On)
            .onSet(async (value) => {
              await this.internalSceneUpdate(charName, sceneCode, bleCode, value, true)
            })
            .updateValue(false)
        } else {
          // Remove the accessory service switch if exists
          if (this.accessory.getService(charName)) {
            this.accessory.removeService(this.accessory.getService(charName))
          }

          // Add the Eve switch
          if (!this.service.testCharacteristic(this.cusChar[charName])) {
            this.service.addCharacteristic(this.cusChar[charName])
          }

          // Add the set handler and also mark all as off when initialising accessory
          this.service
            .getCharacteristic(this.cusChar[charName])
            .onSet(async (value) => {
              await this.internalSceneUpdate(charName, sceneCode, bleCode, value)
            })
            .updateValue(false)
        }
      } else {
        // If here then either code is invalid or has been removed, so remove the characteristic

        if (this.service.testCharacteristic(this.cusChar[charName])) {
          this.service.removeCharacteristic(this.service.getCharacteristic(this.cusChar[charName]))
        }
      }
    })

    this.hasScenes = this.usedCodes.length > 0

    // Add the colour mode characteristic if at least one other scene/mode is exposed
    if (this.hasScenes) {
      // Add the colour mode characteristic if not already
      if (!this.service.testCharacteristic(this.cusChar.ColourMode)) {
        this.service.addCharacteristic(this.cusChar.ColourMode)
      }

      // Add the set handler and also mark as off when initialising accessory
      this.service
        .getCharacteristic(this.cusChar.ColourMode)
        .onSet(async (value) => {
          if (value) {
            await this.internalColourUpdate(this.cacheHue, true)
          }
        })
        .updateValue(false)
    } else if (this.service.testCharacteristic(this.cusChar.ColourMode)) {
      // Remove the characteristic if it exists already (no need for it)
      this.service.removeCharacteristic(this.service.getCharacteristic(this.cusChar.ColourMode))
    }

    // Add the set handler to the lightbulb on/off characteristic
    this.service.getCharacteristic(this.hapChar.On).onSet(async (value) => {
      await this.internalStateUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.On).value ? 'on' : 'off'

    // Add the set handler to the lightbulb brightness characteristic
    this.service
      .getCharacteristic(this.hapChar.Brightness)
      .setProps({ minStep: this.brightStep })
      .onSet(async (value) => {
        await this.internalBrightnessUpdate(value)
      })
    this.cacheBright = this.service.getCharacteristic(this.hapChar.Brightness).value
    this.cacheBrightRaw = this.cacheBright

    // Add the set handler to the lightbulb hue characteristic
    this.service.getCharacteristic(this.hapChar.Hue).onSet(async (value) => {
      await this.internalColourUpdate(value)
    })
    // Saturation needs a handler of its own. HomeKit writes hue and saturation
    // separately, so with only hue listened for, dragging saturation alone -
    // the same colour made paler or richer - reached nothing at all. Both
    // handlers share one update, and the debounce inside it collapses a
    // hue-and-saturation pair into a single command.
    this.service.getCharacteristic(this.hapChar.Saturation).onSet(async () => {
      await this.internalColourUpdate(this.service.getCharacteristic(this.hapChar.Hue).value)
    })
    this.cacheHue = this.service.getCharacteristic(this.hapChar.Hue).value
    this.cacheSat = this.service.getCharacteristic(this.hapChar.Saturation).value

    // Add the set handler to the lightbulb cct characteristic
    if (this.colourSafeMode) {
      if (this.service.testCharacteristic(this.hapChar.ColorTemperature)) {
        this.service.removeCharacteristic(this.service.getCharacteristic(this.hapChar.ColorTemperature))
      }
      this.cacheMired = 0
    } else {
      this.service.getCharacteristic(this.hapChar.ColorTemperature).onSet(async (value) => {
        await this.internalCTUpdate(value)
      })
      this.cacheMired = this.service.getCharacteristic(this.hapChar.ColorTemperature).value
    }

    // Set up the adaptive lighting controller if not disabled by user
    if (!this.colourSafeMode && this.alShift !== -1) {
      this.alController = new platform.api.hap.AdaptiveLightingController(this.service, {
        customTemperatureAdjustment: this.alShift,
      })
      this.accessory.configureController(this.alController)
      this.accessory.context.adaptiveLighting = true
    }

    // Some lights (e.g. the H1270 Ceiling Light Ultra) have two independently
    // controllable zones - a main/bottom panel and a background/top light. Govee
    // exposes these as OpenAPI toggle capabilities, so add a lightbulb for each
    // zone the device reports, controlled over the OpenAPI connection.
    //
    // The models in `zoneLightModels` advertise those same capabilities but the
    // cloud never delivers them, so they are driven by a raw frame over AWS
    // instead - and only those models can address a zone's brightness and
    // color, since the raw frame reaches light segments the OpenAPI toggle
    // capabilities never could. Either way the tile itself, its state and how
    // a failure is undone are the same (#1333)
    this.zoneServices = {}
    this.zoneCache = {}
    // "light segments" to avoid any confusion with the unrelated
    // segmented/segmentedTwo/segmentedThree/segmentedFour config options
    // elsewhere in this file, which name a captured scene or BLE code
    this.zoneLightSegments = platformConsts.zoneLightModels[accessory.context.gvModel]
    this.hasRawZones = Boolean(this.zoneLightSegments)
    // Models with no raw zone frame but whose cloud genuinely delivers the
    // segmented capabilities get their zones over the OpenAPI instead (#1223)
    if (!this.hasRawZones) {
      this.zoneLightSegments = platformConsts.segmentedZoneModels[accessory.context.gvModel]
      this.hasSegmentedZones = Boolean(this.zoneLightSegments)
    }
    this.zoneBrightCache = {}
    this.zoneColourCache = {}
    this.zoneMiredCache = {}
    this.zoneKelvinCache = {}
    this.zoneUpdateKey = {}
    this.zoneAlControllers = {}
    const openApiCaps = accessory.context.openApiCapabilities || {}
    ZONE_DEFS.forEach(({ instance, zone, name }) => {
      // A real HAP Service has no `.type` - only `.UUID`, `.subtype` and
      // `.displayName` - so getServiceById is the correct way to ask "does this
      // zone's lightbulb already exist", matching by type AND subtype rather
      // than by name. Falling back to a name lookup only when that comes up
      // empty catches a service under this name that ISN'T this lightbulb,
      // which can only be the tile's previous Switch, since HomeKit cannot
      // change a service's type in place
      const existingLightbulb = this.accessory.getServiceById(this.hapServ.Lightbulb, instance)
      let existingService = existingLightbulb || this.accessory.getService(name)

      // The raw frame goes over AWS, which needs Govee account credentials
      // rather than just an API key. For raw-zone models, also require this
      // particular zone to have a measured light segment layout - a model
      // whose config only defines one of its two zones should not offer a
      // tile for the other one, since every raw-zone handler indexes
      // zoneLightSegments[zone] and would throw at tap time on a real device
      // rather than at startup
      let isControllable
      if (this.hasRawZones) {
        isControllable = accessory.context.useAwsControl && Boolean(this.zoneLightSegments[zone])
      } else if (this.hasSegmentedZones) {
        // The segmented capabilities need an API key, and the zone needs a
        // segment layout - same reasoning as the raw-zone guard above
        isControllable = accessory.context.useOpenApiControl
          && Boolean(openApiCaps.segmentedBrightness)
          && Boolean(this.zoneLightSegments[zone])
      } else {
        isControllable = accessory.context.useOpenApiControl && openApiCaps[instance]
      }

      if (isControllable) {
        // That name-matched fallback is stale (the old Switch) whenever it
        // isn't the lightbulb itself - clear it out before the lightbulb can
        // take the name, otherwise the tile is stuck with On and nothing
        // else, and no amount of adding characteristics will fix it
        if (existingService && existingService !== existingLightbulb) {
          this.accessory.removeService(existingService)
          existingService = undefined
        }

        const service = existingService
          || this.accessory.addService(this.hapServ.Lightbulb, name, instance)
        service
          .getCharacteristic(this.hapChar.On)
          .onSet(async value => this.internalZoneUpdate(instance, zone, name, value))

        // Only the raw-frame and segmented-capability models can address a
        // zone's brightness and color. The models whose toggles work have
        // on/off and nothing else, so giving them sliders would be a control
        // that silently does nothing - which is the bug this whole path
        // exists to avoid (#1333)
        if (this.hasRawZones || this.hasSegmentedZones) {
          // Adaptive lighting characteristics are added to a service by real
          // HAP's AdaptiveLightingController when it attaches, not by this
          // file, so they can only be sitting on a zone service left over from
          // an earlier boot that had a controller here. Zones have no
          // equivalent of `accessory.context.adaptiveLighting` above - that
          // flag exists purely to remember, for the MAIN light, that this
          // block already ran once so it does not repeat needlessly. A zone's
          // controller is fully re-derived from colourSafeMode/alShift on
          // every boot regardless (see below), so there is nothing to
          // remember here: checking those two directly is enough to know
          // whether this boot's controller state has changed from the last
          if (this.colourSafeMode || this.alShift === -1) {
            clearAdaptiveLightingCharacteristics(service, this.hapChar)
          }

          service
            .getCharacteristic(this.hapChar.Brightness)
            .setProps({ minStep: this.brightStep })
            .onSet(async value => this.internalZoneBrightnessUpdate(instance, zone, name, value))
          service
            .getCharacteristic(this.hapChar.Hue)
            .onSet(async value => this.internalZoneColourUpdate(instance, zone, name, value))
          service.getCharacteristic(this.hapChar.Saturation)
          this.zoneBrightCache[instance] = service.getCharacteristic(this.hapChar.Brightness).value

          // Seed this now, not just on the first write or status report. An
          // unseeded cache would make externalUpdate's "did this change
          // elsewhere" check treat the very first report after every restart
          // as an external change - switching adaptive lighting off before
          // anything has actually changed
          const seedHue = service.getCharacteristic(this.hapChar.Hue).value
          const seedSat = service.getCharacteristic(this.hapChar.Saturation).value
          const [seedR, seedG, seedB] = hs2rgb(seedHue, seedSat)
          this.zoneColourCache[instance] = {
            r: seedR,
            g: seedG,
            b: seedB,
            hue: seedHue,
            sat: seedSat,
          }

          // Adaptive lighting needs Brightness and ColorTemperature on the same
          // service, so a zone that is to have it needs its own color
          // temperature control. The zone only takes rgb on the wire, so a
          // temperature is converted on the way out - the same thing the
          // bluetooth path already does for every other light
          if (this.colourSafeMode) {
            if (service.testCharacteristic(this.hapChar.ColorTemperature)) {
              service.removeCharacteristic(service.getCharacteristic(this.hapChar.ColorTemperature))
            }
            this.zoneMiredCache[instance] = 0
            this.zoneKelvinCache[instance] = 0
          } else {
            service
              .getCharacteristic(this.hapChar.ColorTemperature)
              .onSet(async value => this.internalZoneCTUpdate(instance, zone, name, value))
            this.zoneMiredCache[instance] = service.getCharacteristic(this.hapChar.ColorTemperature).value

            // Seeded the same way as the mired cache above, so the first real
            // adaptive lighting tick after a restart is compared against what
            // was actually last sent, not against nothing
            const seedMired = this.zoneMiredCache[instance]
            const seedKelvin = Math.round(1000000 / seedMired / 100) * 100
            this.zoneKelvinCache[instance] = Math.min(Math.max(seedKelvin, this.minKelvin), this.maxKelvin)

            // One controller per zone. The id is derived from the service, so
            // these sit alongside the main light's rather than clashing with it
            if (this.alShift !== -1) {
              this.zoneAlControllers[instance] = new platform.api.hap.AdaptiveLightingController(service, {
                customTemperatureAdjustment: this.alShift,
              })
              this.accessory.configureController(this.zoneAlControllers[instance])
            }
          }
        }

        this.zoneServices[instance] = service
        this.zoneCache[instance] = service.getCharacteristic(this.hapChar.On).value ? 1 : 0
      } else if (existingService) {
        // Capability no longer available (or the connection it needs is off) so
        // remove the tile
        this.accessory.removeService(existingService)
      }
    })

    // Withholding the tiles without AWS is deliberate - tiles that swallow taps
    // are worse than none - but silence would leave the owner with no idea the
    // zones exist or what is missing, so say so once at startup
    if (this.hasRawZones && !accessory.context.useAwsControl) {
      this.accessory.log(platformLang.zoneNeedsAws)
    }
    if (this.hasSegmentedZones && !accessory.context.useOpenApiControl) {
      this.accessory.log(platformLang.zoneNeedsApi)
    }

    // Output the customised options to the log
    const useAwsControl = accessory.context.useAwsControl ? 'enabled' : 'disabled'
    const useBleControl = accessory.context.useBleControl ? 'enabled' : 'disabled'
    const useLanControl = accessory.context.useLanControl ? 'enabled' : 'disabled'
    const opts = JSON.stringify({
      adaptiveLightingShift: this.alShift,
      aws: accessory.context.hasAwsControl ? useAwsControl : 'unsupported',
      ble: accessory.context.hasBleControl ? useBleControl : 'unsupported',
      brightnessStep: this.brightStep,
      colourSafeMode: this.colourSafeMode,
      lan: accessory.context.hasLanControl ? useLanControl : 'unsupported',
    })
    platform.log('[%s] %s %s.', accessory.displayName, platformLang.devInitOpts, opts)
    this.initialised = true
  }

  async internalStateUpdate(value) {
    try {
      const newValue = value ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (newValue === this.cacheState) {
        return
      }

      // Send off after colour/brightness (a colour command can implicitly power a
      // bulb back on), but send on straight away so the bulb is awake in time to
      // receive the colour and brightness a HomeKit scene sends alongside it, as
      // some models ignore these commands while switched off (#1277)
      if (newValue === 'off') {
        await sleep(400)
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'state',
        value: newValue,
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')
      })
    }
  }

  async internalZoneUpdate(instance, zone, name, value) {
    const service = this.zoneServices[instance]
    try {
      const newValue = value ? 1 : 0

      // Don't continue if the new value is the same as before
      if (this.zoneCache[instance] === newValue) {
        return
      }

      if (this.hasRawZones) {
        // This model's toggles are accepted and ignored, so send the frame the
        // device itself uses. The command builder leaves lanParams off, so this
        // one skips LAN - which the device ignores - and goes over AWS
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'zoneState',
          zone,
          value: newValue === 1,
        })
      } else if (this.hasSegmentedZones) {
        const toggleIndex = this.zoneLightSegments.awsToggleIndex?.[zone]
        if (this.accessory.context.useAwsControl && toggleIndex !== undefined) {
          // The real per-light frame, where a measured one exists for the
          // model - the official api's only "off" is a segment brightness of
          // zero, which the device clamps to a dim glow rather than off
          await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'ptReal',
            value: generateCodeFromHexValues([0x33, 0x36, toggleIndex, newValue]),
          })
        } else {
          // Official-api fallback: zone on/off through the segmented
          // brightness capability - zero is off (well, dim), and on restores
          // the tile's own last brightness
          await this.platform.sendDeviceUpdate(this.accessory, {
            cmd: 'openApi',
            openApi: {
              instance: 'segmentedBrightness',
              capabilityType: 'devices.capabilities.segment_color_setting',
              value: {
                segment: this.zoneLightSegments[zone],
                brightness: newValue === 1 ? (this.zoneBrightCache[instance] || 100) : 0,
              },
            },
          })
        }
      } else {
        // These toggles are only controllable via the OpenAPI (cloud) connection
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'openApi',
          openApi: {
            instance,
            capabilityType: 'devices.capabilities.toggle',
            value: newValue,
          },
        })
      }

      // Cache the new state and log
      this.zoneCache[instance] = newValue
      this.accessory.log(`[${name}] ${platformLang.curState} [${value ? 'on' : 'off'}]`)
    } catch (err) {
      // Catch any errors during the process
      this.accessory.logWarn(`[${name}] ${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and revert this after 2 seconds
      setTimeout(() => {
        if (service) {
          service.updateCharacteristic(this.hapChar.On, this.zoneCache[instance] === 1)
        }
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  /**
   * Sets one zone's brightness in response to a HomeKit write.
   *
   * @param {string} instance the capability instance, eg 'mainLightToggle'
   * @param {string} zone the key into `this.zoneLightSegments`, eg 'main'
   * @param {string} name the tile's display name, for logging
   * @param {number} value 0-100
   */
  async internalZoneBrightnessUpdate(instance, zone, name, value) {
    const service = this.zoneServices[instance]
    try {
      // HomeKit writes once per position of the slider, so without this a single
      // drag becomes a burst of frames. Same debounce the main light uses
      const updateKey = generateRandomString(5)
      this.zoneUpdateKey[instance] = updateKey
      await sleep(350)
      if (updateKey !== this.zoneUpdateKey[instance]) {
        return
      }

      // Don't continue if the new value is the same as before
      if (this.zoneBrightCache[instance] === value) {
        return
      }

      if (this.hasSegmentedZones) {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'openApi',
          openApi: {
            instance: 'segmentedBrightness',
            capabilityType: 'devices.capabilities.segment_color_setting',
            value: { segment: this.zoneLightSegments[zone], brightness: value },
          },
        })
      } else {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'zoneBrightness',
          lightSegments: this.zoneLightSegments[zone],
          value,
        })
      }

      this.zoneBrightCache[instance] = value
      this.accessory.log(`[${name}] ${platformLang.curBright} [${value}%]`)
    } catch (err) {
      this.accessory.logWarn(`[${name}] ${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and revert this after 2 seconds
      setTimeout(() => {
        if (service) {
          service.updateCharacteristic(this.hapChar.Brightness, this.zoneBrightCache[instance])
        }
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  /**
   * Sets one zone's color in response to a HomeKit hue write. Saturation is
   * read from the tile itself, since HomeKit sends hue and saturation as
   * separate writes.
   *
   * @param {string} instance the capability instance, eg 'mainLightToggle'
   * @param {string} zone the key into `this.zoneLightSegments`, eg 'main'
   * @param {string} name the tile's display name, for logging
   * @param {number} value hue, 0-360
   */
  async internalZoneColourUpdate(instance, zone, name, value) {
    const service = this.zoneServices[instance]
    try {
      // Same debounce as the main light's colour wheel
      const updateKey = generateRandomString(5)
      this.zoneUpdateKey[instance] = updateKey
      await sleep(300)
      if (updateKey !== this.zoneUpdateKey[instance]) {
        return
      }

      // Dropping the cct to its lowest mimics native adaptive lighting, and
      // HAP asks for it on any service carrying both hue/saturation and color
      // temperature. The main light does the same
      if (!this.colourSafeMode) {
        service.updateCharacteristic(this.hapChar.ColorTemperature, 140)
      }

      // Hue and saturation arrive as separate writes, so the other half comes
      // from this tile's own characteristic - not the main light's
      const currentSat = service.getCharacteristic(this.hapChar.Saturation).value
      const [r, g, b] = hs2rgb(value, currentSat)

      // Don't continue if the new value is the same as before
      const cached = this.zoneColourCache[instance]
      if (cached && cached.r === r && cached.g === g && cached.b === b) {
        return
      }

      if (this.hasSegmentedZones) {
        // The official capability takes the colour as one integer
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'openApi',
          openApi: {
            instance: 'segmentedColorRgb',
            capabilityType: 'devices.capabilities.segment_color_setting',
            value: { segment: this.zoneLightSegments[zone], rgb: (r << 16) + (g << 8) + b },
          },
        })
      } else {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'zoneColour',
          lightSegments: this.zoneLightSegments[zone],
          value: { r, g, b },
        })
      }

      this.zoneColourCache[instance] = {
        r,
        g,
        b,
        hue: value,
        sat: currentSat,
      }
      this.accessory.log(`[${name}] ${platformLang.curColour} [rgb ${r} ${g} ${b}]`)
    } catch (err) {
      this.accessory.logWarn(`[${name}] ${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and revert this after 2 seconds
      setTimeout(() => {
        const previous = this.zoneColourCache[instance]
        if (service && previous) {
          service.updateCharacteristic(this.hapChar.Hue, previous.hue)
          service.updateCharacteristic(this.hapChar.Saturation, previous.sat)
        }
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  /**
   * Sets one zone's color temperature. Adaptive lighting calls this on its own
   * schedule; a HomeKit write reaches it the same way.
   *
   * @param {string} instance the capability instance, eg 'mainLightToggle'
   * @param {string} zone the key into `this.zoneLightSegments`, eg 'main'
   * @param {string} name the tile's display name, for logging
   * @param {number} value mireds
   */
  async internalZoneCTUpdate(instance, zone, name, value) {
    const service = this.zoneServices[instance]
    try {
      // Adaptive lighting writes here every sixty seconds, so this is debounced
      // exactly as the main light's color temperature is
      const updateKey = generateRandomString(5)
      this.zoneUpdateKey[instance] = updateKey
      await sleep(300)
      if (updateKey !== this.zoneUpdateKey[instance]) {
        return
      }

      // Convert mired to kelvin to nearest 100, the same rounding the main
      // light uses. Adaptive lighting nudges mired by fractional amounts far
      // more often than the rounded kelvin actually changes, so comparing the
      // rounded value below - not raw mired - is what keeps a real command
      // from going out on almost every adaptive lighting tick
      const kelvin = Math.round(1000000 / value / 100) * 100
      const k = Math.min(Math.max(kelvin, this.minKelvin), this.maxKelvin)

      // Don't continue if the rounded kelvin is the same as before
      if (this.zoneKelvinCache[instance] === k) {
        return
      }

      // Updating hue/sat to the corresponding values mimics native adaptive
      // lighting - the main light's own color temperature handler does the same
      const [hue, sat] = m2hs(value)
      service.updateCharacteristic(this.hapChar.Hue, hue)
      service.updateCharacteristic(this.hapChar.Saturation, sat)

      // The zone frame carries rgb and nothing else, so the temperature is
      // converted here - the same conversion the bluetooth path uses
      const [r, g, b] = k2rgb(k)

      if (this.hasSegmentedZones) {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'openApi',
          openApi: {
            instance: 'segmentedColorRgb',
            capabilityType: 'devices.capabilities.segment_color_setting',
            value: { segment: this.zoneLightSegments[zone], rgb: (r << 16) + (g << 8) + b },
          },
        })
      } else {
        await this.platform.sendDeviceUpdate(this.accessory, {
          cmd: 'zoneColour',
          lightSegments: this.zoneLightSegments[zone],
          value: { r, g, b },
        })
      }

      this.zoneKelvinCache[instance] = k
      this.zoneMiredCache[instance] = value
      this.zoneColourCache[instance] = {
        r,
        g,
        b,
        hue,
        sat,
      }
      this.accessory.log(`[${name}] ${platformLang.curColour} [${k}K / ${value}M]`)
    } catch (err) {
      this.accessory.logWarn(`[${name}] ${platformLang.devNotUpdated} ${parseError(err)}`)

      // Throw a 'no response' error and revert this after 2 seconds
      setTimeout(() => {
        if (service) {
          service.updateCharacteristic(this.hapChar.ColorTemperature, this.zoneMiredCache[instance])
        }
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  async internalBrightnessUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the brightness scale
      // If the light is off (e.g. a HomeKit scene turning it on), wait longer so the
      // on command sent by internalStateUpdate has time to wake the bulb first (#1277)
      const updateKeyBright = generateRandomString(5)
      this.updateKeyBright = updateKeyBright
      await sleep(this.cacheState !== 'on' ? 1050 : 350)
      if (updateKeyBright !== this.updateKeyBright) {
        return
      }

      // Don't continue if the new value is the same as before
      if (value === this.cacheBright) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'brightness',
        value,
      })

      // Govee considers 0% brightness to be off
      if (value === 0) {
        setTimeout(() => {
          this.cacheState = 'off'
          if (this.service.getCharacteristic(this.hapChar.On).value) {
            this.service.updateCharacteristic(this.hapChar.On, false)
            this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
          }
          this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
        }, 1500)
        return
      }

      // Cache the new state and log if appropriate
      if (this.cacheBright !== value) {
        this.cacheBright = value
        this.accessory.log(`${platformLang.curBright} [${value}%]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)
      })
    }
  }

  async internalColourUpdate(value, force = false) {
    try {
      // This acts like a debounce function when endlessly sliding the colour wheel
      // If the light is off (e.g. a HomeKit scene turning it on), wait longer so the
      // on command sent by internalStateUpdate has time to wake the bulb first (#1277)
      const updateKeyColour = generateRandomString(5)
      this.updateKeyColour = updateKeyColour
      await sleep(this.cacheState !== 'on' ? 1000 : 300)
      if (updateKeyColour !== this.updateKeyColour) {
        return
      }

      if (!this.colourSafeMode) {
        // Updating the cct to the lowest value mimics native adaptive lighting
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, 140)
      }

      // Don't continue if the new value is the same as before
      const currentSat = this.service.getCharacteristic(this.hapChar.Saturation).value
      const newRGB = hs2rgb(value, currentSat)
      if (
        !force
        && newRGB[0] === this.cacheR
        && newRGB[1] === this.cacheG
        && newRGB[2] === this.cacheB
      ) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'color',
        value: {
          r: newRGB[0],
          g: newRGB[1],
          b: newRGB[2],
        },
      })

      // Switch off any custom mode/scene characteristics and turn the on switch to on
      if (this.hasScenes) {
        setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.On, true)
          this.service.updateCharacteristic(this.cusChar.ColourMode, true)
          this.usedCodes.forEach((thisCharName) => {
            if (this.service.testCharacteristic(this.cusChar[thisCharName])) {
              this.service.updateCharacteristic(this.cusChar[thisCharName], false)
            }
            if (this.accessory.getService(thisCharName)) {
              this.accessory.getService(thisCharName).updateCharacteristic(this.hapChar.On, false)
            }
          })
        }, 1000)
      }

      // Cache the new state and log if appropriate
      this.cacheHue = value
      this.cacheKelvin = 0
      this.cacheScene = ''
      if (this.cacheR !== newRGB[0] || this.cacheG !== newRGB[1] || this.cacheB !== newRGB[2]) {
        [this.cacheR, this.cacheG, this.cacheB] = newRGB
        this.accessory.log(`${platformLang.curColour} [rgb ${this.cacheR} ${this.cacheG} ${this.cacheB}]`)
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.Hue, this.cacheHue)
      })
    }
  }

  async internalCTUpdate(value) {
    try {
      // This acts like a debounce function when endlessly sliding the colour wheel
      // If the light is off (e.g. a HomeKit scene turning it on), wait longer so the
      // on command sent by internalStateUpdate has time to wake the bulb first, and
      // so the 'skip when off' check below sees the updated state (#1277)
      const updateKeyCT = generateRandomString(5)
      this.updateKeyCT = updateKeyCT
      await sleep(this.cacheState !== 'on' ? 1000 : 300)
      if (updateKeyCT !== this.updateKeyCT) {
        return
      }

      // Convert mired to kelvin to nearest 100 (Govee seems to need this)
      const kelvin = Math.round(1000000 / value / 100) * 100

      // Check and increase/decrease kelvin to range of device
      const k = Math.min(Math.max(kelvin, this.minKelvin), this.maxKelvin)

      // Don't continue if the new value is the same as before
      if (this.cacheState !== 'on' || this.cacheKelvin === k) {
        if (this.alController?.isAdaptiveLightingActive?.()) {
          this.accessory.logDebug(`${platformLang.skippingAL} [${k}K /${value}M]`)
        }
        return
      }

      // Updating the hue/sat to the corresponding values mimics native adaptive lighting
      const hs = m2hs(value)
      this.service.updateCharacteristic(this.hapChar.Hue, hs[0])
      this.service.updateCharacteristic(this.hapChar.Saturation, hs[1])

      // Convert kelvin to rgb to use in case device doesn't support colour temperature
      const rgb = k2rgb(k)

      // Set up the params object to send
      const objToSend = {}

      // For BLE only models, convert to RGB, otherwise send kelvin value
      // TODO we can look at this in the future
      if (this.isBLEOnly) {
        objToSend.cmd = 'color'
        objToSend.value = { r: rgb[0], g: rgb[1], b: rgb[2] }
      } else {
        objToSend.cmd = 'colorTem'
        objToSend.value = k
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, objToSend)

      // Switch off any custom mode/scene characteristics and turn the on switch to on
      if (this.hasScenes) {
        setTimeout(() => {
          this.service.updateCharacteristic(this.hapChar.On, true)
          this.service.updateCharacteristic(this.cusChar.ColourMode, true)
          this.usedCodes.forEach((thisCharName) => {
            if (this.service.testCharacteristic(this.cusChar[thisCharName])) {
              this.service.updateCharacteristic(this.cusChar[thisCharName], false)
            }
            if (this.accessory.getService(thisCharName)) {
              this.accessory.getService(thisCharName).updateCharacteristic(this.hapChar.On, false)
            }
          })
        }, 1000)
      }

      // Cache the new state and log if appropriate
      [this.cacheR, this.cacheG, this.cacheB] = rgb
      this.cacheMired = value
      this.cacheScene = ''
      if (this.cacheKelvin !== k) {
        this.cacheKelvin = k
        if (this.alController?.isAdaptiveLightingActive?.()) {
          this.accessory.log(`${platformLang.curColour} [${k}K / ${value}M] ${platformLang.viaAL}`)
        } else {
          this.accessory.log(`${platformLang.curColour} [${k}K / ${value}M]`)
        }
      }
    } catch (err) {
      this.failUpdate(err, () => {
        this.service.updateCharacteristic(this.hapChar.ColorTemperature, this.cacheMired)
      })
    }
  }

  async internalSceneUpdate(charName, awsCode, bleCode, value, isService = false) {
    try {
      // Don't continue if command is to turn off - we should turn off by changing to a colour mode instead, or another scene
      if (!value) {
        return
      }

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'rgbScene',
        value: [awsCode, bleCode],
      })

      // Disable adaptive lighting if it's on already
      if (!this.colourSafeMode && this.alController?.isAdaptiveLightingActive?.()) {
        this.alController.disableAdaptiveLighting()
        this.accessory.log(platformLang.alDisabledScene)
      }

      // Log the scene change
      if (this.cacheScene !== charName) {
        this.cacheScene = charName
        this.accessory.log(`${platformLang.curScene} [${this.cacheScene}]`)
      }

      // Turn all the characteristics off and turn the on switch to on
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.On, true)
        this.service.updateCharacteristic(this.cusChar.ColourMode, false)
        this.usedCodes.forEach((thisCharName) => {
          if (thisCharName !== charName) {
            if (this.service.testCharacteristic(this.cusChar[thisCharName])) {
              this.service.updateCharacteristic(this.cusChar[thisCharName], false)
            }
            if (this.accessory.getService(thisCharName)) {
              this.accessory.getService(thisCharName).updateCharacteristic(this.hapChar.On, false)
            }
          }
        })
      }, 1000)
    } catch (err) {
      this.failUpdate(err, () => {
        if (isService) {
          this.accessory.getService(charName).updateCharacteristic(this.hapChar.On, false)
        } else {
          this.service.updateCharacteristic(this.cusChar[charName], false)
        }
      })
    }
  }

  externalUpdate(params) {
    // Return if not initialised
    if (!this.initialised) {
      return
    }

    // Check to see if the provided state is different from the cached value
    if (params.state && params.state !== this.cacheState) {
      // State is different so update Homebridge with new values
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.On, this.cacheState === 'on')

      // Log the change
      this.accessory.log(`${platformLang.curState} [${this.cacheState}]`)
    }

    // Check to see if the provided brightness is different from the cached value
    if (hasProperty(params, 'brightness') && params.brightness !== this.cacheBrightRaw) {
      // Brightness is different so update Homebridge with new values
      this.cacheBrightRaw = params.brightness

      // Govee considers brightness 0 as OFF so change brightness to 1 if light is on
      this.cacheBright = this.cacheState === 'on' ? Math.max(this.cacheBrightRaw, 1) : this.cacheBrightRaw
      this.service.updateCharacteristic(this.hapChar.Brightness, this.cacheBright)

      // Log the change
      this.accessory.log(`${platformLang.curBright} [${this.cacheBright}%]`)
    }

    // Check to see if the provided colour is different from the cached state
    if (params.kelvin || params.rgb) {
      // Colour can be provided in rgb or kelvin so either way convert to hs for later
      let hs
      let rgb
      let mired
      let colourChange = false
      let changedElsewhere = false
      if (params.kelvin) {
        mired = Math.round(1000000 / params.kelvin)
        hs = m2hs(mired)
        rgb = hs2rgb(hs[0], hs[1])

        // Check for a colour change
        if (params.kelvin !== this.cacheKelvin) {
          colourChange = true
          // Commands go out rounded to the nearest 100K, so a report that lands
          // within that is this light repeating back what it was just told.
          // Anything further apart came from somewhere else - see below
          changedElsewhere = Math.abs(params.kelvin - this.cacheKelvin) > 100
        }
      } else {
        rgb = [params.rgb.r, params.rgb.g, params.rgb.b]
        hs = rgb2hs(rgb[0], rgb[1], rgb[2])

        // Check for a colour change. Saturation matters as much as hue: going
        // from a pale colour to a vivid one at the same hue is a real change,
        // and comparing hue alone missed it entirely - so the light was left
        // following adaptive lighting after its owner had chosen a colour, and
        // wandered off that colour a few minutes later (#1333)
        if (hs[0] !== this.cacheHue || hs[1] !== this.cacheSat) {
          colourChange = true
          // A light repeating our own command back can drift by a unit or two
          // through the colour conversions on the way out and back. Beyond that
          // drift, somebody else set this colour
          changedElsewhere = Math.abs(rgb[0] - this.cacheR) > 5
            || Math.abs(rgb[1] - this.cacheG) > 5
            || Math.abs(rgb[2] - this.cacheB) > 5
        }
      }

      // Perform the check against the cache
      if (colourChange) {
        // Colour is different so update Homebridge with new values
        this.service.updateCharacteristic(this.hapChar.Hue, hs[0])
        this.service.updateCharacteristic(this.hapChar.Saturation, hs[1]);
        [this.cacheR, this.cacheG, this.cacheB] = rgb;
        [this.cacheHue, this.cacheSat] = hs

        if (mired) {
          if (!this.colourSafeMode) {
            this.service.updateCharacteristic(this.hapChar.ColorTemperature, mired)
          }
          this.cacheMired = mired
          this.cacheKelvin = params.kelvin
          this.accessory.log(`${platformLang.curColour} [${params.kelvin}K / ${mired}M]`)
        } else {
          this.accessory.log(`${platformLang.curColour} [rgb ${this.cacheR} ${this.cacheG} ${this.cacheB}]`)
        }

        // Somebody chose this colour outside HomeKit - in the Govee app, on a
        // remote, or at the wall. HomeKit's own colour changes are caught by
        // Homebridge itself, but nothing else sees these, so adaptive lighting
        // would carry on and move the light off that colour within minutes.
        if (!this.colourSafeMode && this.alController?.isAdaptiveLightingActive?.() && changedElsewhere) {
          this.alController.disableAdaptiveLighting()
          this.accessory.log(platformLang.alDisabled)
        }
      }
    }

    // Update any independently-controllable light zones (e.g. main/background),
    // read from the device's own frame where the toggles report nothing
    let zoneToggles
    if (this.hasRawZones) {
      zoneToggles = readZoneFrame(params.commands)
    } else if (this.hasSegmentedZones) {
      zoneToggles = readSegmentedZoneStateFrame(params.commands)
    } else {
      zoneToggles = params.toggles
    }
    if (zoneToggles) {
      Object.entries(this.zoneServices).forEach(([instance, service]) => {
        if (hasProperty(zoneToggles, instance)) {
          const newValue = zoneToggles[instance] ? 1 : 0
          if (this.zoneCache[instance] !== newValue) {
            this.zoneCache[instance] = newValue
            service.updateCharacteristic(this.hapChar.On, newValue === 1)
            this.accessory.log(`[${service.displayName}] ${platformLang.curState} [${newValue === 1 ? 'on' : 'off'}]`)
          }
        }
      })
    }

    // The same status carries every light segment's brightness and color, so a
    // change made in the Govee app, on a remote or at the wall reaches the
    // zone tiles too - not just our own writes echoing back. The segmented
    // models emit the same `aa a5` frames (proven for the H601F in #1223)
    if (this.hasRawZones || this.hasSegmentedZones) {
      const lightSegments = readLightSegmentFrames(params.commands)
      ZONE_DEFS.forEach(({ instance, zone, name }) => {
        const service = this.zoneServices[instance]
        if (!service) {
          return
        }

        // Every light segment in a zone normally holds the same value. Where
        // they differ - someone has colored segments individually in the
        // Govee app - the first is what the tile shows, because HomeKit has
        // one value per characteristic and this zone has sixteen segments
        const first = this.zoneLightSegments[zone].find(index => lightSegments[index])
        const reported = first === undefined ? undefined : lightSegments[first]
        if (!reported) {
          return
        }

        if (this.zoneBrightCache[instance] !== reported.level) {
          this.zoneBrightCache[instance] = reported.level
          service.updateCharacteristic(this.hapChar.Brightness, reported.level)
          this.accessory.log(`[${name}] ${platformLang.curBright} [${reported.level}%]`)
        }

        const cached = this.zoneColourCache[instance]
        if (!cached || cached.r !== reported.r || cached.g !== reported.g || cached.b !== reported.b) {
          const [hue, sat] = rgb2hs(reported.r, reported.g, reported.b)

          // A zone repeating our own command back can drift by a unit or two
          // through the conversions on the way out and back. Beyond that
          // drift, somebody else set this color
          const changedElsewhere = !cached
            || Math.abs(reported.r - cached.r) > 5
            || Math.abs(reported.g - cached.g) > 5
            || Math.abs(reported.b - cached.b) > 5

          this.zoneColourCache[instance] = {
            r: reported.r,
            g: reported.g,
            b: reported.b,
            hue,
            sat,
          }
          service.updateCharacteristic(this.hapChar.Hue, hue)
          service.updateCharacteristic(this.hapChar.Saturation, sat)
          this.accessory.log(`[${name}] ${platformLang.curColour} [rgb ${reported.r} ${reported.g} ${reported.b}]`)

          // Somebody chose this color in the Govee app, on a remote or at the
          // wall. Homebridge catches HomeKit's own writes, but nothing sees
          // these - so this zone's adaptive lighting would carry on and move
          // it back off that color within minutes (#1333)
          const controller = this.zoneAlControllers[instance]
          if (changedElsewhere && controller?.isAdaptiveLightingActive?.()) {
            controller.disableAdaptiveLighting()
            this.accessory.log(`[${name}] ${platformLang.alDisabled}`)
          }
        }
      })
    }
  }
}
