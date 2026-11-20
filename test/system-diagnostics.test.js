'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { diskStatus, runPersistenceSelfTest, storageSummary } = require('../lib/systemDiagnostics')
const { acquireProcessLock } = require('../lib/processLock')

test('system diagnostics reports disk capacity and restart-safe local storage', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lee-diagnostics-'))
  try {
    const lock = acquireProcessLock(root)
    const result = await runPersistenceSelfTest({ authDir: root, storage: { enabled: false, status: () => ({ localWritable: true, localPersistent: true, healthy: true }) }, diskRoot: root })
    assert.equal(result.ok, true)
    assert.equal(result.localWrite, true)
    assert.equal(result.durableAccess, null)
    assert.notEqual(result.disk.level, 'unknown')
    assert.equal(storageSummary({ localWritable: true, localPersistent: true, healthy: true }, root).safeForRestart, true)
    lock.release()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('process lock rejects a second live process marker', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lee-lock-'))
  try {
    const first = acquireProcessLock(root)
    assert.throws(() => acquireProcessLock(root), /already using/)
    first.release()
    const second = acquireProcessLock(root)
    second.release()
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
