'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

function removeContents(directory, removed) {
  if (!directory || !fs.existsSync(directory)) return
  for (const name of fs.readdirSync(directory)) {
    const target = path.join(directory, name)
    try {
      fs.rmSync(target, { recursive: true, force: true })
      removed.push(target)
    } catch (_) {}
  }
}

function removeMatchingFiles(directory, pattern, removed) {
  if (!directory || !fs.existsSync(directory)) return
  for (const name of fs.readdirSync(directory)) {
    if (!pattern.test(name)) continue
    const target = path.join(directory, name)
    try {
      fs.rmSync(target, { recursive: true, force: true })
      removed.push(target)
    } catch (_) {}
  }
}

function removeOlderThan(directory, maxAgeMs, removed) {
  if (!directory || !fs.existsSync(directory)) return
  const cutoff = Date.now() - maxAgeMs
  for (const name of fs.readdirSync(directory)) {
    const target = path.join(directory, name)
    try {
      const stat = fs.statSync(target)
      if (stat.isDirectory()) {
        removeOlderThan(target, maxAgeMs, removed)
        const remaining = fs.readdirSync(target)
        if (!remaining.length && stat.mtimeMs < cutoff) {
          fs.rmSync(target, { recursive: true, force: true })
          removed.push(target)
        }
      } else if (stat.mtimeMs < cutoff) {
        fs.rmSync(target, { force: true })
        removed.push(target)
      }
    } catch (_) {}
  }
}

function cleanupUnwantedFiles({
  cwd = process.cwd(),
  tempDir,
  osTemp = os.tmpdir(),
  authDir,
  logRetentionDays = 7,
  sessionCacheRetentionDays = 7
} = {}) {
  const removed = []
  const roots = [
    tempDir || path.join(osTemp, 'lee-techbot'),
    path.join(osTemp, 'lee-techbot-tmp'),
    path.join(cwd, 'tmp'),
    path.join(cwd, 'temp'),
    path.join(cwd, 'node_modules', '.cache'),
    path.join(cwd, '.npm'),
    path.join(cwd, '.cache')
  ]
  for (const root of roots) removeContents(root, removed)

  // Failed update downloads and interrupted atomic writes are safe to remove.
  removeMatchingFiles(cwd, /^(update-|.*\.part$|.*\.tmp$)/i, removed)

  const logAge = Math.max(1, Number(logRetentionDays) || 7) * 24 * 60 * 60 * 1000
  for (const logDir of [path.join(cwd, 'logs'), path.join(cwd, 'log')]) removeOlderThan(logDir, logAge, removed)
  removeMatchingFiles(cwd, /^(?:bot|debug|error|output)[-_].*\.log$/i, removed)

  const cacheAge = Math.max(1, Number(sessionCacheRetentionDays) || 7) * 24 * 60 * 60 * 1000
  for (const cacheDir of ['session-cache', 'sessions-cache', 'auth-cache', '.session-cache']) {
    removeOlderThan(path.join(cwd, cacheDir), cacheAge, removed)
  }
  // Bad-MAC backups are intentionally retained for a limited recovery window;
  // the active auth directory itself is never traversed or removed.
  if (authDir) {
    const resolvedAuth = path.resolve(authDir)
    const parent = path.dirname(resolvedAuth)
    const base = path.basename(resolvedAuth).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    removeOlderThanMatching(parent, new RegExp(`^${base}\\.bad-mac-`), cacheAge, removed)
  }
  return removed
}

function removeOlderThanMatching(directory, pattern, maxAgeMs, removed) {
  if (!directory || !fs.existsSync(directory)) return
  const cutoff = Date.now() - maxAgeMs
  for (const name of fs.readdirSync(directory)) {
    if (!pattern.test(name)) continue
    const target = path.join(directory, name)
    try {
      if (fs.statSync(target).mtimeMs < cutoff) {
        fs.rmSync(target, { recursive: true, force: true })
        removed.push(target)
      }
    } catch (_) {}
  }
}

function diskPressure(root = process.cwd()) {
  try {
    const stat = fs.statfsSync(root)
    const total = Number(stat.blocks) * Number(stat.bsize)
    const free = Number(stat.bavail) * Number(stat.bsize)
    const usedPercent = total > 0 ? ((total - free) / total) * 100 : 0
    return { totalBytes: total, freeBytes: free, usedPercent: Math.round(usedPercent * 10) / 10, level: free < 50 * 1024 * 1024 || usedPercent >= 95 ? 'critical' : free < 250 * 1024 * 1024 || usedPercent >= 85 ? 'warning' : 'ok' }
  } catch (error) {
    return { level: 'unknown', error: String(error.message || error) }
  }
}

module.exports = { cleanupUnwantedFiles, diskPressure }
