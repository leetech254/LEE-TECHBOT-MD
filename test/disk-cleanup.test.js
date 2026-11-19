'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { cleanupUnwantedFiles } = require('../lib/diskCleanup')

test('disk cleanup removes safe caches and temporary files only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lee-cleanup-test-'))
  try {
    for (const directory of ['tmp', 'temp', 'node_modules/.cache', '.npm', '.cache', 'auth', 'session', 'data']) {
      fs.mkdirSync(path.join(root, directory), { recursive: true })
    }
    fs.mkdirSync(path.join(root, 'logs'), { recursive: true })
    fs.mkdirSync(path.join(root, 'auth.bad-mac-old'), { recursive: true })
    fs.writeFileSync(path.join(root, 'tmp', 'media.bin'), 'temporary')
    fs.writeFileSync(path.join(root, 'update-old.zip.part'), 'partial')
    fs.writeFileSync(path.join(root, 'logs', 'old.log'), 'old log')
    fs.writeFileSync(path.join(root, 'auth', 'creds.json'), 'keep')
    fs.writeFileSync(path.join(root, 'session', 'creds.json'), 'keep')
    fs.writeFileSync(path.join(root, 'data', 'settings.json'), 'keep')
    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    fs.utimesSync(path.join(root, 'logs', 'old.log'), oldTime, oldTime)
    fs.utimesSync(path.join(root, 'auth.bad-mac-old'), oldTime, oldTime)

    const removed = cleanupUnwantedFiles({ cwd: root, osTemp: path.join(root, 'os-tmp'), authDir: path.join(root, 'auth') })
    assert.ok(removed.length >= 4)
    assert.equal(fs.existsSync(path.join(root, 'tmp')), true)
    assert.equal(fs.existsSync(path.join(root, 'tmp', 'media.bin')), false)
    assert.equal(fs.existsSync(path.join(root, 'update-old.zip.part')), false)
    assert.equal(fs.existsSync(path.join(root, 'logs', 'old.log')), false)
    assert.equal(fs.existsSync(path.join(root, 'auth.bad-mac-old')), false)
    assert.equal(fs.existsSync(path.join(root, 'auth', 'creds.json')), true)
    assert.equal(fs.existsSync(path.join(root, 'session', 'creds.json')), true)
    assert.equal(fs.existsSync(path.join(root, 'data', 'settings.json')), true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
