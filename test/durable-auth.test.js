'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { createDurableAuthStore } = require('../lib/durableAuthStore')

function body(value) {
  const buffer = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
  return { transformToByteArray: async () => buffer }
}

function fakeS3(objects) {
  const calls = []
  return {
    calls,
    async send(command) {
      calls.push(command)
      const input = command.input
      const name = command.constructor.name
      if (name === 'GetObjectCommand') {
        if (!objects.has(input.Key)) {
          const error = new Error('not found')
          error.name = 'NoSuchKey'
          error.$metadata = { httpStatusCode: 404 }
          throw error
        }
        return { Body: body(objects.get(input.Key)) }
      }
      if (name === 'PutObjectCommand') {
        objects.set(input.Key, Buffer.isBuffer(input.Body) ? input.Body : Buffer.from(input.Body))
        return {}
      }
      if (name === 'DeleteObjectCommand') {
        objects.delete(input.Key)
        return {}
      }
      throw new Error(`Unexpected S3 command: ${name}`)
    }
  }
}

test('registered local auth is never overwritten by a remote snapshot', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lee-auth-'))
  fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify({ registered: true }))
  const client = fakeS3(new Map([['leetechbot/auth/current.json', '{}']]))
  const store = createDurableAuthStore({ authDir, client, env: { AUTH_STORE: 's3', S3_BUCKET: 'test' } })
  assert.equal(await store.restore(), false)
  assert.equal(client.calls.length, 0)
  fs.rmSync(authDir, { recursive: true, force: true })
})

test('fresh auth restores the current remote generation', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lee-auth-'))
  const objects = new Map([
    ['leetechbot/auth/current.json', JSON.stringify({ manifestKey: 'leetechbot/auth/manifests/g1.json' })],
    ['leetechbot/auth/manifests/g1.json', JSON.stringify({ generation: 'g1', files: ['creds.json'] })],
    ['leetechbot/auth/g1/creds.json', JSON.stringify({ registered: true, me: { id: '123@s.whatsapp.net' } })]
  ])
  const store = createDurableAuthStore({ authDir, client: fakeS3(objects), env: { AUTH_STORE: 's3', S3_BUCKET: 'test' } })
  assert.equal(await store.restore(), true)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(authDir, 'creds.json'))), { registered: true, me: { id: '123@s.whatsapp.net' } })
  fs.rmSync(authDir, { recursive: true, force: true })
})

test('flush publishes the latest generation before shutdown', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lee-auth-'))
  fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify({ registered: true }))
  const objects = new Map()
  const client = fakeS3(objects)
  const store = createDurableAuthStore({ authDir, client, env: { AUTH_STORE: 's3', S3_BUCKET: 'test' } })
  store.scheduleSync()
  await store.flush()
  assert.ok(objects.has('leetechbot/auth/current.json'))
  const pointer = JSON.parse(objects.get('leetechbot/auth/current.json').toString())
  assert.ok(objects.has(pointer.manifestKey))
  fs.rmSync(authDir, { recursive: true, force: true })
})


test('transient object-storage failures are retried before publishing the pointer', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lee-auth-'))
  fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify({ registered: true }))
  const objects = new Map()
  const base = fakeS3(objects)
  let failures = 2
  const client = {
    calls: base.calls,
    async send(command) {
      if (command.constructor.name === 'PutObjectCommand' && failures > 0) {
        failures -= 1
        throw new Error('temporary network failure')
      }
      return base.send(command)
    }
  }
  const store = createDurableAuthStore({ authDir, client, env: { AUTH_STORE: 's3', S3_BUCKET: 'test', AUTH_STORE_RETRIES: '3' } })
  store.scheduleSync()
  await store.flush()
  assert.equal(failures, 0)
  assert.ok(objects.has('leetechbot/auth/current.json'))
  fs.rmSync(authDir, { recursive: true, force: true })
})

test('Bucketeer variables enable durable storage and an empty bucket passes the access probe', async () => {
  const authDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lee-auth-'))
  const store = createDurableAuthStore({
    authDir,
    client: fakeS3(new Map()),
    env: {
      AUTH_STORE: 's3',
      BUCKETEER_BUCKET_NAME: 'bucket-from-addon',
      BUCKETEER_AWS_REGION: 'eu-west-1',
      BUCKETEER_AWS_ACCESS_KEY_ID: 'key',
      BUCKETEER_AWS_SECRET_ACCESS_KEY: 'secret'
    }
  })
  assert.equal(store.enabled, true)
  assert.equal(await store.verifyAccess(), true)
  fs.rmSync(authDir, { recursive: true, force: true })
})

test('durable access probe fails closed on permission errors', async () => {
  const client = { async send() { const error = new Error('AccessDenied'); error.name = 'AccessDenied'; error.$metadata = { httpStatusCode: 403 }; throw error } }
  const store = createDurableAuthStore({
    authDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lee-auth-')),
    client,
    env: { AUTH_STORE: 's3', S3_BUCKET: 'test' }
  })
  await assert.rejects(store.verifyAccess(), /S3\/Bucketeer access check failed: AccessDenied/)
})
