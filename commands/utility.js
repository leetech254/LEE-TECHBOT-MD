'use strict'
const os = require('os')
const settings = require('../settings')
const { allCommands } = require('../lib/menuCatalog')
const { resolveAuthDir } = require('../lib/storagePaths')
const { diskStatus, systemSnapshot, runPersistenceSelfTest, storageSummary } = require('../lib/systemDiagnostics')
const menuSettingsPath = require('path').join(process.cwd(), 'data', 'menuSettings.json')

function menuSettings() {
  try { return JSON.parse(require('fs').readFileSync(menuSettingsPath, 'utf8')) } catch (_) { return {} }
}
function formatUptime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${days}d ${hours}h ${minutes}m ${secs}s`
}
function formatBytes(value) {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = Math.max(0, Number(value) || 0)
  let index = 0
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1 }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`
}
async function speedCommand(sock, chatId, message) {
  const started = Date.now()
  const sent = await sock.sendMessage(chatId, { text: '⚡ Measuring response speed…' }, { quoted: message })
  const latency = Date.now() - started
  global.lastCommandLatencyMs = latency
  return sock.sendMessage(chatId, { text: `╭─〔 ⚡ SPEED TEST 〕\n│ Response: *${latency} ms*\n│ Status: *ONLINE* ✅\n╰──────────────` }, { quoted: sent })
}
async function uptimeCommand(sock, chatId, message) {
  return sock.sendMessage(chatId, { text: `╭─〔 ⏱️ BOT UPTIME 〕\n│ Online for: *${formatUptime(process.uptime())}*\n│ Runtime: *${process.version}*\n│ Status: *Stable* ✅\n╰──────────────` }, { quoted: message })
}
async function idCommand(sock, chatId, message) {
  const sender = message.key?.participant || message.key?.remoteJid || 'unknown'
  return sock.sendMessage(chatId, { text: `╭─〔 🪪 IDENTIFIERS 〕\n│ Chat ID: \`${chatId}\`\n│ Your ID: \`${sender}\`\n╰──────────────` }, { quoted: message })
}
async function botInfoCommand(sock, chatId, message) {
  const mem = process.memoryUsage()
  const menu = menuSettings()
  return sock.sendMessage(chatId, { text: `╭━━〔 🤖 ${settings.botName} 〕━━╮\n┃ Version: *${settings.version}*\n┃ Owner: *${settings.botOwner}*\n┃ Platform: *${os.platform()}*\n┃ Commands: *${allCommands().length}*\n┃ Menu style: *${menu.style || 'premium'}*\n┃ Menu font: *${menu.font || 'clean'}*\n┃ Memory: *${formatBytes(mem.rss)}*\n┃ Uptime: *${formatUptime(process.uptime())}*\n╰━━━━━━━━━━━━━━━━╯\n\n⚡ Premium • Fast • Reliable` }, { quoted: message })
}
async function healthCommand(sock, chatId, message) {
  const snapshot = global.botHealth?.snapshot?.() || {}
  const disk = diskStatus(process.cwd())
  const status = disk.level === 'critical' ? 'CRITICAL' : snapshot.errors ? 'DEGRADED' : 'HEALTHY'
  return sock.sendMessage(chatId, { text: `╭─〔 💚 BOT HEALTH 〕\n│ Status: *${status}* ${status === 'HEALTHY' ? '✅' : '⚠️'}\n│ Messages: *${snapshot.messages || 0}*\n│ Commands: *${snapshot.commands || 0}*\n│ Errors: *${snapshot.errors || 0}*\n│ Disk: *${disk.free} free (${disk.usedPercent}% used)*\n│ Uptime: *${formatUptime(snapshot.uptimeSeconds || process.uptime())}*\n╰──────────────` }, { quoted: message })
}
function diagnosticsText(snapshot) {
  const storage = snapshot.storage || {}
  const disk = snapshot.disk || {}
  return `╭━━〔 🛠️ SYSTEM STATUS 〕━━╮\n┃ Platform: *${snapshot.platform}*\n┃ Node: *${snapshot.node}*\n┃ PID: *${snapshot.pid}*\n┃ Uptime: *${formatUptime(snapshot.uptimeSeconds)}*\n┃ Memory: *${snapshot.memory?.rss || 'unknown'}*\n┃ Disk: *${disk.level || 'unknown'}* — ${disk.free || 'unknown'} free\n┃ Storage: *${storage.mode || 'unknown'}*\n┃ Restart safe: *${storage.safeForRestart ? 'YES ✅' : 'NO ⚠️'}*\n┃ Backup: *${storage.lastSyncAt || 'not synced'}*\n╰━━━━━━━━━━━━━━━━╯`
}
async function systemStatusCommand(sock, chatId, message) {
  const snapshot = systemSnapshot({ authDir: resolveAuthDir(process.env), storage: global.durableAuthStore, health: global.botHealth?.snapshot?.() || {} })
  return sock.sendMessage(chatId, { text: diagnosticsText(snapshot) }, { quoted: message })
}
async function storageStatusCommand(sock, chatId, message, userMessage = '') {
  const storage = global.durableAuthStore
  if (/\btest\b/i.test(userMessage)) {
    const result = await runPersistenceSelfTest({ authDir: resolveAuthDir(process.env), storage })
    return sock.sendMessage(chatId, { text: `╭━━〔 💾 PERSISTENCE TEST 〕━━╮\n┃ Result: *${result.ok ? 'PASSED ✅' : 'FAILED ⚠️'}*\n┃ Local write: *${result.localWrite ? 'OK' : 'FAILED'}*\n┃ Durable access: *${result.durableAccess === null ? 'N/A (local)' : result.durableAccess ? 'OK' : 'FAILED'}*\n┃ Disk: *${result.disk.free || 'unknown'} free (${result.disk.level || 'unknown'})*\n┃ Duration: *${result.durationMs} ms*\n${result.error ? `┃ Error: ${result.error}\n` : ''}╰━━━━━━━━━━━━━━━━╯` }, { quoted: message })
  }
  const status = storage?.status?.() || {}
  const summary = storageSummary(status, resolveAuthDir(process.env))
  return sock.sendMessage(chatId, { text: `╭━━〔 💾 STORAGE STATUS 〕━━╮\n┃ Mode: *${summary.mode}*\n┃ Healthy: *${summary.healthy ? 'YES ✅' : 'NO ⚠️'}*\n┃ Restart safe: *${summary.safeForRestart ? 'YES ✅' : 'NO ⚠️'}*\n┃ Local writable: *${status.localWritable === true ? 'YES' : 'NO'}*\n┃ Persistent volume: *${status.localPersistent === true ? 'YES' : 'NO'}*\n┃ Last backup: *${summary.lastSyncAt || 'not synced'}*\n┃ Backup files: *${summary.lastSyncFiles}*\n┃ Retrying: *${summary.retrying ? 'YES' : 'NO'}*\n${summary.error ? `┃ Error: ${summary.error}\n` : ''}╰━━━━━━━━━━━━━━━━╯\n\nRun *.storage test* to verify local writes and durable access.` }, { quoted: message })
}
module.exports = { speedCommand, uptimeCommand, idCommand, botInfoCommand, healthCommand, systemStatusCommand, storageStatusCommand }
