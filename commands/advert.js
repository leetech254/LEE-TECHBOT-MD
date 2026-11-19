'use strict'

const fs = require('fs')
const path = require('path')

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'advertisements.json')
const MIN_INTERVAL_MS = 10 * 60 * 1000
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
const TICK_MS = 60 * 1000
let activeSocket = null
let schedulerTimer = null
const sending = new Set()

function ensureDir() {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
    return parsed && typeof parsed === 'object' && parsed.groups && typeof parsed.groups === 'object'
      ? parsed
      : { version: 1, groups: {} }
  } catch (_) {
    return { version: 1, groups: {} }
  }
}

function saveState(state) {
  ensureDir()
  const temporary = `${SETTINGS_PATH}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, groups: state.groups }, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, SETTINGS_PATH)
}

function parseInterval(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/\s+/g, '')
  const match = raw.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/)
  if (!match) return null
  const amount = Number(match[1])
  const unit = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }[match[2]]
  const milliseconds = Math.round(amount * unit)
  return Number.isFinite(milliseconds) && milliseconds >= MIN_INTERVAL_MS && milliseconds <= MAX_INTERVAL_MS ? milliseconds : null
}

function formatInterval(milliseconds) {
  const minutes = Math.round(Number(milliseconds) / 60000)
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}d`
  if (minutes % 60 === 0) return `${minutes / 60}h`
  return `${minutes}m`
}

function advertHelp() {
  return [
    '📢 *AUTOMATED ADVERTISING*',
    '',
    'Use these owner commands inside the target group:',
    '• `.advert set 6h | Your advert text` — configure and enable',
    '• `.advert on` — enable an existing advert',
    '• `.advert off` — pause this group',
    '• `.advert status` — view the current schedule',
    '• `.advert now` — send one advert immediately',
    '• `.advert clear` — remove the saved advert',
    '',
    'Minimum interval: *10 minutes*. Maximum: *30 days*.',
    'No group receives adverts unless an owner explicitly configures it.'
  ].join('\n')
}

async function reply(sock, chatId, message, text) {
  return sock.sendMessage(chatId, { text }, { quoted: message }).catch(() => null)
}

function getGroupConfig(groupId) {
  return loadState().groups[groupId] || null
}

async function sendAdvert(sock, groupId, config, immediate = false) {
  if (!sock || !groupId.endsWith('@g.us') || sending.has(groupId)) return false
  sending.add(groupId)
  try {
    await sock.sendMessage(groupId, {
      text: `📢 *ADVERTISEMENT*\n\n${config.message}`
    })
    const state = loadState()
    const current = state.groups[groupId]
    if (current && current.message === config.message) {
      current.lastSentAt = Date.now()
      current.nextAt = Date.now() + current.intervalMs
      current.sentCount = Number(current.sentCount || 0) + 1
      saveState(state)
    }
    return true
  } catch (error) {
    console.error(`[advert] Could not send advert to ${groupId}:`, error.message || error)
    if (!immediate) {
      const state = loadState()
      if (state.groups[groupId]) {
        state.groups[groupId].nextAt = Date.now() + Math.min(state.groups[groupId].intervalMs, 5 * 60 * 1000)
        saveState(state)
      }
    }
    return false
  } finally {
    sending.delete(groupId)
  }
}

async function tick() {
  const sock = activeSocket
  if (!sock?.user) return
  const state = loadState()
  const now = Date.now()
  for (const [groupId, config] of Object.entries(state.groups)) {
    if (!config || config.enabled !== true || !config.message || !config.intervalMs) continue
    if (sending.has(groupId) || Number(config.nextAt || 0) > now) continue
    await sendAdvert(sock, groupId, config)
  }
}

function attachAdvertScheduler(sock) {
  activeSocket = sock
  if (!schedulerTimer) {
    schedulerTimer = setInterval(() => { void tick() }, TICK_MS)
    schedulerTimer.unref?.()
  }
  void tick()
}

function detachAdvertScheduler(sock) {
  if (!sock || activeSocket === sock) activeSocket = null
}

async function advertCommand(sock, chatId, message, userMessage, context = {}) {
  if (!context.isOwnerOrSudoCheck) return reply(sock, chatId, message, '❌ Only the bot owner or sudo can configure automated advertising.')
  if (!context.isGroup || !chatId.endsWith('@g.us')) return reply(sock, chatId, message, '📢 Run `.advert` inside the group where the advert should be scheduled.')
  const args = String(userMessage || '').trim().split(/\s+/).slice(1)
  const action = String(args.shift() || 'help').toLowerCase()
  const state = loadState()
  const current = state.groups[chatId]

  if (action === 'help') return reply(sock, chatId, message, advertHelp())
  if (action === 'status') {
    if (!current) return reply(sock, chatId, message, '📢 No advert is configured for this group. Use `.advert set 6h | Your advert text`.')
    const next = current.nextAt ? new Date(current.nextAt).toLocaleString() : 'waiting for scheduler'
    return reply(sock, chatId, message, `📢 *ADVERT STATUS*\n\nStatus: *${current.enabled ? 'ON' : 'OFF'}*\nInterval: *${formatInterval(current.intervalMs)}*\nNext advert: *${next}*\nSent: *${Number(current.sentCount || 0)}*\n\nMessage:\n${current.message}`)
  }
  if (action === 'off' || action === 'stop' || action === 'pause') {
    if (!current) return reply(sock, chatId, message, '📢 No advert is configured for this group.')
    current.enabled = false
    saveState(state)
    return reply(sock, chatId, message, '✅ Automated advertising is paused for this group.')
  }
  if (action === 'on' || action === 'start' || action === 'resume') {
    if (!current) return reply(sock, chatId, message, '📢 Configure an advert first: `.advert set 6h | Your advert text`')
    current.enabled = true
    current.nextAt = Math.max(Date.now() + current.intervalMs, Number(current.nextAt || 0))
    saveState(state)
    return reply(sock, chatId, message, `✅ Automated advertising is ON. Next advert: *${new Date(current.nextAt).toLocaleString()}*.`)
  }
  if (action === 'clear' || action === 'delete' || action === 'remove') {
    if (!current) return reply(sock, chatId, message, '📢 No advert is configured for this group.')
    delete state.groups[chatId]
    saveState(state)
    return reply(sock, chatId, message, '✅ Advert configuration removed from this group.')
  }
  if (action === 'now' || action === 'send') {
    if (!current) return reply(sock, chatId, message, '📢 Configure an advert first: `.advert set 6h | Your advert text`')
    const sent = await sendAdvert(sock, chatId, current, true)
    return reply(sock, chatId, message, sent ? '✅ Advert sent once. The normal schedule remains active.' : '❌ The advert could not be sent. Check that the bot is connected and still in the group.')
  }
  if (action === 'set' || action === 'configure') {
    const payload = args.join(' ')
    const separator = payload.indexOf('|')
    if (separator < 0) return reply(sock, chatId, message, 'Usage: `.advert set 6h | Your advert text`\nInterval must be between 10m and 30d.')
    const intervalMs = parseInterval(payload.slice(0, separator))
    const advertText = payload.slice(separator + 1).trim()
    if (!intervalMs) return reply(sock, chatId, message, '❌ Invalid interval. Use 10m–30d, for example `30m`, `6h`, or `2d`.')
    if (advertText.length < 3 || advertText.length > 2000) return reply(sock, chatId, message, '❌ Advert text must contain 3–2000 characters.')
    state.groups[chatId] = {
      enabled: true,
      intervalMs,
      message: advertText,
      nextAt: Date.now() + intervalMs,
      lastSentAt: current?.lastSentAt || null,
      sentCount: Number(current?.sentCount || 0),
      updatedAt: Date.now()
    }
    saveState(state)
    return reply(sock, chatId, message, `✅ Automated advert enabled for this group.\nInterval: *${formatInterval(intervalMs)}*\nFirst advert: *${new Date(state.groups[chatId].nextAt).toLocaleString()}*\n\nUse ".advert off" to pause it.`)
  }
  return reply(sock, chatId, message, advertHelp())
}

module.exports = {
  SETTINGS_PATH,
  MIN_INTERVAL_MS,
  MAX_INTERVAL_MS,
  parseInterval,
  loadState,
  saveState,
  advertCommand,
  attachAdvertScheduler,
  detachAdvertScheduler,
  tick
}
