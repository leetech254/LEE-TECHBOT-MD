'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { downloadContentFromMessage } = require('@whiskeysockets/baileys')
const { resolveAuthDir } = require('../lib/storagePaths')
const { resolveGroupTarget, fetchParticipatingGroups, normalizeGroupJid } = require('../lib/groupTarget')

// Keep schedules beside the auth files. The existing durable auth store then
// includes them in the immutable S3/Bucketeer session generations.
const SETTINGS_PATH = path.join(resolveAuthDir(process.env), 'advertisements.json')
const MIN_INTERVAL_MS = 10 * 60 * 1000
const MAX_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000
const TICK_MS = 60 * 1000
let activeSocket = null
let schedulerTimer = null
const sending = new Set()
let storageWarningShown = false

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
  const temporary = `${SETTINGS_PATH}.${process.pid}.tmp`
  try {
    ensureDir()
    const selectedChannels = Array.isArray(state.channelJids)
      ? state.channelJids.filter((jid) => /^\d+@newsletter$/.test(jid))
      : (/^\d+@newsletter$/.test(state.channelJid || '') ? [state.channelJid] : [])
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, groups: state.groups, channelJids: selectedChannels, channelJid: selectedChannels[0] || null, channelForwardingEnabled: state.channelForwardingEnabled === true, channelMessageIds: Array.isArray(state.channelMessageIds) ? state.channelMessageIds.slice(-100) : [] }, null, 2), { mode: 0o600 })
    fs.renameSync(temporary, SETTINGS_PATH)
    requestDurableSync()
    return true
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }) } catch (_) {}
    if (!storageWarningShown) {
      storageWarningShown = true
      console.warn(`[advert] Advert settings were not saved: ${error.message || error}`)
    }
    return false
  }
}

function unwrapMessage(content) {
  return content?.ephemeralMessage?.message || content?.viewOnceMessage?.message || content?.viewOnceMessageV2?.message || content || null
}

function quotedContent(message) {
  const direct = unwrapMessage(message?.message)
  return direct?.extendedTextMessage?.contextInfo?.quotedMessage
    || direct?.imageMessage?.contextInfo?.quotedMessage
    || direct?.videoMessage?.contextInfo?.quotedMessage
    || null
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
  const normalize = (value) => String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const directCaption = normalize(direct?.imageMessage?.caption)
  const usableDirectCaption = /^\.advert(?:\s|$)/i.test(directCaption) ? '' : directCaption
  return normalize(fallback || usableDirectCaption || quoted?.imageMessage?.caption)
}

function captionAfterSeparator(payload, separator) {
  // Remove only the conventional space immediately after `|`; preserve every
  // additional space, newline, and character supplied by the user.
  return String(payload || '').slice(separator + 1).replace(/^\s/, '')
}

function textAfterFirstToken(value) {
  return String(value || '').replace(/^\S+\s*/, '')
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
  const target = path.join(path.dirname(SETTINGS_PATH), filename)
  try {
    fs.writeFileSync(target, buffer, { mode: 0o600 })
  } catch (error) {
    try { fs.rmSync(target, { force: true }) } catch (_) {}
    throw error
  }
  return { type: media.type, file: filename }
}

function removeAdvertMedia(media) {
  const file = media?.file
  if (!file || path.basename(file) !== file || !/^advert-[\w-]+\.jpg$/i.test(file)) return
  try { fs.rmSync(path.join(path.dirname(SETTINGS_PATH), file), { force: true }) } catch (_) {}
}

function removeUnusedAdvertMedia(state, mediaFiles) {
  const referenced = new Set(Object.values(state.groups || {}).map((config) => config?.media?.file).filter(Boolean))
  for (const media of mediaFiles) {
    if (media?.file && !referenced.has(media.file)) removeAdvertMedia(media)
  }
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
    '• `.advert groups` — list groups with numbers for DM setup',
    '• `.advert set <group number> 6h | Your advert text` — configure a group',
    '• `.advert set all 6h | Your advert text` — configure all participating groups',
    '• `.advert set 1,3 6h | Your advert text` — configure selected groups',
    '• Reply to an image in owner DM with `.advert set all 6h` or `.advert set 1,3 6h`',
    '• Add a caption with `.advert set all 6h | Caption text`',
    '• `.advert on/off/status/now/clear all` — manage all configured groups',
    '• `.advert all on/off/status/now/clear` — shortcut for all groups',
    '• `.advert clear` — clear all group adverts from owner DM',
    '• `.advert clear 1,3` — clear selected groups only',
    '• `.advert schedule` — show active adverts and next broadcast times',
    '• `.advert on/off/status/now/clear <group number>` — manage one group',
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

async function groupNameMap(sock) {
  try {
    const groups = await fetchParticipatingGroups(sock)
    return new Map(groups.map((group) => [group.jid, group.subject || 'Unnamed group']))
  } catch (_) {
    return new Map()
  }
}

async function ownerDmStatus(state, sock) {
  const groups = Object.entries(state.groups).filter(([groupId, config]) => groupId.endsWith('@g.us') && (config?.message || config?.media))
  if (!groups.length) return '📢 No advert groups are configured yet. Use `.advert set 6h | Your advert text` inside a group.'
  const names = await groupNameMap(sock)
  const tick = String.fromCharCode(96)
  const lines = groups.map(([groupId, config], index) => {
    const stateLabel = config.enabled ? 'ON' : 'OFF'
    const delivery = config.lastDelivery || 'not sent'
    const next = config.enabled && config.nextAt ? new Date(config.nextAt).toLocaleString() : 'paused'
    return `${index + 1}. *${names.get(groupId) || 'Unnamed group'}*\n   Group ID: ${tick}${groupId}${tick}\n   Type: *${advertContentType(config)}*\n   Status: *${stateLabel}* | Delivery: *${delivery}* | Sent: *${Number(config.sentCount || 0)}*\n   Next: ${next}`
  })
  return `📢 *ADVERT GROUPS*\n\n${lines.join('\n\n')}`
}

function advertContentType(config = {}) {
  if (config.media?.type === 'image' && config.message) return 'Image + caption'
  if (config.media?.type === 'image') return 'Image'
  return 'Text'
}

async function ownerDmScheduleStatus(state, sock) {
  const active = Object.entries(state.groups || {}).filter(([groupId, config]) => (
    groupId.endsWith('@g.us') && config?.enabled === true && (config.message || config.media) && config.intervalMs
  ))
  if (!active.length) return '📢 No active scheduled adverts. Configure one with `.advert set all 6h | Your advert text`, then use `.advert on all`.'
  const names = await groupNameMap(sock)
  const tick = String.fromCharCode(96)
  const lines = active.map(([groupId, config], index) => {
    const nextAt = Number(config.nextAt || 0)
    const next = nextAt > 0 ? new Date(nextAt).toLocaleString() : 'waiting for scheduler'
    return `${index + 1}. *${names.get(groupId) || 'Unnamed group'}*\n   Group ID: ${tick}${groupId}${tick}\n   Type: *${advertContentType(config)}*\n   Interval: *${formatInterval(config.intervalMs)}*\n   Next broadcast: *${next}*\n   Last delivery: *${config.lastDelivery || 'not sent'}*\n   Sent: *${Number(config.sentCount || 0)}*`
  })
  return `📅 *ACTIVE ADVERT SCHEDULE*\n\n${lines.join('\n\n')}`
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
  const tick = String.fromCharCode(96)
  return available.map((jid, index) => `${index + 1}. ${tick}${jid}${tick} — ${selected.has(jid) ? '*selected*' : 'available'}`).join('\n')
}

function advertButtons(buttons) {
  return buttons.slice(0, 3).map(({ id, label }) => ({
    buttonId: id,
    buttonText: { displayText: label },
    type: 1
  }))
}

async function replyInteractive(sock, chatId, message, text, buttons = []) {
  if (!buttons.length) return reply(sock, chatId, message, text)
  const payload = {
    text,
    footer: 'LEE TECH BOT • Tap a button or copy an ID from the message',
    buttons: advertButtons(buttons),
    headerType: 1
  }
  try {
    return await sock.sendMessage(chatId, payload, { quoted: message })
  } catch (_) {
    return reply(sock, chatId, message, text)
  }
}

function groupActionButtons(targets) {
  const first = targets[0]
  if (!first) return []
  const target = first.index || 1
  return [
    { id: `.advert set ${target} 6h | Your advert text`, label: `Set group ${target}` },
    { id: `.advert status ${target}`, label: `Status ${target}` },
    { id: `.advert on ${target}`, label: `Enable ${target}` }
  ]
}

async function resolveAdvertTargets(sock, targetSpec) {
  const groups = await fetchParticipatingGroups(sock)
  const raw = String(targetSpec || '').trim()
  if (raw.toLowerCase() === 'all') return groups
  const tokens = raw.split(',').map((value) => value.trim()).filter(Boolean)
  const targets = []
  for (const token of tokens) {
    const byIndex = /^\d{1,3}$/.test(token) ? groups[Number(token) - 1] : null
    const direct = normalizeGroupJid(token)
    const match = byIndex || groups.find((group) => direct && group.jid === direct)
    if (!match) throw new Error(`No participating group matches "${token}". Use .advert groups first.`)
    if (!targets.some((group) => group.jid === match.jid)) targets.push(match)
  }
  return targets
}

function channelActionButtons() {
  return [
    { id: '.advert channel all', label: 'Select all channels' },
    { id: '.advert channel on', label: 'Enable forwarding' },
    { id: '.advert channel off', label: 'Disable forwarding' }
  ]
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
    const content = String(config.message || '')
    const body = content ? `${content}\n\n*Powered by LEE TECH*` : '*Powered by LEE TECH*'
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
    if (action === 'groups' || action === 'list') {
      try {
        const groups = await fetchParticipatingGroups(sock)
        if (!groups.length) return reply(sock, chatId, message, '📢 The bot is not participating in any groups.')
        const lines = groups.map((group) => {
          const config = state.groups[group.jid]
          return `${group.index}. *${group.subject}*\n   Group: \`${group.number}\`\n   Advert: *${config?.enabled ? 'ON' : config ? 'OFF' : 'NOT CONFIGURED'}*`
        })
        return replyInteractive(sock, chatId, message, `📋 *ADVERT GROUPS*\n\n${lines.join('\n\n')}\n\nCopy a group ID above, or use the list number.\nExample: .advert set 1 6h | Your advert text`, groupActionButtons(groups))
      } catch (error) {
        return reply(sock, chatId, message, `❌ Could not list groups: ${error.message || error}`)
      }
    }
    if (action === 'schedule' || action === 'next') {
      return replyInteractive(sock, chatId, message, await ownerDmScheduleStatus(state, sock), [
        { id: '.advert now', label: 'Send enabled now' },
        { id: '.advert status', label: 'All advert status' },
        { id: '.advert off all', label: 'Pause all' }
      ])
    }
    if (action === 'clear' && args.length === 0) {
      const oldMedia = Object.values(state.groups || {}).map((config) => config?.media).filter(Boolean)
      const removed = Object.keys(state.groups || {}).filter((groupId) => groupId.endsWith('@g.us')).length
      for (const groupId of Object.keys(state.groups || {})) {
        if (groupId.endsWith('@g.us')) delete state.groups[groupId]
      }
      const saved = saveState(state)
      if (saved) removeUnusedAdvertMedia(state, oldMedia)
      return reply(sock, chatId, message, saved
        ? `✅ Cleared *${removed}* advert configuration(s) from all groups. Channel settings were not changed.`
        : '⚠️ Could not persist clearing the adverts because storage is full.')
    }
    // DM group syntax: `.advert set <list number|full group number> 6h | text`
    // and `.advert on|off|status|now|clear <target>`.
    const bulkCommands = ['set', 'configure', 'add', 'on', 'start', 'resume', 'off', 'stop', 'pause', 'status', 'now', 'send', 'clear', 'delete', 'remove']
    const bulkTarget = action === 'all' ? 'all' : String(args[0] || '')
    const allActionAliases = ['on', 'start', 'resume', 'off', 'stop', 'pause', 'status', 'now', 'send', 'clear', 'delete', 'remove']
    const bulkAction = action === 'all' ? (allActionAliases.includes(String(args[0] || '').toLowerCase()) ? String(args[0]).toLowerCase() : 'set') : action
    const bulkSpec = bulkTarget.toLowerCase() === 'all' || bulkTarget.includes(',')
    if (bulkSpec && bulkCommands.includes(bulkAction)) {
      try {
        const targets = await resolveAdvertTargets(sock, bulkTarget)
        if (!targets.length) return reply(sock, chatId, message, '📢 No participating groups were found.')
        const targetIds = targets.map((target) => target.jid)
        const targetLabel = bulkTarget.toLowerCase() === 'all' ? `all ${targets.length} participating groups` : `${targets.length} selected groups`
        if (['set', 'configure', 'add'].includes(bulkAction)) {
          const payload = action === 'all' ? rest : textAfterFirstToken(rest)
          const separator = payload.indexOf('|')
          const intervalMs = parseInterval(separator < 0 ? payload : payload.slice(0, separator))
          const advertText = separator < 0 ? captionFromCommand(message) : captionAfterSeparator(payload, separator)
          const hasMedia = Boolean(mediaFromCommand(message))
          if (!intervalMs) return reply(sock, chatId, message, '❌ Invalid interval. Use `.advert set all 6h | Your advert text` or `.advert set 1,3 6h | Your advert text`.')
          if (advertText.length > 2000) return reply(sock, chatId, message, '❌ Advert caption must not exceed 2000 characters.')
          let media = null
          if (hasMedia) {
            try { media = await saveAdvertMedia(message, 'broadcast') } catch (error) { return reply(sock, chatId, message, `❌ Could not save the advert image: ${error.message || error}`) }
          }
          if (!advertText && !media) return reply(sock, chatId, message, '❌ Add advert text or reply to an image.')
          const oldMedia = []
          for (const groupId of targetIds) {
            const current = state.groups[groupId]
            if (current?.media) oldMedia.push(current.media)
            state.groups[groupId] = { enabled: false, intervalMs, message: advertText || '', media, nextAt: Date.now() + intervalMs, sentCount: Number(current?.sentCount || 0), updatedAt: Date.now() }
          }
          const saved = saveState(state)
          if (saved) removeUnusedAdvertMedia(state, oldMedia)
          return replyInteractive(sock, chatId, message, `${saved ? '✅' : '⚠️'} One advert ${saved ? 'saved' : 'prepared but not persisted'} for *${targetLabel}* and is currently *OFF*.
Use ".advert on ${bulkTarget}" to enable it.`, [{ id: `.advert on ${bulkTarget}`, label: `Enable ${bulkTarget}` }, { id: `.advert status ${bulkTarget}`, label: 'View status' }])
        }
        if (['clear', 'delete', 'remove'].includes(bulkAction)) {
          const oldMedia = []
          for (const groupId of targetIds) { if (state.groups[groupId]?.media) oldMedia.push(state.groups[groupId].media); delete state.groups[groupId] }
          const saved = saveState(state)
          if (saved) removeUnusedAdvertMedia(state, oldMedia)
          return reply(sock, chatId, message, saved ? `✅ Advert removed from ${targetLabel}.` : '⚠️ Could not persist the removal because storage is full.')
        }
        if (bulkAction === 'status') {
          const tick = String.fromCharCode(96)
          const lines = targets.map((target, index) => {
            const config = state.groups[target.jid]
            return `${index + 1}. *${target.subject || 'Unnamed group'}*\n   Group ID: ${tick}${target.number}${tick} — *${config ? (config.enabled ? 'ON' : 'OFF') : 'NOT CONFIGURED'}*${config ? `\n   Type: *${advertContentType(config)}*` : ''}`
          })
          return replyInteractive(sock, chatId, message, `📢 *BULK ADVERT STATUS*\n\n${lines.join('\n')}`, [{ id: `.advert on ${bulkTarget}`, label: `Enable ${bulkTarget}` }, { id: `.advert off ${bulkTarget}`, label: `Pause ${bulkTarget}` }])
        }
        if (['on', 'start', 'resume', 'off', 'stop', 'pause'].includes(bulkAction)) {
          const enabled = ['on', 'start', 'resume'].includes(bulkAction)
          let changed = 0
          for (const groupId of targetIds) if (state.groups[groupId]) { state.groups[groupId].enabled = enabled; if (enabled) state.groups[groupId].nextAt = Math.max(Date.now() + state.groups[groupId].intervalMs, Number(state.groups[groupId].nextAt || 0)); changed += 1 }
          const saved = saveState(state)
          return reply(sock, chatId, message, saved ? `✅ Advertising ${enabled ? 'enabled' : 'paused'} for ${changed} configured group(s) in ${targetLabel}.` : '⚠️ Could not persist the setting because storage is full.')
        }
        if (['now', 'send'].includes(bulkAction)) {
          const results = await Promise.all(targetIds.filter((groupId) => state.groups[groupId]?.enabled === true).map((groupId) => sendAdvert(sock, groupId, state.groups[groupId], true)))
          return reply(sock, chatId, message, `✅ Sent adverts to *${results.filter(Boolean).length}/${results.length}* enabled group(s) in ${targetLabel}.`)
        }
      } catch (error) {
        return reply(sock, chatId, message, `❌ Bulk advert operation failed: ${error.message || error}`)
      }
    }
    const targetCandidate = String(args[0] || '')
    const targetLike = /^\d{1,3}$/.test(targetCandidate) || /^\d+[-\d]*@g\.us$/i.test(targetCandidate) || /^\d{4,}[-\d]*$/.test(targetCandidate)
    const targetAction = action === 'group' || (['set', 'configure', 'add', 'on', 'start', 'resume', 'off', 'stop', 'pause', 'status', 'now', 'send', 'clear', 'delete', 'remove'].includes(action) && targetLike)
    if (targetAction) {
      let dmAction = action
      let targetToken = args[0]
      if (action === 'group') {
        dmAction = String(args[1] || '').toLowerCase()
        targetToken = args[0]
      }
      if (!targetToken) {
        return reply(sock, chatId, message, 'Usage: `.advert groups`, then `.advert set <group number> 6h | Your advert text`')
      }
      if (targetAction) {
        // For set, the target is the first token and the remaining text keeps
        // multiline content intact, including the interval separator.
        try {
          const target = await resolveGroupTarget(sock, chatId, targetToken)
          if (target.error) return reply(sock, chatId, message, target.error)
          const groupId = target.jid
          const current = state.groups[groupId]
          if (['set', 'configure', 'add'].includes(dmAction)) {
            const payload = textAfterFirstToken(rest)
            const separator = payload.indexOf('|')
            const intervalMs = parseInterval(separator < 0 ? payload : payload.slice(0, separator))
            const advertText = separator < 0 ? captionFromCommand(message) : captionAfterSeparator(payload, separator)
            const hasMedia = Boolean(mediaFromCommand(message))
            if (!intervalMs) return reply(sock, chatId, message, '❌ Invalid interval. Use `.advert set <group number> 10m–30d | Your advert text`.')
            if (advertText.length > 2000) return reply(sock, chatId, message, '❌ Advert caption must not exceed 2000 characters.')
            let media = current?.media || null
            if (hasMedia) {
              try { media = await saveAdvertMedia(message, groupId) } catch (error) { return reply(sock, chatId, message, `❌ Could not save the advert image: ${error.message || error}`) }
            }
            if (!advertText && !media) return reply(sock, chatId, message, '❌ Add advert text or reply to an image.')
            state.groups[groupId] = { enabled: false, intervalMs, message: advertText || '', media, nextAt: Date.now() + intervalMs, sentCount: Number(current?.sentCount || 0), updatedAt: Date.now() }
            const saved = saveState(state)
            if (saved && current?.media && current.media.file !== media?.file) removeAdvertMedia(current.media)
            return reply(sock, chatId, message, `${saved ? '✅' : '⚠️'} Advert ${saved ? 'saved' : 'prepared but could not be persisted'} for *${target.subject || groupId}* and is currently *OFF*.\nUse ".advert on ${targetToken}" to start it.`)
          }
          if (!current) return reply(sock, chatId, message, '📢 No advert is configured for that group.')
          if (['clear', 'delete', 'remove'].includes(dmAction)) {
            const oldMedia = current.media
            delete state.groups[groupId]
            const saved = saveState(state)
            if (saved) removeAdvertMedia(oldMedia)
            return reply(sock, chatId, message, saved ? '✅ Advert configuration removed.' : '⚠️ Could not persist the removal because storage is full.')
          }
          if (dmAction === 'status') {
            return reply(sock, chatId, message, `📢 *ADVERT STATUS*\n\nGroup: *${target.subject || groupId}*\nStatus: *${current.enabled ? 'ON' : 'OFF'}*\nInterval: *${formatInterval(current.intervalMs)}*\nSent: *${Number(current.sentCount || 0)}*\nMessage:\n${current.message || '(image advert)'}`)
          }
          if (['on', 'start', 'resume'].includes(dmAction)) {
            current.enabled = true
            current.nextAt = Math.max(Date.now() + current.intervalMs, Number(current.nextAt || 0))
            const saved = saveState(state)
            return reply(sock, chatId, message, saved ? `✅ Advertising is ON for *${target.subject || groupId}*.` : '⚠️ Could not persist the setting because storage is full.')
          }
          if (['off', 'stop', 'pause'].includes(dmAction)) {
            current.enabled = false
            const saved = saveState(state)
            return reply(sock, chatId, message, saved ? `✅ Advertising is OFF for *${target.subject || groupId}*.` : '⚠️ Could not persist the setting because storage is full.')
          }
          if (['now', 'send'].includes(dmAction)) {
            const sent = await sendAdvert(sock, groupId, current, true)
            return reply(sock, chatId, message, sent ? `✅ Advert sent to *${target.subject || groupId}*.` : '❌ Advert delivery failed; the bot will retry on schedule.')
          }
        } catch (error) {
          return reply(sock, chatId, message, `❌ Advert group operation failed: ${error.message || error}`)
        }
      }
    }
    if (action === 'channel') {
      const channelAction = String(args[0] || '').toLowerCase()
      if (channelAction === 'status') {
        const available = availableChannelJids()
        const selected = selectedChannelJids(state)
        return replyInteractive(sock, chatId, message, `📢 *CHANNEL ADVERT SETTINGS*\n\nForwarding: *${state.channelForwardingEnabled === true ? 'ON' : 'OFF'}*\nSelected: *${configuredChannelJids(state).size}* | Available: *${available.length}*\n\n${formatChannelList(available, selected)}\n\nCopy a channel ID above. Use .advert channel add <JID>, remove <JID|all>, or all.`, channelActionButtons())
      }
      if (channelAction === 'on' || channelAction === 'enable' || channelAction === 'start') {
        state.channelForwardingEnabled = true
        const available = availableChannelJids()
        if (!selectedChannelJids(state).size) state.channelJids = available
        saveState(state)
        return replyInteractive(sock, chatId, message, `✅ Channel forwarding is ON.\n\nAvailable channels:\n${formatChannelList(available, selectedChannelJids(state))}\n\nCopy a channel ID above. Use .advert channel remove <JID> to exclude one or remove all to clear the sources.`, channelActionButtons())
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
        return replyInteractive(sock, chatId, message, `✅ All *${state.channelJids.length}* available channel(s) selected and forwarding enabled.`, [{ id: '.advert channel status', label: 'View channel status' }, { id: '.advert channel off', label: 'Disable forwarding' }])
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
    if (action === 'status') {
      const groups = Object.keys(state.groups || {}).filter((jid) => jid.endsWith('@g.us'))
      return replyInteractive(sock, chatId, message, await ownerDmStatus(state, sock), groupActionButtons(groups.map((jid, index) => ({ jid, index: index + 1 }))))
    }
    if (action === 'now' || action === 'send') {
      const result = await sendEnabledAdverts(sock)
      return reply(sock, chatId, message, result.total
        ? `✅ Advert broadcast complete.\nSent: *${result.sent}/${result.total}* enabled groups.${result.failed ? `\nFailed and scheduled for retry: *${result.failed}*.` : ''}`
        : '📢 No enabled advert groups were found. Configure one with `.advert set 6h | Your advert text` inside a group.')
    }
    return replyInteractive(sock, chatId, message, '📢 From owner DM use `.advert groups` to list groups, `.advert status` to view saved adverts, or `.advert now` to send to every enabled group. Configure adverts inside each target group.', [
      { id: '.advert groups', label: 'List groups' },
      { id: '.advert status', label: 'Advert status' },
      { id: '.advert now', label: 'Send enabled now' }
    ])
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
    const advertText = separator < 0 ? captionFromCommand(message) : captionAfterSeparator(payload, separator)
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
  mediaFromCommand,
  captionFromCommand,
  loadState,
  saveState,
  advertCommand,
  sendAdvert,
  handleChannelUpdate,
  attachAdvertScheduler,
  detachAdvertScheduler,
  tick
}
