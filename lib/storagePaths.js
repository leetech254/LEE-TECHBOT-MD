'use strict'

const path = require('path')

const STORAGE_ENV_KEYS = Object.freeze([
  'AUTH_DIR',
  'BOT_AUTH_DIR',
  'PERSISTENT_DATA_DIR',
  'PANEL_DATA_DIR',
  'HOSTKB_DATA_DIR',
  'RAILWAY_VOLUME_MOUNT_PATH',
  'RENDER_DISK_MOUNT_PATH',
  'PERSISTENT_DISK_PATH',
  'VOLUME_PATH'
])

function isHosted(env) {
  return Boolean(env.PORT || env.SERVER_PORT || env.DYNO || env.HEROKU_APP_NAME || env.P_SERVER_UUID || env.PTERODACTYL_SERVER_UUID || env.KATABUMP_SERVER_ID || env.RAILWAY_ENVIRONMENT || env.RENDER_SERVICE_ID || env.KOYEB_APP_ID)
}

function resolveAuthDir(env = process.env) {
  for (const key of STORAGE_ENV_KEYS) {
    const value = String(env[key] || '').trim()
    if (value) return path.resolve(value)
  }
  // Docker/HostKB images conventionally mount /app/auth. Fall back to a
  // project-local auth directory for panels, VPSs, and ordinary Node hosts.
  if (isHosted(env) && path.isAbsolute('/app/auth')) return '/app/auth'
  return path.resolve('./session')
}

module.exports = { STORAGE_ENV_KEYS, isHosted, resolveAuthDir }
