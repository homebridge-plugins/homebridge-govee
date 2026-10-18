import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import url from 'node:url'

import { device as iotDevice } from 'aws-iot-device-sdk'

import { getDeviceCapabilities } from '../utils/device-capabilities.js'
import { parseError } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

const dirname = url.fileURLToPath(new URL('.', import.meta.url))

// How long a device gets to answer a command before it is sent again. Devices
// that answer at all do so within a second or two.
const CONFIRM_MS = 5000

export default class {
  constructor(platform, iotFile) {
    this.accountTopic = platform.accountTopic

    // A device answers a command with a status message carrying the command's
    // own transaction id. Nothing else confirms that a command arrived: the
    // publish succeeds whether or not the device ever hears it. So the last
    // command to each device is kept until its answer comes back (#1370)
    this.sequence = 0
    this.awaitingReply = new Map()
    this.answersCommands = new Set()

    this.device = iotDevice({
      privateKey: Buffer.from(iotFile.key, 'utf8'),
      clientCert: Buffer.from(iotFile.cert, 'utf8'),
      caCert: readFileSync(resolve(dirname, './cert/AmazonRootCA1.pem')),
      clientId: `AP/${platform.accountId}/${platform.clientId}`,
      host: platform.iotEndpoint,
      enableMetrics: false,
    })

    // A listener event for if the connection closes
    this.device.on('close', () => {
      platform.log.debugWarn('[AWS] %s.', platformLang.awsEventClose)
      this.connected = false
    })

    // A listener event for if the connection reconnects
    this.device.on('reconnect', () => {
      platform.log.debug('[AWS] %s.', platformLang.awsEventReconnect)
    })

    // A listener event for if the connection goes offline
    this.device.on('offline', () => {
      platform.log.debugWarn('[AWS] %s.', platformLang.awsEventOffline)
      this.connected = false
    })

    // A listener event for if the connection creates an error
    this.device.on('error', (error) => {
      platform.log.debugWarn('[AWS] %s [%s].', platformLang.awsEventError, parseError(error))
      this.connected = false
    })

    // A listener event for receiving a message
    this.device.on('message', (topic, payload) => {
      const payloadString = Buffer.from(payload).toString()

      // Parse the message to JSON
      try {
        payload = JSON.parse(payloadString)
      } catch (error) {
        platform.log.debugWarn('[AWS] %s [%s].', platformLang.invalidJson, payloadString)
        return
      }

      // Older models may have the message in a msg property
      if (payload.msg) {
        try {
          payload = JSON.parse(payload.msg)
        } catch (error) {
          platform.log.debugWarn('[AWS] %s [%s].', platformLang.invalidJson, payloadString)
          return
        }
      }

      // Also JSON parse any data property that may exist, do not throw on error
      if (payload.data && typeof payload.data === 'string') {
        try {
          payload.data = JSON.parse(payload.data)
        } catch (error) {
          // Do nothing, leave as string
        }
      }

      // Log the received message if debug is enabled
      platform.log.debug('[AWS] %s [%s].', platformLang.awsEventMessage, payloadString)

      // A reply to one of our commands means it arrived
      this.noteReply(payload)

      // Send the update to the receiver function
      platform.receiveUpdateAWS(payload)
    })

    // A listener event for when the connection is created
    this.device.on('connect', () => {
      platform.log.debug('[AWS] %s.', platformLang.awsEventConnect)
      this.connected = true
    })
  }

  async connect() {
    return new Promise((res, rej) => {
      this.device.subscribe(this.accountTopic, {}, (err) => {
        if (err) {
          rej(err)
        } else {
          res()
        }
      })
    })
  }

  async requestUpdate(accessory) {
    // Check if we are connected before attempting an update
    if (!this.connected) {
      throw new Error(platformLang.notAWSConn)
    }

    // Generate the AWS payload
    const payload = {
      msg: {
        cmd: 'status',
        cmdVersion: getDeviceCapabilities(accessory.context.gvModel).awsStatusCmdVersion,
        transaction: this.newTransaction(),
        type: 0,
      },
    }

    // Log the update if accessory debug is enabled
    accessory.logDebug(`[AWS] ${platformLang.sendingUpdate} ${JSON.stringify(payload)}`)

    // Add the account topic after logging
    payload.msg.accountTopic = this.accountTopic

    // Send the update over AWS
    return new Promise((res, rej) => {
      this.device.publish(accessory.context.awsTopic, JSON.stringify(payload), {}, (err) => {
        if (err) {
          rej(err)
        } else {
          res()
        }
      })
    })
  }

  async updateDevice(accessory, params) {
    // Check if we are connected before attempting an update
    if (!this.connected) {
      throw new Error(platformLang.notAWSConn)
    }

    // Generate the AWS payload
    const payload = {
      msg: {
        cmd: params.cmd,
        cmdVersion: 0,
        data: params.data,
        transaction: this.newTransaction(),
        type: 1,
      },
    }

    // Log the update if accessory debug is enabled
    accessory.logDebug(`[AWS] ${platformLang.sendingUpdate} ${JSON.stringify(payload)}`)

    await this.publish(accessory, payload)
    this.awaitReply(accessory, payload, 0)
  }

  newTransaction() {
    // The timestamp alone repeats when a scene sends several commands in the
    // same millisecond, and a reply has to be matched to exactly one of them
    this.sequence = (this.sequence + 1) % 1000
    return `v_${Date.now()}${String(this.sequence).padStart(3, '0')}`
  }

  publish(accessory, payload) {
    // The account topic is added after logging, it is only routing
    const message = JSON.stringify({ msg: { ...payload.msg, accountTopic: this.accountTopic } })
    return new Promise((res, rej) => {
      this.device.publish(accessory.context.awsTopic, message, {}, (err) => {
        if (err) {
          rej(err)
        } else {
          res()
        }
      })
    })
  }

  /**
   * Wait for the device to answer a command, and send it once more if it does
   * not.
   *
   * Commands do go missing between the cloud and a device that is otherwise
   * online: three lights all answered the evening's "on", then none of them
   * answered the "off", while still sending their own status updates through
   * the night. Home showed them off, and they stayed on until morning (#1370).
   *
   * Only a device that has answered a command before is chased. Not every
   * model answers, and resending to one that never does would just send
   * every command twice. A newer command to the same device replaces the one
   * being waited on, so an older command is never resent over a newer one.
   */
  awaitReply(accessory, payload, attempt) {
    const id = accessory.context.gvDeviceId
    clearTimeout(this.awaitingReply.get(id)?.timer)
    const timer = setTimeout(async () => {
      this.awaitingReply.delete(id)
      if (!this.answersCommands.has(id) || !this.connected) {
        return
      }
      if (attempt > 0) {
        accessory.logWarn(`[AWS] ${platformLang.awsNoReply}`)
        return
      }
      const retry = { msg: { ...payload.msg, transaction: this.newTransaction() } }
      accessory.logDebug(`[AWS] ${platformLang.awsResend} ${JSON.stringify(retry)}`)
      try {
        await this.publish(accessory, retry)
        this.awaitReply(accessory, retry, attempt + 1)
      } catch (err) {
        accessory.logWarn(`[AWS] ${platformLang.awsNoReply} [${parseError(err)}]`)
      }
    }, CONFIRM_MS)
    timer.unref?.()
    this.awaitingReply.set(id, { transaction: payload.msg.transaction, timer })
  }

  noteReply(payload) {
    const waiting = this.awaitingReply.get(payload?.device)
    if (!waiting || payload.transaction !== waiting.transaction) {
      return
    }
    clearTimeout(waiting.timer)
    this.awaitingReply.delete(payload.device)
    this.answersCommands.add(payload.device)
  }
}
