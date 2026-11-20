'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Math.max(0, Number(value) || 0)
  let index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1 }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`
}

function diskStatus(root = process.cwd()) {
  try {
    const stat = fs.statfsSync(root)
    const total = Number(stat.blocks) * Number(stat.bsize)
    const free = Number(stat.bavail) * Number(stat.bsize)
    const used = Math.max(0, total - free)
    const usedPercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0
    const level = free < 50 * 1024 * 1024 || usedPercent >= 95 ? 'critical' : free < 250 * 1024 * 1024 || usedPercent >= 85 ? 'warning' : 'ok'
    return { root: path.resolve(root), totalBytes: total, freeBytes: free, usedBytes: used, usedPercent, level, total: formatBytes(total), free: formatBytes(free), used: formatBytes(used) }
  } catch (error) {
    return { root: path.resolve(root), level: 'unknown', error: String(error.message || error) }
  }
}

function hostingProfile(env = process.env) {
  if (env.DYNO || env.HEROKU_APP_NAME) return 'Heroku'
  if (env.LEETEC_HOSTING || env.LEE_TECH_HOSTING || env.LEETEC_APP_ID) return 'Lee Tech Hosting'
  if (env.PTERODACTYL_SERVER_UUID || env.P_SERVER_UUID || env.PANEL || env.KATARO_HOST || (env.HOME || '').includes('/home/container')) return 'Panel'
  if (env.RENDER) return 'Render'
  if (env.RAILWAY_ENVIRONMENT) return 'Railway'
  if (env.KOYEB_APP_ID) return 'Koyeb'
  if (env.VERCEL || env.VERCEL_ENV) return 'Vercel'
  return 'Node.js host'
}

function storageSummary(status = {}, authDir = '') {
  const durable = Boolean(status.enabled)
  const persistent = durable || status.localPersistent === true
  return {
    mode: durable ? 'durable-s3' : status.localPersistent ? 'persistent-local' : status.localWritable ? 'local' : 'unavailable',
    safeForRestart: persistent && status.healthy !== false,
    configured: Boolean(status.configured || durable || status.localPersistent),
    healthy: status.healthy !== false && (durable || status.localWritable === true),
    authDir: authDir ? path.resolve(authDir) : undefined,
    lastSyncAt: status.lastSyncAt || null,
    lastSyncFiles: Number(status.lastSyncFiles || 0),
    retrying: Boolean(status.retrying),
    error: status.error ? String(status.error).slice(0, 240) : null
  }
}

async function runPersistenceSelfTest({ authDir, storage, diskRoot = process.cwd() } = {}) {
  const started = Date.now()
  const targetDir = path.resolve(authDir || process.cwd())
  const probe = path.join(targetDir, `.lee-techbot-persistence-test-${process.pid}`)
  const result = { ok: false, localWrite: false, durableAccess: null, durationMs: 0, disk: diskStatus(diskRoot), error: null }
  try {
    fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 })
    fs.writeFileSync(probe, `${new Date().toISOString()}\n`, { mode: 0o600 })
    result.localWrite = fs.readFileSync(probe, 'utf8').includes('T')
    if (storage?.enabled && typeof storage.verifyAccess === 'function') result.durableAccess = Boolean(await storage.verifyAccess())
    else result.durableAccess = storage?.enabled ? false : null
    result.ok = result.localWrite && (result.durableAccess !== false) && result.disk.level !== 'critical'
  } catch (error) {
    result.error = String(error.message || error).slice(0, 240)
  } finally {
    try { fs.rmSync(probe, { force: true }) } catch (_) {}
    result.durationMs = Date.now() - started
    result.disk = diskStatus(diskRoot)
  }
  return result
}

function systemSnapshot({ authDir, storage, health } = {}) {
  const status = storage?.status?.() || storage || {}
  return {
    ok: Boolean(health?.errors === 0 || health?.errors == null) && diskStatus(process.cwd()).level !== 'critical',
    platform: hostingProfile(),
    node: process.version,
    pid: process.pid,
    uptimeSeconds: Number(health?.uptimeSeconds || Math.floor(process.uptime())),
    memory: { rss: formatBytes(process.memoryUsage().rss), heapUsed: formatBytes(process.memoryUsage().heapUsed) },
    disk: diskStatus(process.cwd()),
    storage: storageSummary(status, authDir),
    health: health || {}
  }
}

module.exports = { formatBytes, diskStatus, hostingProfile, storageSummary, runPersistenceSelfTest, systemSnapshot }
