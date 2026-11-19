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

function cleanupUnwantedFiles({ cwd = process.cwd(), tempDir, osTemp = os.tmpdir() } = {}) {
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
  return removed
}

module.exports = { cleanupUnwantedFiles }
