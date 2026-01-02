# Change Log

All notable changes to `@homebridge-plugins/homebridge-govee` will be documented in this file.

## v11.14.0 (2025-12-28)

### Changes

- add `H600D` to native matter models (#1213) (@R-STR)
- add support for `H8015` light bulb (#1221) (@zionsnider)
- add `H619D` to native matter models
- add support for `H8811` light device
- determine debug mode from `-D` flag
- dependency updates, fix `patch-package`

## v11.13.0 (2025-12-15)

### Changes

- new light model: `H6871`
- dependency updates

## v11.12.1 (2025-12-05)

### Changes

- update workflows and npm publish via oidc
- dependency updates

## v11.12.0 (2025-11-30)

### Changes

- add support for `H80C5` lights
- fix `DEP0187` deprecation warning retry

## v11.11.0 (2025-11-29)

### Changes

- update readme badges (use `shields.io`)
- feat: add support for `H6671` and `H6672` (#1200) (@fish-sammy)
- update dependencies
- improvements to ble error catching and logging
- improvements to `H7107` fan commands
- fix `DEP0187` deprecation warning
- added support for new devices
  - lights:
    - `H6020`, `H6095`, `H60C1`, `H61D6`, `H66A0`, `H66A1`,
    - `H6841`, `H7026`, `H7056`, `H7073`, `H707A`, `H7087`,
    - `H7094`, `H70B6`, `H806A`, `H80A4`, `H8840`, `H8841`
  - thermo-sensors: `H5112` (untested)
  - template: `H5140` (to be implemented)

## v11.10.0 (2025-09-07)

### Other Changes

- reorder and more logging in shutdown function
- refactor ble clients for better stability

## v11.9.0 (2025-09-03)

### Notable Changes

- added light model: `H702A` (#1159) (@lucavb)
- added light models: `H702C`, `H61B8`, `H61B9`

## v11.8.0 (2025-08-29)

### Notable Changes

- added light models: `H808A`, `H7076`, `H6011`, `H702B`

### Other Changes

- updated dependencies

## v11.7.0 (2025-07-26)

### Notable Changes

- added light models: `H600C`

## v11.6.0 (2025-07-26)

### Notable Changes

- added light models: `H6007` & `H6631`

### Other Changes

- updated dependencies

## v11.5.1 (2025-07-24)

### Other Changes

- dependency updates

## v11.5.0 (2025-07-18)

### Notable Changes

- added light models: `H6038`, `H60B1` & `H60B2`

## v11.4.0 (2025-07-18)

- ⚠️ This update will remove and re-add any H7105 fan accessories in your Homebridge setup.
  - It will replace the 0-100% rotation speed with a unitless rotation speed characteristic.
  - The new rotation speed values (0-12) will better match the speeds from the Govee app.

### Notable Changes

- add option to hide fan light for H7105
- use unitless rotation speed for H7105
- fix updating swing mode for H7105 when externally controlled
- temporarily disable controlling swing mode for H7105

### Other Changes

- add maintainer message

## v11.3.1 (2025-07-13)

### Notable Changes

- fix eve characteristics for hb 2

## v11.3.0 (2025-07-13)

### Notable Changes

- fix custom plugin config modal styles in ui 5
- fix custom characteristics for hb 2

### Other Changes

- fix permission in release workflow
- improvements to the deprecate workflow

## v11.2.0 (2025-07-12)

### Notable Changes

- support new govee models
  - lights: `H60A4`

### Other Changes

- fix plugin name in release workflow
- add permissions to workflows

## v11.1.0 (2025-07-12)

### Notable Changes

- work-in-progress support for ice-makers
- allow exposing a temperature sensor as a thermostat
- set `strictValidation` to `true` in the config schema file
- support new govee models
  - lights: `H601E` `H6048` `H60A6` `H60B0` `H6630` `H7025` `H7086` `H8022`
  - ice-makers: `H717D` (work-in-progress)

### Other Changes

- github repo maintenance

## v11.0.2 (2025-05-20)

⚠️ This plugin no longer officially supports Node 18. Please update to Node 20 or 22.

### Changed

- enable logging for unknown scene codes for the ice maker

## v11.0.1 (2025-05-18)

### Changed

- downgrade bluetooth packages to fix child bridge restart issues

## v11.0.0 (2025-05-18)

⚠️ This plugin no longer officially supports Node 18. Please update to Node 20 or 22.

### Added

- support light models `H600B` and `H7093`
- support fan model `H7107`

### Changed

- updated dependencies

### Removed

- remove official support for node 18

## v10.19.0 (2025-04-19)

### Added

- add `H5110` to models of thermo sensors (#1087) (@N9PBJ)

### Changed

- updated dependencies

## v10.18.0 (2025-04-13)

### Added

- add support for `H5109` as a thermostat (#1082) (@nrc2358)

### Changed

- updated dependencies

## v10.17.0 (2025-03-22)

### Added

- support light models `H6013` and `H8604`

### Changed

- updated dependencies

### Fixed

- fix hap-nodejs permissions for hb2

## v10.16.0 (2025-02-24)

### Added

- new models
- added support for H6104 status updates from AWS (#1043) (@Lumute)

### Changed

- simplify BLE connections and updates
- updated dependencies

## v10.15.0 (2024-12-09)

### Added

- added new light models

## v10.14.0 (2024-12-08)

### Added 

- add matter ignore list and config opt
  - using an initial (but probably incomplete) list of Matter-enabled models
  - please report any missing models or issues via GitHub

### Changed

- try to allow bluetooth on macs

### Fixed

- plugin config screen issue (undefined methods)

## v10.13.0 (2024-12-08)

### Added

- added models H8072 and H80C4 (#969) (@EricHigdon)
- added recent models

### Changed

- Bump `node` recommended versions to `v18.20.5` or `v20.18.1` or `v22.12.0`

### Fixed

- Fix for H5178 Temp sensor (#870) (@damonaw)

## v10.12.1 (2024-10-15)

### Fixed

- fix `homepage` in `package.json`

## v10.12.0 (2024-10-15)

### Added

- Lights: `H7070` `H70B5`
- Humidifiers (beta): `H7148`

### Changed

- put scene code logging back into debug mode

## v10.11.0 (2024-10-14)

### Added

- Lights: `H6811` `H801B`

## v10.10.0 (2024-10-13)

### Added

- Lights: `H6089` `H6093` `H6097` `H613G` `H615F` `H61B3` `H61B6` `H61E5` `H61F5` `H7037` `H70B4` `H70C5` `H70D1` `H801C`
- Switches: `H5086`
- Purifiers (beta): `H7124` `H7127` `H712C`
- Presence sensor (beta): `H5127`
- Template devices: `H5121` `H5126`

### Changed

- Bump `node` recommended versions to `v18.20.4` or `v20.18.0` or `v22.9.0`
- Updated `eslint` and use new code style

## v10.9.2 (2024-07-15)

### Changed

- Split appliances into different files for more specific features per model

## v10.9.1 (2024-07-13)

### Changed

- Always log new scene codes for appliances
  - this is helpful for development

## v10.9.0 (2024-07-13)

### Added

- Support for light models:
  - `H600D` `H605A` `H6098` `H6640` `H6641`
- Support (beta) for sensor:
  - `H5190`

## v10.8.1 (2024-07-13)

### Changed

- Fixed for `hap-nodejs` v1.0.0
- Updated dependencies
- Bump `node` recommended versions to v18.20.4 or v20.15.1

## v10.8.0 (2024-05-26)

### Added

- Support for light models:
  - `H60A1` `H61D3` `H7038` `H7039` `H7105`
- Support for light models:
  - `H7015`
  - `H7016` (thanks @rusnewman)

### Changed

 - Updated dependencies

## v10.7.1 (2024-05-03)

### Fixed

- Use existing access token on HTTP login

## v10.7.0 (2024-05-02)

### Added

- Support device H6079 (floor lamp) (#775) (@bwitting)

### Fixed

- HTTP connection with leak sensors

## v10.6.0 (2024-04-20)

### Added

- Support for light models:
  - `H6042` `H6043` `H6063` `H607C` `H608D`
  - `H616C` `H616D` `H616E` `H6175` `H61A9`
  - `H61B1` `H7021` `H7052` `H7053` `H705D`
  - `H705E` `H705F` `H7063` `H706B` `H7075`
  - `H70BC` `H805A` `H805B` `H805C`

## vChanged

- Updated LAN supported models based on latest Govee docs
- Bump `node` supported versions to v18.20.2 or v20.12.2

## v10.5.0 (2024-03-28)

### Added

- Allow `H5108` Thermometer (#736) (@BroHammie)
- Add support for `H600A`, `H61B5`, `H61D5`

### Changed

- Bump `node` supported versions to v18.20.0 or v20.12.0
- Updated dependencies

## v10.4.0 (2024-02-06)

### Added

- Support for `H6099` lights
- Add support for H5105 (#727) (@ALPHAy00)
- Add LAN support for `H61BC`, `H70A1`

### Changed

- Bump `node` supported versions to v18.19.0 or v20.11.0
- Updated dependencies

## v10.3.0 (2023-12-30)

### Added

- Support for `H6004`, `H601D`, `H70A1`, `H706A` lights
- Support for `H7173`, `H7175` kettles
- Support for `H7161`, `H7162` diffusers
- Work-in-progress support for `H5198` thermometer sensor(s)

### Changed

- Bump `node` supported versions to v18.19.0 or v20.10.0
- Updated dependencies

## v10.2.0 (2023-11-30)

### Added

- Support for `H606A`, `H6092` and `H706C` lights
- Add LAN support for `H7066` (@JGtHb)

### Changed

- Bump `node` supported versions to v18.18.2 or v20.10.0

## v10.1.0 (2023-11-19)

### Added

- Support for `H608A`, `H608B`, `H608C` lights (thanks [@twhitson](https://github.com/twhitson)!)
- Support for `H601C`, `H6185`, `H6176`, `H70A1` lights
- Support for heater `H7133`

### Changed

- Updated dependencies

## v10.0.0 (2023-10-24)

### Added

- Support for heater `H713C`
- Support for lights
  - `H6010`, `H601B`, `H6088`, `H60A0`, `H6167`, `H617F`, `H61BA`, `H61BC`, `H61C2`, `H61C5`, `H7066`, `H70C1` and `H70C2`
- Support for air purifier `H7126` (work-in-progress)

### Changed

- Updated dependencies
- Bump `node` supported versions to v18.18.2 or v20.8.1

### Removed

- Support for node 16

## v9.4.2 (2023-08-28)

⚠️ Note this will be the last version of the plugin to support Node 16.
- Node 16 moves to 'end of life' on 2023-09-11 ([more info](https://nodejs.org/en/blog/announcements/nodejs16-eol))
- This is in-line with the Homebridge guidelines on supporting node versions ([more info](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js/))
- If you are currently using Node 16, now is a good time to upgrade to Node 18 or 20 (see the link above for more info)

### Changed

- Update dependencies

## v9.4.1 (2023-08-27)

### Changed

- Update `axios` to `v1.5.0`

### Fixed

- `H713A` is not a light it is a header 😅
- Support for `H713B` heater

## v9.4.0 (2023-08-26)

### Added

- Support for:
  - `H5058` leak sensors
  - `H5104` thermo-hygrometer sensor
  - `H6609` gaming lights
  - `H7029` bluetooth lights
  - `H7134` heater
  - `H705C`, `H713A` lights
  - `H7151` dehumidifier

### Fixed

- Do not attempt to control models via LAN when an IP is entered in the config, but the model is not LAN supported

## v9.3.0 (2023-07-29)

### Added

- Support for `H61BE` (+ LAN) and `H7019` bluetooth lights
- Work-in-progress support for `H6602` device

### Changed

- 'no connection method' log entry now includes a link to a wiki page for more info

## v9.2.0 (2023-07-24)

### Added

- Support for heater `H7135`
- Support for humidifier `H7140`
- Support for lights `H7033`

### Changed

- Bump `node` recommended versions to v16.20.1 or v18.17.0 or v20.5.0

### 9.1.0 (2023-06-12)

### Added

- Support for humidifier `H7143`
- Support for lights `H6006` and `H61E0`

### Changed

- Bump `node` supported versions to v16.20.0 or v18.16.0 or **v20.3.0**
- Updated dependencies

### 9.0.2 (2023-05-06)

### Changed

- Bump `node` supported versions to v16.20.0 or v18.16.0 or v20.1.0

### Fixed

- Properly match configured device id to actual device id

## v9.0.1 (2023-05-03)

### Fixed

- Temperature readings for some Govee appliances

## v9.0.0 (2023-04-30)

️Note this release makes breaking changes to scene codes and will require reconfiguring (apologies for changing this again!). This is to:

- make finding scene codes more straightforward and reliable
- allow scene codes to be sent via LAN mode
- allow scene codes to be sent via BLE mode (separate scene code required - see docs)
- bring some consistency to how the plugin handles scenes

See the first section of the updated wiki document for instructions:
- https://github.com/homebridge-plugins/homebridge-govee/wiki/Scene,-Music,-DIY-Modes

### Added

- Support for `H61C3` lights
- Support for `H7102` fan
- LAN mode support for the following devices:
  - `H6078`, `H6168`, `H61A8`, `H61C3`, `H7055`, `H705A`, `H705B`
- Log added scene codes on plugin startup
- Scene codes via LAN mode
- Scene codes via BLE mode
- Option to show a scene code as an extra Home App switch instead of an Eve button
  - This could be useful for Home Assistant or ioBroker users who wish to integrate scenes

### Changed

- ⚠️ Scene codes reverted back to old raw `base64` format
- Bump `node` supported versions to v16.20.0 or v18.16.0 or v20.0.0
- Updated dependencies

## v8.1.2 (2023-04-10)

### Changed

- Remove 'H6052', 'H6110', 'H6141', 'H6143', 'H6144', 'H615A', 'H615B' and 'H615C' from LAN supported
  - These models seem to have been removed from the Govee LAN API supported list

## v8.1.1 (2023-04-05)

### Changed

- Bump `node` recommended versions to v16.20.0 or v18.15.0

### Fixed

- Better logging info about OpenSSL

## v8.1.0 (2023-03-24)

### Added

- Support for fan H7100

### Changed

- Plugin initialisation logging

## v8.0.2 (2023-03-21)

### Fixed

- Plugin config screen fix for scene codes

## v8.0.1 (2023-03-21)

### Fixed

- Plugin config screen fix

## v8.0.0 (2023-03-21)

### Breaking

- ⚠️ Remove API connection method
  - This also removes the need for the `offlineAsOff` config option
- ⚠️ Lists of different AWS command types and brightness scales have been removed and replaces with a user configuration
- ⚠️ Scenes have also changed - please use the Homebridge UI to configure scenes again
  - This change is to (in the future) allow for more customisation of scenes, for example to expose as a switch to allow in Home Assistant
- Remove official support for Node 14
- Remove option to disable plugin - this is now available in the Homebridge UI
- Remove option for debug logging - this will be enabled when using a beta version of the plugin
- Remove individual accessory logging options to simplify the config

### Added

- Support for Kettle device `H7171`

### Changed

- Bump `homebridge` recommended version to v1.6.0 or v2.0.0-beta
- Bump `node` recommended versions to v16.19.1 or v18.14.2
- Updated dependencies

## v7.9.3 (2023-02-26)

### Changed

- Remove JSON logging for all API appliances as no more devices needed

## v7.9.2 (2023-02-26)

### Changed

- Updated dependencies
- Bump `node` recommended versions to v14.21.2 or v16.19.1 or v18.14.2

### Fixed

- AWS commands for H6003, H6009 and H601A

## v7.9.1 (2023-01-28)

### Changed

- For users with old AWS scene codes ending in `||ptReal`, you can now change this to `||raw` and the command should work as before
- For devices with AWS connection (with real-time updates), API polling will be disabled
- Improved AWS connectivity for older models

### Fixed

- AWS commands for H6054

## v7.9.0 (2023-01-20)

### Added

- Configuration items for kettle devices to switch to two custom modes

### Fixed

- Kettle commands
- AWS commands for H615E and H6195

## v7.8.0 (2023-01-12)

**Kettle Users**
Unfortunately this update will break your kettle. This is something I am working on and will hopefully be fixed soon.

### Changes

- General fixes
- Bump `node` recommended versions to v14.21.2 or v16.19.0 or v18.13.0

### Fixed

- AWS control for H6071, H6076, H615C, H61A2, H619B and H6182

### Removed

- AWS connection method polling - it is unnecessary as changes are provided to the plugin in realtime anyway

## v7.7.1 (2022-12-27)

### Changed

- Improvements to Govee Humidifiers (H7141 and H7142)
  - If anyone has a H7143 or H7160 please get in contact!
- Other fixes for purifiers and dehumidifiers

## v7.7.0 (2022-12-25) 🎄

### Added

- Temperature sensor to Govee Kettle (device is still a WIP)
- Added support for Govee Air Quality Monitor H5106 (credit and thanks to [@rmaes4](https://github.com/rmaes4))

### Changed

- Improvements to Govee Air Purifier H7122 (credit and thanks to [@rmaes4](https://github.com/rmaes4))
- Bump `node` recommended versions to v14.21.2 or v16.19.0 or v18.12.1

### Fixed

- Downgrade (and fix) bluetooth package versions
- Updated LAN model list

## v7.6.0 (2022-12-18)

### Added

- Config option to expose a Govee light device as a HomeKit `Switch` accessory

### Changed

- Updated BLE dependencies

### Fixed

- AWS commands for H5082 and H6054
- Avoid Homebridge characteristic warning for `ColourMode`

## v7.5.1 (2022-12-09)

- Maintenance release

## v7.5.0 (2022-12-06)

### Added

- LAN support for models (pending Govee support):
  - `H6051`, `H6059`, `H6073`, `H6109`, `H6142`, `H6154`, `H615B`, `H615C`, `H6160`, `H6182`, `H618F`, `H6195` and `H7020`
- Control appliances (Heaters, Fans, Humidifiers, Dehumidifiers and Purifiers) via BLE when AWS is unavailable
  - Experimental! This is not meant to be a replacement for AWS - more a fallback for the case that AWS is unavailable
- Config option to disable AWS
- BLE will now be enabled by default for all devices
  - BLE can be globally disabled via the config

### Fixed

- AWS commands for H619A

## v7.4.2 (2022-12-04)

### Fixed

- Hide scene logging when device is not switched on
- AWS commands for H6159

## v7.4.1 (2022-12-04)

### Changed

- Eve scene buttons are now stateful, showing the current scene that the device is in

### Fixed

- Fix for systems running OpenSSL v3
- Fixed oscillation command for H7131 and H7132 heaters
- AWS commands for H7020
- BLE commands for H6052 and H6058

## v7.4.0 (2022-12-02)

### Added

- Better handling of custom light scenes
  - Unfortunately all existing scene codes are no longer valid - you will need to recreate your scenes
  - See [wiki page](https://github.com/homebridge-plugins/homebridge-govee/wiki/Scene,-Music,-DIY-Modes) for more info
  - There _may_ be some older models which this method does not work for - if you have one of these, please open an issue

### Fixed

- BLE colour commands for H6053, H6072 and H6199

## v7.3.2 (2021-12-01)

### Changed

- Improved error message for Ubuntu users running a too high version of OpenSSL

### Fixed

- AWS command code logging
- AWS commands for H6052

## v7.3.1 (2022-12-01)

### Fixed

- Some AWS related things

## v7.3.0 (2022-12-01)

### Added

- Configuration section for Govee kettle devices

### Changed

- Log temperature from sensors in fahrenheit too
- Remove `awsDebug` option as impossible to implement for the moment
- Allow for homebridge 2.0 beta

### Fixed

- AWS connection
- AWS commands for H6142 and H615B
- Fix bluetooth status in Homebridge UI for sensors

## v7.2.0 (2022-11-27)

### Added

- Added support for the Govee outlet H5083
- Configuration section for Govee fan devices

### Changed

- **Fan Devices**
  - Rotation speeds reduced to multiples of 11% to allow a new 99% setting to access 'Auto' mode if your device is linked to a sensor
  - Otherwise, 99% will have the same effect as 88% (the highest speed available on the device)
- AWS codes will no longer be logged unless the `awsDebug` option is enabled for a specific device

### Fixed

- Plugin will now correctly enable LAN mode for devices discovered **after** the initial scan, with extra debug logging

## v7.1.9 (2022-11-23)

### Changed

- Added (forgotten) `awsDebug` option for switch devices

### Fixed

- AWS commands for H5080 outlet (for simulations)

## v7.1.8 (2022-11-23)

### Changed

- More improvements to heater devices H7131 and H7132 (fan speed selection mapping to Govee modes)

### Fixed

- AWS commands for H5080 outlet
- AWS fixes for H7050

## v7.1.7 (2022-11-19)

### Changed

- Updated dev dependencies

### Fixed

- AWS fixes for H619C
- Fixes an issue sending colour temperature updates for certain models

## v7.1.6 (2022-11-18)

### Fixed

- Colour control for some bluetooth-only models

## v7.1.5 (2022-11-16)

### Fixed

- AWS commands for H6054
- Bluetooth commands for H6102 - similar models may use these commands, please create an issue if you have a bluetooth model and brightness/colour do not work
  - Thanks to [@bitfl0wer](https://github.com/bitfl0wer) for figuring out the commands

## v7.1.4 (2022-11-15)

### Fixed

- AWS fixes for H6009 (WIP) and H605C

## v7.1.3 (2022-11-13)

### Changed

- Improvements to fan accessories (still a work-in-progress)
- Bump `node` recommended versions to v14.21.1 or v16.18.1 or v18.12.1

### Fixed

- Issue with using improperly saved access token
- AWS fixes for H6009 and H7041

## v7.1.2 (2022-10-31) 🎃

### Changed

- Disable BLE for Mac devices as not supported (by noble)
- Cap out of range colour temperatures from Govee

### Fixed

- AWS control for H6159
- AWS fixes for H6051 and H6056

## v7.1.1 (2022-10-25)

### Fixed

- Properly catch errors when parsing notifications with invalid JSON
- AWS brightness scale for H6182

## v7.1.0 (2022-10-25)

### Added

- Store and use account access token locally if possible to avoid re-authenticating on every restart
  - Should reduce cases of 24-hour account suspensions from logging in too many times
- A `colourSafeMode` setting which will not add `ColorTemperature` to light devices
  - This should help users with old iOS devices in which the`ColorTemperature` cannot be used with `Hue` and `Saturation`

### Changed

- More features to the Govee Heater implementation
- Scene codes will now log only in debug mode
- General refactoring and code improvements
- Plugin will override and use debug logging mode if a beta version is installed

### Fixed

- Improved AWS support for H6182
- An issue parsing incoming API updates for lights
- An issue when brightness was not scaled properly for certain incoming AWS updates

## v7.0.1 (2022-10-22)

- More features to the Govee Heater implementation
- Fixed an issue with incoming AWS updates for accessories not in Homebridge
- Log all scene codes received for a device (for debugging, this is not permanent)

## v7.0.0 (2022-10-20)

### ⚠️ Config Changes

#### New

- `httpRefreshTime`
  - Default `30`, minimum `30`
- `awsRefreshTime`
  - Default `30`, minimum `30`
- `lanDisable`
  - Default `false`
- `bleDisable`
  - Default `false`
- `bleRefreshTime`
  - Default `300`, minimum `60`

#### Changed

- `refreshTime` has been renamed to `apiRefreshTime`
  - Minimum increased from `15` to `30`
- `lanStateUpdateInterval` has been renamed to `lanRefreshTime`
  - Default increased from `5` to `30`, minimum increased from `2` to `10`
- `lanScanInterval`
  - Default increased from `5` to `60`, minimum increased from `2` to `30`
- `controlInterval` has been renamed to `apiBleControlInterval`
  - Unit changed from `milliseconds` to `seconds`
  - Plugin will try to be backward compatible, dividing any existing values >=500 appropriately

### Added

- Support for AWS connection polling
- Support for H5160 3-channel outlet device
- Support for BLE-only thermo-hygrometers (integration of homebridge-plugin-govee plugin)
  - Use [govee-bt-client](https://www.npmjs.com/package/govee-bt-client) to connect to certain Govee sensor models via BLE
- Logout to close Govee session on Homebridge shutdown

### Work in Progress

- Continued improved implementation of Govee Heaters
- Support for H5103 and H5106 temperature/humidity sensors

### Changed

- Plugin no longer sends API command if AWS command was successful
- Plugin no longer requests device state via LAN immediately after sending a command
- Bump `axios` to v1.1.3
- Bump `node` recommended versions to v14.20.1 or v16.18.0 or v18.11.0

### Fixed

- Multiple general fixes
- Fixes H5054 leak sensor status reporting (again)
- Fixes an incorrect error when changing speed of appliances like heaters and humidifiers

## v6.0.4 (2022-10-07)

### Changed

- Small timeout to ignore incoming LAN updates when controlled, workaround for incorrect status updates when controlling via LAN
- Bump `axios` to v1.1.2

## v6.0.3 (2022-10-06)

### Changed

- Use configured `label` for accessory name for LAN-only models

## v6.0.2 (2022-10-06)

### Fixed

- Ignore `offlineAsOff` for LAN-only devices
- Remove scene characteristics from LAN-only devices as unsupported

## v6.0.1 (2022-10-06)

### Fixed

- A couple of small fixes for when using a custom IP address for LAN control

## v6.0.0 (2022-10-05)

### Added

- 🎉 LAN mode! 🎉 (thanks [@alboiuvlad29](https://github.com/alboiuvlad29)!)
  - See [the homebridge-govee wiki](https://github.com/homebridge-plugins/homebridge-govee/wiki/Supported-Devices) for supported devices
  - The plugin will scan your local network for supported Govee lights
  - You can also specify the IP address of your Govee light in the config
  - The plugin will match any discovered devices to your existing accessories from cloud usage
  - Supported LAN controls are on/off, brightness, colour and colour temperature
  - The plugin will initially attempt LAN control, if this fails then it will fall back to cloud control
- **New Devices**
  - Via Govee Developer API v2.0:
    - **Lights**: H61A5, H6078, H604D, H6168, H6601, H70B1, H61A8
    - **Fans:** H7101, H7111
    - **Heaters:** H7130, H7131, H7132
    - **Dehumidifiers:** H7150
    - **Humidifiers:** H7141, H7142, H7160
    - **Purifiers:** H7120, H7121, H7122, H7123
  - Via AWS Connection:
    - **Kettles:** H7170 (ability just to switch on)
  - Via Bluetooth:
    - **Lights:** H617E bluetooth light strip

### Changed

- **Revert:** Bluetooth-only devices no longer need to be configured to explicitly enable bluetooth
- Less bluetooth logging when not in debug mode
- AWS improvements for H615D
- AWS improvements for H7050/H7051 (thanks [@alboiuvlad29](https://github.com/alboiuvlad29)!)
- Correct parameters for `updatePlatformAccessories()`
- Bump `node` recommended versions to v14.20.1 or v16.17.1
- Allow for `node` v18.10.0
- Bump `homebridge` recommended version to v1.5.0
- Bump `axios` to v1.0.0
- Updated dev dependencies

### Fixed

- Fixed H5054 leak sensor status reporting

### Removed

- Removed the `disableAWS` option for lights
  - *This option was implemented when AWS was introduced as a way to disable it for lights that didn't work with it, but now that it's been tested on more lights, it's no longer needed*

## v5.2.0 (2022-06-13)

### Added

- **New Devices** via Govee Developer API v1.8
  - H601A, H6046, H6047, H604C, H6057, H605C, H6065, H610B, H61A3, H61E1, H7055, H705A, H705B, H7065

## v5.1.0 (2022-06-08)

### Added

- **New Devices**
  - H7123 Air Purifier
  - H7160 Humidifier

### Changed

- Bump `node` recommended versions to v14.19.3 or v16.15.1

### Fixed

- A potential issue showing errors in the logs
- AWS improvements for H618E

## v5.0.1 (2022-05-28)

### Changed

- Try BLE-only device connection for 8 seconds and 4 seconds for API/AWS models
- More fixes and refactoring

## v5.0.0 (2022-05-28)

### Potentially Breaking Changes

⚠️ The minimum required version of Homebridge is now v1.4.0
⚠️ The minimum required version of Node is now v14

### Changed

- Device polling based on number of devices and new Govee limitations
- Bluetooth-only devices no longer need to be configured to explicitly enable bluetooth
- Changed to ESM package
- Bump `node` recommended versions to v14.19.3 or v16.15.0

## v4.30.3 (2022-04-10)

### Fixed

- An issue updating colour for certain RGB models

## v4.30.2 (2022-04-03)

### Changed

- Updated dependencies

## v4.30.1 (2022-04-01)

### Changed

- Bump `aws-iot-device-sdk` to v2.2.12
- Improve AWS support for H6008, H604A, H6056 and H6073

## v4.30.0 (2022-03-20)

### Added

- Support new models via Govee API v1.5:
  - H6009, H604A, H604B, H605D, H6066, H6067, H6091, H615E, H6173, H618F, H61A1, H61A2, H61B2, H7031, H7032, H7041, H7042, H7051, H7061, H7062
- Added H6101, H6116 to bluetooth only light strips

### Changed

- Bump `axios` to v0.26.1
- Bump `node` recommended versions to v14.19.1 or v16.14.2

## v4.29.0 (2022-02-27)

### Added

- Added H604A and H613B to bluetooth only light strips

### Changed

- Bump `node` recommended versions to v14.19.0 or v16.14.0
- Bump `axios` to v0.26.0

### Fixed

- Colour support for H613B and H613D via bluetooth, thanks @jbheuschen
- Improved AWS support for H610A, H6144, H6159, H6172, H61A0, H619C and H619E
- Improved AWS support for H6052 thanks @DuckMasterAl

## v4.28.0 (2022-02-02)

### Added

- Initial support for Govee Fans H7101 and H7111
- Heating speed and oscillation support for Govee Heater (via `RotationDirection` feature)

### Changed

- Bump `homebridge` recommended version to v1.4.0
- Bump `axios` to v0.25.0

### Fixed

- Brightness fix for H6050
- Improved AWS support for H6072 and H6141

## v4.27.0 (2022-01-15)

### Added

- Added H6178 and H617A to bluetooth only light strips
- Added lock control and display light control to Govee Purifiers

## vFixed

- Improved AWS support for H6058 and H605B

## v4.26.0 (2022-01-13)

### Added

- Speed control for Govee Purifiers

### Changed

- Plugin startup logs will include the model in the device listing
- Purifier, Heater and Humidifier will no longer debug log (was hard-coded for development)
- Bump `node` recommended versions to v14.18.3 or v16.13.2

### Fixed

- Improved AWS support for H6141
- Incorrectly marking AWS-only devices as command failed when it was in fact sent

## v4.25.0 (2022-01-09)

### Added

- Added two custom scene options called 'Video Mode' for video mode scenes

### Fixed

- Properly display a certain error from `bluetooth-hci-socket`
- Properly throw an error if bluetooth fails and is the only connection method
- Missing RGB data for selecting 5600K colour temperature

## v4.24.0 (2022-01-08)

### Added

- Reinstate support for H6001

### Fixed

- Improved AWS support for H6062

## v4.23.2 (2022-01-07)

### Fixed

- Improved AWS support for H6003, H6054, H6199
- Plugin crash for older versions of Homebridge

## v4.23.1 (2021-01-05)

### Fixed

- Improved AWS support for H619A

## v4.23.0 (2022-01-03)

### Added

- **Logging**
  - Plugin will log if it notices your device supports the `color/rgb` AWS command, asking to let me know on Github

### Fixed

- Colour and colour temperature fixes for the H6086

## v4.22.0 (2021-12-31)

See ⚠️ for potentially-breaking changes.

### Added

- **New Devices**
  - Added H6005 to bluetooth only light strips
  - Added H5071 to thermo-hygrometer devices

### Changed

- Bump `homebridge` recommended version to v1.3.9

### Fixed

- Fixed sending and receiving colour temperature values with `colorwc` AWS command

### Removed

- ⚠️ Remove support for bluetooth-only thermo-hygrometer devices
  - The plugin will log a recommendation to use `homebridge-plugin-govee`

## v4.21.0 (2021-12-30)

### Added

- **New Devices**
  - Added H6196 to bluetooth only light strips
- **Logging**
  - Plugin will log if it notices your device supports the `colorwc` AWS command, asking to let me know on Github

### Changed

- Improved support for colour temperature for devices that support `colorwc` AWS command
- Plugin will log HAPNodeJS version on startup

## v4.20.3 (2021-12-29)

### Fixed

- Use `colorwc` AWS command for H6059 and H6143 for colour

## v4.20.2 (2021-12-26)

### Fixed

- Hide error stack info for more known warnings on plugin startup

## v4.20.1 (2021-12-24)

### Fixed

- Sending colour updates via BLE was sometimes incorrectly marked as not supported
- A `Disabling HTTP client as server is busy` message
- AWS brightness fix for H6059

## v4.20.0 (2021-12-21)

### Added

- **New Devices**
  - Added H613E to bluetooth only light strips
  - Added H5174 to thermo-hygrometer devices (although not properly supported since BLE-only)
- **Simulations**
  - Expose an outlet device as a `Heater` or `Cooler` accessory type, using the current temperature value from another Govee, eWeLink or Meross sensor (eWeLink and Meross sensors will not work with HOOBS)
  - Current temperature values from sensors will be cached in the homebridge storage directory to allow my other plugins to create `Heater` and `Cooler` accessories with the temperature values

### Changed

- Some config options rearranged for easier access
- Only use the (promise) queue for API updates, ie, don't use the queue for AWS and BLE updates

## v4.19.0 (2021-12-08)

### Added

- **New Devices**
  - On/Off capability for Govee Purifiers H7121 and H7122
  - Support for Govee Humidifier H7142
  - Added H6055, H6114, H6145, H6146, H7010, H7001, H7002, H7011, H7015, H7016, H7023, H7024 and H7090 to bluetooth only light strips
- **Simulations**
  - Expose a single switch as an `Audio Receiver`, `Set Top Box`, `Streaming Stick`, `Tap/Faucet`, or `Valve` HomeKit accessory type

### Changed

- In debug mode, the plugin will log all bluetooth devices discovered when trying to control a light
  - This can help identify whether bluetooth is working and to find the address of a light strip if the plugin cannot automatically determine it
- Bump `homebridge` recommended version to v1.3.8
- Bump `node` recommended versions to v14.18.2 or v16.13.1

### Fixed

- Avoid repeated logging for state changes of certain accessories
- Properly remove ignored accessories from the Homebridge cache

## v4.18.0 (2021-11-18)

### Added

- **New Devices**
  - Added H613D to bluetooth only light strips
  - Added H5177 to thermo-hygrometer devices
  - Added H605B, H6087, H6172, H619B, H619D, H619Z, H610A, H6059, H7028, H6198 and H6049 to API enabled models
  - Added H61A0 and H7060 to API enabled models and removed from BLE-only models

### Fixed

- AWS brightness fix for H6003, H6008 and H6062
- AWS colour fix for H6003

## v4.17.0 (2021-11-03)

### Added

- **New Devices**
  - Added H5100 to thermo-hygrometer devices
  - Added H617C to bluetooth only light strips
  - Govee Heater H7130 partial implementation
  - Govee Humidifier H7141 partial implementation

### Changed

- Configuration text label from `username` to `email` for clarification
- Revert back from `@homebridge/noble` to `@abandonware/noble`

## v4.16.0 (2021-10-31)

### Added

- **New Devices**
  - Added H613A to bluetooth only light strips
  - Added H613C to bluetooth only light strips
  - Added H61A0 to bluetooth only light strips
- **Logging**
  - AWS account topic and device topics will now be redacted from the Homebridge log

### Changed

- Bump `node` recommended versions to v14.18.1 or v16.13.0
- Bump `axios` to v0.24.0

## v4.15.0 (2021-10-20)

### Added

- **New Devices**
  - Added H5102 to temperature/humidity sensors

### Changed

- Some small changes to Fakegato debug logging

## v4.14.0 (2021-10-16)

### Added

- **New Devices**
  - Added H5074 to temperature/humidity sensors
  - Added H613C to bluetooth only light strips

### Changed

- Recommended node versions bumped to v14.18.1 or v16.11.1
- Recommended Homebridge bumped to v1.3.5
- Bump `axios` to v0.23.0

### Fixed

- H6072 brightness and colour commands don't work with AWS

## v4.13.1 (2021-10-03)

### Changed

- Updated bluetooth dependencies

## v4.13.0 (2021-10-03)

### Added

- **New Devices**
  - Added H6170 to bluetooth only light strips

### Changed

- Bump `axios` to v0.22.0

## v4.12.3 (2021-09-30)

### Changed

- Recommended node versions bumped to v14.18.0 or v16.10.0

## v4.12.2 (2021-09-25)

### Fixed

- 'Segmented' scenes not being added correctly

## v4.12.1 (2021-09-25)

### Changed

- Use `@homebridge/noble` repo to fix noble `EALREADY` crash

## v4.12.0 (2021-09-21)

### Added

- Added four more custom scene options called 'Segmented' for segmented light scenes
- Added the option to use an AWS code using the `bulb` AWS command property

## v4.11.0 (2021-09-14)

### Added

- **New Devices**
  - Added `H5082` to dual outlet devices
- New `offlineAsOff` setting to show offline devices as OFF in HomeKit

### Fixed

- Don't throw error when **only** AWS update is used
- Disable colour commands via AWS/BLE for `H6199` as seems not supported

## v4.10.0 (2021-09-09)

### Added

- **New Devices**
  - Added `H5053` to temperature/humidity sensors supported list

### Changed

- `configureAccessory` function simplified to reduce chance of accessory cache retrieval failing
- Bump `axios` to v0.21.4

## v4.9.0 (2021-09-05)

### Added

- **New Devices**
  - Added `H6147` to bluetooth-only supported list

### Changed

- Recommended node version bumped to v14.17.6
- Bump `axios` to v0.21.3

## v4.8.0 (2021-08-30)

### Added

- Added `H5072` to not-supported list

### Changed

- Remove `node-machine-id` in favour of generating a client id based on Govee username
- AWS client id is now unique per device

## v4.7.0 (2021-08-26)

### Added

- **New Devices**
  - Added `H6102` to bluetooth-only supported list

## v4.6.0 (2021-08-22)

### Added

- **New Devices**
  - Added `H6179` to bluetooth-only supported list

## v4.5.0 (2021-08-16)

### Added

- **New Devices**
  - Added `H6138` to bluetooth-only supported list
  - Added `H6001` to not-supported list (model must use undocumented bluetooth commands)

### Changed

- **Unsupported Devices**
  - Plugin will remove existing accessories whose model is unsupported
- **Platform Versions**
  - Recommended node version bumped to v14.17.5

### Fixed

- More specific-case logging when device updates fail (eg not displaying reverting to API if not unsupported API model)
- Plugin will ignore incoming AWS updates when controlling colour temperature as can sometimes incorrectly disable adaptive lighting
- Attempt to fix a situation when `node-machine-id` fails to obtain the machine uuid
- Attempt to fix a situation when the plugin would crash Homebridge in a loop if running on a non-macOS platform with no bluetooth module

## v4.4.1 (2021-08-10)

### Fixed

- Removed H6144 from 'scale brightness' list, fixes [#99](https://github.com/homebridge-plugins/homebridge-govee/issues/99)

## v4.4.0 (2021-08-09)

### Added

- **New Devices**
  - Added `H5051` to temp/humidity sensor supported list
  - Added new API models: `H7050` `H6051` `H6056` `H6061` `H6058` `H6073` `H6076` `H619A` `H619C` `H618A` `H618C` `H6008` `H6071` `H6075` `H614A` `H614B` `H614E` `H618E` `H619E`

## v4.3.0 (2021-08-05)

### Added

- **New Devices**
  - Added `H5101` to temp/humidity sensor supported list

### Changed

- **AWS Codes**
  - ⚠️ The format of the code that the plugin needs has changed
    - You will need to re-obtain your AWS codes using the same method as before and save them into the configuration

### Fixed

- Fixes an issue preventing outlet devices from initialising

## v4.2.0 (2021-08-04)

### Added

- **New Devices**
  - Added `H6126` to bluetooth-only supported list

### Fixed

- Fixes an issue where AWS was not being enabled for non-configured light strips

## v4.1.0 (2021-08-04)

### Added

- **Govee Lights**
  - Support for two more custom scene codes and two mode custom diy mode codes
- **New Devices**
  - Added `H6125` to bluetooth-only supported list

### Fixed

- **Logging**
  - Certain common errors made easier to read
  - Stringify new device objects so they appear in HOOBS log

## v4.0.2 (2021-07-30)

### Changed

- A log warning for certain models which use a different data format for scenes

### Fixed

- Adaptive Lighting will now be turned off when using the Govee app to use a scene for these certain models

## v4.0.1 (2021-07-29)

### Fixed

- An issue where custom scenes weren't visible in Eve app

## v4.0.0 (2021-07-29)

### Added

- **New Devices**
  - Added `H6127` to the bluetooth only model list
  - Added `H6171` to the bluetooth only model list
- **Configuration**
  - Plugin will now check for duplicate device ID entries in the config and ignore them

### Changed

- ⚠️ **Platform Versions**

  - Recommended node version bumped to v14.17.4
  - Recommended homebridge version bumped to v1.3.4

- ⚠️ **AWS Control**
  - AWS connection is now **enabled** by default for Govee Lights that support this mode
    - If for any reason you want to disable this then there is a new 'Disable AWS Control' setting

### Fixed

- Older models may supply device id in a format without colons and in lowercase (plugin reformats)
- Use device ble address that Govee sometimes supplies rather than calculating from existing device id
- Removed `H6141` from bluetooth only model list as is in fact wifi too

### Removed

- 'Experimental' labels have been removed from AWS control, BLE control and scene mode settings
  - Whilst maybe not perfect(!), a lot of users have had success with both connection methods

## v3.8.0 (2021-07-27)

### Added

- `H6053` and `H6141` light models to bluetooth-only supported list
- Optionally use a base64 encoded version of your Govee password in the configuration

## v3.7.0 (2021-07-22)

### Added

- **New Devices**
  - Support for the H5075 Thermo-Hygrometer via wifi connection
    - Readings may not be reliable. Recommended to use homebridge-plugin-govee to connect over bluetooth.
- **Govee Lights**
  - Added support for colour temperature control over AWS connection
  - Plugin will apply 'ignore timeout' for incoming API updates if incoming update received over AWS

### Changed

- **Govee Lights**

  - Plugin now uses a fix list of kelvin to RGB calculations (not a formula) which are the values that Govee uses
  - Reduced 'ignore timeout' from 2 minutes to 1 minute as Govee API reaction times seem to have improved

## v3.6.0 (2021-07-20)

### Added

- **Experimental AWS Control**
  - This release includes a new connection method for certain Govee Light models - AWS control - which can improve response times when controlling lights (AWS control is a real-time persistent connection)
  - As with the bluetooth connection, this is still experimental and will only be enabled if explicitly enabled in the plugin settings
  - You can check whether your model supports this connection method in the Homebridge plugin settings UI on the 'My Devices' tab
  - The different connection methods work with each other so it is possible to enable both AWS and bluetooth control for your lights
- **Scenes/Music/DIY Modes**
  - If you Govee Lights support AWS or bluetooth connection, you can use the plugin settings and the Eve app to setup HomeKit scenes for your Govee scenes, music mode and DIY modes that you have created in the Govee app. Check the wiki for more information.
- **New Devices**
  - Support for the H5179 Thermo-Hygrometer via wifi connection
  - Experimental support for the H5054 Leak Sensor via wifi connection
  - The plugin will now log extra information for devices that are not currently supported to be included in a Github issue to see whether support can be enabled for more models in the future

### Changed

- A bluetooth connection will no longer disconnect and reconnect to the same lights if the connection still exists from a previous update
- Certain bluetooth (noble) warnings will now only appear in the log when the plugin is in debug mode

### Fixed

- A number of bugs/problems concerning the bluetooth packages and connection
- An issue preventing Govee Outlets from initialising into Homebridge

## v3.5.1 (2021-07-14)

### Changed

- Bluetooth device disconnection log message only shown in debug mode

### Fixed

- A bug preventing accessories being added to Homebridge
- A characteristic warning when an out of range brightness is received from Govee

## v3.5.0 (2021-07-14)

### Added

- Support for AWS control of certain devices
- Structure for supporting Govee leak sensors

### Changed

- Continued bluetooth control changes

### Fixed

- An issue where bluetooth control wasn't adhering to the configuration

## v3.4.4 (2021-07-13)

## v3.4.3 (2021-07-13)

## v3.4.2 (2021-07-13)

### Changed

- Continued refactoring and testing of bluetooth implementation

## v3.4.1 (2021-07-12)

### Changed

- Try sending colour temperature over bluetooth for models with cold/warm leds
- Small changes to logging, makes it clearer when updates are sent/received over bluetooth or cloud

### Fixed

- An issue where brightness would be repeatedly logged if the received value is more than `100`

## v3.4.0 (2021-07-12)

### Added

- Support for Bluetooth control for power/brightness/colour for supported devices
  - Extra packages may need to be installed on your system - [see wiki](https://github.com/homebridge-plugins/homebridge-govee/wiki/Bluetooth-Control)
  - Enter your Govee username and password in the config
  - Create an entry for your light in the 'Light Devices' section and check 'Enable Bluetooth Control'

### Changed

- **Homebridge UI**
  - `label` field now appears first in the device configuration sections
  - A device can now be ignored/removed from Homebridge by the `ignoreDevice` setting in the device configuration sections

### Removed

- `ignoredDevices` configuration option (see alternate way of ignore a device above)

## v3.3.2 (2021-07-08)

### Changes

- Revert node version bump to v14.17.3 (back to v14.17.2)

## v3.3.1 (2021-07-07)

## vFixed

- Brightness issue for H6054

## v3.3.0 (2021-07-06)

### Added

- **Govee Outlets**
  - `showAs` setting to expose Govee outlet devices as a `Switch` or `AirPurifier` accessory in HomeKit
- **Govee Lights**
  - Remove Adaptive Lighting feature from a device by setting the `adaptiveLightingShift` to `-1`
- **Accessory Logging**
  - `overrideLogging` setting per device type (to replace the removed `overrideDisabledLogging`), which can be set to (and will override the global device logging and debug logging settings):
    - `"default"` to follow the global device update and debug logging setting for this accessory (default if setting not set)
    - `"standard"` to enable device update logging but disable debug logging for this accessory
    - `"debug"` to enable device update and debug logging for this accessory
    - `"disable"` to disable device update and debug logging for this accessory

### Changed

- ⚠️ Govee outlet devices (currently exposed as a `Switch`) will now be exposed as an `Outlet` by default
- Light devices will now turn on to the previous brightness (not 100%) when turning on after setting brightness to 0%
- More interactive Homebridge UI - device configuration will expand once device ID entered
- Small changes to the startup logging
- Recommended node version bump to v14.17.3

### Removed

- `overrideDisabledLogging` setting for each accessory type

## v3.2.4 (2021-06-06)

### Changed

- Switch list of 'models to not scale brightness' to a list of 'models **to** scale brightness'
- Use `standard-prettier` code formatting
- Recommended node version bump to v14.17.0

## v3.2.3 (2021-05-10)

### Changed

- Round kelvin value sent to Govee to nearest 100
- Skip Adaptive Lighting update if kelvin value is same as previous update
- Show light as off if brightness set to 0%

## v3.2.2 (2021-05-10)

### Removed

- Removed `language` config option

## v3.2.1 (2021-05-10)

### Removed

- Removed `forceUpdates` config option - this is now hard-coded to `true`

## v3.2.0 (2021-05-10)

### Added

- Support for new outlet devices:
  - `H5080`
- Support for new RGB devices:
  - `H6062` `H6072`
  - `H611A` `H611B` `H611C` `H611Z` `H6121` `H614C` `H614D` `H615A` `H615B` `H615C` `H615D` `H6154`
  - `H7006` `H7007` `H7008` `H7012` `H7013` `H7020`
- Use minimum and maximum kelvin reported per devices for models that support this
- Show minimum and maximum kelvin values reported by device in plugin-ui

### Changed

- Catch polling '400' error separately and only show in logs when in debug mode
- Reduce 'No Response' timeout to 2 seconds
- Ensure user is using at least Homebridge v1.3.0

### Fixed

- Brightness fix for H6052
- Update the correct corresponding characteristic after the 'No Response' timeout

## v3.1.4 (2021-05-04)

### Changed

- Accessory 'identify' function will now add an entry to the log
- Backend refactoring, function and variable name changes

### Removed

- Removal of device 'retrievable' and 'controllable' status as they seem to serve no purpose

## v3.1.3 (2021-04-24)

### Changed

- Use `colorTem` for colour temperature updates for devices that support this command
  - This will use the white LEDs on devices that have them
- Include a link in the 'device offline' log message for further details of this issue

### Fixed

- Fixes a brightness issue with the H6143 model

## v3.1.2 (2021-04-16)

### Changed

- Recover accessories from the cache using the UUID
- Update wiki links in the Homebridge plugin-ui

### Fixed

- Fix characteristic NaN warning for `LastActivation`

## v3.1.1 (2021-04-12)

### Changed

- Updated plugin-ui 'Support' page links to match GitHub readme file

## v3.1.0 (2021-04-07)

### Added

- `forceUpdates` configuration option for force-sending device updates even if Govee is reporting your devices as offline

### Changed

- Updated README to reflect minimum supported Homebridge/HOOBS and Node versions
- Updated recommended Node to v14.16.1

### Removed

- Removed development code for scene support

## v3.0.0 (2021-04-03)

### Requirements

- **Homebridge Users**

  - This plugin has a minimum requirement of Homebridge v1.3.3

- **HOOBS Users**
  - This plugin has a minimum requirement of HOOBS v3.3.4

### Changed

- Use the new `.onSet` methods available in Homebridge v1.3
- Plugin will report 'offline' devices with a 'No Response' message in HomeKit apps when controlled (and this status will be reverted after 5 seconds)

## v2.14.2 (2021-03-22)

### Changed

- Updated plugin ui to use reported `online` status for the 'Cloud Status' instead of the reported `controllable` status

## v2.14.1 (2021-03-21)

### Fixed

- Fixes an issue with online/offline status as certain devices seem to report status as a boolean (not as a string)

## v2.14.0 (2021-03-21)

### Added

- Device online/offline status logging to make it clearer if a device is connected to wifi

### Changed

- **Light devices** will now send on/off commands **after** brightness and colour ([#56](https://github.com/homebridge-plugins/homebridge-govee/issues/56))
- More welcome messages
- Updated `plugin-ui-utils` dependency

## v2.13.2 (2021-03-17)

### Changed

- Modified config schema to show titles/descriptions for non Homebridge UI users

## v2.13.1 (2021-03-14)

### Changed

- Adaptive Lighting now requires Homebridge 1.3 release

## v2.13.0 (2021-03-01)

### Added

- A `label` setting per device group which has no effect except to help identify the device when editing the configuration
- Show a red/green icon in the Homebridge plugin-ui to show device reachability
- Plugin will automatically retry HTTP connection on startup in the event of certain error codes
- **In Development**
  - A configuration option to expose four non-working scenes per light device
  - The idea of this is to experiment with how scenes could work if Govee enable this functionality through the API
  - The scene buttons that appear have **no** effect except logging what should happen

### Changed

- Less strict threshold for determining a 'significant' colour change for disabling Adaptive Lighting
- Show a more user friendly log message on timeout error from Govee
- 502 and timeout errors will be hidden from the log if one has already been received during the previous minute
- Updated minimum Node to v14.16.0

## v2.12.2 (2021-02-17)

### Changed

- In debug mode, the plugin will log each device's customised options when initialised

## v2.12.1 (2021-02-17)

### Changed

- Raised minimum Homebridge beta required for Adaptive Lighting to 1.3.0-beta.58

## v2.12.0 (2021-02-13)

### Added

- A configurable minimum brightness step per Govee light bulb/strip
- The ability to explicitly enable device logging _per_ device if you have `disableDeviceLogging` set to `true`

### Changed

- Show a more user friendly log message on 502 error from Govee
- Stop subsequent warning messages if a device fails to initialise
- Changes to colour conversion:
  - Lighter colours appear brighter
  - Solid red is now easier to obtain via the Home app

## v2.11.2 (2021-02-11)

### Changed

- Suitable range for `adaptiveLightingShift` added to description
- Link to 'Uninstall' wiki page in the plugin-ui
- Updated minimum Homebridge to v1.1.7
- Fakegato library formatting and simplification

### Removed

- Removed concurrency limit from http queue as throttling is based on the interval and cap

## v2.11.1 (2021-02-10)

### Changed

- Updated minimum node to v14.15.5

### Fixed

- Fixes an issue when initialising switch devices

## v2.11.0 (2021-02-09)

### Added

- 'Light Devices' config section where you can define settings per device, starting with:
  - New `adaptiveLightingShift` option to offset the Adaptive Lighting values to make the light appear warmer
- Eve history service for Govee Wi-Fi switches

### Changed

- User inputted Govee device IDs will now be parsed more thoroughly

### Fixed

- Fixed a bug when trying to select a different device in the Homebridge plugin-ui

## v2.10.1 (2021-02-08)

### Changed

- Improvements to colour temperature conversion

### Fixed

- Fixed a bug where Adaptive Lighting would not be disabled if the colour was changed from the Govee app
- Hide the `Config entry [plugin_map] is unused and can be removed` notice for HOOBS users

## v2.10.0 (2021-02-08)

### Added

- Configuration setting `controlInterval` to change the 7500ms delay introduced in v2.9.0
  - This setting is visible in the Homebridge plugin UI screen under 'Optional Settings'
  - The default value for this setting will be 500ms but if you experience connectivity issues I would suggest increasing this number (by multiples of 500) until you find a value which works well for you

### Changed

- Error stack will be hidden when the disabled plugin message appears in the log
- More colour conversation formula changes

### Fixed

- Brightness fix for the H6003

## v2.9.0 (2021-02-06)

### Added

- This release hopes to bring more reliability when using HomeKit scenes and device groupings, by using:
  - A queueing system for device updates (HTTP requests) to replace the random delays
  - Delays between HTTP requests are set to 7.5 seconds which seems to work reliably
  - The refresh interval for device sync will skip whilst device updates are being sent
- Configuration checks to highlight any unnecessary or incorrectly formatted settings you have
- Link to 'Configuration' wiki page in the plugin-ui

### Changed

- ⚠️ `ignoredDevices` configuration option is now an array not a string
- If a device's current status cannot be retrieved then the log message will only be displayed in debug mode
- Colour conversation formula changes
- Error messages refactored to show the most useful information
- [Backend] Major code refactoring
- [Backend] Code comments

## v2.8.4 (2021-01-29)

### Changed

- More consistent and clearer error logging
- Minor code refactors
- Updated plugin-ui-utils dep and use new method to get cached accessories

### Fixed

- H6109 brightness fix

## v2.8.3 (2021-01-24)

### Fixed

- H6195 brightness fix

## v2.8.2 (2021-01-24)

### Changed

- Backend - better handling of errors

## v2.8.1 (2021-01-21)

### Changed

- Minimum Homebridge beta needed for Adaptive Lighting bumped to beta-46.

## v2.8.0 (2021-01-18)

### Changed

- Plugin will log incoming device updates in `debug` mode
  - For standard usage I would recommend to have plugin `debug` mode set to OFF/FALSE, as this change will add an update to your log every X seconds depending on your refresh interval (which is 15 seconds by default)

### Fixed

- Brightness fix for `H7022` model

## v2.7.3 (2021-01-14)

### Changed

- Expose H5001, H5081 and H7014 as switches (not lightbulbs)
- Ensures brightness value is in [0, 100]

## v2.7.1 (2021-01-13)

### Changed

- Created CHANGELOG.md

### Fixed

- Brightness fix for H6188

## v2.7.0 (2021-01-12)

### New

- New configuration option `disableDeviceLogging` to stop device state changes being logged

### Changed

- Improved validation checks and formatting for user inputs
- Changes to startup log messages
- Backend code changes

### Removed

- Removal of maximum value for `number` types on plugin settings screen
