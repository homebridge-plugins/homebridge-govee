import {
  deviceComposterBasic,
  deviceDehumidifierBasic,
  deviceDiffuserBasic,
  deviceFanBasic,
  deviceHumidifierBasic,
  deviceIceMakerBasic,
  devicePurifierBasic,
} from './appliance-basic.js'
import deviceCoolerSingle from './cooler-single.js'
import deviceDehumidifierH7150 from './dehumidifier-H7150.js'
import deviceDiffuserH7161 from './diffuser-H7161.js'
import deviceFanH1370 from './fan-H1370.js'
import deviceFanH7100 from './fan-H7100.js'
import deviceFanH7105 from './fan-H7105.js'
import deviceFanH7107 from './fan-H7107.js'
import deviceHeater1A from './heater1a.js'
import deviceHeater1B from './heater1b.js'
import deviceHeater2 from './heater2.js'
import deviceHeaterSingle from './heater-single.js'
import deviceHumidifierH7140 from './humidifier-H7140.js'
import deviceHumidifierH7141 from './humidifier-H7141.js'
import deviceHumidifierH7142 from './humidifier-H7142.js'
import deviceHumidifierH7143 from './humidifier-H7143.js'
import deviceHumidifierH7160 from './humidifier-H7160.js'
import deviceIceMakerH7172 from './ice-maker-H7172.js'
import deviceKettle from './kettle.js'
import deviceLightSwitch from './light-switch.js'
import deviceLight from './light.js'
import deviceOutletSingle from './outlet-single.js'
import devicePurifierH7120 from './purifier-H7120.js'
import devicePurifierH7122 from './purifier-H7122.js'
import devicePurifierH7123 from './purifier-H7123.js'
import devicePurifierH7126 from './purifier-H7126.js'
import devicePurifierSingle from './purifier-single.js'
import deviceSensorBasic from './sensor-basic.js'
import deviceSensorCO2 from './sensor-co2.js'
import deviceSensorLeak from './sensor-leak.js'
import deviceSensorMonitor from './sensor-monitor.js'
import deviceSensorPresence from './sensor-presence.js'
import deviceSensorProbe from './sensor-probe.js'
import deviceSensorThermoSwitch from './sensor-thermo-switch.js'
import deviceSensorThermo from './sensor-thermo.js'
import deviceSwitchDouble, { asOutlet as deviceOutletDouble } from './switch-double.js'
import deviceSwitchSingle from './switch-single.js'
import deviceSwitchTriple, { asOutlet as deviceOutletTriple } from './switch-triple.js'
import deviceTapSingle from './tap-single.js'
import deviceTemplate from './template.js'
import deviceTVSingle from './tv-single.js'
import deviceValveSingle from './valve-single.js'

export default {
  deviceCoolerSingle,
  deviceDehumidifierH7150,
  deviceDehumidifierH7151: deviceDehumidifierH7150, // identical to the H7150
  deviceDehumidifierH7152: deviceDehumidifierH7150, // same device, and this gives it proper speed feedback
  deviceDiffuserH7161,
  deviceDiffuserH7162: deviceDiffuserH7161, // identical to the H7161
  deviceComposterBasic,
  deviceDehumidifierBasic,
  deviceDiffuserBasic,
  deviceFanBasic,
  // Ceiling fans, not tower fans. They were on the H7100 tower fan handler,
  // which is a different product entirely: Govee's own app files them under
  // Indoor Lighting as "Govee Ceiling Fan", while every H71xx is Air Treatment.
  // The H7100 handler builds no light at all and speaks the tower fan's speed
  // codes, so an owner got a fan tile that did nothing, an oscillation control
  // for a fan that cannot oscillate, and no light (#1352)
  deviceFanH1310: deviceFanH1370,
  deviceFanH1370,
  deviceFanR1310: deviceFanH1370, // R1310 is the newer naming of the H1310
  deviceFanH7100,
  deviceFanH7102: deviceFanH7100, // identical to the H7100
  deviceFanH7106: deviceFanH7100, // identical to the H7100
  deviceFanH7101: deviceFanH7100, // identical to the H7100, with a turbo mode it is never sent
  deviceFanH7105,
  deviceFanH7107,
  deviceFanH7111: deviceFanH7100, // same fan without the turbo mode, which is not sent
  deviceHeaterSingle,
  deviceHeater1A,
  deviceHeater1B,
  deviceHeater2,
  deviceHumidifierBasic,
  deviceHumidifierH7140,
  deviceHumidifierH7141,
  deviceHumidifierH7142,
  deviceHumidifierH7143,
  deviceHumidifierH7145: deviceHumidifierH7143, // identical to the H7143
  deviceHumidifierH7147: deviceHumidifierH7143, // identical to the H7143
  deviceHumidifierH7148: deviceHumidifierH7143, // identical to the H7143
  deviceHumidifierH7149: deviceHumidifierH7143, // identical to the H7143
  deviceHumidifierH714E: deviceHumidifierH7143, // identical to the H7143
  deviceHumidifierH7160,
  deviceIceMakerBasic,
  deviceIceMakerH7172,
  deviceIceMakerH717D: deviceIceMakerH7172, // identical to the H7172
  deviceIceMakerH8120: deviceIceMakerH7172, // identical to the H7172
  deviceIceMakerH8121: deviceIceMakerH7172, // same handler; its size byte order comes from the model
  deviceIceMakerH8122: deviceIceMakerH7172, // identical to the H8121
  deviceKettle,
  deviceLight,
  deviceLightSwitch,
  deviceOutletDouble,
  deviceOutletSingle,
  deviceOutletTriple,
  devicePurifierBasic,
  devicePurifierH7120,
  devicePurifierH7121: devicePurifierH7120, // identical apart from its sleep mode value, which is not sent
  devicePurifierH7122,
  devicePurifierH7123,
  devicePurifierH7124: devicePurifierH7123, // same device; this also gives it the #1261 air quality fix
  devicePurifierH7126,
  devicePurifierH7127: devicePurifierH7126, // identical to the H7126
  devicePurifierH7128: devicePurifierH7126, // identical to the H7126
  devicePurifierH7129: devicePurifierH7126, // identical to the H7126
  devicePurifierH712C: devicePurifierH7126, // identical to the H7126
  devicePurifierSingle,
  deviceSensorBasic,
  deviceSensorButton: deviceSensorBasic, // nothing decoded yet, so it reports instead
  deviceSensorCO2,
  deviceSensorContact: deviceSensorBasic, // nothing decoded yet, so it reports instead
  deviceSensorLeak,
  deviceSensorMonitor,
  deviceSensorPresence,
  deviceSensorThermo,
  deviceSensorThermoSwitch,
  deviceSensorProbe,
  deviceSwitchDouble,
  deviceSwitchSingle,
  deviceSwitchTriple,
  deviceTapSingle,
  deviceTemplate,
  deviceTVSingle,
  deviceValveSingle,
}
