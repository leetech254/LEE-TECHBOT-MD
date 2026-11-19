'use strict';

function sessionStorageSummary(status = {}) {
    if (status.enabled) {
        return status.healthy
            ? 'Session backup: *Cloud backup active* ☁️'
            : 'Session backup: *Cloud backup needs attention* ⚠️';
    }
    if (status.localPersistent) return 'Session backup: *Persistent host storage detected* 💾';
    if (status.localWritable) return 'Session backup: *Local storage only; host resets may remove the session* ⚠️';
    return 'Session backup: *Persistence not confirmed; configure a host volume or cloud backup* ⚠️';
}

function formatConnectedMessage({ botName, version, prefix, storageStatus, connectedAt = new Date(), timeZone }) {
    const time = new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
        ...(timeZone ? { timeZone } : {})
    }).format(connectedAt);
    const commandPrefix = prefix === 'none' ? '.' : (prefix || '.');
    const prefixLabel = prefix === 'none' ? 'No prefix (use .)' : `\`${commandPrefix}\``;

    return `✅ *${botName || 'LEE TECH BOT'} CONNECTED*\n` +
        `Your WhatsApp bot is online and ready.\n\n` +
        `🕒 Connected: ${time}\n` +
        `🏷️ Version: *${version || 'unknown'}*\n` +
        `⌨️ Prefix: ${prefixLabel}\n` +
        `🛡️ ${sessionStorageSummary(storageStatus)}\n\n` +
        `Try \`${commandPrefix}menu\` for commands or \`${commandPrefix}health\` for status.`;
}

function formatReconnectedMessage({ botName, version, prefix }) {
    const commandPrefix = prefix === 'none' ? '.' : (prefix || '.');
    const prefixLabel = prefix === 'none' ? 'No prefix (use .)' : `\`${commandPrefix}\``;

    return `🔄 *${botName || 'LEE TECH BOT'} RECONNECTED*\n` +
        `The connection was restored; the bot is online and ready.\n\n` +
        `⌨️ Prefix: ${prefixLabel}\n` +
        `🏷️ Version: *${version || 'unknown'}*\n\n` +
        `Use \`${commandPrefix}menu\` for commands or \`${commandPrefix}health\` to check status.`;
}

module.exports = { formatConnectedMessage, formatReconnectedMessage, sessionStorageSummary };
