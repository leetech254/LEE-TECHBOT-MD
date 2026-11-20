'use strict'

const fs = require('fs')
const path = require('path')

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

function acquireProcessLock(authDir) {
  const directory = path.resolve(authDir)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lockPath = path.join(directory, '.lee-techbot-process.lock')
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), host: require('os').hostname() })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600)
      fs.writeFileSync(fd, payload)
      let released = false
      const release = () => {
        if (released) return
        released = true
        try { fs.closeSync(fd) } catch (_) {}
        try {
          const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
          if (Number(current.pid) === process.pid) fs.rmSync(lockPath, { force: true })
        } catch (_) { fs.rmSync(lockPath, { force: true }) }
      }
      return { lockPath, release }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
        if (pidIsAlive(Number(current.pid))) {
          const conflict = new Error(`Another LEE TECH BOT process (PID ${current.pid}) is already using ${directory}.`)
          conflict.code = 'AUTH_DIR_IN_USE'
          throw conflict
        }
      } catch (readError) {
        if (readError.code === 'AUTH_DIR_IN_USE') throw readError
      }
      try { fs.rmSync(lockPath, { force: true }) } catch (_) {}
    }
  }
  const error = new Error(`Could not acquire the auth directory lock: ${lockPath}`)
  error.code = 'AUTH_DIR_LOCK_FAILED'
  throw error
}

module.exports = { acquireProcessLock, pidIsAlive }
