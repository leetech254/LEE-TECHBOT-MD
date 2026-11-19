'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const { resolveAuthDir } = require('../lib/storagePaths')

// Keep schedules beside the auth files. The existing durable auth store then
// includes them in the immutable S3/Bucketeer session generations.
const SETTINGS_PATH = path.join(resolveAuthDir(process.env), 'advertisements.json')
const MIN_INTERVAL_MS = 10 * 60 * 1000
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
const TICK_MS = 60 * 1000
let activeSocket = null
let schedulerTimer = null
const sending = new Set()

function ensureDir() {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
}

function requestDurableSync() {
  try {
    const sync = global.durableAuthStore?.scheduleSync
    if (typeof sync === 'function') Promise.resolve(sync()).catch((error) => console.error(`[advert] Durable state sync failed: ${error.message || error}`))
  } catch (error) {
    console.error(`[advert] Could not request durable state sync: ${error.message || error}`)
  }
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
  const selectedChannels = Array.isArray(state.channelJids)
    ? state.channelJids.filter((jid) => /^\d+@newsletter$/.test(jid))
    : (/^\d+@newsletter$/.test(state.channelJid || '') ? [state.channelJid] : [])
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, groups: state.groups, channelJids: selectedChannels, channelJid: selectedChannels[0] || null, channelForwardingEnabled: state.channelForwardingEnabled === true, channelMessageIds: state.channelMessageIds || [] }, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, SETTINGS_PATH)
  requestDurableSync()
}

function unwrapMessage(content) {
  return content?.ephemeralMessage?.message || content?.viewOnceMessage?.message || content?.viewOnceMessageV2?.message || content || null
}

function quotedContent(message) {
  return message?.message?.extendedTextMessage?.contextInfo?.quotedMessage || null
}

function mediaFromCommand(message) {
  const direct = unwrapMessage(message?.message)
  const quoted = unwrapMessage(quotedContent(message))
  if (direct?.imageMessage) return { type: 'image', payload: direct.imageMessage }
  if (quoted?.imageMessage) return { type: 'image', payload: quoted.imageMessage }
  return null
}

function captionFromCommand(message, fallback = '') {
  const direct = unwrapMessage(message?.message)
  const quoted = unwrapMessage(quotedContent(message))
  const directCaption = String(direct?.imageMessage?.caption || '').trim()
  const usableDirectCaption = /^\.advert(?:\s|$)/i.test(directCaption) ? '' : directCaption
  return String(fallback || usableDirectCaption || quoted?.imageMessage?.caption || '').trim()
}

async function saveAdvertMedia(message, groupId) {
  const media = mediaFromCommand(message)
  if (!media) return null
  const chunks = []
  const stream = await downloadContentFromMessage(media.payload, media.type)
  for await (const chunk of stream) chunks.push(chunk)
  const buffer = Buffer.concat(chunks)
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('image is empty or larger than 10 MB')
  const filename = `advert-${crypto.createHash('sha1').update(groupId).digest('hex').slice(0, 12)}-${Date.now()}.jpg`
  ensureDir()
  fs.writeFileSync(path.join(path.dirname(SETTINGS_PATH), filename), buffer, { mode: 0o600 })
  return { type: media.type, file: filename }
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

function parseAdvertCommandText(userMessage) {
  const raw = String(userMessage || '').replace(/\r\n/g, '\n').trim()
  const body = raw.replace(/^\.[^\s]+/, '').trimStart()
  const separator = body.search(/\s/)
  if (separator < 0) return { action: body.toLowerCase(), rest: '' }
  return {
    action: body.slice(0, separator).toLowerCase(),
    rest: body.slice(separator).trimStart()
  }
}

function advertHelp() {
  return [
    '📢 *AUTOMATED ADVERTISING*',
    '',
    'Use these owner commands inside the target group:',
    '• `.advert set 6h | Your advert text` — configure (OFF by default)',
    '• Reply to an image with `.advert set 6h` — schedule the image and its caption',
    '• `.advert on` — enable an existing advert',
    '• `.advert off` — pause this group',
    '• `.advert status` — view the current schedule',
    '• `.advert now` — send one advert immediately',
    '• `.advert clear` — remove the saved advert',
    '',
    'From the owner DM:',
    '• `.advert status` — view all enabled groups',
    '• `.advert now` — send each enabled advert immediately',
    '• `.advert channel on` — show available channels and enable forwarding',
    '• `.advert channel add <JID>` — add one followed channel',
    '• `.advert channel remove <JID|all>` — remove one or all sources',
    '• `.advert channel all` — select every followed channel',
    '• `.advert channel status/off` — inspect or stop forwarding',
    '',
    'Minimum interval: *10 minutes*. Maximum: *30 days*.',
    'No group receives adverts unless an owner explicitly configures it.'
  ].join('\n')
}

function enabledGroups(state) {
  return Object.entries(state.groups).filter(([groupId, config]) => (
    groupId.endsWith('@g.us') && config?.enabled === true && (config.message || config.media) && config.intervalMs
  ))
}

async function sendEnabledAdverts(sock) {
  const groups = enabledGroups(loadState())
  const results = await Promise.all(groups.map(async ([groupId, config]) => ({
    groupId,
    sent: await sendAdvert(sock, groupId, config, true)
  })))
  return {
    total: results.length,
    sent: results.filter((result) => result.sent).length,
    failed: results.filter((result) => !result.sent).length
  }
}

function ownerDmStatus(state) {
  const groups = Object.entries(state.groups).filter(([groupId, config]) => groupId.endsWith('@g.us') && (config?.message || config?.media))
  if (!groups.length) return '📢 No advert groups are configured yet. Use `.advert set 6h | Your advert text` inside a group.'
  const lines = groups.map(([groupId, config], index) => {
    const stateLabel = config.enabled ? 'ON' : 'OFF'
    const delivery = config.lastDelivery || 'not sent'
    const next = config.enabled && config.nextAt ? new Date(config.nextAt).toLocaleString() : 'paused'
    return `${index + 1}. ${groupId}\n   Status: *${stateLabel}* | Delivery: *${delivery}* | Sent: *${Number(config.sentCount || 0)}*\n   Next: ${next}`
  })
  return `📢 *ADVERT GROUPS*\n\n${lines.join('\n\n')}`
}

function existingChannelJids() {
  const channelStatePath = path.join(path.dirname(SETTINGS_PATH), '.channel-automation.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(channelStatePath, 'utf8'))
    return new Set(Object.values(parsed?.accounts || {}).flatMap((account) => Object.values(account?.channelJids || {})).filter((jid) => /^\d+@newsletter$/.test(jid)))
  } catch (_) {
    return new Set()
  }
}

function selectedChannelJids(state) {
  const values = Array.isArray(state.channelJids) ? state.channelJids : [state.channelJid]
  return new Set(values.filter((jid) => /^\d+@newsletter$/.test(jid)))
}

function availableChannelJids() {
  return [...existingChannelJids()]
}

function formatChannelList(available, selected = new Set()) {
  if (!available.length) return 'No already-followed channels are available yet. Follow a channel first, then try again.'
  return available.map((jid, index) => `${index + 1}. ${jid} — ${selected.has(jid) ? '*selected*' : 'available'}`).join('\n')
}

function configuredChannelJids(state) {
  if (state.channelForwardingEnabled === false) return new Set()
  const configured = Array.isArray(state.channelJids) ? new Set() : new Set(existingChannelJids())
  for (const jid of selectedChannelJids(state)) configured.add(jid)
  return configured
}

const channelSending = new Set()

async function handleChannelUpdate(sock, channelMessage) {
  const state = loadState()
  const channelJid = channelMessage?.key?.remoteJid
  if (!channelJid || !configuredChannelJids(state).has(channelJid)) return false
  const messageId = channelMessage.key?.id
  if (!messageId || state.channelMessageIds?.includes(messageId)) return false
  const content = unwrapMessage(channelMessage.message)
  const image = content?.imageMessage
  const video = content?.videoMessage
  const text = String(content?.conversation || content?.extendedTextMessage?.text || image?.caption || video?.caption || '').trim()
  if (!text && !image && !video) return false
  const targets = enabledGroups(state)
  if (!targets.length || channelSending.has(messageId)) return false
  channelSending.add(messageId)
  try {
    let payload = { text: `📢 *CHANNEL UPDATE*\n\n${text}`.trim() }
    if (image || video) {
      const media = image || video
      const type = image ? 'image' : 'video'
      const chunks = []
      const stream = await downloadContentFromMessage(media, type)
      for await (const chunk of stream) chunks.push(chunk)
      payload = { [type]: Buffer.concat(chunks), caption: `📢 *CHANNEL UPDATE*\n\n${text}`.trim() }
    }
    await Promise.all(targets.map(([groupId]) => sock.sendMessage(groupId, payload)))
    const ids = Array.isArray(state.channelMessageIds) ? state.channelMessageIds : []
    state.channelMessageIds = [...ids, messageId].slice(-100)
    saveState(state)
    console.log(`[advert] Forwarded channel update ${messageId} to ${targets.length} enabled groups.`)
    return true
  } catch (error) {
    console.error(`[advert] Could not forward channel update ${messageId}:`, error.message || error)
    return false
  } finally {
    channelSending.delete(messageId)
  }
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
    const body = `📢 *ADVERTISEMENT*\n\n${config.message || ''}`.trim()
    let payload = { text: body }
    if (config.media?.type === 'image' && config.media.file) {
      const mediaPath = path.join(path.dirname(SETTINGS_PATH), config.media.file)
      if (fs.existsSync(mediaPath)) payload = { image: fs.readFileSync(mediaPath), caption: body }
    }
    const result = await sock.sendMessage(groupId, payload)
    const state = loadState()
    const current = state.groups[groupId]
    if (current && current.message === config.message) {
      const sentAt = Date.now()
      current.lastSentAt = sentAt
      current.lastAttemptAt = sentAt
      current.lastDelivery = 'sent'
      current.lastMessageId = result?.key?.id || null
      current.lastError = null
      current.nextAt = sentAt + current.intervalMs
      current.sentCount = Number(current.sentCount || 0) + 1
      saveState(state)
    }
    return true
  } catch (error) {
    console.error(`[advert] Could not send advert to ${groupId}:`, error.message || error)
    const state = loadState()
    if (state.groups[groupId]) {
      state.groups[groupId].lastAttemptAt = Date.now()
      state.groups[groupId].lastDelivery = 'retrying'
      state.groups[groupId].lastError = String(error.message || error).slice(0, 240)
      state.groups[groupId].nextAt = Date.now() + Math.min(state.groups[groupId].intervalMs, 5 * 60 * 1000)
      saveState(state)
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
    if (!config || config.enabled !== true || (!config.message && !config.media) || !config.intervalMs) continue
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
  const parsedCommand = parseAdvertCommandText(userMessage)
  const action = parsedCommand.action || 'help'
  const rest = parsedCommand.rest
  const args = rest.split(/\s+/).filter(Boolean)
  const state = loadState()

  if (!context.isGroup || !chatId.endsWith('@g.us')) {
    if (action === 'help') return reply(sock, chatId, message, advertHelp())
    if (action === 'channel') {
      const channelAction = String(args[0] || '').toLowerCase()
      if (channelAction === 'status') {
        const available = availableChannelJids()
        const selected = selectedChannelJids(state)
        return reply(sock, chatId, message, `📢 *CHANNEL ADVERT SETTINGS*\n\nForwarding: *${state.channelForwardingEnabled === true ? 'ON' : 'OFF'}*\nSelected: *${configuredChannelJids(state).size}* | Available: *${available.length}*\n\n${formatChannelList(available, selected)}\n\nUse .advert channel add <JID>, remove <JID|all>, or all.`)
      }
      if (channelAction === 'on' || channelAction === 'enable' || channelAction === 'start') {
        state.channelForwardingEnabled = true
        const available = availableChannelJids()
        if (!selectedChannelJids(state).size) state.channelJids = available
        saveState(state)
        return reply(sock, chatId, message, `✅ Channel forwarding is ON.\n\nAvailable channels:\n${formatChannelList(available, selectedChannelJids(state))}\n\nUse .advert channel remove <JID> to exclude one or remove all to clear the sources.`)
      }
      if (channelAction === 'off' || channelAction === 'disable' || channelAction === 'stop') {
        state.channelForwardingEnabled = false
        saveState(state)
        return reply(sock, chatId, message, '✅ Channel forwarding is disabled.')
      }
      if (channelAction === 'all') {
        state.channelJids = availableChannelJids()
        state.channelForwardingEnabled = true
        saveState(state)
        return reply(sock, chatId, message, `✅ All *${state.channelJids.length}* available channel(s) selected and forwarding enabled.`)
      }
      if (channelAction === 'add' || channelAction === 'remove') {
        const channelJid = String(args[1] || '').trim()
        const available = new Set(availableChannelJids())
        if (channelAction === 'remove' && channelJid.toLowerCase() === 'all') {
          state.channelJids = []
          state.channelForwardingEnabled = false
          saveState(state)
          return reply(sock, chatId, message, '✅ All channel sources removed. Channel forwarding is now OFF.')
        }
        if (!/^\d+@newsletter$/.test(channelJid)) return reply(sock, chatId, message, `Usage: .advert channel ${channelAction} <JID>`)
        if (channelAction === 'add' && !available.has(channelJid)) return reply(sock, chatId, message, `That channel is not in the followed-channel list.\n\nAvailable channels:\n${formatChannelList([...available])}`)
        const selected = selectedChannelJids(state)
        if (channelAction === 'add') selected.add(channelJid)
        else selected.delete(channelJid)
        state.channelJids = [...selected]
        if (channelAction === 'add') state.channelForwardingEnabled = true
        saveState(state)
        return reply(sock, chatId, message, `✅ Channel ${channelAction === 'add' ? 'added' : 'removed'}: ${channelJid}\nSelected sources: *${state.channelJids.length}*.`)
      }
      const channelJid = String(args[0] || '').trim()
      if (!/^\d+@newsletter$/.test(channelJid)) return reply(sock, chatId, message, `Usage: .advert channel add <JID> or .advert channel all\n\nAvailable channels:\n${formatChannelList(availableChannelJids())}`)
      state.channelJids = [...selectedChannelJids(state), channelJid].filter((jid, index, list) => list.indexOf(jid) === index)
      state.channelForwardingEnabled = true
      saveState(state)
      return reply(sock, chatId, message, `✅ Channel forwarding enabled. Updates from ${channelJid} will be sent to every enabled advert group.`)
    }
    if (action === 'status') return reply(sock, chatId, message, ownerDmStatus(state))
    if (action === 'now' || action === 'send') {
      const result = await sendEnabledAdverts(sock)
      return reply(sock, chatId, message, result.total
        ? `✅ Advert broadcast complete.\nSent: *${result.sent}/${result.total}* enabled groups.${result.failed ? `\nFailed and scheduled for retry: *${result.failed}*.` : ''}`
        : '📢 No enabled advert groups were found. Configure one with `.advert set 6h | Your advert text` inside a group.')
    }
    return reply(sock, chatId, message, '📢 From owner DM use `.advert status` to view all groups or `.advert now` to send to every enabled group. Configure adverts inside each target group.')
  }

  const current = state.groups[chatId]

  if (action === 'help') return reply(sock, chatId, message, advertHelp())
  if (action === 'status') {
    if (!current) return reply(sock, chatId, message, '📢 No advert is configured for this group. Use `.advert set 6h | Your advert text`.')
    const next = current.nextAt ? new Date(current.nextAt).toLocaleString() : 'waiting for scheduler'
    const delivery = current.lastDelivery === 'retrying'
      ? `Retrying: *${current.lastError || 'temporary send failure'}*`
      : `Last delivery: *${current.lastDelivery || 'not sent'}*`
    return reply(sock, chatId, message, `📢 *ADVERT STATUS*\n\nStatus: *${current.enabled ? 'ON' : 'OFF'}*\nInterval: *${formatInterval(current.intervalMs)}*\nNext advert: *${next}*\nSent: *${Number(current.sentCount || 0)}*\n${delivery}\n\nMessage:\n${current.message}`)
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
    const payload = rest
    const separator = payload.indexOf('|')
    const intervalMs = parseInterval(separator < 0 ? payload : payload.slice(0, separator))
    const advertText = separator < 0 ? captionFromCommand(message) : payload.slice(separator + 1).trim()
    const hasMedia = Boolean(mediaFromCommand(message))
    if (separator < 0 && !hasMedia) return reply(sock, chatId, message, 'Usage: `.advert set 6h | Your advert text`\nOr reply to an image with `.advert set 6h` to schedule the image.\nInterval must be between 10m and 30d.')
    if (!intervalMs) return reply(sock, chatId, message, '❌ Invalid interval. Use 10m–30d, for example `30m`, `6h`, or `2d`.')
    if (advertText.length > 2000) return reply(sock, chatId, message, '❌ Advert caption must not exceed 2000 characters.')
    let media = current?.media || null
    if (hasMedia) {
      try { media = await saveAdvertMedia(message, chatId) } catch (error) {
        return reply(sock, chatId, message, `❌ Could not save the advert image: ${error.message || error}`)
      }
    }
    if (!advertText && !media) return reply(sock, chatId, message, '❌ Add advert text or reply to an image.')
    state.groups[chatId] = {
      enabled: false,
      intervalMs,
      message: advertText || '',
      media,
      nextAt: Date.now() + intervalMs,
      lastSentAt: current?.lastSentAt || null,
      sentCount: Number(current?.sentCount || 0),
      updatedAt: Date.now()
    }
    saveState(state)
    return reply(sock, chatId, message, `✅ Advert saved for this group and is currently *OFF*.\nInterval: *${formatInterval(intervalMs)}*\nUse ".advert on" to start sending, or ".advert status" to review it.`)
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
  sendAdvert,
  handleChannelUpdate,
  attachAdvertScheduler,
  detachAdvertScheduler,
  tick
}
