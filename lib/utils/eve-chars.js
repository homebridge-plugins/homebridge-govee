export default class {
  constructor(api) {
    this.uuids = {
      currentConsumption: 'E863F10D-079E-48FF-8F27-9C2605A29F52',
      voltage: 'E863F10A-079E-48FF-8F27-9C2605A29F52',
      electricCurrent: 'E863F126-079E-48FF-8F27-9C2605A29F52',
      lastActivation: 'E863F11A-079E-48FF-8F27-9C2605A29F52',
    }

    const uuids = this.uuids

    this.CurrentConsumption = class extends api.hap.Characteristic {
      constructor() {
        super('Current Consumption', uuids.currentConsumption)
        // decimal, like Eve's own plugs: whole watts read 5.5W as 6W, which
        // trips an automation that waits for a reading below 6W (#1379)
        this.setProps({
          format: api.hap.Formats.FLOAT,
          unit: 'W',
          maxValue: 100000,
          minValue: 0,
          minStep: 0.01,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.Voltage = class extends api.hap.Characteristic {
      constructor() {
        super('Voltage', uuids.voltage)
        this.setProps({
          format: api.hap.Formats.FLOAT,
          unit: 'V',
          maxValue: 100000000000,
          minValue: 0,
          minStep: 1,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.ElectricCurrent = class extends api.hap.Characteristic {
      constructor() {
        super('Electric Current', uuids.electricCurrent)
        this.setProps({
          format: api.hap.Formats.FLOAT,
          unit: 'A',
          maxValue: 100000000000,
          minValue: 0,
          minStep: 0.1,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.LastActivation = class extends api.hap.Characteristic {
      constructor() {
        super('Last Activation', uuids.lastActivation)
        this.setProps({
          format: api.hap.Formats.UINT32,
          unit: api.hap.Units.SECONDS,
          perms: [api.hap.Perms.PAIRED_READ, api.hap.Perms.NOTIFY],
        })
        this.value = this.getDefaultValue()
      }
    }

    this.CurrentConsumption.UUID = this.uuids.currentConsumption
    this.Voltage.UUID = this.uuids.voltage
    this.ElectricCurrent.UUID = this.uuids.electricCurrent
    this.LastActivation.UUID = this.uuids.lastActivation
  }
}
