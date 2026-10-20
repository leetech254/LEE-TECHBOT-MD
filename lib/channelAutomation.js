'use strict';

const CHANNEL_LINKS = Object.freeze([
    Object.freeze({
        name: '💠 ❰ TECH - DIGITAL SOLUTIONS HUB ❱',
        url: 'https://whatsapp.com/channel/0029Vb9GMft7YSd5GfsIyZ2H'
    }),
    Object.freeze({
        name: 'ORBIT GROWTH - GROW FAST',
        url: 'https://whatsapp.com/channel/0029VbBu1EgJUM2iVI3tPE0S'
    })
]);
const DEFAULT_REACTION = '💠';
const MAX_REMEMBERED_REACTIONS_PER_CHANNEL = 500;

function inviteCodeFromChannelUrl(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return null; }
    if (url.protocol !== 'https:' || !['whatsapp.com', 'www.whatsapp.com'].includes(url.hostname.toLowerCase())) return null;
    const match = url.pathname.match(/^\/channel\/([A-Za-z0-9]+)\/?$/);
    return match ? match[1] : null;
}

function accountState(state, accountJid) {
    const account = String(accountJid || '').trim().toLowerCase();
    if (!account) throw new TypeError('A linked WhatsApp account JID is required for channel automation.');
    if (!state.accounts || typeof state.accounts !== 'object' || Array.isArray(state.accounts)) state.accounts = {};
    if (!state.accounts[account] || typeof state.accounts[account] !== 'object') {
        state.accounts[account] = { followedCodes: [], channelJids: {}, reacted: {} };
    }
    const record = state.accounts[account];
    if (!Array.isArray(record.followedCodes)) record.followedCodes = [];
    if (!record.channelJids || typeof record.channelJids !== 'object') record.channelJids = {};
    if (!record.reacted || typeof record.reacted !== 'object') record.reacted = {};
    return record;
}

function createChannelAutomation({
    channels = CHANNEL_LINKS,
    reaction = DEFAULT_REACTION,
    followEnabled = true,
    reactEnabled = true,
    state = {},
    persist = () => {},
    logger = console
} = {}) {
    if (typeof reaction !== 'string' || !reaction.trim()) throw new TypeError('A non-empty channel reaction is required.');
    const inFlight = new Set();

    async function followChannels(socket, accountJid) {
        const record = accountState(state, accountJid);
        const outcomes = [];
        if (typeof socket?.newsletterMetadata !== 'function' || typeof socket?.newsletterFollow !== 'function') {
            logger.warn?.('[channel-auto] This Baileys socket does not support channel follow; skipping the configured channels.');
            return outcomes;
        }

        for (const channel of channels) {
            const inviteCode = inviteCodeFromChannelUrl(channel.url);
            if (!inviteCode) {
                logger.warn?.(`[channel-auto] Invalid configured channel URL; skipping ${channel.name}.`);
                outcomes.push({ name: channel.name, followed: false, error: 'Invalid configured WhatsApp channel URL.' });
                continue;
            }
            const flightKey = `follow:${String(accountJid).toLowerCase()}:${inviteCode}`;
            if (inFlight.has(flightKey)) continue;
            inFlight.add(flightKey);
            try {
                const metadata = await socket.newsletterMetadata('invite', inviteCode);
                const jid = String(metadata?.id || '');
                if (!/^\d+@newsletter$/.test(jid)) throw new Error('WhatsApp did not return a valid channel ID for the invite link.');
                record.channelJids[inviteCode] = jid;
                persist(state);

                if (!followEnabled) {
                    outcomes.push({ name: channel.name, followed: false, disabled: true, jid });
                } else if (!record.followedCodes.includes(inviteCode)) {
                    await socket.newsletterFollow(jid);
                    record.followedCodes.push(inviteCode);
                    persist(state);
                    logger.info?.(`[channel-auto] Followed ${channel.name}.`);
                    outcomes.push({ name: channel.name, followed: true, jid });
                } else {
                    outcomes.push({ name: channel.name, followed: false, alreadyFollowed: true, jid });
                }
            } catch (error) {
                const detail = String(error?.message || error).slice(0, 220);
                logger.warn?.(`[channel-auto] Could not follow ${channel.name}: ${detail}`);
                outcomes.push({ name: channel.name, followed: false, error: detail });
            } finally {
                inFlight.delete(flightKey);
            }
        }
        return outcomes;
    }

    async function handleMessage(socket, message, accountJid, upsertType = 'notify') {
        const key = message?.key || {};
        const jid = String(key.remoteJid || '');
        if (!jid.endsWith('@newsletter')) return false;
        // Never pass channel posts into the bot's ordinary chat-command handler.
        if (upsertType !== 'notify') return true;
        if (!reactEnabled) return true;

        const record = accountState(state, accountJid);
        const allowedJids = new Set(Object.values(record.channelJids));
        if (!allowedJids.has(jid)) return true;
        const serverId = String(key.server_id || key.serverId || '');
        if (!serverId) return true;

        const reacted = Array.isArray(record.reacted[jid]) ? record.reacted[jid] : [];
        record.reacted[jid] = reacted;
        if (reacted.includes(serverId)) return true;

        const flightKey = `react:${String(accountJid).toLowerCase()}:${jid}:${serverId}`;
        if (inFlight.has(flightKey)) return true;
        inFlight.add(flightKey);
        try {
            if (typeof socket?.newsletterReactMessage !== 'function') throw new Error('This Baileys socket does not support channel reactions.');
            await socket.newsletterReactMessage(jid, serverId, reaction);
            reacted.push(serverId);
            if (reacted.length > MAX_REMEMBERED_REACTIONS_PER_CHANNEL) reacted.splice(0, reacted.length - MAX_REMEMBERED_REACTIONS_PER_CHANNEL);
            persist(state);
            logger.info?.(`[channel-auto] Reacted ${reaction} to a new post in ${jid}.`);
        } catch (error) {
            logger.warn?.(`[channel-auto] Could not react to channel post ${serverId}: ${String(error?.message || error).slice(0, 220)}`);
        } finally {
            inFlight.delete(flightKey);
        }
        return true;
    }

    return { followChannels, handleMessage };
}

module.exports = {
    CHANNEL_LINKS,
    DEFAULT_REACTION,
    inviteCodeFromChannelUrl,
    createChannelAutomation,
    MAX_REMEMBERED_REACTIONS_PER_CHANNEL
};
