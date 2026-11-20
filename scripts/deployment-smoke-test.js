'use strict'

const base = String(process.env.HEALTH_URL || process.env.DEPLOYMENT_URL || '').trim()
if (!base) {
  console.error('Set HEALTH_URL or DEPLOYMENT_URL to the deployed bot URL before running this check.')
  process.exit(2)
}
const url = base.endsWith('/health') ? base : `${base.replace(/\/+$/, '')}/health`

;(async () => {
  const started = Date.now()
  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  const body = await response.json().catch(() => ({}))
  const safe = JSON.stringify(body)
  if (/accessKey|secretAccessKey|S3_BUCKET|pairingCode|qrData|phone/i.test(safe)) throw new Error('Health response exposed sensitive fields.')
  console.log(JSON.stringify({ url, httpStatus: response.status, ok: body.ok === true, connection: body.connection || null, storage: body.sessionStorage || null, elapsedMs: Date.now() - started }, null, 2))
  if (!response.ok || body.ok !== true) process.exitCode = 1
})().catch(error => {
  console.error(`[deployment-smoke] ${error.message || error}`)
  process.exitCode = 1
})
