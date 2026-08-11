import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const hostname = os.hostname().split('.')[0]

/**
 * Path separators, as the platform actually understands them.
 *
 * A history file is named after the accessory, and an accessory is named by
 * whoever set the device up. A name carrying a separator stops being a name
 * once it reaches `path.join`: it reads as a directory that does not exist, so
 * the write fails with ENOENT and - because nothing here passes a callback -
 * the error goes nowhere. A device called "Kitchen/Diner" simply never saved
 * its history, with nothing in the log to say so. HAP-NodeJS guards its own
 * storage keys against the same thing.
 *
 * Only genuine separators are replaced, and only where they are one. A
 * backslash is an ordinary filename character on Linux, so replacing it there
 * would rename the file of anyone already using one and lose their history.
 */
const PATH_SEPARATORS = process.platform === 'win32' ? /[\\/]/g : /\//g

function toFileNamePart(name) {
  return String(name ?? '').replace(PATH_SEPARATORS, '-')
}

export default class {
  constructor(params) {
    if (!params) {
      params = {}
    }
    this.writers = []
    this.log = params.log || {}
    if (!this.log) {
      this.log = () => {}
    }
    this.addingWriter = false
  }

  addWriter(service, params) {
    if (!this.addingWriter) {
      this.addingWriter = true
      if (!params) {
        params = {}
      }
      this.log('[%s] FGS addWriter().', service.accessoryName)
      const newWriter = {
        service,
        callback: params.callback,
        fileName: `${hostname}_${toFileNamePart(service.accessoryName)}_persist.json`,
      }
      const onReady = typeof params.onReady === 'function' ? params.onReady : () => {}
      newWriter.storageHandler = fs
      newWriter.path = params.path || path.join(os.homedir(), '.homebridge')
      this.writers.push(newWriter)
      this.addingWriter = false
      onReady()
    } else {
      setTimeout(() => this.addWriter(service, params), 100)
    }
  }

  getWriter(service) {
    return this.writers.find(ele => ele.service === service)
  }

  _getWriterIndex(service) {
    return this.writers.findIndex(ele => ele.service === service)
  }

  getWriters() {
    return this.writers
  }

  delWriter(service) {
    const index = this._getWriterIndex(service)
    this.writers.splice(index, 1)
  }

  write(params) {
    if (!this.writing) {
      this.writing = true
      const writer = this.getWriter(params.service)
      const callBack = typeof params.callback === 'function'
        ? params.callback
        : typeof writer.callback === 'function'
          ? writer.callback
          : () => {}
      const fileLoc = path.join(writer.path, writer.fileName)
      // Written to a temporary file and renamed over the target, so a write cut
      // short by a restart or a power cut leaves the previous history intact
      // rather than a half-written file that will not parse.
      //
      // The leading dot matters: this is HAP-NodeJS's persist directory, and it
      // reads every file that does not start with one into memory at startup -
      // so a temporary file left behind by a crash would be loaded, and kept,
      // for the life of every run after it. The pid keeps child bridges sharing
      // the directory from racing on the same temporary name.
      const tempLoc = path.join(writer.path, `.${writer.fileName}.${process.pid}.tmp`)
      this.log(
        '[%s] FGS write file [%s] [%s].',
        params.service.accessoryName,
        fileLoc,
        params.data.substring(1, 81),
      )
      writer.storageHandler.writeFile(tempLoc, params.data, 'utf8', (writeErr) => {
        if (writeErr) {
          // the temporary file may never have been created, so a failure to
          // remove it is not worth reporting over the write error itself
          writer.storageHandler.unlink(tempLoc, () => {
            this.writing = false
            callBack(writeErr)
          })
          return
        }
        writer.storageHandler.rename(tempLoc, fileLoc, (renameErr) => {
          this.writing = false
          callBack(renameErr || null)
        })
      })
    } else {
      setTimeout(() => this.write(params), 100)
    }
  }

  read(params) {
    const writer = this.getWriter(params.service)
    const callBack = typeof params.callback === 'function'
      ? params.callback
      : typeof writer.callback === 'function'
        ? writer.callback
        : () => {}
    const fileLoc = path.join(writer.path, writer.fileName)
    this.log('[%s] FGS read file [%s].', params.service.accessoryName, fileLoc)
    writer.storageHandler.readFile(fileLoc, 'utf8', callBack)
  }

  remove(params) {
    const writer = this.getWriter(params.service)
    const callBack = typeof params.callback === 'function'
      ? params.callback
      : typeof writer.callback === 'function'
        ? writer.callback
        : () => {}
    const fileLoc = path.join(writer.path, writer.fileName)
    this.log('[%s] FGS delete file [%s].', params.service.accessoryName, fileLoc)
    writer.storageHandler.unlink(fileLoc, callBack)
  }
}
