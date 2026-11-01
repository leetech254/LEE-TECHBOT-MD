'use strict';

const fs = require('fs');
const path = require('path');
const settings = require('../settings');
const { MENU_CATEGORIES, getCategory, allCommands } = require('../lib/menuCatalog');
const { loadBotMode } = require('../lib/mode');
const { loadIdentity } = require('../lib/identity');
const { normalizeWhatsAppNumber } = require('../lib/phone');

const menuImagePath = path.join(process.cwd(), 'menu.jpg');
const menuSettingsPath = path.join(process.cwd(), 'data', 'menuSettings.json');

const FONT_MAPS = {
    clean: null,
    bold: { upper: 0x1d400, lower: 0x1d41a },
    double: { upper: 0x1d538, lower: 0x1d552 },
    mono: { upper: 0x1d670, lower: 0x1d68a }
};

const STYLE_MAP = {
    premium: { open: '╭─〔', close: '〕', bullet: '│', footer: '╰────────────────────' },
    neon: { open: '┏━【', close: '】', bullet: '┃', footer: '┗━━━━━━━━━━━━━━━━━━━━' },
    cyberpunk: { open: '⟦⟦', close: '⟧⟧', bullet: '▰', footer: '╞════════════════════╡' },
    minimal: { open: '┌─', close: '─┐', bullet: '│', footer: '└────────────────┘' },
    terminal: { open: '[', close: ']', bullet: '>', footer: '====================' },
    royal: { open: '╔══〔', close: '〕', bullet: '║', footer: '╚════════════════════' }
};

function menuConfig() {
    try {
        const value = JSON.parse(fs.readFileSync(menuSettingsPath, 'utf8'));
        return { enabled: value.enabled === true, style: value.style || 'premium', font: value.font || 'clean' };
    } catch (_) {
        return { enabled: false, style: 'premium', font: 'clean' };
    }
}

function stylizeHeading(value, font) {
    const map = FONT_MAPS[font];
    if (!map) return value;
    return String(value).replace(/[A-Za-z]/g, (char) => {
        const code = char.charCodeAt(0);
        const lower = code >= 97;
        const base = lower ? map.lower : map.upper;
        return String.fromCodePoint(base + (code - (lower ? 97 : 65)));
    });
}

function menuImageEnabled() {
    try {
        const state = JSON.parse(fs.readFileSync(menuSettingsPath, 'utf8'));
        return state.enabled === true && fs.existsSync(menuImagePath);
    } catch (_) {
        return false;
    }
}

function menuImage() {
    if (!menuImageEnabled()) return null;
    try { return fs.readFileSync(menuImagePath); } catch (_) { return null; }
}

function prefix() {
    return global.prefix === 'none' ? '.' : (global.prefix || '.');
}

function formatUptime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return [days ? `${days}d` : '', hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${secs}s`]
        .filter(Boolean).join(' ');
}

function platformName() {
    const explicit = process.env.PLATFORM_NAME || process.env.HOSTING_PLATFORM || process.env.DEPLOYMENT_PROVIDER;
    if (explicit) return String(explicit).trim();
    if (process.env.LEETEC_HOSTING || process.env.LEE_TECH_HOSTING || process.env.LEETEC_APP_ID || process.env.LEETEC_DEPLOYMENT) return 'Lee Tech Hosting';
    if (process.env.DYNO || process.env.HEROKU_APP_NAME) return 'Heroku';
    if (process.env.RENDER) return 'Render';
    if (process.env.RAILWAY_ENVIRONMENT) return 'Railway';
    if (process.env.KOYEB_APP_ID) return 'Koyeb';
    if (process.env.VERCEL || process.env.VERCEL_ENV) return 'Vercel';
    if (process.env.PTERODACTYL_SERVER_UUID || process.env.P_SERVER_UUID || process.env.PANEL || process.env.KATARO_HOST) return 'Panel';
    if (process.env.SERVER_PORT && (process.env.HOME || '').includes('/home/container')) return 'Panel';
    return process.env.PLATFORM_NAME || 'Node.js host';
}

function readState(fileName, fallback = {}) {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', fileName), 'utf8'));
    } catch (_) {
        return fallback;
    }
}

function enabled(value) {
    return value === true || value === 'on' || value?.enabled === true;
}

function liveMenuState(context = {}) {
    const chatId = context.chatId || '';
    const message = context.message || {};
    const sender = message.key?.participant || message.key?.remoteJid || 'user';
    const senderNumber = sender.includes('@') ? sender.split('@')[0].split(':')[0] : sender;
    const menuSettings = readState('menuSettings.json', {});
    const identity = loadIdentity();
    const linkedName = context.userName || message.pushName || message.key?.pushName;
    const configuredName = identity.userName || process.env.MENU_USER_NAME || process.env.USER_DISPLAY_NAME || menuSettings.userName;
    const user = configuredName || linkedName || senderNumber;
    const configuredNumber = normalizeWhatsAppNumber(identity.ownerNumber || process.env.OWNER_NUMBER || process.env.PHONE_NUMBER || process.env.PAIRING_NUMBER || '');
    const mode = loadBotMode();
    const autoStatus = readState('autoStatus.json', { enabled: false });
    const autoread = readState('autoread.json', { enabled: false });
    const autotyping = readState('autotyping.json', { enabled: false });
    const pmblocker = readState('pmblocker.json', { enabled: false });
    const anticall = readState('anticall.json', { enabled: false });
    const userGroupData = readState('userGroupData.json', {});
    const group = chatId.endsWith('@g.us');
    const groupState = (name) => Boolean(userGroupData[name]?.[chatId]);
    const health = global.botHealth?.snapshot?.() || {};
    const durableStatus = global.durableAuthStore?.status?.();
    const durableEnabled = durableStatus ? Boolean(durableStatus.enabled) : (String(process.env.AUTH_STORE || '').toLowerCase() === 's3' || process.env.BUCKETEER_BUCKET_NAME);
    const sessionLabel = durableEnabled
        ? (durableStatus?.retrying ? 'Durable backup retrying' : durableStatus?.lastSyncAt ? 'Durable backup saved' : 'Durable backup enabled')
        : 'Local storage only';
    return {
        user,
        userNumber: configuredNumber || (senderNumber.length < 15 ? senderNumber : ''),
        mode: (() => { const value = String(mode.mode || (mode.isPublic === false ? 'private' : 'public')); return value.charAt(0).toUpperCase() + value.slice(1); })(),
        speed: Number(health.lastLatencyMs || global.lastCommandLatencyMs || 0).toFixed(4),
        uptime: formatUptime(process.uptime()),
        platform: platformName(),
        memory: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`,
        session: sessionLabel,
        group,
        features: {
            autoread: enabled(autoread),
            autotyping: enabled(autotyping),
            autostatus: enabled(autoStatus),
            pmblocker: enabled(pmblocker),
            anticall: enabled(anticall),
            autoreaction: enabled(userGroupData.autoReaction),
            chatbot: group && groupState('chatbot'),
            antilink: group && groupState('antilink'),
            welcome: group && groupState('welcome'),
            antistatus: group && enabled(global.antistatusState?.[chatId]),
            autodl: enabled(global.autodlState),
            antispam: enabled(global.antispamState),
            antisticker: group && enabled(global.antistickerState?.[chatId]),
            antiphoto: group && enabled(global.antiphotoState?.[chatId]),
            antiviewonce: group && enabled(global.antiviewonceState?.[chatId]),
            antifake: group && enabled(global.antifakeState?.[chatId]),
            antibot: group && enabled(global.antibotState?.[chatId]?.status),
            maintenance: enabled(global.ownerControls?.maintenance),
            hidechannel: enabled(global.ownerControls?.hideChannel)
        }
    };
}

function section(title, lines) {
    const config = menuConfig();
    const style = STYLE_MAP[config.style] || STYLE_MAP.premium;
    return [
        `${style.open} *${stylizeHeading(title, config.font)}* ${style.close}`,
        ...lines.map((line) => `${style.bullet} ${line}`),
        style.footer
    ].join('\n');
}

function commandLine(commands, p) {
    return commands.map((command) => `*${p}${command}*`).join('  •  ');
}

function displayCommand(command) {
    return String(command).replace(/(^|[-_])(\w)/g, (_, separator, character) => `${separator}${character.toUpperCase()}`);
}

const COMMAND_NUMBERS = new Map(allCommands().map((command, index) => [command, index + 1]));

function numberedCommand(command) {
    return `${String(COMMAND_NUMBERS.get(command) || 0).padStart(3, '0')}. ${displayCommand(command)}`;
}

function buildCatalogMenu(context = {}) {
    const p = prefix();
    const name = settings.botName || 'LEE TECH BOT';
    const version = settings.version || '3.0.7';
    const live = liveMenuState(context);
    const config = menuConfig();
    const style = STYLE_MAP[config.style] || STYLE_MAP.premium;
    const privacy = live.mode;
    const owner = live.user || settings.botOwner || 'LEETECH';
    const lines = [
        `┏━━━✧ *CONNECTED* ✧━━━`,
        `┃✧ *BOT:* ${stylizeHeading(name, config.font)}`,
        `┃✧ *USER:* ${live.user}`,
        `┃✧ *PREFIX:* [ ${p} ]`,
        ...(live.userNumber ? [`┃✧ *NUMBER:* ${live.userNumber}`] : []),
        `┃✧ *OWNER:* ${live.userNumber || owner}`,
        `┃✧ *MODE:* ${privacy} 🌐`,
        `┃✧ *PLATFORM:* ☁️ ${live.platform}`,
        `┃✧ *STATUS:* 🟢 Online`,
        `┃✧ *SPEED:* ${live.speed}ms`,
        `┃✧ *UPTIME:* ${live.uptime}`,
        `┃✧ *VERSION:* v${version}`,
        `┃✧ *USAGE:* ${live.memory}`,
        `┃✧ *RAM:* ${live.memory}`,
        `┃✧ *SESSION:* 🔒 ${live.session}`,
        `┃✧ *COMMANDS:* ${allCommands().length}`,
        `┗━━━━━━━━━━━━━━━━━━`
    ];
    for (const category of MENU_CATEGORIES) {
        lines.push('', `${style.open} ${stylizeHeading(category.title, config.font)} ${style.close}`, `${style.bullet} Command list`, style.footer);
        for (const command of category.commands) {
            lines.push(`│𖥟╾ ${numberedCommand(command)}`);
        }
        lines.push('┗━━━━━━━━━━━━━━━❍');
    }
    lines.push('', `┏━━━━━━━━━━━━━━━❍`, `┃ *MENU CONTROLS*`, `┃ ${p}menustyle premium|neon|cyberpunk|minimal|terminal|royal`, `┃ ${p}menufont clean|bold|double|mono`, `┃ ${p}menumode image|text|status`, `┃ *POWERED BY LEE TECH*`, `┃ *OWNER: LEETECH*`, `┃ Use *${p}menu <category>* for a focused menu`, `┃ Use *${p}help <command>* for command guidance`, `┗━━━━━━━━━━━━━━━❍`);
    return lines.join('\n');
}

function buildFeatureStatus(context = {}) {
    const p = prefix();
    const live = liveMenuState(context);
    const state = value => value ? 'ON ✅' : 'OFF ⭕';
    const lines = [
        `┏━━━✧ *FEATURE SETTINGS* ✧━━━`,
        `┃ Scope: *${live.group ? 'GLOBAL + GROUP' : 'GLOBAL'}*`,
        `┃`,
        `┃ *GLOBAL FEATURES*`,
        `┃ *AUTOREAD:* ${state(live.features.autoread)}`,
        `┃ *AUTOTYPING:* ${state(live.features.autotyping)}`,
        `┃ *AUTOSTATUS:* ${state(live.features.autostatus)}`,
        `┃ *ANTICALL:* ${state(live.features.anticall)}`,
        `┃ *PMBLOCKER:* ${state(live.features.pmblocker)}`,
        `┃ *AUTODL:* ${state(live.features.autodl)}`,
        `┃ *ANTISPAM:* ${state(live.features.antispam)}`,
        `┃ *MAINTENANCE:* ${state(live.features.maintenance)}`
    ];
    if (live.group) {
        lines.push(
            `┃`,
            `┃ *GROUP FEATURES*`,
            `┃ *CHATBOT:* ${state(live.features.chatbot)}`,
            `┃ *ANTILINK:* ${state(live.features.antilink)}`,
            `┃ *WELCOME:* ${state(live.features.welcome)}`,
            `┃ *AUTOREACTION:* ${state(live.features.autoreaction)}`,
            `┃ *ANTISTICKER:* ${state(live.features.antisticker)}`,
            `┃ *ANTIPHOTO:* ${state(live.features.antiphoto)}`,
            `┃ *ANTIVIEWONCE:* ${state(live.features.antiviewonce)}`,
            `┃ *ANTIFAKE:* ${state(live.features.antifake)}`,
            `┃ *ANTIBOT:* ${state(live.features.antibot)}`,
            `┃ *HIDECHANNEL:* ${state(live.features.hidechannel)}`
        );
    } else {
        lines.push(`┃`, `┃ Group features: use *${p}features* inside a group to inspect them.`);
    }
    lines.push(`┗━━━━━━━━━━━━━━━━━━━━━━━━`, `Use *${p}menu* for runtime status and command categories.`);
    return lines.join('\n');
}

function buildCategoryMenu(categoryKey) {
    const category = getCategory(categoryKey);
    if (!category) return null;
    const p = prefix();
    return [
        `╭━━━〔 *${category.title}* 〕━━━╮`,
        `┃ Prefix: *${p}*`,
        `╰━━━━━━━━━━━━━━━━━━━━╯`,
        '',
        commandLine(category.commands, p),
        '',
        `Use *${p}menu* for all categories or *${p}help <command>* for guidance.`
    ].join('\n');
}

function buildMenu(context = {}) {
    return buildCatalogMenu(context);
}

function buildDeveloperMenu() {
    const p = prefix();
    const version = settings.version || '3.0.7';
    return [
        `╭━━━〔 *DEVELOPER TOOLKIT* 〕━━━╮`,
        `┃ LEE TECH BOT v${version}`,
        `╰━━━━━━━━━━━━━━━━━━━━━━╯`,
        '',
        section('MONITORING', [
            `*${p}health*  •  *${p}system*  •  *${p}stats*`,
            `*${p}ping*  •  *${p}speed*  •  *${p}uptime*  •  *${p}runtime*`,
            `*${p}botinfo*  •  *${p}jid*  •  *${p}ownerstatus*`
        ]),
        '',
        section('OPERATIONS', [
            `*${p}settings*  •  *${p}backup*  •  *${p}cleartmp*`,
            `*${p}clearsession*  •  *${p}update*`,
            `*${p}maintenance on/off*  •  *${p}mode public|private|group|dm*`,
            `*${p}alwaysonline*  •  *${p}pmblocker*  •  *${p}autobio*`
        ]),
        '',
        section('CONFIGURATION', [
            `*${p}setprefix <symbol|none>*`,
            `*${p}hidechannel on/off*`,
            `*${p}setmenuimage*  — replace and enable the menu image`,
            `*${p}menumode image|text|status*  — switch display mode`,
            `*${p}menustyle premium|neon|cyberpunk|minimal|terminal|royal*`,
            `*${p}menufont clean|bold|double|mono*`
        ]),
        '',
        `Owner authorization is required for sensitive operations.`,
        `Use *${p}help <command>* for a focused guide.`
    ].join('\n');
}

function messageText(message) {
    return message?.message?.conversation || message?.message?.extendedTextMessage?.text || '';
}

function developerButtons() {
    return [
        { buttonId: 'tools_health', buttonText: { displayText: 'Health' }, type: 1 },
        { buttonId: 'tools_settings', buttonText: { displayText: 'Settings' }, type: 1 },
        { buttonId: 'tools_update', buttonText: { displayText: 'Update' }, type: 1 }
    ];
}

function buildDetails(topic) {
    const p = prefix();
    const topics = {
        admin: `*ADMIN GUIDE*\n\n${p}adminstatus\n${p}groupstats\n${p}tagall\n${p}hidetag\n${p}kick @user\n${p}promote @user\n${p}demote @user\n${p}promotion on/off/status\n${p}antidemote on/off/status\n${p}mute @user\n${p}antiall on/off/status\n${p}open [minutes]\n${p}close [minutes]\n\nThe sender and bot must have the required group permissions.`,
        owner: `*OWNER GUIDE*\n\n${p}owner\n${p}mode public|private|group|dm\n${p}setname <display name>\n${p}setownernumber <full international number>\n${p}setpaypoint <payment details>\n${p}paylink link <https payment URL>\n${p}setprefix <symbol|none>\n${p}hidechannel on/off\n${p}maintenance on/off\n${p}backup\n${p}update\n${p}tostatus hello 👋\n${p}tostatus (reply to text, image, or video)\n${p}tostatus (send an image/video with a .tostatus caption)\n${p}togstatus (inside a group)\n${p}savestatus (reply to a Status)\n\nModes: public = everyone in all chats; private = owner/sudo/developer only in groups and DMs; group = everyone in groups only; dm = everyone in private chats only.\n\nOwner tools are protected by owner or sudo authorization.`,
        download: `*DOWNLOAD GUIDE*\n\n${p}download <public social link>\n${p}tiktok <url>\n${p}instagram <url>\n${p}facebook <url>\n${p}play <song>\n${p}song <song>\n${p}spotify <query>\n${p}ytmp4 <url|search>\n${p}url (reply to image/video)\n\nPrivate, expired, or region-blocked links may fail.`,
        ai: `*AI GUIDE*\n\n${p}gpt <question>\n${p}gemini <question>\n${p}groq <question>\n${p}grok <question>\n${p}chatbot on/off\n${p}imagine <prompt>\n${p}translate <text> <language>\n${p}tts <text>`,
        dev: buildDeveloperMenu(),
        developer: buildDeveloperMenu(),
        tools: buildDeveloperMenu()
    };
    return topics[topic] || `Use ${p}menu for the full command center. Guides: admin, owner, download, ai.`;
}

async function helpCommand(sock, chatId, message) {
    const words = messageText(message).trim().split(/\s+/);
    const first = words[0]?.toLowerCase();
    const requestedTopic = words[1]?.toLowerCase()
        || (['.devmenu', '.developermenu', '.devtools', '.tools'].includes(first) ? 'dev' : first === '.groupmenu' ? 'admin' : undefined);
    const categoryMenu = requestedTopic ? buildCategoryMenu(requestedTopic) : null;
    const helpMessage = categoryMenu || (requestedTopic ? buildDetails(requestedTopic) : buildMenu({ chatId, message }));
    const image = requestedTopic ? null : menuImage();

    try {
        if (['dev', 'developer', 'tools'].includes(requestedTopic)) {
            try {
                return await sock.sendMessage(chatId, {
                    text: helpMessage,
                    footer: 'LEE TECH Developer Toolkit',
                    buttons: developerButtons(),
                    headerType: 1
                }, { quoted: message });
            } catch (buttonError) {
                console.warn('[menu] Buttons unavailable; using text-only fallback:', buttonError.message || buttonError);
            }
        }
        if (image) return await sock.sendMessage(chatId, { image, caption: helpMessage }, { quoted: message });
        return await sock.sendMessage(chatId, { text: helpMessage }, { quoted: message });
    } catch (error) {
        console.error('[menu] send error:', error.message || error);
        return sock.sendMessage(chatId, { text: helpMessage }, { quoted: message });
    }
}

module.exports = helpCommand;
module.exports.buildMenu = buildMenu;
module.exports.buildFeatureStatus = buildFeatureStatus;
module.exports.buildDeveloperMenu = buildDeveloperMenu;
module.exports.developerButtons = developerButtons;
