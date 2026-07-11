import { Buffer } from 'node:buffer'

import axios from 'axios'

import platformConsts from '../utils/constants.js'
import { parseError, sleep } from '../utils/functions.js'
import platformLang from '../utils/lang-en.js'

const HYPHEN_REGEX = /-/g
const WHITESPACE_REGEX = /\s+/g
const NEWLINE_REGEX = /\r\n|\n|\r/g

export default class {
  constructor(platform) {
    // Create variables usable by the class
    this.log = platform.log
    this.password = platform.config.password
    this.token = platform.accountToken
    this.tokenTTR = platform.accountTokenTTR
    this.username = platform.config.username
    this.code = platform.config.code

    // May need changing from time to time
    this.appVersion = '7.4.10'
    this.userAgent = `GoveeHome/${this.appVersion} (com.ihoment.GoVeeSensor; build:8; iOS 26.5.0) Alamofire/5.11.0`

    // Create a client id generated from Govee username which should remain constant
    let clientSuffix = platform.api.hap.uuid.generate(this.username).replace(HYPHEN_REGEX, '') // 32 chars
    clientSuffix = clientSuffix.substring(0, clientSuffix.length - 2) // 30 chars
    this.clientId = `hb${clientSuffix}` // 32 chars
  }

  async login() {
    try {
      // Perform the HTTP request
      const loginData = {
        email: this.username,
        password: this.password,
        client: this.clientId,
      }
      if (this.code) {
        loginData.code = this.code
      }

      const res = await axios({
        url: 'https://app2.govee.com/account/rest/account/v2/login',
        method: 'post',
        data: loginData,
        headers: {
          'appVersion': this.appVersion,
          'clientId': this.clientId,
          'clientType': 1,
          'iotVersion': 0,
          'timestamp': Date.now(),
          'User-Agent': this.userAgent,
        },
        timeout: 30000,
      })

      // Check to see we got a response
      if (!res.data) {
        throw new Error(platformLang.noToken)
      }

      // Handle 2FA requirement (status 454)
      if (res.data.status === 454) {
        if (this.code) {
          throw new Error(platformLang.twoFACodeInvalid)
        }

        // Request a verification code to be sent to the user's email
        await axios({
          url: 'https://app2.govee.com/account/rest/account/v1/verification',
          method: 'post',
          data: {
            type: 8,
            email: this.username,
          },
          headers: {
            'appVersion': this.appVersion,
            'clientId': this.clientId,
            'clientType': 1,
            'iotVersion': 0,
            'timestamp': Date.now(),
            'User-Agent': this.userAgent,
          },
          timeout: 30000,
        })

        throw new Error(platformLang.twoFARequired)
      }

      // Check to see we got a needed response
      if (!res.data.client || !res.data.client.token) {
        if (res.data.message && res.data.message.replace(WHITESPACE_REGEX, '') === 'Incorrectpassword') {
          if (this.base64Tried) {
            throw new Error(res.data.message || platformLang.noToken)
          } else {
            this.base64Tried = true
            this.password = Buffer.from(this.password, 'base64')
              .toString('utf8')
              .replace(NEWLINE_REGEX, '')
              .trim()
            return await this.login()
          }
        }
        throw new Error(res.data.message || platformLang.noToken)
      }

      // Make the token available in other functions
      this.token = res.data.client.token

      // Also grab an access token specifically for the get-tap-to-run endpoint
      await this.loginTTR()

      // Mark this request complete if in debug mode
      this.log.debug('[HTTP] %s.', platformLang.loginSuccess)

      // Also grab the iot data
      const iotRes = await axios({
        url: 'https://app2.govee.com/app/v1/account/iot/key',
        method: 'get',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'appVersion': this.appVersion,
          'clientId': this.clientId,
          'clientType': 1,
          'iotVersion': 0,
          'timestamp': Date.now(),
          'User-Agent': this.userAgent,
        },
      })

      // Return the account token and topic for AWS
      return {
        accountId: res.data.client.accountId,
        client: this.clientId,
        endpoint: iotRes.data.data.endpoint,
        iot: iotRes.data.data.p12,
        iotPass: iotRes.data.data.p12Pass,
        token: res.data.client.token,
        tokenTTR: this.tokenTTR,
        topic: res.data.client.topic,
      }
    } catch (err) {
      if (err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        if (this.loginRetryCount >= 3) {
          this.loginRetryCount = 0
          throw err
        }
        this.loginRetryCount = (this.loginRetryCount || 0) + 1
        this.log.warn('[HTTP] %s [login() - %s] (attempt %d/3).', platformLang.httpRetry, err.code, this.loginRetryCount)
        await sleep(30000)
        return this.login()
      }
      throw err
    }
  }

  async loginTTR() {
    // The tap-to-run endpoint uses a separate, shorter-lived token obtained from
    // a different login endpoint to the main Govee account token. This is split
    // out so it can be refreshed on its own without a full account re-login.
    const ttrRes = await axios({
      url: 'https://community-api.govee.com/os/v1/login',
      method: 'post',
      data: {
        email: this.username,
        password: this.password,
      },
      timeout: 30000,
    })

    this.tokenTTR = ttrRes.data?.data?.token
    return this.tokenTTR
  }

  async logout() {
    try {
      await axios({
        url: 'https://app2.govee.com/account/rest/account/v1/logout',
        method: 'post',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'appVersion': this.appVersion,
          'clientId': this.clientId,
          'clientType': 1,
          'iotVersion': 0,
          'timestamp': Date.now(),
          'User-Agent': this.userAgent,
        },
      })
    } catch (err) {
      // Logout is only called on homebridge shutdown, so we can just log the error
      this.log.warn('[HTTP] %s %s.', platformLang.logoutFail, parseError(err))
    }
  }

  async getDevices(isSync = true) {
    try {
      // Make sure we do have the account token
      if (!this.token) {
        throw new Error(platformLang.noTokenExists)
      }

      // Use the token received to get a device list
      const res = await axios({
        url: 'https://app2.govee.com/bff-app/v1/device/list',
        method: 'get',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'appVersion': this.appVersion,
          'clientId': this.clientId,
          'clientType': 1,
          'iotVersion': 0,
          'timestamp': Date.now(),
          'User-Agent': this.userAgent,
        },
        timeout: 30000,
      })

      // Check to see we got a response
      if (!res.data || !res.data.data || !res.data.data.devices) {
        throw new Error(platformLang.noDevices)
      }

      // Return the device list
      return res.data.data.devices || []
    } catch (err) {
      if (!isSync && err.code && platformConsts.httpRetryCodes.includes(err.code)) {
        if (this.getDevicesRetryCount >= 3) {
          this.getDevicesRetryCount = 0
          throw err
        }
        this.getDevicesRetryCount = (this.getDevicesRetryCount || 0) + 1
        this.log.warn('[HTTP] %s [getDevices() - %s] (attempt %d/3).', platformLang.httpRetry, err.code, this.getDevicesRetryCount)
        await sleep(30000)
        return this.getDevices(isSync)
      }
      throw err
    }
  }

  async getTapToRuns(isRetry = false) {
    // The TTR token is separate to the main account token and shorter-lived. If
    // we don't have a usable one (eg. restored from an old cache where it was
    // never saved, saved as the literal string 'undefined', or expired) then
    // fetch a fresh one before continuing. This lets a user with a valid main
    // token but a bad TTR token self-heal without a full account re-login.
    if (!this.tokenTTR || this.tokenTTR === 'undefined') {
      await this.loginTTR()
      this.tokenTTRRefreshed = true
    }

    // Build and send the request
    const res = await axios({
      url: 'https://app2.govee.com/bff-app/v1/exec-plat/home',
      method: 'get',
      headers: {
        'Authorization': `Bearer ${this.tokenTTR}`,
        'appVersion': this.appVersion,
        'clientId': this.clientId,
        'clientType': 1,
        'iotVersion': 0,
        'timestamp': Date.now(),
        'User-Agent': this.userAgent,
      },
      timeout: 10000,
    })

    // Check to see we got a response
    if (!res?.data?.data?.components) {
      // The token may have expired since we obtained it - try one fresh TTR
      // login and retry once before giving up
      if (!isRetry) {
        await this.loginTTR()
        this.tokenTTRRefreshed = true
        return this.getTapToRuns(true)
      }
      throw new Error('not a valid response')
    }

    return res.data.data.components
  }

  async getLeakDeviceWarning(deviceId, deviceSku) {
    // Make sure we do have the account token
    if (!this.token) {
      throw new Error(platformLang.noTokenExists)
    }

    // Build and send the request
    const res = await axios({
      url: 'https://app2.govee.com/leak/rest/device/v1/warnMessage',
      method: 'post',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'appVersion': this.appVersion,
        'clientId': this.clientId,
        'clientType': 1,
        'iotVersion': 0,
        'timestamp': Date.now(),
        'User-Agent': this.userAgent,
      },
      data: {
        device: deviceId.replaceAll(':', ''),
        limit: 50,
        sku: deviceSku,
      },
      timeout: 10000,
    })

    // Check to see we got a response
    if (!res?.data?.data) {
      throw new Error(platformLang.noDevices)
    }

    return res.data.data
  }
}
