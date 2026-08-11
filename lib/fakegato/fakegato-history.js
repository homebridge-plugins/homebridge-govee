import { Buffer } from 'node:buffer'
import { format as Format } from 'node:util'

import FakeGatoStorage from './fakegato-storage.js'
import FakeGatoTimer from './fakegato-timer.js'
import { toLongFormUUID, toShortFormUUID } from './uuid.js'

const _EPOCH = 978307200
const NON_HEX_REGEX = /[^\dA-F]/gi

let Characteristic
let Service

export default function (homebridge) {
  Characteristic = homebridge.hap.Characteristic
  Service = homebridge.hap.Service

  const hexToBase64 = val => Buffer.from((`${val}`).replace(NON_HEX_REGEX, ''), 'hex').toString('base64')

  const base64ToHex = (val) => {
    if (!val) {
      return val
    }
    return Buffer.from(val, 'base64').toString('hex')
  }

  const swap16 = val => ((val & 0xFF) << 8) | ((val >>> 8) & 0xFF)

  const swap32 = val => (
    ((val & 0xFF) << 24) | ((val & 0xFF00) << 8) | ((val >>> 8) & 0xFF00) | ((val >>> 24) & 0xFF)
  )

  const numToHex = (val, len) => {
    let s = Number(val >>> 0).toString(16)
    if (s.length % 2 !== 0) {
      s = `0${s}`
    }
    if (len) {
      return (`0000000000000${s}`).slice(-1 * len)
    }
    return s
  }

  const ucfirst = val => val.charAt(0).toUpperCase() + val.substring(1)

  const precisionRound = (number, precision) => {
    const factor = 10 ** precision
    return Math.round(number * factor) / factor
  }

  class S2R1Characteristic extends Characteristic {
    constructor() {
      super('S2R1', S2R1Characteristic.UUID)
      this.setProps({
        format: homebridge.hap.Formats.DATA,
        perms: [homebridge.hap.Perms.PAIRED_READ, homebridge.hap.Perms.NOTIFY, homebridge.hap.Perms.HIDDEN],
      })
    }
  }

  S2R1Characteristic.UUID = 'E863F116-079E-48FF-8F27-9C2605A29F52'

  class S2R2Characteristic extends Characteristic {
    constructor() {
      super('S2R2', S2R2Characteristic.UUID)
      this.setProps({
        format: homebridge.hap.Formats.DATA,
        perms: [homebridge.hap.Perms.PAIRED_READ, homebridge.hap.Perms.NOTIFY, homebridge.hap.Perms.HIDDEN],
      })
    }
  }

  S2R2Characteristic.UUID = 'E863F117-079E-48FF-8F27-9C2605A29F52'

  class S2W1Characteristic extends Characteristic {
    constructor() {
      super('S2W1', S2W1Characteristic.UUID)
      this.setProps({
        format: homebridge.hap.Formats.DATA,
        perms: [homebridge.hap.Perms.PAIRED_WRITE, homebridge.hap.Perms.HIDDEN],
      })
    }
  }

  S2W1Characteristic.UUID = 'E863F11C-079E-48FF-8F27-9C2605A29F52'

  class S2W2Characteristic extends Characteristic {
    constructor() {
      super('S2W2', S2W2Characteristic.UUID)
      this.setProps({
        format: homebridge.hap.Formats.DATA,
        perms: [homebridge.hap.Perms.PAIRED_WRITE, homebridge.hap.Perms.HIDDEN],
      })
    }
  }

  S2W2Characteristic.UUID = 'E863F121-079E-48FF-8F27-9C2605A29F52'

  class FakeGatoHistoryService extends Service {
    constructor(displayName, subtype) {
      super(displayName, FakeGatoHistoryService.UUID, subtype)
      this.addCharacteristic(S2R1Characteristic)
      this.addCharacteristic(S2R2Characteristic)
      this.addCharacteristic(S2W1Characteristic)
      this.addCharacteristic(S2W2Characteristic)
    }
  }

  FakeGatoHistoryService.UUID = 'E863F007-079E-48FF-8F27-9C2605A29F52'

  let thisAccessory = {}

  class FakeGatoHistory extends Service {
    constructor(accessoryType, accessory, optionalParams) {
      super(`${accessory.displayName} History`, FakeGatoHistoryService.UUID)
      thisAccessory = accessory
      this.accessoryName = thisAccessory.displayName
      this.signatures = []
      this.path = `${homebridge.user.storagePath()}/persist/`
      this.minutes = optionalParams.minutes || 10
      this.log = optionalParams.log
      if (!this.log) {
        this.log = () => {}
      }
      if (homebridge.globalFakeGatoTimer === undefined) {
        homebridge.globalFakeGatoTimer = new FakeGatoTimer({
          minutes: this.minutes,
          log: this.log,
        })
      }
      this.loaded = false
      if (homebridge.globalFakeGatoStorage === undefined) {
        homebridge.globalFakeGatoStorage = new FakeGatoStorage({
          log: this.log,
        })
      }
      homebridge.globalFakeGatoStorage.addWriter(this, {
        path: this.path,
        onReady: function () {
          this.load(
            (err, loaded) => {
              if (err) {
                this.log('FGH load error: %s.', err)
              } else if (loaded) {
                this.log('FGH loaded from storage.')
              }
              // Ready either way. A history that could not be read starts
              // empty, which is the only thing left to do with it - leaving
              // this unset instead would park save() in a 100ms retry that
              // never ends, so a single unreadable file cost a busy loop for
              // the lifetime of the plugin
              this.loaded = true
            },
          )
        }.bind(this),
      })
      switch (accessoryType) {
        case 'weather':
          this.accessoryType116 = '03 0102 0202 0302'
          this.accessoryType117 = '07'
          homebridge.globalFakeGatoTimer.subscribe(this, this.calculateAverage)
          break
        case 'energy':
          this.accessoryType116 = '04 0102 0202 0702 0f03'
          this.accessoryType117 = '1f'
          homebridge.globalFakeGatoTimer.subscribe(this, this.calculateAverage)
          break
        case 'room':
          this.accessoryType116 = '04 0102 0202 0402 0f03'
          this.accessoryType117 = '0f'
          homebridge.globalFakeGatoTimer.subscribe(this, this.calculateAverage)
          break
        case 'door':
          this.accessoryType116 = '01 0601'
          this.accessoryType117 = '01'
          homebridge.globalFakeGatoTimer.subscribe(this, function (params) {
            const backLog = params.backLog || []
            const { immediate } = params
            const fakegato = this.service
            const actualEntry = {}
            if (backLog.length) {
              if (immediate) {
                actualEntry.time = backLog[0].time
                actualEntry.status = backLog[0].status
              } else {
                actualEntry.time = Math.round(new Date().valueOf() / 1000)
                actualEntry.status = backLog[0].status
              }
              fakegato.log(
                '[%s] FG timer: callbackDoor [%s] immediate [%s].',
                fakegato.accessoryName,
                actualEntry,
                immediate,
              )
              fakegato._addEntry(actualEntry)
            }
          })
          break
        case 'motion':
          this.accessoryType116 = '02 1301 1c01'
          this.accessoryType117 = '02'
          homebridge.globalFakeGatoTimer.subscribe(this, function (params) {
            const backLog = params.backLog || []
            const { immediate } = params
            const fakegato = this.service
            const actualEntry = {}
            if (backLog.length) {
              if (immediate) {
                actualEntry.time = backLog[0].time
                actualEntry.status = backLog[0].status
              } else {
                actualEntry.time = Math.round(new Date().valueOf() / 1000)
                actualEntry.status = backLog[0].status
              }
              fakegato.log(
                '[%s] FG timer: callbackMotion [%s] immediate [%s].',
                fakegato.accessoryName,
                actualEntry,
                immediate,
              )
              fakegato._addEntry(actualEntry)
            }
          })
          break
        case 'switch':
          this.accessoryType116 = '01 0e01'
          this.accessoryType117 = '01'
          homebridge.globalFakeGatoTimer.subscribe(this, function (params) {
            const backLog = params.backLog || []
            const { immediate } = params
            const fakegato = this.service
            const actualEntry = {}
            if (backLog.length) {
              if (immediate) {
                actualEntry.time = backLog[0].time
                actualEntry.status = backLog[0].status
              } else {
                actualEntry.time = Math.round(new Date().valueOf() / 1000)
                actualEntry.status = backLog[0].status
              }
              fakegato.log(
                '[%s] FG timer: callbackSwitch [%s] immediate [%s].',
                fakegato.accessoryName,
                actualEntry,
                immediate,
              )
              fakegato._addEntry(actualEntry)
            }
          })
          break
        case 'custom':
          thisAccessory.services.forEach((service) => {
            service.characteristics.forEach((characteristic) => {
              switch (toLongFormUUID(characteristic.UUID)) {
                case Characteristic.CurrentTemperature.UUID:
                  this.signatures.push({
                    signature: '0102',
                    length: 4,
                    uuid: toShortFormUUID(characteristic.UUID),
                    factor: 100,
                    entry: 'temp',
                  })
                  break
                case Characteristic.CurrentRelativeHumidity.UUID:
                  this.signatures.push({
                    signature: '0202',
                    length: 4,
                    uuid: toShortFormUUID(characteristic.UUID),
                    factor: 100,
                    entry: 'humidity',
                  })
                  break
                case 'E863F10F-079E-48FF-8F27-9C2605A29F52':
                  this.signatures.push({
                    signature: '0302',
                    length: 4,
                    uuid: toShortFormUUID(characteristic.UUID),
                    factor: 10,
                    entry: 'pressure',
                  })
                  break
                case 'E863F10B-079E-48FF-8F27-9C2605A29F52':
                  this.signatures.push({
                    signature: '0702',
                    length: 4,
                    uuid: toShortFormUUID(characteristic.UUID),
                    factor: 10,
                    entry: 'ppm',
                  })
                  break
                case Characteristic.ContactSensorState.UUID:
                  this.signatures.push({
                    signature: '0601',
                    length: 2,
                    uuid: toShortFormUUID(characteristic.UUID),
                    factor: 1,
                    entry: 'contact',
                  })
                  break
                case 'E863F10D-079E-48FF-8F27-9C2605A29F52':
                  this.signatures.push({
                    signature: '0702',
                    length: 4,
                    uuid: toShortFormUUID(characteristic.UUID),
                    factor: 10,
                    entry: 'power',
                  })
                  break
                case Characteristic.On.UUID:
                  this.signatures.push({
                    signature: '0e01',
                    length: 2,
                    uuid: toShortFormUUID(characteristic.UUID),
                    factor: 1,
                    entry: 'status',
                  })
                  break
                case Characteristic.MotionDetected.UUID:
                  this.signatures.push({
                    signature: '1c01',
                    length: 2,
                    uuid: toShortFormUUID(characteristic.UUID),
                    factor: 1,
                    entry: 'motion',
                  })
                  break
              }
            })
          })
          this.accessoryType116 = ` 0${
            this.signatures.length.toString()
          } ${
            this.signatures
              .sort((a, b) => (a.signature > b.signature ? 1 : -1))
              .map(a => a.signature)
              .join(' ')
          } `
          homebridge.globalFakeGatoTimer.subscribe(this, this.calculateAverage)
          break
        case 'aqua':
          this.accessoryType116 = '03 1f01 2a08 2302'
          this.accessoryType117 = '05'
          this.accessoryType117bis = '07'
          break
        case 'thermo':
          this.accessoryType116 = '05 0102 1102 1001 1201 1d01'
          this.accessoryType117 = '1f'
          break
      }
      this.accessoryType = accessoryType
      this.firstEntry = 0
      this.lastEntry = 0
      this.history = ['noValue']
      this.memorySize = 4032
      this.usedMemory = 0
      this.currentEntry = 1
      this.transfer = false
      this.setTime = true
      this.restarted = true
      this.refTime = 0
      this.memAddress = 0
      this.dataStream = ''
      this.saving = false
      this.registerEvents()
    }

    calculateAverage(params) {
      const backLog = params.backLog || []
      const previousAvrg = params.previousAvrg || {}
      const { timer } = params
      const fakegato = this.service
      const calc = {
        sum: {},
        num: {},
        avrg: {},
      }
      for (const h in backLog) {
        if (Object.hasOwn(backLog, h)) {
          for (const key in backLog[h]) {
            if (Object.hasOwn(backLog[h], key) && key !== 'time') {
              if (!calc.sum[key]) {
                calc.sum[key] = 0
              }
              if (!calc.num[key]) {
                calc.num[key] = 0
              }
              calc.sum[key] += backLog[h][key]
              calc.num[key]++
              calc.avrg[key] = precisionRound(calc.sum[key] / calc.num[key], 2)
            }
          }
        }
      }
      calc.avrg.time = Math.round(new Date().valueOf() / 1000)

      for (const key in previousAvrg) {
        if (Object.hasOwn(previousAvrg, key) && key !== 'time') {
          if (!backLog.length || calc.avrg[key] === undefined) {
            calc.avrg[key] = previousAvrg[key]
          }
        }
      }

      if (Object.keys(calc.avrg).length > 1) {
        fakegato._addEntry(calc.avrg)
        timer.emptyData(fakegato)
      }
      return calc.avrg
    }

    registerEvents() {
      this.log('[%s] FGH registering events.', thisAccessory.displayName)
      this.service = thisAccessory.getService(FakeGatoHistoryService)
      if (this.service === undefined) {
        this.service = thisAccessory.addService(
          FakeGatoHistoryService,
          `${ucfirst(thisAccessory.displayName)} History`,
          this.accessoryType,
        )
      }
      this.service.getCharacteristic(S2R2Characteristic).onGet(() => this.getCurrentS2R2())
      this.service.getCharacteristic(S2W1Characteristic).onSet((value) => {
        this.setCurrentS2W1(value)
      })
      this.service.getCharacteristic(S2W2Characteristic).onSet((value) => {
        this.setCurrentS2W2(value)
      })
    }

    sendHistory(address) {
      if (address !== 0) {
        this.currentEntry = address
      } else {
        this.currentEntry = 1
      }
      this.transfer = true
    }

    addEntry(entry) {
      entry.time = Math.round(new Date().valueOf() / 1000)
      switch (this.accessoryType) {
        case 'door':
        case 'motion':
        case 'switch':
          homebridge.globalFakeGatoTimer.addData({
            entry,
            service: this,
            immediateCallback: true,
          })
          break
        case 'aqua':
          this._addEntry({
            time: entry.time,
            status: entry.status,
            waterAmount: entry.waterAmount,
          })
          break
        case 'weather':
          homebridge.globalFakeGatoTimer.addData({
            entry,
            service: this,
          })
          break
        case 'room':
          homebridge.globalFakeGatoTimer.addData({
            entry,
            service: this,
          })
          break
        case 'energy':
          homebridge.globalFakeGatoTimer.addData({
            entry,
            service: this,
          })
          break
        case 'custom':
          if ('power' in entry || 'temp' in entry || 'humidity' in entry) {
            homebridge.globalFakeGatoTimer.addData({
              entry,
              service: this,
            })
          } else {
            this._addEntry(entry)
          }
          break
        default:
          this._addEntry(entry)
          break
      }
    }

    _addEntry(entry) {
      if (this.loaded) {
        const entry2address = val => val % this.memorySize
        let val
        if (this.usedMemory < this.memorySize) {
          this.usedMemory++
          this.firstEntry = 0
          this.lastEntry = this.usedMemory
        } else {
          this.firstEntry++
          this.lastEntry = this.firstEntry + this.usedMemory
          if (this.restarted) {
            this.history[entry2address(this.lastEntry)] = {
              time: entry.time,
              setRefTime: 1,
            }
            this.firstEntry++
            this.lastEntry = this.firstEntry + this.usedMemory
            this.restarted = false
          }
        }
        if (this.refTime === 0) {
          this.refTime = entry.time - _EPOCH
          this.history[this.lastEntry] = {
            time: entry.time,
            setRefTime: 1,
          }
          this.initialTime = entry.time
          this.lastEntry++
          this.usedMemory++
        }
        this.history[entry2address(this.lastEntry)] = entry
        if (this.usedMemory < this.memorySize) {
          val = Format(
            '%s00000000%s%s%s%s%s000000000101',
            numToHex(swap32(entry.time - this.refTime - _EPOCH), 8),
            numToHex(swap32(this.refTime), 8),
            this.accessoryType116,
            numToHex(swap16(this.usedMemory + 1), 4),
            numToHex(swap16(this.memorySize), 4),
            numToHex(swap32(this.firstEntry), 8),
          )
        } else {
          val = Format(
            '%s00000000%s%s%s%s%s000000000101',
            numToHex(swap32(entry.time - this.refTime - _EPOCH), 8),
            numToHex(swap32(this.refTime), 8),
            this.accessoryType116,
            numToHex(swap16(this.usedMemory), 4),
            numToHex(swap16(this.memorySize), 4),
            numToHex(swap32(this.firstEntry + 1), 8),
          )
        }
        this.service.getCharacteristic(S2R1Characteristic).setValue(hexToBase64(val))
        this.log(
          '[%s] FGH first entry [%s] last entry [%s] used memory [%s] 116 [%s].',
          this.accessoryName,
          this.firstEntry.toString(16),
          this.lastEntry.toString(16),
          this.usedMemory.toString(16),
          val,
        )
        this.save()
      } else {
        setTimeout(() => this._addEntry(entry), 100)
      }
    }

    getInitialTime() {
      return this.initialTime || 0
    }

    setExtraPersistedData(extra) {
      this.extra = extra
    }

    getExtraPersistedData() {
      return this.extra
    }

    isHistoryLoaded() {
      return this.loaded
    }

    save() {
      if (this.loaded) {
        const data = {
          firstEntry: this.firstEntry,
          lastEntry: this.lastEntry,
          usedMemory: this.usedMemory,
          refTime: this.refTime,
          initialTime: this.initialTime,
          history: this.history,
          extra: this.extra,
        }
        homebridge.globalFakeGatoStorage.write({
          service: this,
          data: typeof data === 'object' ? JSON.stringify(data) : data,
        })
      } else {
        setTimeout(() => this.save(), 100)
      }
    }

    load(cb) {
      this.log('[%s] FGH loading.', this.accessoryName)
      homebridge.globalFakeGatoStorage.read({
        service: this,
        callback: function (err, data) {
          // No history stored yet, or a file with nothing in it. There is
          // nothing to restore either way, and the caller still has to be told
          // so: an empty file used to answer nothing at all, which left the
          // service waiting to be loaded while save() retried every 100ms for
          // as long as the plugin ran
          if (err || !data) {
            cb(null, false)
            return
          }

          try {
            // this.log('[%s] read data [%s].', this.accessoryName, data)
            const jsonFile = typeof data === 'object' ? data : JSON.parse(data)
            this.firstEntry = jsonFile.firstEntry
            this.lastEntry = jsonFile.lastEntry
            this.usedMemory = jsonFile.usedMemory
            this.refTime = jsonFile.refTime
            this.initialTime = jsonFile.initialTime
            this.history = jsonFile.history
            this.extra = jsonFile.extra
          } catch (e) {
            // A file that will not parse was cut short. The entries are gone
            // whatever happens next, so the caller is told once and the service
            // starts empty - this used to report the failure and then
            // immediately report success as well, over the top of it
            this.log('FGH error fetching data - invalid JSON [%s].', e)
            cb(e, false)
            return
          }

          cb(null, true)
        }.bind(this),
      })
    }

    cleanPersist() {
      this.log('FGH cleaning.')
      homebridge.globalFakeGatoStorage.remove({ service: this })
    }

    getCurrentS2R2() {
      const entry2address = val => val % this.memorySize
      if (this.currentEntry <= this.lastEntry && this.transfer) {
        this.memAddress = entry2address(this.currentEntry)
        for (let i = 0; i < 11; i += 1) {
          if (
            this.history[this.memAddress].setRefTime === 1
            || this.setTime
            || this.currentEntry === this.firstEntry + 1
          ) {
            this.dataStream += Format(
              ',15%s 0100 0000 81%s0000 0000 00 0000',
              numToHex(swap32(this.currentEntry), 8),
              numToHex(swap32(this.refTime), 8),
            )
            this.setTime = false
          } else {
            this.log(
              '[%s] FGH entry [%s] address [%s].',
              this.accessoryName,
              this.currentEntry,
              this.memAddress,
            )
            switch (this.accessoryType) {
              case 'weather':
                this.dataStream += Format(
                  ',10 %s%s-%s:%s %s %s',
                  numToHex(swap32(this.currentEntry), 8),
                  numToHex(swap32(this.history[this.memAddress].time - this.refTime - _EPOCH), 8),
                  this.accessoryType117,
                  numToHex(swap16(this.history[this.memAddress].temp * 100), 4),
                  numToHex(swap16(this.history[this.memAddress].humidity * 100), 4),
                  numToHex(swap16(this.history[this.memAddress].pressure * 10), 4),
                )
                break
              case 'energy':
                this.dataStream += Format(
                  ',14 %s%s-%s:0000 0000 %s 0000 0000',
                  numToHex(swap32(this.currentEntry), 8),
                  numToHex(swap32(this.history[this.memAddress].time - this.refTime - _EPOCH), 8),
                  this.accessoryType117,
                  numToHex(swap16(this.history[this.memAddress].power * 10), 4),
                )
                break
              case 'room':
                this.dataStream += Format(
                  ',13 %s%s%s%s%s%s0000 00',
                  numToHex(swap32(this.currentEntry), 8),
                  numToHex(swap32(this.history[this.memAddress].time - this.refTime - _EPOCH), 8),
                  this.accessoryType117,
                  numToHex(swap16(this.history[this.memAddress].temp * 100), 4),
                  numToHex(swap16(this.history[this.memAddress].humidity * 100), 4),
                  numToHex(swap16(this.history[this.memAddress].ppm), 4),
                )
                break
              case 'door':
              case 'motion':
              case 'switch':
                this.dataStream += Format(
                  ',0b %s%s%s%s',
                  numToHex(swap32(this.currentEntry), 8),
                  numToHex(swap32(this.history[this.memAddress].time - this.refTime - _EPOCH), 8),
                  this.accessoryType117,
                  numToHex(this.history[this.memAddress].status, 2),
                )
                break
              case 'aqua':
                if (this.history[this.memAddress].status) {
                  this.dataStream += Format(
                    ',0d %s%s%s%s 300c',
                    numToHex(swap32(this.currentEntry), 8),
                    numToHex(swap32(this.history[this.memAddress].time - this.refTime - _EPOCH), 8),
                    this.accessoryType117,
                    numToHex(this.history[this.memAddress].status, 2),
                  )
                } else {
                  this.dataStream += Format(
                    ',15 %s%s%s%s%s 00000000 300c',
                    numToHex(swap32(this.currentEntry), 8),
                    numToHex(swap32(this.history[this.memAddress].time - this.refTime - _EPOCH), 8),
                    this.accessoryType117bis,
                    numToHex(this.history[this.memAddress].status, 2),
                    numToHex(swap32(this.history[this.memAddress].waterAmount), 8),
                  )
                }
                break
              case 'thermo':
                this.dataStream += Format(
                  ',11 %s%s%s%s%s%s 0000',
                  numToHex(swap32(this.currentEntry), 8),
                  numToHex(swap32(this.history[this.memAddress].time - this.refTime - _EPOCH), 8),
                  this.accessoryType117,
                  numToHex(swap16(this.history[this.memAddress].currentTemp * 100), 4),
                  numToHex(swap16(this.history[this.memAddress].setTemp * 100), 4),
                  numToHex(this.history[this.memAddress].valvePosition, 2),
                )
                break
              case 'custom': {
                const result = []
                let bitmask = 0
                const dataStream = Format(
                  '%s%s',
                  numToHex(swap32(this.currentEntry), 8),
                  numToHex(swap32(this.history[this.memAddress].time - this.refTime - _EPOCH), 8),
                )
                for (const [k, v] of Object.entries(this.history[this.memAddress])) {
                  switch (k) {
                    case 'time':
                      break
                    default:
                      for (let x = 0, iLen = this.signatures.length; x < iLen; x++) {
                        if (this.signatures[x].entry === k) {
                          switch (this.signatures[x].length) {
                            case 8:
                              result[x] = Format(
                                '%s',
                                numToHex(
                                  swap32(v * this.signatures[x].factor),
                                  this.signatures[x].length,
                                ),
                              )
                              break
                            case 4:
                              result[x] = Format(
                                '%s',
                                numToHex(
                                  swap16(v * this.signatures[x].factor),
                                  this.signatures[x].length,
                                ),
                              )
                              break
                            case 2:
                              result[x] = Format(
                                '%s',
                                numToHex(v * this.signatures[x].factor, this.signatures[x].length),
                              )
                              break
                          }
                          bitmask += 2 ** x
                        }
                      }
                  }
                }
                const results = `${dataStream} ${numToHex(bitmask, 2)} ${result.map(a => a).join(' ')}`
                this.dataStream
                  += ` ${
                    numToHex(results.replace(NON_HEX_REGEX, '').length / 2 + 1)
                  } ${
                    results
                  },`
                break
              }
            }
          }
          this.currentEntry++
          this.memAddress = entry2address(this.currentEntry)
          if (this.currentEntry > this.lastEntry) {
            break
          }
        }
        this.log('[%s] FGH data [%s].', this.accessoryName, this.dataStream)
        const toReturn = hexToBase64(this.dataStream)
        this.dataStream = ''
        return toReturn
      }
      this.transfer = false
      return hexToBase64('00')
    }

    setCurrentS2W1(value) {
      this.log('[%s] FGH data req [%s].', this.accessoryName, base64ToHex(value))
      const valHex = base64ToHex(value)
      const substring = valHex.substring(4, 12)
      const valInt = Number.parseInt(substring, 16)
      const address = swap32(valInt)
      const hexAddress = address.toString(16)
      this.log('[%s] FGH address req [%s].', this.accessoryName, hexAddress)
      this.sendHistory(address)
    }

    setCurrentS2W2(value) {
      this.log('[%s] FGH clock adj [%s].', this.accessoryName, base64ToHex(value))
    }
  }

  FakeGatoHistoryService.UUID = 'E863F007-079E-48FF-8F27-9C2605A29F52'

  return FakeGatoHistory
}
