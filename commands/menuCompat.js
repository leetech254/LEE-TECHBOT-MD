'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const aiCommand = require('./ai');
const animeCommand = require('./anime').animeCommand;
const downloadCommand = require('./download');
const { speedCommand, uptimeCommand, idCommand, botInfoCommand, healthCommand } = require('./utility');
const quoteCommand = require('./quote');
const factCommand = require('./fact');
const { truthCommand } = require('./truth');
const eightBallCommand = require('./eightball').eightBallCommand;
const stickerTelegramCommand = require('./stickertelegram');
const toStatusCommand = require('./tostatus');
const groupInfoCommand = require('./groupinfo');
const { autoStatusCommand } = require('./autostatus');
const { setGroupDescription, setGroupName, setGroupPhoto } = require('./groupmanage');
const { lyricsCommand } = require('./lyrics');
const { onlineMembers } = require('./groupcheck');
const yts = require('yt-search');
const { clearCommand } = require('./clear');
const vv2Command = require('./vv2');
const audioSpeedCommand = require('./audiospeed');
const setProfilePicture = require('./setpp');
const { paymentCommand, setPaymentCommand } = require('./payment');
const simageCommand = require('./simage');
const { allCommands } = require('../lib/menuCatalog');
const { superOwnerNumber } = require('../settings');
const { fetchParticipatingGroups } = require('../lib/groupTarget');
const { groupSettingsCommand } = require('../commands/groupSettings');
const { getAntilink } = require('../lib/index');
const { groqCommand } = require('./groq');
const { legacyCommand } = require('./legacyCommands');
const linkCommand = require('./link');
const groupVcfCommand = require('./groupvcf');
const leaveCommand = require('./leave');
const {
    addAllCommand,
    unwarnCommand,
    antiStatusCommand,
    groupAlertCommand,
    addMetaAiCommand,
    removeMetaAiCommand,
    openTimeCommand,
    closeTimeCommand
} = require('./groupFeatures');
const { normalizeWhatsAppNumber } = require('../lib/phone');
const { saveIdentity } = require('../lib/identity');
const { tagAllCommand, contactTagCommand, tagAdminsCommand } = require('./groupTags');
const studentTools = require('./studentTools');
const { whoisCommand, pingHostCommand, dnsCommand, scholarCommand, mathCommand, pdfCommand } = require('./academicTools');
const { designCommand } = require('./design');

const DATA_DIR = path.join(process.cwd(), 'data');
const NOTES_FILE = path.join(DATA_DIR, 'menuNotes.json');
const MAIL_API = 'https://api.mail.tm';

function readNotes() {
    try { return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8')); } catch (_) { return {}; }
}

function saveNotes(notes) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

async function publicSearch(query) {
    const response = await axios.get('https://html.duckduckgo.com/html/', {
        params: { q: query }, timeout: 15000, headers: { 'User-Agent': 'LEE-TECH-BOT/1.0' }
    });
    const $ = cheerio.load(response.data);
    return $('.result').slice(0, 5).map((_, item) => ({
        title: $(item).find('.result__title').text().trim(),
        url: $(item).find('.result__a').attr('href'),
        snippet: $(item).find('.result__snippet').text().trim()
    })).get().filter((item) => item.title && item.url);
}

async function mailTmRequest(method, url, data, token) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return axios({ method, url: `${MAIL_API}${url}`, data, headers, timeout: 15000 });
}

function cryptoRandom() {
    return crypto.randomBytes(6).toString('hex');
}

const ANIME_ALIASES = {
    animeavatar: 'nom', animeblush: 'blush', animewave: 'wave', animesmile: 'smile',
    animepoke: 'poke', animewink: 'wink', animebonk: 'bonk', animebully: 'bully',
    neko: 'neko', waifu: 'waifu', loli: 'loli'
};

const DOWNLOAD_ALIASES = new Set([
    'ytmp3', 'ytmp4', 'mediafire', 'wallpaper', 'hdwallpaper', 'pinterest', 'img', 'aio',
    'fdroid', 'imgsearch', 'twitter', 'apk', 'spotifysearch', 'splay', 'knackvideo'
]);

const LEGACY_COMMANDS = new Set([
    'addpdf', 'brat', 'carbon', 'catbox', 'clearpdf', 'ephoto', 'ephotolist', 'fakechannel', 'fakedana', 'fakeigstory', 'firelogo', 'fliptext', 'img2pdf', 'img2txt', 'imgbb', 'ocr', 'pickupline', 'predict', 'qrscan', 'roast', 'stickkill', 'story', 'tiktokstalk', 'tiny', 'toanime', 'toaudio', 'togif', 'tomp3', 'toqr', 'tovideo', 'tovideonote', 'tovn'
]);

const GROUP_COMMANDS = new Set([
    'addall', 'promoteall', 'demoteall', 'left', 'totag', 'gc', 'unwarn', 'all', 'antistatus',
    'approve', 'reject', 'group', 'gcalert', 'addmetaai', 'removemetaai', 'opentime', 'closetime',
    'setdesc', 'setgrouppicture', 'editinfo', 'invite', 'revoke', 'savecontact', 'sendcontact',
    'contacttag', 'tagadmin', 'getgrouppp', 'group-id', 'poll'
]);

const OWNER_COMMANDS = new Set([
    'addowner', 'delowner', 'listowner', 'block', 'unblock', 'blocklist', 'joingc', 'join', 'restart',
    'mode', 'edit', 'clearall', 'autorecording', 'autorecordtype', 'autoviewstatus', 'autoreact',
    'autolikestatus', 'getsession', 'setfullpp', 'reveal', 'listgroup', 'listonline', 'setpaypoint', 'setpayment', 'paylink',
    'reportcommand', 'panel', 'eval', 'gsettings', 'groupsettings', 'setname', 'setownernumber'
]);

function textOf(message) {
    return message?.conversation || message?.extendedTextMessage?.text || message?.imageMessage?.caption || message?.videoMessage?.caption || message?.message?.conversation || message?.message?.extendedTextMessage?.text || message?.message?.imageMessage?.caption || message?.message?.videoMessage?.caption || '';
}

function quoted(message) {
    return message?.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
}

async function reply(sock, chatId, message, text) {
    return sock.sendMessage(chatId, { text }, { quoted: message });
}

async function profilePicture(sock, chatId, message, targetJid) {
    try {
        const url = await sock.profilePictureUrl(targetJid, 'image');
        return sock.sendMessage(chatId, { image: { url }, caption: `Profile picture for ${targetJid}` }, { quoted: message });
    } catch (_) {
        return reply(sock, chatId, message, '❌ No profile picture is available for that account.');
    }
}

async function handleSimpleLocal(sock, chatId, message, command, args, context = {}) {
    if (command === 'test') return reply(sock, chatId, message, '✅ LEE TECH BOT command router is working.');
    if (command === 'speed' || command === 'ping') return speedCommand(sock, chatId, message);
    if (command === 'runtime') return uptimeCommand(sock, chatId, message);
    if (command === 'jid' || command === 'group-id' || command === 'channel-id') return idCommand(sock, chatId, message);
    if (command === 'botinfo' || command === 'script') return botInfoCommand(sock, chatId, message);
    if (command === 'health') return healthCommand(sock, chatId, message);
    if (command === 'quotes' || command === 'quote') return quoteCommand(sock, chatId, message);
    if (command === 'fact') return factCommand(sock, chatId, message);
    if (command === 'truth') return truthCommand(sock, chatId, message);
    if (command === '8ballpool') return eightBallCommand(sock, chatId, args.join(' ').trim());
    if (command === 'readmore') {
        const value = args.join(' ').trim();
        if (!value) return reply(sock, chatId, message, 'Usage: `.readmore visible text | hidden text`');
        const [visible, hidden = ''] = value.split('|');
        return reply(sock, chatId, message, `${visible.trim()}\n${'‎'.repeat(400)}${hidden.trim()}`);
    }
    if (command === 'copy') {
        const value = args.join(' ').trim() || textOf(quoted(message) || message);
        return value ? reply(sock, chatId, message, value) : reply(sock, chatId, message, 'Reply to a message or provide text to copy.');
    }
    if (command === 'getpp') return profilePicture(sock, chatId, message, message.key?.participant || message.key?.remoteJid);
    if (command === 'getgrouppp') {
        if (!chatId.endsWith('@g.us')) return reply(sock, chatId, message, '❌ Use this command in a group.');
        return profilePicture(sock, chatId, message, chatId);
    }
    if (command === 'poll') {
        const value = args.join(' ').trim();
        const [question, ...options] = value.split('|').map((item) => item.trim()).filter(Boolean);
        if (!question || options.length < 2) return reply(sock, chatId, message, 'Usage: `.poll question | option 1 | option 2`');
        return sock.sendMessage(chatId, { poll: { name: question, values: options.slice(0, 12), selectableCount: 1 } }, { quoted: message });
    }
    if (command === 'system') return reply(sock, chatId, message, `OS: ${os.platform()}\nNode: ${process.version}\nMemory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`);
    if (command === 'clearchat') { await clearCommand(sock, chatId); return true; }
    if (command === 'vvdm') { await vv2Command(sock, chatId, message, context.isOwnerOrSudoCheck); return true; }
    if (command === 'lid') return idCommand(sock, chatId, message);
    if (command === 'audiospeed') { await audioSpeedCommand(sock, chatId, message); return true; }
    return null;
}

function botJid(sock) {
    const id = sock.user?.id || '';
    const bare = id.split(':')[0];
    return bare.includes('@') ? bare : `${bare}@s.whatsapp.net`;
}

async function editRepliedMessage(sock, chatId, message, text) {
    const contextInfo = message?.message?.extendedTextMessage?.contextInfo;
    const stanzaId = contextInfo?.stanzaId;
    if (!stanzaId || !text) {
        await reply(sock, chatId, message, 'Usage: reply to one of the bot messages, then send `.edit <new text>`.');
        return;
    }
    const editKey = {
        remoteJid: chatId,
        id: stanzaId,
        fromMe: true,
        participant: contextInfo.participant || botJid(sock)
    };
    await sock.sendMessage(chatId, { text, edit: editKey }, { quoted: message });
}

async function updateAllGroupRoles(sock, chatId, message, action) {
    const metadata = await sock.groupMetadata(chatId);
    const bot = botJid(sock);
    const targets = (metadata.participants || [])
        .map((participant) => participant.id)
        .filter((jid) => jid && jid !== bot && !jid.startsWith('status@'));
    if (!targets.length) {
        await reply(sock, chatId, message, `ℹ️ No members available to ${action}.`);
        return;
    }
    const changed = [];
    const failed = [];
    for (const jid of targets) {
        try {
            await sock.groupParticipantsUpdate(chatId, [jid], action);
            changed.push(jid);
        } catch (_) {
            failed.push(jid);
        }
    }
    await reply(sock, chatId, message, `✅ ${action === 'promote' ? 'Promoted' : 'Demoted'} ${changed.length} member(s)${failed.length ? `\n⚠️ Could not update ${failed.length} member(s) (owner/protected/admin restriction).` : ''}.`);
}

async function menuCompatCommand(sock, chatId, message, input, context = {}) {
    const parts = String(input || '').trim().split(/\s+/).filter(Boolean);
    const command = (parts.shift() || '').replace(/^[./]/, '').toLowerCase();
    const args = parts;
    if (!command) return false;

    if (['create', 'logo', 'design', 'imagine'].includes(command)) {
        const promptArgs = command === 'logo' ? ['logo', ...args] : args;
        await designCommand(sock, chatId, message, promptArgs);
        return true;
    }

    if (command === 'whois') { await whoisCommand(sock, chatId, message, args); return true; }
    if (command === 'pinghost') { await pingHostCommand(sock, chatId, message, args); return true; }
    if (command === 'dns') { await dnsCommand(sock, chatId, message, args); return true; }
    if (command === 'scholar') { await scholarCommand(sock, chatId, message, args); return true; }
    if (command === 'math') { await mathCommand(sock, chatId, message, args); return true; }
    if (command === 'pdf') { await pdfCommand(sock, chatId, message, args); return true; }

    if (command === 'broadcast') { await studentTools.broadcastCommand(sock, chatId, message, args, context); return true; }
    if (command === 'schedule') { await studentTools.scheduleCommand(sock, chatId, message, args, context); return true; }
    if (command === 'feedback') { await studentTools.feedbackCommand(sock, chatId, message, args, context); return true; }
    if (command === 'status') { await studentTools.statusCommand(sock, chatId, message); return true; }
    if (command === 'deploy') { await studentTools.deployCommand(sock, chatId, message, args, context); return true; }
    if (command === 'logs') { await studentTools.logsCommand(sock, chatId, message, args, context); return true; }
    if (command === 'todo') { await studentTools.todoCommand(sock, chatId, message, args, context); return true; }
    if (command === 'remind') { await studentTools.remindCommand(sock, chatId, message, args, context); return true; }
    if (['iamadmin', 'iamadmins', 'groupadmins'].includes(command)) { await studentTools.iamAdminCommand(sock, chatId, message, context); return true; }
    if (command === 'summary') { await studentTools.summaryCommand(sock, chatId, message, args); return true; }

    if (OWNER_COMMANDS.has(command) && !context.isOwnerOrSudoCheck) {
        await reply(sock, chatId, message, '❌ This command is restricted to the bot owner or sudo.');
        return true;
    }
    if (GROUP_COMMANDS.has(command) && !context.isGroup) {
        await reply(sock, chatId, message, '❌ This command can only be used in a group.');
        return true;
    }
    if (GROUP_COMMANDS.has(command) && !context.isSenderAdmin && !context.isOwnerOrSudoCheck) {
        await reply(sock, chatId, message, '❌ Only group admins can use this command.');
        return true;
    }

    const local = await handleSimpleLocal(sock, chatId, message, command, args, context);
    if (local) return true;

    if (command === 'autoviewstatus') {
        await autoStatusCommand(sock, chatId, message, args);
        return true;
    }
    if (command === 'edit') {
        await editRepliedMessage(sock, chatId, message, args.join(' ').trim());
        return true;
    }
    if (command === 'listonline') {
        await onlineMembers(sock, chatId, Boolean(context.isGroup));
        return true;
    }
    if (command === 'listgroup') {
        try {
            const groups = await fetchParticipatingGroups(sock);
            if (!groups.length) {
                await reply(sock, chatId, message, 'ℹ️ The bot is not currently participating in any groups.');
                return true;
            }
            const lines = await Promise.all(groups.map(async (group) => {
                const antiLink = await getAntilink(group.jid, 'on');
                const status = antiLink?.enabled ? 'ON' : 'OFF';
                const mode = antiLink?.mode || 'all';
                const action = antiLink?.action || 'delete';
                const threshold = antiLink?.threshold || Number(process.env.WARN_COUNT || 3);
                return `${group.index}. *${group.subject}*\n   Group number: ${group.number}\n   Members: ${group.participants.length}\n   Anti-link: ${status} | Mode: ${mode} | Action: ${action} | Threshold: ${threshold}\n   DM command: .antilink ${group.index} get`;
            }));
            await reply(sock, chatId, message, `📋 *GROUPS (${groups.length})*\n\n${lines.join('\n\n')}\n\nUse .antilink <list number> get to view anti-link settings, or .antilink <list number> on all silent to enable it from DM.\nUse .settings <list number|full group number> to view other settings, or .gsettings <list number|full group number> <feature> <on|off> to change them.`);
        } catch (error) {
            console.error('[listgroup]', error.message || error);
            await reply(sock, chatId, message, '❌ Could not fetch the bot group list.');
        }
        return true;
    }
    if (command === 'setname') {
        const name = args.join(' ').trim();
        if (!name) return reply(sock, chatId, message, 'Usage: .setname Your display name');
        saveIdentity({ userName: name });
        return reply(sock, chatId, message, `✅ Menu display name saved as *${name}*.`);
    }
    if (command === 'setownernumber') {
        const number = normalizeWhatsAppNumber(args.join(' '));
        if (!number) return reply(sock, chatId, message, 'Usage: .setownernumber 254712345678\nUse the full international number without a local leading 0.');
        saveIdentity({ ownerNumber: number });
        return reply(sock, chatId, message, `✅ Menu owner number saved as *${number}*.`);
    }
    if (command === 'reportcommand') {
        const reportText = args.join(' ').trim() || textOf(quoted(message)).trim();
        if (!reportText) return reply(sock, chatId, message, 'Usage: `.reportcommand <command or issue description>`');
        const developerNumber = normalizeWhatsAppNumber(superOwnerNumber || '');
        if (!developerNumber) return reply(sock, chatId, message, '❌ No developer number is configured for reports.');
        const sender = context.senderId || message.key?.participant || message.key?.remoteJid || 'unknown';
        try {
            await sock.sendMessage(`${developerNumber}@s.whatsapp.net`, {
                text: `🛠️ *Command report*\nFrom: ${sender}\nChat: ${chatId}\n\n${reportText}`
            });
            return reply(sock, chatId, message, '✅ Report sent to the developer.');
        } catch (error) {
            console.error('[reportcommand]', error.message || error);
            return reply(sock, chatId, message, '❌ Could not deliver the report to the developer.');
        }
    }
    if (command === 'gsettings' || command === 'groupsettings') {
        await groupSettingsCommand(sock, chatId, message, args);
        return true;
    }
    if (command === 'setfullpp') {
        await setProfilePicture(sock, chatId, message);
        return true;
    }
    if (command === 'setpaypoint' || command === 'setpayment' || command === 'paylink') {
        await setPaymentCommand(sock, chatId, message, args, context.isOwnerOrSudoCheck);
        return true;
    }
    if (command === 'donate') {
        await paymentCommand(sock, chatId, message);
        return true;
    }
    if (command === 'toimage') {
        const quotedMessage = quoted(message);
        if (!quotedMessage?.stickerMessage) {
            await reply(sock, chatId, message, 'Please reply to a sticker with `.toimage` to convert it to an image.');
            return true;
        }
        await simageCommand(sock, quotedMessage, chatId);
        return true;
    }
    if (command === 'reveal') {
        await vv2Command(sock, chatId, message, context.isOwnerOrSudoCheck);
        return true;
    }
    if (command === 'promoteall' || command === 'demoteall') {
        await updateAllGroupRoles(sock, chatId, message, command === 'promoteall' ? 'promote' : 'demote');
        return true;
    }
    if (command === 'joingc' || command === 'join') {
        const repliedText = textOf(quoted(message));
        const value = [args.join(' ').trim(), repliedText.trim()].filter(Boolean).join(' ').trim();
        const match = value.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
        const inviteCode = match?.[1] || value.replace(/[^A-Za-z0-9_-]/g, '');
        if (!inviteCode) {
            await reply(sock, chatId, message, `Usage: .${command} <WhatsApp group invite link or code>`);
            return true;
        }
        try {
            const groupId = await sock.groupAcceptInvite(inviteCode);
            await reply(sock, chatId, message, `✅ Successfully joined the group.\nGroup ID: ${groupId || 'accepted'}`);
        } catch (error) {
            console.error(`[${command}]`, error.message || error);
            await reply(sock, chatId, message, '❌ Could not join the group. The invite may be expired, revoked, or invalid.');
        }
        return true;
    }
    if (command === 'invite') {
        await linkCommand(sock, chatId, message, Boolean(context.isGroup), Boolean(context.isBotAdmin));
        return true;
    }
    if (command === 'all') {
        await tagAllCommand(sock, chatId, context.senderId || message.key?.participant || message.key?.remoteJid, message);
        return true;
    }
    if (command === 'contacttag') {
        await contactTagCommand(sock, chatId, context.senderId || message.key?.participant || message.key?.remoteJid, message);
        return true;
    }
    if (command === 'tagadmin') {
        await tagAdminsCommand(sock, chatId, context.senderId || message.key?.participant || message.key?.remoteJid, message);
        return true;
    }
    if (command === 'totag') {
        await tagAllCommand(sock, chatId, context.senderId || message.key?.participant || message.key?.remoteJid, message);
        return true;
    }
    if (command === 'gc' || command === 'group') {
        await groupInfoCommand(sock, chatId, message);
        return true;
    }
    if (command === 'left') {
        await leaveCommand(sock, chatId, message, Boolean(context.isGroup), Boolean(context.isOwnerOrSudoCheck));
        return true;
    }
    if (command === 'sendcontact') {
        await contactTagCommand(sock, chatId, context.senderId || message.key?.participant || message.key?.remoteJid, message);
        return true;
    }
    if (command === 'addall') {
        await addAllCommand(sock, chatId, message, args, context);
        return true;
    }
    if (command === 'unwarn') {
        await unwarnCommand(sock, chatId, message, args, context);
        return true;
    }
    if (command === 'antistatus') {
        await antiStatusCommand(sock, chatId, message, args, context);
        return true;
    }
    if (command === 'gcalert') {
        await groupAlertCommand(sock, chatId, message, args, context);
        return true;
    }
    if (command === 'addmetaai') {
        await addMetaAiCommand(sock, chatId, message, context);
        return true;
    }
    if (command === 'removemetaai') {
        await removeMetaAiCommand(sock, chatId, message, context);
        return true;
    }
    if (command === 'opentime') {
        await openTimeCommand(sock, chatId, message, args, context);
        return true;
    }
    if (command === 'closetime') {
        await closeTimeCommand(sock, chatId, message, args, context);
        return true;
    }
    if (command === 'savecontact' || command === 'savecontacts' || command === 'extract') {
        await groupVcfCommand(sock, chatId, message, Boolean(context.isGroup), Boolean(context.isSenderAdmin), Boolean(context.isOwnerOrSudoCheck));
        return true;
    }
    if (command === 'autoreact' || command === 'autolikestatus') {
        await autoStatusCommand(sock, chatId, message, ['react', args[0] || 'status']);
        return true;
    }
    if (ANIME_ALIASES[command]) {
        await animeCommand(sock, chatId, message, [ANIME_ALIASES[command], ...args]);
        return true;
    }
    if (command === 'groq' || command === 'grok') {
        await groqCommand(sock, chatId, message, args);
        return true;
    }
    if (LEGACY_COMMANDS.has(command)) {
        await legacyCommand(sock, chatId, message, command, args);
        return true;
    }
    if (['ai', 'aivoice', 'chatgpt', 'analyze', 'search', 'gemini', 'elevenlab'].includes(command)) {
        await aiCommand(sock, chatId, message, args);
        return true;
    }
    if (DOWNLOAD_ALIASES.has(command)) {
        await downloadCommand(sock, chatId, { ...message, message: { conversation: `.${command} ${args.join(' ')}` } });
        return true;
    }
    if (command === 'telegramsticker') {
        await stickerTelegramCommand(sock, chatId, message);
        return true;
    }
    if (command === 'toviewonce' || command === 'statusd') {
        await toStatusCommand(sock, chatId, message, context.isOwnerOrSudoCheck);
        return true;
    }
    if (command === 'group') {
        await groupInfoCommand(sock, chatId, message);
        return true;
    }
    if (command === 'setdesc') {
        await setGroupDescription(sock, chatId, context.senderId || message.key?.participant || message.key?.remoteJid, args.join(' '), message);
        return true;
    }
    if (command === 'setgrouppicture') {
        await setGroupPhoto(sock, chatId, context.senderId || message.key?.participant || message.key?.remoteJid, message);
        return true;
    }
    if (command === 'editinfo') {
        await setGroupName(sock, chatId, context.senderId || message.key?.participant || message.key?.remoteJid, args.join(' '), message);
        return true;
    }
    if (command === 'lyrics') {
        await lyricsCommand(sock, chatId, args.join(' '), message);
        return true;
    }
    if (command === 'yts') {
        const query = args.join(' ').trim();
        if (!query) { await reply(sock, chatId, message, 'Usage: `.yts <song or video>`'); return true; }
        try {
            const results = await yts(query);
            const top = (results.videos || []).slice(0, 5);
            await reply(sock, chatId, message, top.length ? top.map((v, i) => `${i + 1}. ${v.title}\n${v.url}\n${v.timestamp || ''}`).join('\n\n') : '❌ No YouTube results found.');
        } catch (_) { await reply(sock, chatId, message, '❌ YouTube search failed.'); }
        return true;
    }
    if (command === 'define') {
        const word = args.join(' ').trim();
        if (!word) { await reply(sock, chatId, message, 'Usage: `.define <word>`'); return true; }
        try {
            const { data } = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, { timeout: 12000 });
            const entry = data[0];
            const meaning = entry.meanings?.[0];
            const definition = meaning?.definitions?.[0];
            await reply(sock, chatId, message, `📖 *${entry.word}*\n${meaning?.partOfSpeech || ''}\n${definition?.definition || 'No definition found.'}${definition?.example ? `\n\nExample: ${definition.example}` : ''}`);
        } catch (_) { await reply(sock, chatId, message, '❌ Word definition not found.'); }
        return true;
    }
    if (command === 'country') {
        const country = args.join(' ').trim();
        if (!country) { await reply(sock, chatId, message, 'Usage: `.country <country>`'); return true; }
        try {
            const { data } = await axios.get(`https://restcountries.com/v3.1/name/${encodeURIComponent(country)}`, { timeout: 12000 });
            const c = data[0];
            await reply(sock, chatId, message, `🌍 *${c.name?.common}*\nCapital: ${c.capital?.[0] || 'Unknown'}\nRegion: ${c.region || 'Unknown'}\nPopulation: ${(c.population || 0).toLocaleString()}\nCurrency: ${Object.values(c.currencies || {})[0]?.name || 'Unknown'}`);
        } catch (_) { await reply(sock, chatId, message, '❌ Country not found.'); }
        return true;
    }
    if (command === 'google' || command === 'search') {
        const query = args.join(' ').trim();
        if (!query) { await reply(sock, chatId, message, `Usage: .${command} <search terms>`); return true; }
        try {
            const results = await publicSearch(query);
            await reply(sock, chatId, message, results.length ? results.map((r, i) => `${i + 1}. *${r.title}*\n${r.url}\n${r.snippet}`).join('\n\n') : '❌ No public search results found.');
        } catch (_) { await reply(sock, chatId, message, '❌ Public search is temporarily unavailable.'); }
        return true;
    }
    if (command === 'note' || command === 'listnote' || command === 'deletenote') {
        const notes = readNotes();
        const ownerKey = context.senderId || message.key?.participant || message.key?.remoteJid || chatId;
        notes[ownerKey] ||= [];
        if (command === 'note') {
            const value = args.join(' ').trim();
            if (!value) { await reply(sock, chatId, message, 'Usage: `.note <text>`'); return true; }
            notes[ownerKey].push({ text: value, createdAt: new Date().toISOString() });
            saveNotes(notes);
            await reply(sock, chatId, message, `✅ Note saved (#${notes[ownerKey].length}).`);
        } else if (command === 'listnote') {
            await reply(sock, chatId, message, notes[ownerKey].length ? notes[ownerKey].map((n, i) => `${i + 1}. ${n.text}`).join('\n') : '📝 No saved notes.');
        } else {
            const index = Number(args[0]) - 1;
            if (!Number.isInteger(index) || !notes[ownerKey][index]) { await reply(sock, chatId, message, 'Usage: `.deletenote <note number>`'); return true; }
            notes[ownerKey].splice(index, 1); saveNotes(notes); await reply(sock, chatId, message, '✅ Note deleted.');
        }
        return true;
    }
    if (command === 'rate') {
        const value = args.join(' ').trim() || 'this';
        await reply(sock, chatId, message, `⭐ I rate *${value}* ${Math.floor(Math.random() * 101)}/100.`);
        return true;
    }
    if (command === 'tempmail' || command === 'tempinbox') {
        const sessions = global.tempMailSessions ||= {};
        const ownerKey = context.senderId || message.key?.participant || message.key?.remoteJid || chatId;
        try {
            if (command === 'tempmail' || !sessions[ownerKey]) {
                const domains = (await mailTmRequest('get', '/domains?page=1')).data['hydra:member'] || [];
                const domain = domains[0]?.domain;
                if (!domain) throw new Error('No mail domain');
                const address = `${cryptoRandom()}@${domain}`;
                const password = `${cryptoRandom()}Lee!9`;
                await mailTmRequest('post', '/accounts', { address, password });
                const token = (await mailTmRequest('post', '/token', { address, password })).data.token;
                sessions[ownerKey] = { address, token };
                await reply(sock, chatId, message, `📧 Temporary email created:\n*${address}*\n\nUse .tempinbox to check messages.`);
                if (command === 'tempmail') return true;
            }
            const inbox = await mailTmRequest('get', '/messages', undefined, sessions[ownerKey].token);
            const messages = inbox.data['hydra:member'] || [];
            await reply(sock, chatId, message, messages.length ? messages.slice(0, 5).map((m, i) => `${i + 1}. *${m.subject || '(no subject)'}*\nFrom: ${m.from?.address || 'unknown'}\nID: ${m.id}`).join('\n\n') : `📭 Inbox empty for ${sessions[ownerKey].address}.`);
        } catch (_) { await reply(sock, chatId, message, '❌ Temporary mail service unavailable.'); }
        return true;
    }
    if (command === 'bible') {
        const reference = args.join(' ').trim() || 'John 3:16';
        try {
            const { data } = await axios.get(`https://bible-api.com/${encodeURIComponent(reference)}`, { timeout: 12000 });
            await reply(sock, chatId, message, `📖 *${data.reference || reference}*\n\n${data.text || 'No verse found.'}`);
        } catch (_) { await reply(sock, chatId, message, '❌ Bible reference not found. Try `.bible John 3:16`.'); }
        return true;
    }
    if (command === 'quran') {
        const reference = args[0] || '1:1';
        try {
            const { data } = await axios.get(`https://api.alquran.cloud/v1/ayah/${encodeURIComponent(reference)}/en.asad`, { timeout: 12000 });
            const ayah = data.data;
            await reply(sock, chatId, message, `☪️ *${ayah?.surah?.englishName || 'Quran'} ${ayah?.numberInSurah || reference}*\n\n${ayah?.text || 'No ayah found.'}`);
        } catch (_) { await reply(sock, chatId, message, '❌ Quran reference not found. Try `.quran 1:1`.'); }
        return true;
    }
    if (command === 'gitclone') {
        const input = args.join(' ').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
        const match = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
        if (!match) {
            await reply(sock, chatId, message, 'Usage: `.gitclone <github.com/owner/repository>`');
            return true;
        }
        const [, owner, repo] = match;
        try {
            const api = await axios.get(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
                timeout: 15000,
                headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LEE-TECH-BOT' }
            });
            const data = api.data;
            const archive = await axios.get(data.zipball_url, {
                responseType: 'arraybuffer', timeout: 30000, maxContentLength: 25 * 1024 * 1024
            });
            await sock.sendMessage(chatId, {
                document: Buffer.from(archive.data),
                mimetype: 'application/zip',
                fileName: `${data.name || repo}.zip`,
                caption: `📦 *${data.full_name}*\n${data.description || 'GitHub repository archive'}\n⭐ ${data.stargazers_count || 0} stars  |  Branch: ${data.default_branch || 'main'}`
            }, { quoted: message });
        } catch (error) {
            console.error('[gitclone]', error.message || error);
            await reply(sock, chatId, message, '❌ Repository not found, unavailable, or larger than the 25 MB download limit.');
        }
        return true;
    }
    if (command === 'npm') {
        const packageName = args[0];
        if (!packageName) { await reply(sock, chatId, message, 'Usage: `.npm <package-name>`'); return true; }
        try {
            const { data } = await axios.get(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`, { timeout: 10000 });
            await reply(sock, chatId, message, `📦 ${data.name}@${data['dist-tags']?.latest || 'unknown'}\n${data.description || 'No description'}\n${data.homepage || `https://www.npmjs.com/package/${data.name}`}`);
        } catch (_) { await reply(sock, chatId, message, '❌ NPM package not found or registry unavailable.'); }
        return true;
    }
    if (['shazam', 'vocalremover', 'colorize', 'deepfake'].includes(command)) {
        await reply(sock, chatId, message, `⚠️ .${command} is recognized, but requires a configured provider/API in this deployment. Add the provider credentials, then retry.`);
        return true;
    }
    if (command === 'nsfw') {
        await reply(sock, chatId, message, '❌ NSFW features are disabled by default for group safety.');
        return true;
    }
    if (allCommands().includes(command)) {
        await reply(sock, chatId, message, `⚠️ *.${command}* is recognized, but its handler is not available in this deployment. Use *.menu* to view the currently supported commands.`);
        return true;
    }
    return false;
}

module.exports = { menuCompatCommand, ANIME_ALIASES, DOWNLOAD_ALIASES };
