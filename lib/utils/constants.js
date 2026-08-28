export default {
  defaultConfig: {
    name: 'Govee',
    apiKey: '',
    username: '',
    password: '',
    code: '',
    apikey: '',
    ignoreMatter: false,
    disableDeviceLogging: false,
    httpRefreshTime: 30,
    awsDisable: false,
    bleDisable: false,
    bleRefreshTime: 300,
    lanDisable: false,
    lanRefreshTime: 30,
    lanScanInterval: 60,
    openApiDisable: false,
    openApiRefreshTime: 30,
    bleControlInterval: 5,
    colourSafeMode: false,
    lightDevices: [],
    switchDevices: [],
    leakDevices: [],
    thermoDevices: [],
    fanDevices: [],
    heaterDevices: [],
    dehumidifierDevices: [],
    humidifierDevices: [],
    purifierDevices: [],
    diffuserDevices: [],
    kettleDevices: [],
    iceMakerDevices: [],
    platform: 'Govee',
  },

  defaultValues: {
    adaptiveLightingShift: 0,
    bleControlInterval: 5,
    awsColourMode: 'default',
    bleRefreshTime: 300,
    brightnessStep: 1,
    httpRefreshTime: 30,
    lanRefreshTime: 30,
    lanScanInterval: 60,
    lowBattThreshold: 20,
    openApiRefreshTime: 30,
    showAs: 'default',
  },

  minValues: {
    adaptiveLightingShift: -1,
    bleControlInterval: 5,
    bleRefreshTime: 60,
    brightnessStep: 1,
    httpRefreshTime: 30,
    lanRefreshTime: 10,
    lanScanInterval: 30,
    lowBattThreshold: 1,
    openApiRefreshTime: 30,
  },

  // A Node timer holds its delay in a signed 32-bit integer. Over 2147483647 ms
  // it does not throw - it quietly becomes 1 ms, so any of these set past that
  // point would poll a thousand times a second rather than slowly. 2073600
  // seconds is 24 days, comfortably inside the limit once multiplied up.
  maxValues: {
    bleRefreshTime: 2073600,
    httpRefreshTime: 2073600,
    lanRefreshTime: 2073600,
    lanScanInterval: 2073600,
    openApiRefreshTime: 2073600,
  },

  allowed: {
    lightDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'showAs',
      'customAddress',
      'customIPAddress',
      'adaptiveLightingShift',
      'awsColourMode',
      'brightnessStep',
      'scene',
      'sceneTwo',
      'sceneThree',
      'sceneFour',
      'musicMode',
      'musicModeTwo',
      'videoMode',
      'videoModeTwo',
      'diyMode',
      'diyModeTwo',
      'diyModeThree',
      'diyModeFour',
      'segmented',
      'segmentedTwo',
      'segmentedThree',
      'segmentedFour',
      'sceneSelector',
      'sceneSelectorSnapshots',
      'sceneSelectorDiy',
    ],
    switchDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'showAs',
      'temperatureSource',
    ],
    leakDevices: ['label', 'deviceId', 'ignoreDevice', 'lowBattThreshold'],
    thermoDevices: ['label', 'deviceId', 'ignoreDevice', 'lowBattThreshold', 'openApiTempUnit', 'showExtraSwitch'],
    fanDevices: ['label', 'deviceId', 'ignoreDevice', 'hideLight'],
    heaterDevices: ['label', 'deviceId', 'ignoreDevice', 'tempReporting'],
    humidifierDevices: ['label', 'deviceId', 'ignoreDevice'],
    dehumidifierDevices: ['label', 'deviceId', 'ignoreDevice'],
    purifierDevices: ['label', 'deviceId', 'ignoreDevice'],
    diffuserDevices: ['label', 'deviceId', 'ignoreDevice'],
    kettleDevices: [
      'label',
      'deviceId',
      'ignoreDevice',
      'hideModeGreenTea',
      'hideModeOolongTea',
      'hideModeCoffee',
      'hideModeBlackTea',
      'showCustomMode1',
      'showCustomMode2',
    ],
    iceMakerDevices: ['label', 'deviceId', 'ignoreDevice', 'sceneSelector', 'sceneSelectorSnapshots', 'sceneSelectorDiy'],
    awsColourMode: ['default', 'rgb', 'redgreenblue'],
    openApiTempUnit: ['auto', 'c', 'f'],
    showAs: [
      'default',
      'audio',
      'box',
      'cooler',
      'heater',
      'purifier',
      'stick',
      'switch',
      'tap',
      'valve',
    ],
  },

  models: {
    rgb: [
      'B7080', // 4 pcs Rock Lights
      'B7081', // 8 pcs Rock Lights
      'B7082', // 6 pcs Rock Lights
      'H1161', // Govee Sync
      'H1163', // Music Sync Box 2
      'H1168', // Sync Box
      'H1232', // Ceiling Light
      'H1250', // 18-Inch Ceiling Light Pro, https://github.com/homebridge-plugins/homebridge-govee/issues/1333
      'H1252', // Ceiling Light
      'H1270', // Ceiling Light Ultra
      'H12D0', // Govee Ceiling Light
      'H1401',
      'H14A1', // Smart LED Bulb
      'H14C0', // https://github.com/homebridge-plugins/homebridge-govee/issues/1301
      'H14C1', // https://github.com/homebridge-plugins/homebridge-govee/issues/1319
      'H14C2', // Edison Bulb
      'H1630',
      'H16B0', // https://github.com/homebridge-plugins/homebridge-govee/issues/1278
      'H16C0', // https://github.com/homebridge-plugins/homebridge-govee/issues/1286
      'H1741', // https://github.com/homebridge-plugins/homebridge-govee/issues/1278
      'H1771', // Table Lamp
      'H1811', // Projector Light
      'H1A42', // Strip Light
      'H1A43', // Strip Light
      'H1A44', // Strip Light
      'H1A45', // Strip Light
      'H1AA2', // Strip Light
      'H1AA5', // Strip Light
      'H1AB1', // Strip Light
      'H1AB2', // Strip Light
      'H1AB3', // Strip Light
      'H1B6A', // Strip Light
      'H2800', // Monitor Light Bar
      'H2A40', // TV Backlight 3
      'H2A41', // TV Backlight 3
      'H3001', // bluetooth-only solar string lights, https://github.com/homebridge-plugins/homebridge-govee/issues/1328
      'H30D0', // Bulb String Lights
      'H30D1', // Bulb String Lights
      'H3200', // https://github.com/homebridge-plugins/homebridge-govee/issues/1292
      'H3351', // Wall Floodlight
      'H3401', // Outdoor Deck Lights
      'H3500', // RGBIC Path Lights
      'H3501', // RGBIC Path Lights
      'H3510', // Cylinder Pathway Light
      'H3511', // Cylinder Pathway Light
      'H3751', // Wall Light Pro
      'H3860', // Projector Light
      'H3A51', // Permanent Lights 2 Pro
      'H3A52', // Permanent Lights 2 Pro
      'H3A53', // Permanent Lights 2 Pro
      'H6001',
      'H6002',
      'H6003',
      'H6004',
      'H6005',
      'H6006',
      'H6007',
      'H6008',
      'H6009',
      'H600A',
      'H600B',
      'H600C',
      'H600D',
      'H6010',
      'H6011',
      'H6013',
      'H601A',
      'H601B',
      'H601C',
      'H601D',
      'H601E',
      'H601F',
      'H6020',
      'H6022',
      'H6038',
      'H6039',
      'H6042',
      'H6043',
      'H6046',
      'H6047',
      'H6048',
      'H6049',
      'H604A',
      'H604B',
      'H604C',
      'H604D',
      'H6050',
      'H6051',
      'H6052',
      'H6053',
      'H6054',
      'H6055',
      'H6056',
      'H6057',
      'H6058',
      'H6059',
      'H605A',
      'H605B',
      'H605C',
      'H605D',
      'H6061',
      'H6062',
      'H6063',
      'H6065',
      'H6066',
      'H6067',
      'H6069',
      'H606A',
      'H6071',
      'H6072',
      'H6073',
      'H6075',
      'H6076',
      'H6078',
      'H6079',
      'H607C',
      'H6083',
      'H6085',
      'H6086',
      'H6087',
      'H6088',
      'H6089',
      'H608A',
      'H608B',
      'H608C',
      'H608D',
      'H6091',
      'H6092',
      'H6093',
      'H6094', // Star Light Projector
      'H6095',
      'H6097',
      'H6098',
      'H6099',
      'H609D',
      'H60A0',
      'H60A1',
      'H60A4',
      'H60A6',
      'H60B0',
      'H60B1',
      'H60B2',
      'H60B3',
      'H60C1',
      'H6101',
      'H6102',
      'H6104',
      'H6105', // TV Backlight
      'H6107',
      'H6109',
      'H610A',
      'H610B',
      'H6110',
      'H6113', // Car Light
      'H6114',
      'H6116',
      'H6117',
      'H6118', // Car Led Lights
      'H6119', // Car Led Lights
      'H611A',
      'H611B',
      'H611C',
      'H611Z',
      'H6121',
      'H6125',
      'H6126',
      'H6127',
      'H6129',
      'H612A',
      'H612B',
      'H612C',
      'H612D',
      'H612E',
      'H612F',
      'H6135',
      'H6137',
      'H6138',
      'H6139',
      'H613A',
      'H613B',
      'H613C',
      'H613D',
      'H613E',
      'H613F',
      'H613G',
      'H6141',
      'H6142',
      'H6143',
      'H6144',
      'H6145',
      'H6146',
      'H6147',
      'H6148',
      'H614A',
      'H614B',
      'H614C',
      'H614D',
      'H614E',
      'H6154',
      'H6159',
      'H615A',
      'H615B',
      'H615C',
      'H615D',
      'H615E',
      'H615F',
      'H6160',
      'H6161',
      'H6163',
      'H6165', // Rock Light
      'H6166', // Rock Light
      'H6167',
      'H6168',
      'H6169',
      'H616B', // RGB Strip Lights
      'H616C',
      'H616D',
      'H616E',
      'H6170',
      'H6171',
      'H6172',
      'H6173',
      'H6175',
      'H6176',
      'H6178',
      'H6179',
      'H617A',
      'H617C',
      'H617E',
      'H617F',
      'H617G', // RGBIC LED Strip Light
      'H6181',
      'H6182',
      'H6184', // Car Underglow Lights
      'H6185',
      'H6188',
      'H618A',
      'H618C',
      'H618E',
      'H618F',
      'H618G', // RGBIC LED Strip Light
      'H6192', // Motorcycle LED Lights
      'H6194', // Motorcycle LED Lights
      'H6195',
      'H6196',
      'H6198',
      'H6199',
      'H619A',
      'H619B',
      'H619C',
      'H619D',
      'H619E',
      'H619Z',
      'H61A0',
      'H61A1',
      'H61A2',
      'H61A3',
      'H61A5',
      'H61A8',
      'H61A9',
      'H61B1',
      'H61B2',
      'H61B3',
      'H61B5',
      'H61B6',
      'H61B8',
      'H61B9',
      'H61BA',
      'H61BC',
      'H61BE',
      'H61C2',
      'H61C3',
      'H61C5',
      'H61D2', // Neon Rope Light
      'H61D3',
      'H61D5',
      'H61D6',
      'H61E0',
      'H61E1',
      'H61E5',
      'H61E6',
      'H61F2',
      'H61F5',
      'H61F6',
      'H6350', // Net Lights
      'H6351', // Net Lights
      'H6601',
      'H6602',
      'H6603', // AI Sync Box Kit
      'H6604',
      'H6608', // Gaming Light Kit G1
      'H6609',
      'H6630',
      'H6631',
      'H6640',
      'H6641',
      'H6671',
      'H6672',
      'H6690', // TV Backlight 3 Lite
      'H66A0',
      'H66A1',
      'H6800',
      'H6810',
      'H6811',
      'H6821', // Meteor Shower Lights
      'H6840',
      'H6841',
      'H6842', // Cone Tree Lights
      'H6843', // Cone Tree Lights
      'H6850', // Govee Ball Lights
      'H6860', // C9 String Lights
      'H6861', // C9 String Lights
      'H6870', // RGBWIC String Lights
      'H6871',
      'H7001',
      'H7002',
      'H7004', // Plant Grow Lights
      'H7005',
      'H7006',
      'H7007',
      'H7008',
      'H7010',
      'H7011',
      'H7012',
      'H7013',
      'H7015',
      'H7016',
      'H7017',
      'H7019',
      'H7020',
      'H7021',
      'H7022',
      'H7023',
      'H7024',
      'H7025',
      'H7026',
      'H7027', // https://github.com/homebridge-plugins/homebridge-govee/issues/1305
      'H7028',
      'H7029',
      'H702A',
      'H702B',
      'H702C',
      'H7031',
      'H7032',
      'H7033',
      'H7037',
      'H7038',
      'H7039',
      'H703A',
      'H703B',
      'H7040', // Camping lantern
      'H7041',
      'H7042',
      'H7045', // String Lights
      'H7046', // https://github.com/homebridge-plugins/homebridge-govee/issues/1297
      'H7050',
      'H7051',
      'H7052',
      'H7053',
      'H7055',
      'H7056',
      'H7057',
      'H7058',
      'H705A',
      'H705B',
      'H705C',
      'H705D',
      'H705E',
      'H705F',
      'H7060',
      'H7061',
      'H7062',
      'H7063',
      'H7065',
      'H7066',
      'H7067',
      'H7068',
      'H7069',
      'H706A',
      'H706B',
      'H706C',
      'H7070',
      'H7071', // Decoration Projector
      'H7072', // Lamp Post Lights
      'H7073',
      'H7075',
      'H7076',
      'H7078',
      'H707A',
      'H707B', // Permanent Lights Prism
      'H707C', // Permanent Lights Prism
      'H7086',
      'H7087',
      'H7090',
      'H7092',
      'H7093',
      'H7094',
      'H7095',
      'H70A1',
      'H70A2',
      'H70A3',
      'H70B1',
      'H70B3',
      'H70B4',
      'H70B5',
      'H70B6',
      'H70B8', // Lightwall
      'H70BC',
      'H70C1',
      'H70C2',
      'H70C4',
      'H70C5',
      'H70C7',
      'H70C9',
      'H70CB',
      'H70D1',
      'H70D2',
      'H70D3',
      'H7308', // Copper Wire Light
      'H7309', // Copper Wire Light
      'H7310', // Copper Wire Light
      'H7311', // Copper Wire Light
      'H7312', // Copper Wire Light
      'H7313', // Copper Wire Light
      'H7315', // LED Curtain Lights
      'H7317', // RGB Copper Wire Lights
      'H7318', // RGB Copper Wire Lights
      'H800B', // Govee Smart Bulb
      'H8015',
      'H801A', // Downlight
      'H801B',
      'H801C',
      'H801D', // https://github.com/homebridge-plugins/homebridge-govee/issues/1320
      'H8022',
      'H8025',
      'H8026', // LED Bulb String Lights
      'H802A', // https://github.com/homebridge-plugins/homebridge-govee/issues/1295
      'H8048', // Gaming Light Bars
      'H8057', // Flood Lights
      'H805A',
      'H805B',
      'H805C',
      'H805D', // Permanent Lights Elite
      'H8066',
      'H8067', // Outdoor Spotlights
      'H8069', // Mini Panel Lights
      'H806A',
      'H806C', // Permanent Lights Pro
      'H8072',
      'H8076',
      'H807C', // Floor Lamp 2
      'H808A',
      'H8098', // RGBIC TV Backlight 3S
      'H80A1',
      'H80A4',
      'H80B5', // Strip Light
      'H80C4',
      'H80C5',
      'H80D1', // Icicle Lights
      'H8604',
      'H8630', // Gaming Pixel Light
      'H8811',
      'H8840',
      'H8841',
      'HXXXX', // placeholder for LAN-only configured models
      'R1250',
      'R1401',
      'R14A1',
      'R14C0',
      'R14C1',
      'R14C2',
      'R1501',
      'R1630',
      'R16D0',
      'R1741',
      'R1810', // Star Light Projector
      'R2A80', // TV Backlight 3 Pro
      'R2A81', // TV Backlight 3 Pro
      'R3A51', // Permanent Lights
      'R60B3', // Uplighter Floor Lamp
      'R617G', // RGBIC LED Strip Light
      'R618D', // RGBIC LED Strip Light
      'R6842', // Cone Tree Lights
      'R6861', // C9 String Lights
      'R6871', // RGBWIC String Lights
      'R707A', // Permanent Lights Prism
      'R707B', // Permanent Lights Prism
      'R707C', // Permanent Lights Prism
    ],
    // H5901 is a water timer, controlled only through the OpenAPI - it has no
    // usable AWS, BLE or LAN path, so it needs an API key configured. Set
    // showAs to 'valve' or 'tap' for a more fitting HomeKit tile (#1324)
    switchSingle: ['H5001', 'H5080', 'H5081', 'H5083', 'H5085', 'H5086', 'H5901', 'H7014'],
    switchDouble: ['H5082', 'H5089'],
    // The H5161 shares the H5160's goodsType, which is what decides how the
    // app talks to it, so it is handled the same way
    switchTriple: ['H5160', 'H5161'],
    sensorLeak: ['H5054', 'H5058', 'H5059', 'H5830'],
    sensorThermo: [
      'B5178',
      'H5051',
      'H5052',
      'H5053',
      'H5055',
      'H5071',
      'H5072',
      'H5074',
      'H5075',
      'H5100',
      'H5101',
      'H5102',
      'H5103',
      'H5104',
      'H5105',
      'H5107', // https://github.com/homebridge-plugins/homebridge-govee/issues/803
      'H5108',
      'H5109', // https://github.com/homebridge-plugins/homebridge-govee/issues/1099
      'H5110', // https://github.com/homebridge-plugins/homebridge-govee/issues/1217
      'H5111', // same broadcast format as the H5101 family
      'H5112', // https://github.com/homebridge-plugins/homebridge-govee/issues/1197
      'H5171', // https://github.com/homebridge-plugins/homebridge-govee/issues/1243
      'H5174',
      'H5177',
      'H5179',
      'H5183',
      'H5190',
      'H5220', // same broadcast format as the H5101 family
      'H5310', // https://github.com/homebridge-plugins/homebridge-govee/issues/1293
      'R5112', // the refreshed H5112
    ],
    // Meat thermometers. None has had its readings worked out yet, so they
    // report what they send rather than showing a tile that never changes.
    // ⚠️ The H5183 is one of these but stays on the list above, because it has
    // been given working tiles for years and nobody has said they are wrong
    // Power only for now. It also has a mode and a light, which report what
    // they need rather than guessing (#1282)
    composter: ['H7184'],

    sensorProbe: [
      'H5181',
      'H5182',
      'H5184',
      'H5185', // https://github.com/homebridge-plugins/homebridge-govee/issues/804
      'H5191', // https://github.com/homebridge-plugins/homebridge-govee/issues/1121
      'H5192',
      'H5194',
      'H5196',
      'H5198',
      'H5199',
      'H5610',
    ],
    sensorMonitor: ['H5106'],
    sensorCO2: ['H5140'], // CO2 + temp + humidity monitor, AWS opcode 0x0A — closes #1179
    fan: ['H1310', 'H1370', 'H7100', 'H7101', 'H7102', 'H7103', 'H7105', 'H7106', 'H7107', 'H7111', 'H7112', 'R1310'],
    heater1: ['H7130', 'H713A', 'H713B', 'H713C', 'H7137', 'H713E'],
    heater2: ['H7131', 'H7132', 'H7133', 'H7134', 'H7135'],
    dehumidifier: ['H7150', 'H7151', 'H7152'],
    humidifier: ['H7140', 'H7141', 'H7142', 'H7143', 'H7145', 'H7146', 'H7147', 'H7148', 'H7149', 'H714E', 'H7160'],
    purifier: ['H7120', 'H7121', 'H7122', 'H7123', 'H7124', 'H7126', 'H7127', 'H7128', 'H7129', 'H712C'],
    diffuser: ['H7161', 'H7162'],
    iceMaker: ['H7172', 'H717D', 'H8102', 'H8120', 'H8121', 'H8122', 'H8131'],
    sensorButton: ['H5122'],
    sensorContact: ['H5023', 'H5123'],
    // Sensors whose readings are not worked out yet, so they report what
    // they send rather than showing a tile that never changes
    sensorUnknown: ['H5026', 'H5130'],
    sensorPresence: ['H5127'],
    kettle: ['H7170', 'H7171', 'H7173', 'H7175', 'H717A'],
    template: [
      'H1162', // https://github.com/homebridge-plugins/homebridge-govee/issues/422
      'H1167', // https://github.com/homebridge-plugins/homebridge-govee/issues/1142
      'H5010', // https://github.com/homebridge-plugins/homebridge-govee/issues/1235
      'H5024', // https://github.com/homebridge-plugins/homebridge-govee/issues/835
      'H5042', // https://github.com/homebridge-plugins/homebridge-govee/issues/849
      'H5043', // https://github.com/homebridge-plugins/homebridge-govee/issues/558
      // https://github.com/homebridge-plugins/homebridge-govee/issues/951
      // https://github.com/homebridge-plugins/homebridge-govee/issues/1117
      'H5121', // https://github.com/homebridge-plugins/homebridge-govee/issues/913
      'H5124', // https://github.com/homebridge-plugins/homebridge-govee/issues/1119
      'H5126', // https://github.com/homebridge-plugins/homebridge-govee/issues/910
      'H5129', // https://github.com/homebridge-plugins/homebridge-govee/issues/1084
      'H5125', // https://github.com/homebridge-plugins/homebridge-govee/issues/981
    ],
  },

  // Two-zone lights whose zones Govee lists but never routes. Not a device type
  // of its own - these stay in `models.rgb` like any other light, and only the
  // way their zones are driven differs.
  //
  // Govee advertises `mainLightToggle` and `backgroundLightToggle` for these,
  // and its cloud answers `{"status":"success"}` to both, but the command never
  // reaches the device. Nothing reports a failure, so the plugin cannot tell -
  // the tiles simply do nothing. The models here take the raw frame the device
  // itself reports its zones with instead (#1333).
  //
  // The H1270 is deliberately absent. It advertises the same capabilities, but
  // nobody has confirmed it shares the fault, so it stays on the toggle path.
  /**
   * Which light segments make up each zone of a two-zone light. Called "light
   * segments" to avoid any confusion with the unrelated `segmented`/
   * `segmentedTwo`/`segmentedThree`/`segmentedFour` config options above,
   * which name a captured scene or BLE code.
   *
   * How many light segments a light has can be read back from its own report,
   * but which segments belong to which zone cannot - nothing in the frame says
   * so. The H1250's split was established by changing one zone at a time and
   * watching which segments moved, so this is configuration, and a new model
   * should be measured rather than assumed to share the layout (#1333).
   */
  zoneLightModels: {
    H1250: {
      main: [16],
      background: Array.from({ length: 16 }, (_, index) => index),
    },
  },

  /**
   * Models whose two zones are driven through the official OpenAPI
   * `segmentedBrightness` / `segmentedColorRgb` capabilities rather than a
   * raw AWS frame - the cloud genuinely delivers these for the model, so no
   * captured frame is needed. Zone on/off is a segment brightness of zero.
   *
   * H601F (#1223): 7 segments. The owner's `aa a5` status dump showed the six
   * ambient ring segments first and the main downlight as the SEVENTH entry
   * (his ring was at 100% and his main at 10%, and only the last entry read
   * 10%) - so main is taken as segment 6, pending his confirmation from a
   * live test. His own guess was segment 0; the frame evidence won.
   */
  segmentedZoneModels: {
    H601F: {
      main: [6],
      background: [0, 1, 2, 3, 4, 5],
      // Real per-light on/off: `33 36 <light> <state>`, light 00 = main and
      // 01 = background, state absolute. Settled by the owner's four-frame
      // test in #1223 (each frame sent alone from known states) - NOT the
      // ceiling fans' `33 36 <main> <background>` pair frame, despite the
      // shared code
      awsToggleIndex: { main: 0x00, background: 0x01 },
    },
  },

  matterModels: [
    'H1401',
    'H14C0',
    'H14C1',
    'H3200',
    'H5085',
    'H600B',
    'H600D',
    'H601F',
    'H6022',
    'H6099',
    'H60A4',
    'H60A6',
    'H60C1',
    'H612B',
    'H619D',
    'H61D3',
    'H61D4',
    'H61D5',
    'H61E5',
    'H61F2',
    'H6641',
    'H6811',
    'H6840',
    'H7025',
    'H7063',
    'H7067',
    'H7068',
    'H7069',
    'H706A',
    'H706B',
    'H706C',
    'H7073',
    'H7075',
    'H7094',
    'H70C4',
    'H70C5',
    'H8015',
    'R1401',
    'R14C0',
  ],

  httpRetryCodes: ['ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED'],
}
