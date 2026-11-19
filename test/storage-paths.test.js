'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { resolveAuthDir, isHosted } = require('../lib/storagePaths')

test('explicit AUTH_DIR remains the highest-priority storage location', () => {
  assert.equal(resolveAuthDir({ AUTH_DIR: '/mnt/bot-data', PORT: '3000' }), path.resolve('/mnt/bot-data'))
})

test('common persistent volume variables are detected automatically', () => {
  assert.equal(resolveAuthDir({ RAILWAY_VOLUME_MOUNT_PATH: '/data/railway', PORT: '3000' }), path.resolve('/data/railway'))
  assert.equal(resolveAuthDir({ RENDER_DISK_MOUNT_PATH: '/data/render', PORT: '3000' }), path.resolve('/data/render'))
  assert.equal(resolveAuthDir({ PERSISTENT_DISK_PATH: '/data/panel', SERVER_PORT: '3000' }), path.resolve('/data/panel'))
})

test('hosted fallback uses the standard container auth mount', () => {
  assert.equal(isHosted({ P_SERVER_UUID: 'server-1' }), true)
  assert.equal(resolveAuthDir({ P_SERVER_UUID: 'server-1' }), path.resolve(process.cwd(), 'auth'))
})

test('panel templates that inject /app are redirected to a writable panel path', () => {
  assert.equal(resolveAuthDir({ P_SERVER_UUID: 'server-1', AUTH_DIR: '/app' }), path.resolve(process.cwd(), 'auth'))
  assert.equal(resolveAuthDir({ PTERODACTYL_SERVER_UUID: 'server-1', AUTH_DIR: '/app/auth' }), path.resolve(process.cwd(), 'auth'))
})

test('local fallback preserves the existing session directory', () => {
  assert.equal(resolveAuthDir({}).endsWith(path.join('', 'session')), true)
})
