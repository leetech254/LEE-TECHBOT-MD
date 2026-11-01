'use strict';

const os = require('os');
const settings = require('../settings');
const { allCommands } = require('../lib/menuCatalog');
const menuSettingsPath = require('path').join(process.cwd(), 'data', 'menuSettings.json');

function menuSettings() {
    try { return JSON.parse(require('fs').readFileSync(menuSettingsPath, 'utf8')); }
    catch (_) { return {}; }
}

function formatUptime(seconds) {
    const total = Math.max(0, Math.floor(seconds));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function formatBytes(value) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = Math.max(0, value);
    let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

async function speedCommand(sock, chatId, message) {
    const started = Date.now();
    const sent = await sock.sendMessage(chatId, { text: '⚡ Measuring response speed…' }, { quoted: message });
    const latency = Date.now() - started;
    global.lastCommandLatencyMs = latency;
    return sock.sendMessage(chatId, { text: `╭─〔 ⚡ SPEED TEST 〕\n│ Response: *${latency} ms*\n│ Status: *ONLINE* ✅\n╰──────────────` }, { quoted: sent });
}

async function uptimeCommand(sock, chatId, message) {
    return sock.sendMessage(chatId, { text: `╭─〔 ⏱️ BOT UPTIME 〕\n│ Online for: *${formatUptime(process.uptime())}*\n│ Runtime: *${process.version}*\n│ Status: *Stable* ✅\n╰──────────────` }, { quoted: message });
}

async function idCommand(sock, chatId, message) {
    const sender = message.key?.participant || message.key?.remoteJid || 'unknown';
    return sock.sendMessage(chatId, { text: `╭─〔 🪪 IDENTIFIERS 〕\n│ Chat ID: \`${chatId}\`\n│ Your ID: \`${sender}\`\n╰──────────────` }, { quoted: message });
}

async function botInfoCommand(sock, chatId, message) {
    const mem = process.memoryUsage();
    const menu = menuSettings();
    return sock.sendMessage(chatId, { text: `╭━━〔 🤖 ${settings.botName} 〕━━╮\n┃ Version: *${settings.version}*\n┃ Owner: *${settings.botOwner}*\n┃ Platform: *${os.platform()}*\n┃ Commands: *${allCommands().length}*\n┃ Menu style: *${menu.style || 'premium'}*\n┃ Menu font: *${menu.font || 'clean'}*\n┃ Memory: *${formatBytes(mem.rss)}*\n┃ Uptime: *${formatUptime(process.uptime())}*\n╰━━━━━━━━━━━━━━━━╯\n\n⚡ Premium • Fast • Reliable` }, { quoted: message });
}

async function healthCommand(sock, chatId, message) {
    const snapshot = global.botHealth?.snapshot?.() || {};
    return sock.sendMessage(chatId, { text: `╭─〔 💚 BOT HEALTH 〕\n│ Status: *HEALTHY* ✅\n│ Messages: *${snapshot.messages || 0}*\n│ Commands: *${snapshot.commands || 0}*\n│ Errors: *${snapshot.errors || 0}*\n│ Uptime: *${formatUptime(snapshot.uptimeSeconds || process.uptime())}*\n╰──────────────` }, { quoted: message });
}

module.exports = { speedCommand, uptimeCommand, idCommand, botInfoCommand, healthCommand };
