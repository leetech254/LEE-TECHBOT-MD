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
    if (value) {
      // Some Pterodactyl/Bot-Hosting templates incorrectly inject Docker's
      // `/app` path. That directory does not exist in the panel container;
      // use the writable application directory instead of letting Baileys
      // fail with ENOENT before pairing starts.
      const panel = Boolean(env.P_SERVER_UUID || env.PTERODACTYL_SERVER_UUID || env.KATABUMP_SERVER_ID || env.PANEL)
      if (panel && (value === '/app' || value.startsWith('/app/'))) return path.resolve(process.cwd(), 'auth')
      return path.resolve(value)
    }
  }
  // Docker/HostKB images conventionally mount /app/auth. Fall back to a
  // project-local auth directory for panels, VPSs, and ordinary Node hosts.
  if (isHosted(env)) {
    if (env.P_SERVER_UUID || env.PTERODACTYL_SERVER_UUID || env.KATABUMP_SERVER_ID || env.PANEL) return path.resolve(process.cwd(), 'auth')
    return '/app/auth'
  }
  return path.resolve('./session')
}

module.exports = { STORAGE_ENV_KEYS, isHosted, resolveAuthDir }
