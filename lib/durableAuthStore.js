'use strict'

const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand
} = require('@aws-sdk/client-s3')

function envBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function streamToBuffer(body) {
  if (!body) return Promise.resolve(Buffer.alloc(0))
  if (Buffer.isBuffer(body)) return Promise.resolve(body)
  if (typeof body.transformToByteArray === 'function') {
    return body.transformToByteArray().then(value => Buffer.from(value))
  }
  return new Promise((resolve, reject) => {
    const chunks = []
    body.on('data', chunk => chunks.push(Buffer.from(chunk)))
    body.once('end', () => resolve(Buffer.concat(chunks)))
    body.once('error', reject)
  })
}

async function walkFiles(root, current = root, result = []) {
  let entries = []
  try { entries = await fsp.readdir(current, { withFileTypes: true }) } catch (error) {
    if (error.code === 'ENOENT') return result
    throw error
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.durable-')) continue
    const full = path.join(current, entry.name)
    if (entry.isDirectory()) await walkFiles(root, full, result)
    else if (entry.isFile()) result.push({ full, relative: path.relative(root, full).split(path.sep).join('/') })
  }
  return result
}

function createDurableAuthStore(options = {}) {
  const env = options.env || process.env
  const bucket = String(env.S3_BUCKET || env.BUCKETEER_BUCKET_NAME || '').trim()
  const enabled = String(env.AUTH_STORE || '').toLowerCase() === 's3' || Boolean(bucket)
  if (!enabled) return { enabled: false, restore: async () => false, scheduleSync: () => Promise.resolve(false), flush: () => Promise.resolve(false), clear: () => Promise.resolve(false) }
  if (!bucket) throw new Error('AUTH_STORE is enabled but S3_BUCKET is missing.')

  const region = String(env.S3_REGION || env.BUCKETEER_AWS_REGION || 'us-east-1').trim()
  const prefix = String(env.S3_PREFIX || 'leetechbot/auth').trim().replace(/^\/+|\/+$/g, '')
  const client = options.client || new S3Client({
    region,
    endpoint: String(env.S3_ENDPOINT || '').trim() || undefined,
    forcePathStyle: envBool(env.S3_FORCE_PATH_STYLE, false),
    credentials: (env.S3_ACCESS_KEY_ID || env.BUCKETEER_AWS_ACCESS_KEY_ID) && (env.S3_SECRET_ACCESS_KEY || env.BUCKETEER_AWS_SECRET_ACCESS_KEY)
      ? { accessKeyId: env.S3_ACCESS_KEY_ID || env.BUCKETEER_AWS_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY || env.BUCKETEER_AWS_SECRET_ACCESS_KEY }
      : undefined
  })
  const authDir = path.resolve(options.authDir || env.AUTH_DIR || './session')
  const maxRetries = Math.max(1, Math.min(8, Number(env.AUTH_STORE_RETRIES || 5)))
  let pending = null
  let timer = null
  let chain = Promise.resolve()

  const key = suffix => `${prefix}/${suffix}`
  const put = (Key, Body, ContentType = 'application/octet-stream') => client.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType }))
  const get = Key => client.send(new GetObjectCommand({ Bucket: bucket, Key }))
  async function withRetries(operation, label) {
    let lastError
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        if (attempt === maxRetries) break
        const delayMs = Math.min(4000, 500 * 2 ** (attempt - 1))
        console.error(`[auth-store] ${label} failed (attempt ${attempt}/${maxRetries}); retrying in ${delayMs}ms: ${error.message || error}`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
    throw lastError
  }

  function hasRegisteredLocalAuth() {
    try {
      const creds = JSON.parse(fs.readFileSync(path.join(authDir, 'creds.json'), 'utf8'))
      return creds.registered === true
    } catch (_) {
      return false
    }
  }

  async function restore() {
    // Only restore on a fresh dyno or an unregistered local cache. A live
    // reconnect must never overwrite newer local credentials with an older
    // remote snapshot.
    if (hasRegisteredLocalAuth()) return false
    let pointer
    try { pointer = JSON.parse((await streamToBuffer((await get(key('current.json'))).Body)).toString('utf8')) } catch (error) {
      if (['NoSuchKey', 'NotFound'].includes(error.name) || error.$metadata?.httpStatusCode === 404) return false
      throw error
    }
    if (!pointer?.manifestKey) return false
    const manifest = JSON.parse((await streamToBuffer((await get(pointer.manifestKey)).Body)).toString('utf8'))
    if (!Array.isArray(manifest.files) || !manifest.files.length) return false
    await fsp.mkdir(authDir, { recursive: true, mode: 0o700 })
    for (const relative of manifest.files) {
      if (!relative || relative.includes('..') || path.isAbsolute(relative)) continue
      const target = path.join(authDir, relative)
      const response = await get(key(`${manifest.generation}/${relative}`))
      const data = await streamToBuffer(response.Body)
      await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
      const temporary = `${target}.${process.pid}.durable-tmp`
      await fsp.writeFile(temporary, data, { mode: 0o600 })
      await fsp.rename(temporary, target)
    }
    console.log(`[auth-store] Restored ${manifest.files.length} auth files from ${env.S3_ENDPOINT || 'S3'} (${manifest.generation}).`)
    return true
  }

  async function syncNow() {
    const files = await walkFiles(authDir)
    if (!files.length) return false
    const generation = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`
    for (const file of files) {
      const data = await fsp.readFile(file.full)
      await withRetries(() => put(key(`${generation}/${file.relative}`), data), `auth file ${file.relative}`)
    }
    const manifestKey = key(`manifests/${generation}.json`)
    await withRetries(() => put(manifestKey, JSON.stringify({ version: 1, generation, files: files.map(file => file.relative), createdAt: new Date().toISOString() }), 'application/json'), 'auth manifest')
    await withRetries(() => put(key('current.json'), JSON.stringify({ version: 1, generation, manifestKey, updatedAt: new Date().toISOString() }), 'application/json'), 'auth pointer')
    console.log(`[auth-store] Synced ${files.length} auth files (${generation}).`)
    return true
  }

  function scheduleSync() {
    pending = pending || chain.then(syncNow)
    if (!timer) {
      timer = setTimeout(() => {
        timer = null
        const run = pending
        pending = null
        chain = run.catch(error => console.error(`[auth-store] Sync failed: ${error.message || error}`))
      }, Math.max(250, Number(env.AUTH_STORE_DEBOUNCE_MS || 2000)))
      timer.unref?.()
    }
    return pending
  }

  async function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const run = pending
    pending = null
    if (run) {
      chain = run.catch(error => {
        console.error(`[auth-store] Sync failed: ${error.message || error}`)
        throw error
      })
    }
    return chain
  }

  async function clear() {
    if (timer) { clearTimeout(timer); timer = null }
    pending = null
    await chain
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key('current.json') }))
      console.log('[auth-store] Remote auth pointer cleared after WhatsApp logout.')
      return true
    } catch (error) {
      if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') return true
      console.error(`[auth-store] Could not clear remote auth pointer: ${error.message || error}`)
      return false
    }
  }

  return {
    enabled: true,
    restore,
    scheduleSync,
    flush,
    clear
  }
}

module.exports = { createDurableAuthStore }
