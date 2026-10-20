'use strict';

const { setAntilink, getAntilink } = require('../lib/index');
const isOwnerOrSudo = require('../lib/isOwner');
const { getGroupMetadata } = require('../lib/groupMetadata');
const { resolveGroupTarget } = require('../lib/groupTarget');
const { modeLabel, normalizeDomain } = require('../lib/antilink');

const MODES = new Set(['all', 'scam', 'whatsapp', 'telegram', 'custom']);
const ACTIONS = new Set(['delete', 'kick', 'warn', 'ban']);

function groupJid(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (raw.endsWith('@g.us')) return raw;
    const digits = raw.replace(/[^0-9]/g, '');
    return digits ? `${digits}@g.us` : '';
}

function parseDomains(value) {
    return String(value || '').split(/[;,]+/).map(normalizeDomain).filter(Boolean).slice(0, 50);
}

function usage(dm = false) {
    const target = dm ? '<group-number|group-jid> ' : '';
    return `*ANTILINK SETUP*\n\n${dm ? 'Linked-account DM configuration:\n' : ''}.antilink ${target}on all silent\n.antilink ${target}off\n.antilink ${target}set <all|scam|whatsapp|telegram|custom> [silent|loud] [allow domain1,domain2] [deny domain3]\n.antilink ${target}action <delete|kick|warn|ban>\n.antilink ${target}threshold <1-100>\n.antilink ${target}enforce <on|off>\n.antilink ${target}get\n\nExamples:\n.antilink ${target}set all silent allow whatsapp.com,wa.me\n.antilink ${target}set scam silent\n.antilink ${target}action ban\n.antilink ${target}threshold 5\n.antilink ${target}enforce on\n.antilink ${target}set custom silent deny example.com`;
}

function parseConfigArgs(args) {
    const config = {};
    let index = 0;
    while (index < args.length) {
        const value = String(args[index] || '').toLowerCase();
        if (MODES.has(value)) config.mode = value;
        else if (value === 'silent' || value === 'quiet') config.silent = true;
        else if (value === 'loud' || value === 'notify') config.silent = false;
        else if (value === 'allow' || value === 'except' || value === 'whitelist') {
            config.allowDomains = parseDomains(args[index + 1]);
            index += 1;
        } else if (value === 'deny' || value === 'block' || value === 'blacklist') {
            config.denyDomains = parseDomains(args[index + 1]);
            index += 1;
        }
        index += 1;
    }
    return config;
}

function cleanGroupName(value) {
    const name = String(value || '').replace(/\s+/g, ' ').trim();
    return name.slice(0, 120);
}

async function resolveGroupName(sock, targetChatId) {
    const metadata = await getGroupMetadata(sock, targetChatId);
    const subject = cleanGroupName(metadata?.subject);
    // Some Baileys fallbacks expose the JID as `name`; never present that as
    // the human-readable group name in confirmations.
    if (!subject || /@g\.us$/i.test(subject)) return 'Unknown group';
    return subject;
}

function groupLabel(groupName) {
    return groupName || 'Unknown group';
}

async function resolveAntilinkTarget(sock, chatId, value) {
    const raw = String(value || '').trim();
    // A short numeric target is the numbered entry shown by .listgroup.
    if (/^\d{1,3}$/.test(raw)) {
        return resolveGroupTarget(sock, chatId, raw);
    }
    const jid = groupJid(raw);
    return jid ? { jid, number: jid.replace(/@g\.us$/i, ''), source: 'group-number' } : { error: usage(true) };
}

async function handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message, ownerCheck = false) {
    try {
        const isGroup = String(chatId).endsWith('@g.us');
        const isLinkedOwner = Boolean(message?.key?.fromMe) || ownerCheck || await isOwnerOrSudo(senderId, sock, chatId).catch(() => false);
        const rawArgs = userMessage.slice('.antilink'.length).trim().split(/\s+/).filter(Boolean);
        let targetChatId = chatId;
        if (!isGroup) {
            if (!isLinkedOwner) return sock.sendMessage(chatId, { text: '❌ Only the linked account owner can configure group anti-link settings from DM.' }, { quoted: message });
            const target = await resolveAntilinkTarget(sock, chatId, rawArgs.shift());
            if (target.error) return sock.sendMessage(chatId, { text: target.error }, { quoted: message });
            targetChatId = target.jid;
        } else if (!isSenderAdmin && !isLinkedOwner) {
            return sock.sendMessage(chatId, { text: '❌ Group admins or the linked account owner can configure anti-link.' }, { quoted: message });
        }

        // Resolve once per command. The shared helper caches metadata briefly and
        // safely returns null when WhatsApp is rate-limited or temporarily offline.
        const groupName = await resolveGroupName(sock, targetChatId);
        const targetLabel = groupLabel(groupName, targetChatId);
        const action = String(rawArgs.shift() || 'get').toLowerCase();
        if (action === 'on') {
            const config = parseConfigArgs(rawArgs);
            const current = await getAntilink(targetChatId, 'on') || {};
            const mode = config.mode || current.mode || 'all';
            const silent = config.silent === undefined ? (current.silent !== false) : config.silent;
            const result = await setAntilink(targetChatId, 'on', current.action || 'delete', {
                ...config,
                mode,
                silent,
                allowDomains: config.allowDomains || current.allowDomains || [],
                denyDomains: config.denyDomains || current.denyDomains || []
            });
            return sock.sendMessage(chatId, { text: result ? `✅ Anti-link enabled for ${targetLabel}. Mode: ${mode}; silent deletion: ${silent ? 'on' : 'off'}; action: ${current.action || 'delete'}.` : '❌ Failed to enable anti-link.' }, { quoted: message });
        }
        if (action === 'off') {
            const current = await getAntilink(targetChatId, 'on') || {};
            const result = await setAntilink(targetChatId, 'off', current.action || 'delete', {});
            return sock.sendMessage(chatId, { text: result ? `✅ Anti-link disabled for ${targetLabel}. Saved rules were kept; use .antilink on to re-enable them.` : '❌ Failed to disable anti-link.' }, { quoted: message });
        }
        if (action === 'action') {
            const nextAction = String(rawArgs[0] || '').toLowerCase();
            if (!ACTIONS.has(nextAction)) return sock.sendMessage(chatId, { text: 'Use action delete, kick, warn, or ban.' }, { quoted: message });
            const current = await getAntilink(targetChatId, 'on') || {};
            await setAntilink(targetChatId, current.enabled ? 'on' : 'off', nextAction, {});
            return sock.sendMessage(chatId, { text: `✅ Anti-link action for ${targetLabel}: ${nextAction}.` }, { quoted: message });
        }
        if (action === 'threshold') {
            const value = String(rawArgs[0] || '').trim();
            const threshold = Number(value);
            if (!/^\d+$/.test(value) || !Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
                return sock.sendMessage(chatId, { text: `Use a threshold from 1 to 100. Example: .antilink ${isGroup ? '' : `${targetChatId} `}threshold 5` }, { quoted: message });
            }
            const current = await getAntilink(targetChatId, 'on') || {};
            const result = await setAntilink(targetChatId, current.enabled ? 'on' : 'off', current.action || 'delete', { threshold });
            return sock.sendMessage(chatId, { text: result ? `✅ Anti-link threshold for ${targetLabel}: ${threshold} unauthorized links before ${current.action === 'ban' ? 'ban' : 'enforcement'}.` : '❌ Failed to save anti-link threshold.' }, { quoted: message });
        }
        if (action === 'enforce') {
            const value = String(rawArgs[0] || '').toLowerCase();
            if (!['on', 'off'].includes(value)) return sock.sendMessage(chatId, { text: `Use .antilink ${isGroup ? '' : `${targetChatId} `}enforce on or off.` }, { quoted: message });
            const current = await getAntilink(targetChatId, 'on') || {};
            const result = await setAntilink(targetChatId, current.enabled ? 'on' : 'off', current.action || 'delete', { enforceAdmins: value === 'on' });
            return sock.sendMessage(chatId, { text: result ? `✅ Anti-link admin enforcement for ${targetLabel}: ${value.toUpperCase()}.` : '❌ Failed to save admin enforcement.' }, { quoted: message });
        }
        if (action === 'set') {
            if (ACTIONS.has(String(rawArgs[0] || '').toLowerCase())) {
                const current = await getAntilink(targetChatId, 'on') || {};
                const legacyAction = String(rawArgs[0]).toLowerCase();
                const result = await setAntilink(targetChatId, current.enabled ? 'on' : 'off', legacyAction, {});
                return sock.sendMessage(chatId, { text: result ? `✅ Anti-link action for ${targetLabel}: ${legacyAction}.` : '❌ Failed to save anti-link action.' }, { quoted: message });
            }
            const config = parseConfigArgs(rawArgs);
            const current = await getAntilink(targetChatId, 'on') || {};
            const result = await setAntilink(targetChatId, 'on', current.action || 'delete', { ...config, mode: config.mode || current.mode || 'all', silent: config.silent === undefined ? current.silent !== false : config.silent, allowDomains: config.allowDomains || current.allowDomains || [], denyDomains: config.denyDomains || current.denyDomains || [] });
            return sock.sendMessage(chatId, { text: result ? `✅ Anti-link settings saved for ${targetLabel}. Mode: ${config.mode || current.mode || 'all'}; silent: ${(config.silent === undefined ? current.silent !== false : config.silent) ? 'on' : 'off'}.` : '❌ Failed to save anti-link settings.' }, { quoted: message });
        }
        if (action === 'get' || action === 'status') {
            const current = await getAntilink(targetChatId, 'on');
            const allow = current?.allowDomains?.length ? current.allowDomains.join(', ') : 'none';
            const deny = current?.denyDomains?.length ? current.denyDomains.join(', ') : 'none';
            const threshold = current?.threshold || Number(process.env.WARN_COUNT || 3);
            return sock.sendMessage(chatId, { text: `*Anti-link configuration*\nGroup: ${groupName}\nGroup ID: ${targetChatId}\nStatus: ${current?.enabled ? 'ON' : 'OFF'}\nMode: ${modeLabel(current?.mode || 'all')}\nAction: ${current?.action || 'delete'}\nWarning threshold: ${threshold}\nSilent deletion: ${current?.silent === false ? 'OFF' : 'ON'}\nAdmin enforcement: ${current?.enforceAdmins ? 'ON' : 'OFF'}\nAllowed domains: ${allow}\nDenied domains: ${deny}` }, { quoted: message });
        }
        return sock.sendMessage(chatId, { text: usage(!isGroup) }, { quoted: message });
    } catch (error) {
        console.error('Error in antilink command:', error);
        return sock.sendMessage(chatId, { text: '❌ Error processing anti-link settings.' }, { quoted: message });
    }
}

module.exports = { handleAntilinkCommand, groupJid, parseConfigArgs, parseDomains, cleanGroupName, resolveGroupName, groupLabel, resolveAntilinkTarget };
