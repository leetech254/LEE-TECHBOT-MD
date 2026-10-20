// 🧹 Fix for ENOSPC / temp overflow in hosted panels
const fs = require('fs');
const path = require('path');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys'); 
const { ensureRuntimeDirs, readJson, createMessageGuard, createHealthMetrics } = require('./lib/runtime');
const { antiBanCommand, isAntiBanEnabled } = require('./commands/antiban');
const { loadBotMode, saveBotMode } = require('./lib/mode');
const { canProcessMessage } = require('./lib/modeAccess');
const { hydrateRuntimeSettings } = require('./lib/runtimeSettings');

ensureRuntimeDirs();
hydrateRuntimeSettings();
const messageGuard = createMessageGuard({
    // WhatsApp can redeliver an older update after a delete, reconnect, or
    // temporary stream interruption. Keep message IDs protected long enough
    // that the command handler cannot send the same response again.
    dedupeTtlMs: Number(process.env.MESSAGE_DEDUPE_TTL_MS || 24 * 60 * 60 * 1000),
    maxCommands: Number(process.env.COMMAND_RATE_LIMIT || 8),
    windowMs: Number(process.env.COMMAND_RATE_WINDOW_MS || 10000)
});
const antiBanGuard = createMessageGuard({
    dedupeTtlMs: Number(process.env.ANTIBAN_DEDUPE_TTL_MS || 24 * 60 * 60 * 1000),
    maxCommands: Number(process.env.ANTIBAN_COMMAND_RATE_LIMIT || 3),
    windowMs: Number(process.env.ANTIBAN_COMMAND_RATE_WINDOW_MS || 15000)
});
const healthMetrics = createHealthMetrics();
global.botHealth = healthMetrics;

// ==========================================
// 1. INITIALIZE GLOBAL PREFIX PERMANENTLY
// ==========================================
let currentPrefix = process.env.PREFIX || '.'; // Fallback default
try {
    const prefixPath = path.join(__dirname, './data/prefix.json');
    if (fs.existsSync(prefixPath)) {
        const prefixData = JSON.parse(fs.readFileSync(prefixPath, 'utf8'));
        currentPrefix = Object.prototype.hasOwnProperty.call(prefixData, 'prefix')
            ? String(prefixData.prefix)
            : '.';
    }
} catch (e) {
    console.log("Error loading prefix, using default.");
}
global.prefix = currentPrefix; 

// ==========================================
// 2. TEMP FOLDER MANAGEMENT
// ==========================================
const customTemp = path.join(process.cwd(), 'temp');
if (!fs.existsSync(customTemp)) fs.mkdirSync(customTemp, { recursive: true });
process.env.TMPDIR = customTemp;
process.env.TEMP = customTemp;
process.env.TMP = customTemp;

const tempCleanupTimer = setInterval(() => {
    fs.readdir(customTemp, (err, files) => {
        if (err) return;
        for (const file of files) {
            const filePath = path.join(customTemp, file);
            fs.stat(filePath, (err, stats) => {
                if (!err && Date.now() - stats.mtimeMs > 3 * 60 * 60 * 1000) {
                    fs.unlink(filePath, () => {});
                }
            });
        }
    });
    console.log('🧹 Temp folder auto-cleaned');
}, 3 * 60 * 60 * 1000);
if (typeof tempCleanupTimer.unref === 'function') tempCleanupTimer.unref();

// ==========================================
// 3. IMPORTS (ALL FEATURES INCLUDED & FIXED)
// ==========================================
const settings = require('./settings');
require('./config.js');
const { isBanned } = require('./lib/isBanned');
const { fetchBuffer } = require('./lib/myfunc');
const { isSudo } = require('./lib/index');
const isOwnerOrSudo = require('./lib/isOwner');
const isAdmin = require('./lib/isAdmin');
const { ownerControlsCommand } = require('./commands/ownercontrols');

// Auto Features
const { autotypingCommand, handleAutotypingForMessage, showTypingAfterCommand } = require('./commands/autotyping');
const { autoreadCommand, handleAutoread } = require('./commands/autoread');
const { autoStatusCommand, handleStatusUpdate } = require('./commands/autostatus');

// Moderation (FIXED ANTILINK IMPORTS)
const { antistickerCommand, checkAntiSticker } = require('./commands/antisticker');
const { antiphotoCommand, checkAntiPhoto } = require('./commands/antiphoto');
const { antiviewonceCommand, checkAntiViewOnce } = require('./commands/antiviewonce');
const { antifakeCommand, checkFakeLinks } = require('./commands/antifake'); 
const { antibotCommand, checkAntiBot } = require('./commands/antibot'); 
const antiallCommand = require('./commands/antiall');
const { handleAntiBadwordCommand, handleBadwordDetection } = require('./lib/antibadword');
const { Antilink } = require('./lib/antilink'); 
const { handleAntilinkCommand } = require('./commands/antilink'); // <== FIXED IMPORT PATH
const { antimentionCommand, checkAntiMention } = require('./commands/antimention'); 
const groupModeCommand = require('./commands/groupmode');
const { resolveModerationTarget } = require('./lib/moderationTarget');

// Commands
const pingCommand = require('./commands/ping');
const { pingHostCommand } = require('./commands/academicTools');
const helpCommand = require('./commands/help');
const { parsePrefixArgument } = require('./lib/prefix');
const ownerCommand = require('./commands/owner');
const vv2Command = require('./commands/vv2');
const toStatusCommand = require('./commands/tostatus');
const togStatusCommand = require('./commands/togstatus');
const { handleChatbotCommand, handleChatbotResponse, handleAutoReplyCommand, handleSavedContactAutoReply } = require('./commands/chatbot');
const tagAllCommand = require('./commands/tagall');
const banCommand = require('./commands/ban');
const { promoteCommand } = require('./commands/promote');
const { demoteCommand } = require('./commands/demote');
const { promotionCommand, isPromotionNotificationsEnabled } = require('./commands/promotion');
const { antiDemoteCommand, handleAntiDemote } = require('./commands/antidemote');
const muteCommand = require('./commands/mute');
const unmuteCommand = require('./commands/unmute');
const stickerCommand = require('./commands/sticker');
const warnCommand = require('./commands/warn');
const warningsCommand = require('./commands/warnings');
const ttsCommand = require('./commands/tts');
const { tictactoeCommand, handleTicTacToeMove } = require('./commands/tictactoe');
const { topMembers, onlineMembers, incrementMessageCount } = require('./commands/groupcheck');
const decryptCommand = require('./commands/decrypt.js'); 
const deleteCommand = require('./commands/delete');
const { handleAntitagCommand, handleTagDetection } = require('./commands/antitag');
const { handleMentionDetection, mentionToggleCommand, setMentionCommand } = require('./commands/mention');
const memeCommand = require('./commands/meme');
const tagCommand = require('./commands/tag');
const tagNotAdminCommand = require('./commands/tagnotadmin');
const hideTagCommand = require('./commands/hidetag');
const jokeCommand = require('./commands/joke');
const quoteCommand = require('./commands/quote');
const factCommand = require('./commands/fact');
const weatherCommand = require('./commands/weather');
const newsCommand = require('./commands/news');
const kickCommand = require('./commands/kick');
const kickallcommand = require('./commands/kickall');
const simageCommand = require('./commands/simage');
const attpCommand = require('./commands/attp');
const { startHangman, guessLetter } = require('./commands/hangman');
const { startTrivia, answerTrivia } = require('./commands/trivia');
const { complimentCommand } = require('./commands/compliment');
const { insultCommand } = require('./commands/insult');
const { eightBallCommand } = require('./commands/eightball');
const { lyricsCommand } = require('./commands/lyrics');
const { dareCommand } = require('./commands/dare');
const { truthCommand } = require('./commands/truth');
const { clearCommand } = require('./commands/clear');
const aliveCommand = require('./commands/alive');
const blurCommand = require('./commands/img-blur');
const { welcomeCommand, handleJoinEvent } = require('./commands/welcome');
const { goodbyeCommand, handleLeaveEvent } = require('./commands/goodbye');
const githubCommand = require('./commands/github');
const antibadwordCommand = require('./commands/antibadword');
const takeCommand = require('./commands/take');
const { flirtCommand } = require('./commands/flirt');
const characterCommand = require('./commands/character');
const wastedCommand = require('./commands/wasted');
const shipCommand = require('./commands/ship');
const groupInfoCommand = require('./commands/groupinfo');
const resetlinkCommand = require('./commands/resetlink');
const staffCommand = require('./commands/staff');
const unbanCommand = require('./commands/unban');
const emojimixCommand = require('./commands/emojimix');
const { handlePromotionEvent } = require('./commands/promote');
const { handleDemotionEvent } = require('./commands/demote');
const viewOnceCommand = require('./commands/viewonce');
const clearSessionCommand = require('./commands/clearsession');
const { simpCommand } = require('./commands/simp');
const { stupidCommand } = require('./commands/stupid');
const stickerTelegramCommand = require('./commands/stickertelegram');
const textmakerCommand = require('./commands/textmaker');
const { handleAntideleteCommand, handleMessageRevocation, storeMessage } = require('./commands/antidelete');
const clearTmpCommand = require('./commands/cleartmp');
const setProfilePicture = require('./commands/setpp');
const { setGroupDescription, setGroupName, setGroupPhoto } = require('./commands/groupmanage');
const instagramCommand = require('./commands/instagram');
const facebookCommand = require('./commands/facebook');
const spotifyCommand = require('./commands/spotify');
const playCommand = require('./commands/play');
const tiktokCommand = require('./commands/tiktok');
const songCommand = require('./commands/song');
const aiCommand = require('./commands/ai');
const urlCommand = require('./commands/url');
const { handleTranslateCommand } = require('./commands/translate');
const { handleSsCommand } = require('./commands/ss');
const { addCommandReaction, handleAreactCommand } = require('./lib/reactions');
const { goodnightCommand } = require('./commands/goodnight');
const { shayariCommand } = require('./commands/shayari');
const { rosedayCommand } = require('./commands/roseday');
const videoCommand = require('./commands/video');
const sudoCommand = require('./commands/sudo');
const { miscCommand, handleHeart } = require('./commands/misc');
const { animeCommand } = require('./commands/anime');
const { piesCommand, piesAlias } = require('./commands/pies');
const stickercropCommand = require('./commands/stickercrop');
const updateCommand = require('./commands/update');
const removebgCommand = require('./commands/removebg');
const { reminiCommand } = require('./commands/remini');
const { igsCommand } = require('./commands/igs');
const { anticallCommand } = require('./commands/anticall');
const { pmblockerCommand, readState: readPmBlockerState } = require('./commands/pmblocker');
const settingsCommand = require('./commands/settings');
const soraCommand = require('./commands/sora');
const creategroupCommand = require('./commands/creategroup');
const addCommand = require('./commands/add');
const leaveCommand = require('./commands/leave');
const vcfCommand = require('./commands/vcf');
const handleJoinApproval = require('./commands/joinapproval');
const savestatusCommand = require('./commands/savestatus');
const broadcastCommand = require('./commands/broadcast');
const nightmodeCommand = require('./commands/nightmode');
const backupCommand = require('./commands/backup');
const antispamCommand = require('./commands/antispam');
const evalCommand = require('./commands/eval');
const autodlCommand = require('./commands/autodl');
const autobioCommand = require('./commands/autobio');
const alwaysonlineCommand = require('./commands/alwaysonline');
const groupVcfCommand = require('./commands/groupvcf');
const { isGroupAlertEnabled } = require('./commands/groupFeatures');
const setMenuImageCommand = require('./commands/setmenuimage');
const linkCommand = require('./commands/link');
const systemCommand = require('./commands/system');
const { paymentCommand, setPaymentCommand } = require('./commands/payment');
const { designCommand } = require('./commands/design');
const { speedCommand, uptimeCommand, idCommand, botInfoCommand, healthCommand } = require('./commands/utility');
const { menuCompatCommand } = require('./commands/menuCompat');
const downloadCommand = require('./commands/download');
const adminStatusCommand = require('./commands/adminstatus');
const groupStatsCommand = require('./commands/groupstats');
const eatTimeCommand = require('./commands/eat');


// ==========================================
// 4. GLOBAL SETTINGS
// ==========================================
global.packname = settings.packname || 'LEE TECH';
global.author = settings.author || 'Bot';
global.channelLink = settings.channelLink || "https://whatsapp.com/channel/0029VbBu1EgJUM2iVI3tPE0S";
global.ytch = "@ServerNetwork-yt";

const channelInfo = {};
Object.defineProperty(channelInfo, 'contextInfo', {
    enumerable: true,
    get: () => global.ownerControls?.hideChannel ? undefined : {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363404186001130@newsletter',
            newsletterName: 'LEE TECHBOT MD',
            serverMessageId: -1
        }
    }
});

// ==========================================
// 5. MAIN MESSAGE HANDLER
// ==========================================
async function handleMessages(sock, messageUpdate, printLog) {
    try {
        const { messages, type } = messageUpdate || {};
        if (type !== 'notify') return;

        const message = Array.isArray(messages) ? messages[0] : null;
        if (!message?.message) return;
        if (typeof message.key?.remoteJid !== 'string' || !message.key.remoteJid) return;
        if (messageGuard.isDuplicate(message.key?.id)) return;
        healthMetrics.recordMessage();

        // Handle autoread safely
        await handleAutoread(sock, message).catch(()=>null);

        // Store message for antidelete feature
        if (message.message) {
            try { storeMessage(sock, message); } catch(e) {}
        }

        // Handle message revocation
        if (message.message?.protocolMessage?.type === 0) {
            await handleMessageRevocation(sock, message).catch(()=>null);
            return;
        }

        const chatId = message.key.remoteJid;
        const senderId = message.key.participant || message.key.remoteJid;
        const isGroup = chatId.endsWith('@g.us');
        
        // Prevent bot from reading its own broadcasts
        if (chatId === 'status@broadcast') return;

        const senderIsSudo = await isSudo(senderId).catch(()=>false);
        const senderIsOwnerOrSudo = await isOwnerOrSudo(senderId, sock, chatId).catch(()=>false);
        const isOwnerOrSudoCheck = message.key.fromMe || senderIsOwnerOrSudo;

        // Enforce the selected mode before buttons, rate-limit replies, fast
        // commands, moderation, and the normal command router. This prevents
        // non-authorized users from bypassing mode restrictions through menu
        // buttons or other non-text message types.
        let modeData = { mode: 'public', isPublic: true };
        try {
            modeData = loadBotMode();
        } catch (error) {}
        if (!canProcessMessage({ mode: modeData.mode, isPublic: modeData.isPublic, isGroup, isOwnerOrSudo: isOwnerOrSudoCheck })) return;
        if (global.ownerControls?.maintenance && !isOwnerOrSudoCheck) return;

        // Handle button responses
        if (message.message?.buttonsResponseMessage) {
            const buttonId = message.message.buttonsResponseMessage.selectedButtonId;
            const developerButtonCommands = {
                tools_health: '.health',
                tools_settings: '.settings',
                tools_update: '.update'
            };
            if (developerButtonCommands[buttonId]) {
                // Re-enter the normal router so existing owner checks remain
                // authoritative for settings and update operations.
                message.message = { conversation: developerButtonCommands[buttonId] };
            } else if (buttonId === 'channel') {
                return await sock.sendMessage(chatId, { text: '📢 *Join our Channel:*\nhttps://whatsapp.com/channel/0029VbBu1EgJUM2iVI3tPE0S' }, { quoted: message });
            } else if (buttonId === 'owner') {
                return await ownerCommand(sock, chatId);
            } else if (buttonId === 'support') {
                return await sock.sendMessage(chatId, { text: `🔗 *Support*\n\nhttps://chat.whatsapp.com/LIjzygth3mvBKUxwgN6zYt?mode=gi_t` }, { quoted: message });
            }
        }

        const extractedText = message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            message.message?.buttonsResponseMessage?.selectedButtonId ||
            '';
        let userMessage = String(extractedText).toLowerCase().replace(/\.\s+/g, '.').trim();
        if (userMessage.startsWith(global.prefix || '.')) {
            const commandGuard = isAntiBanEnabled() ? antiBanGuard : messageGuard;
            if (!commandGuard.allowCommand(message.key.participant || message.key.remoteJid)) {
                await sock.sendMessage(chatId, { text: '⏳ Please slow down and try again in a moment.' }, { quoted: message }).catch(() => {});
                return;
            }
            healthMetrics.recordCommand();
        }

        // Preserve raw message
        const rawText = String(message.message?.conversation ||
            message.message?.extendedTextMessage?.text ||
            message.message?.imageMessage?.caption ||
            message.message?.videoMessage?.caption ||
            '');

        // Fast lane: these read-only commands do not need group metadata or
        // moderation checks, so they remain responsive on busy groups.
        const fastCommand = userMessage.split(/\s+/)[0];
        const fastPrefix = global.prefix === 'none' ? '.' : (global.prefix || '.');
        const isFastCommand = userMessage.startsWith(fastPrefix) && ['.ping', '.help', '.menu', '.commands', '.devmenu', '.developermenu', '.devtools', '.tools', '.groupmenu', '.alive', '.system', '.stats', '.speed', '.uptime', '.runtime', '.id', '.botinfo', '.health'].includes(fastCommand);
        if (isFastCommand) {
            if (fastCommand === '.ping') {
                if (userMessage.split(/\s+/).length > 1) await pingHostCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                else await pingCommand(sock, chatId, message);
            }
            else if (fastCommand === '.help' || fastCommand === '.menu' || fastCommand === '.commands' || fastCommand === '.devmenu' || fastCommand === '.developermenu' || fastCommand === '.devtools' || fastCommand === '.tools' || fastCommand === '.groupmenu') await helpCommand(sock, chatId, message);
            else if (fastCommand === '.alive') await aliveCommand(sock, chatId, message);
            else if (fastCommand === '.speed') await speedCommand(sock, chatId, message);
            else if (fastCommand === '.uptime' || fastCommand === '.runtime') await uptimeCommand(sock, chatId, message);
            else if (fastCommand === '.id') await idCommand(sock, chatId, message);
            else if (fastCommand === '.botinfo') await botInfoCommand(sock, chatId, message);
            else if (fastCommand === '.health') await healthCommand(sock, chatId, message);
            else await systemCommand(sock, chatId, message);
            return;
        }

        // Check if user is banned
        if (isBanned(senderId) && !userMessage.startsWith('.unban')) {
            if (Math.random() < 0.1) {
                await sock.sendMessage(chatId, { text: '❌ You are banned from using the bot. Contact an admin to get unbanned.', ...channelInfo });
            }
            return;
        }
        
        // Tic-Tac-Toe moves do not need group metadata or moderation checks.
        // Handle them before the potentially slow group-admin lookup.
        if (/^[1-9]$/.test(userMessage) || userMessage === 'surrender') {
            await handleTicTacToeMove(sock, chatId, senderId, userMessage).catch(() => null);
            return;
        }

        let isBotAdmin = false;
        let isSenderAdmin = false;
        let groupMetadataAvailable = true;

        // Check admin status safely
        if (isGroup) {
            try {
                const adminStatus = await isAdmin(sock, chatId, senderId);
                isSenderAdmin = adminStatus.isSenderAdmin;
                isBotAdmin = adminStatus.isBotAdmin;
                groupMetadataAvailable = adminStatus.metadataAvailable !== false;
            } catch (err) { }
        }

        if (!message.key.fromMe) incrementMessageCount(chatId, senderId);

        // =====================================================================
        // THE FRONT-LINE INTERCEPTORS 
        // =====================================================================
        if (isGroup) {
            if (userMessage) {
                await handleBadwordDetection(sock, chatId, message, userMessage, senderId).catch(()=>null);
            }
            if (typeof Antilink === 'function') await Antilink(message, sock).catch(()=>null);

            if (await checkAntiBot(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, senderId).catch(()=>false)) return; 
            if (await checkAntiSticker(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, senderId).catch(()=>false)) return;
            if (await checkAntiPhoto(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, senderId).catch(()=>false)) return;
            if (await checkAntiViewOnce(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, senderId).catch(()=>false)) return;
            if (await checkFakeLinks(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, senderId).catch(()=>false)) return; 
            
            if (typeof checkAntiMention === 'function') {
                if (await checkAntiMention(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, senderId).catch(()=>false)) return;
            }
        }

        // PM blocker
        if (!isGroup && !message.key.fromMe && !senderIsSudo) {
            try {
                const pmState = readPmBlockerState();
                if (pmState.enabled) {
                    await sock.sendMessage(chatId, { text: pmState.message || 'Private messages are blocked. Please contact the owner in groups only.' });
                    await new Promise(r => setTimeout(r, 1500));
                    try { await sock.updateBlockStatus(chatId, 'block'); } catch (e) { }
                    return;
                }
            } catch (e) { }
        }

        let actualPrefix = global.prefix === 'none' ? '' : global.prefix;
        let isCmd = false;

        if (actualPrefix === '') {
            isCmd = userMessage.length > 0;
        } else {
            isCmd = userMessage.startsWith(actualPrefix);
        }
        const slashStatusCommand = /^\/(?:to|tog)status(?:\s|$)/i.test(userMessage);
        if (slashStatusCommand) isCmd = true;

        if (!isCmd) {
            if (isGroup && /^@ll(?:\s|$)/i.test(userMessage)) {
                await tagAllCommand(sock, chatId, senderId, message);
                return;
            }
            await handleAutotypingForMessage(sock, chatId, userMessage).catch(()=>null);

            if (isGroup) {
                await handleTagDetection(sock, chatId, message, senderId).catch(()=>null);
                await handleMentionDetection(sock, chatId, message).catch(()=>null);
            }
            if (await handleSavedContactAutoReply(sock, chatId, message, userMessage, senderId).catch(() => false)) return;
            await handleChatbotResponse(sock, chatId, message, userMessage, senderId).catch(()=>null);
            return;
        }

        // --- AUTO-DOWNLOADER INTERCEPTOR ---
        if (isGroup && global.autodlState === 'on' && !message.key.fromMe) {
            const urlMatch = rawText.match(/(https?:\/\/[^\s]+)/);
            
            if (urlMatch) {
                const extractedUrl = urlMatch[0];
                let mockMessage = JSON.parse(JSON.stringify(message)); 
                
                if (extractedUrl.includes('tiktok.com')) {
                    mockMessage.message = { conversation: `.tiktok ${extractedUrl}` };
                    await tiktokCommand(sock, chatId, mockMessage).catch(()=>null);
                    return; 
                } 
                else if (extractedUrl.includes('instagram.com')) {
                    mockMessage.message = { conversation: `.ig ${extractedUrl}` };
                    await instagramCommand(sock, chatId, mockMessage).catch(()=>null);
                    return;
                } 
                else if (extractedUrl.includes('facebook.com') || extractedUrl.includes('fb.watch')) {
                    mockMessage.message = { conversation: `.fb ${extractedUrl}` };
                    await facebookCommand(sock, chatId, mockMessage).catch(()=>null);
                    return;
                }
            }
        }

        if (slashStatusCommand) {
            userMessage = `.${userMessage.slice(1).trim()}`;
        } else if (actualPrefix !== '.' && actualPrefix !== '') {
            userMessage = '.' + userMessage.slice(actualPrefix.length).trim();
        } else if (actualPrefix === '') {
            if (!userMessage.startsWith('.')) {
                userMessage = '.' + userMessage.trim();
            }
        }
        
        console.log(`📝 Command used in ${isGroup ? 'group' : 'private'}: ${userMessage}`);

        if (modeData.mode === 'private' && !isOwnerOrSudoCheck) {
            return;
        }

        const commandToken = userMessage.split(/\s+/)[0].toLowerCase();
        const adminCommands = ['.add', '.groupvcf', '.savecontacts', '.extract', '.mute', '.unmute', '.link', '.ban', '.unban', '.promote', '.promotemsg', '.promotion', '.promotions', '.antidemote', '.demote', '.kick', '.out', '.antifake', '.tagall', '.tagnotadmin', '.all', '.contacttag', '.tagadmin', '.hidetag', '.antilink', '.antiphoto', '.antisticker', '.antitag', '.antimention', '.setgdesc', '.setgname', '.setgpp', '.kickall'];
        const isAdminCommand = adminCommands.includes(commandToken);

        const ownerCommands = ['.mode', '.autostatus', '.autoviewstatus', '.autolikestatus', '.antidelete', '.cleartmp', '.setpp', '.tostatus', '.togstatus', '.clearsession', '.creategroup', '.areact', '.autoreact', '.decrypt', '.autotyping', '.autoread', '.pmblocker', '.update', '.antiban', '.setpayment', '.setprefix', '.hidechannel', '.maintenance', '.ownerstatus', '.setmenuimage', '.setmenu', '.menumode', '.menustyle', '.menufont'];
        const isOwnerCommand = ownerCommands.some(cmd => userMessage.startsWith(cmd));

        if (isGroup && isAdminCommand) {
            if (!groupMetadataAvailable) {
                await sock.sendMessage(chatId, { text: '⏳ WhatsApp group details are temporarily unavailable or rate-limited. Please wait a few seconds and try again.', ...channelInfo }, { quoted: message }).catch(() => {});
                return;
            }
            if (!isBotAdmin) {
                await sock.sendMessage(chatId, { text: 'Please make the bot an admin to use admin commands.', ...channelInfo }, { quoted: message });
                return;
            }

            if (['.mute', '.unmute', '.ban', '.unban', '.promote', '.promotemsg', '.promotion', '.promotions', '.antidemote', '.demote', '.out', '.kickall'].includes(commandToken)) {
                if (!isSenderAdmin && !isOwnerOrSudoCheck) {
                    await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                    return;
                }
            }
        }

        if (isOwnerCommand) {
            if (!message.key.fromMe && !senderIsOwnerOrSudo) {
                await sock.sendMessage(chatId, { text: '❌ This command is only available for the owner or sudo!' }, { quoted: message });
                return;
            }
        }

        let commandExecuted = false;

        const commandStartedAt = Date.now();
        switch (true) {
            case userMessage === '.system' || userMessage === '.stats':
                await systemCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.joinapproval') || userMessage.startsWith('.approve') || userMessage.startsWith('.reject'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const cmd = parts[0].substring(1);
                    const args = parts.slice(1);
                    
                    await handleJoinApproval(sock, chatId, message, senderId, args, cmd, isGroup, isBotAdmin, isSenderAdmin);
                }
                commandExecuted = true;
                break;
                
            case userMessage.startsWith('.antimention'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antimention', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await antimentionCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isBotAdmin, target.isOwner, target.userMessage);
                }
                commandExecuted = true;
                break;

            case userMessage === '.simage': {
                const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                if (quotedMessage?.stickerMessage) {
                    await simageCommand(sock, quotedMessage, chatId);
                } else {
                    await sock.sendMessage(chatId, { text: 'Please reply to a sticker with the .simage command to convert it.', ...channelInfo }, { quoted: message });
                }
                commandExecuted = true;
                break;
            }
            case userMessage === '.vv2':
                await vv2Command(sock, chatId, message, isOwnerOrSudoCheck);
                commandExecuted = true;
                break;

            case commandToken === '.savestatus' || commandToken === '.statusdl': {
                await savestatusCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
            }
            
            case userMessage === '.kickall' || userMessage.startsWith('.kickall '): {
                await sock.sendMessage(chatId, { text: 'Starting group cleanup... please wait.', ...channelInfo }, { quoted: message });
                const groupMetadata = await sock.groupMetadata(chatId);
                const participants = groupMetadata.participants;

                for (let user of participants) {
                    if (!user.admin && user.id !== sock.user.id && user.id !== senderId) {
                        await sock.groupParticipantsUpdate(chatId, [user.id], "remove");
                        await new Promise(r => setTimeout(r, 1000)); 
                    }
                }
                await sock.sendMessage(chatId, { text: 'Cleanup complete. Non-admins removed.', ...channelInfo }, { quoted: message });
                commandExecuted = true;
                break;
            }

            case commandToken === '.setprefix': {
                if (!isOwnerOrSudoCheck) {
                    await sock.sendMessage(chatId, { text: '❌ Only the bot owner can change the prefix.', ...channelInfo }, { quoted: message });
                    break;
                }
                const parsedPrefix = parsePrefixArgument(rawText);
                if (!parsedPrefix.valid) {
                    await sock.sendMessage(chatId, { text: `📝 Use one letter, symbol, emoji, or \`none\`.\nExamples: .setprefix !   .setprefix 🔥   .setprefix none\n\n❌ ${parsedPrefix.reason}`, ...channelInfo }, { quoted: message });
                    break;
                }

                global.prefix = parsedPrefix.value;
                const displayPrefix = global.prefix === '' ? 'none (No prefix)' : global.prefix;

                const prefixPath = path.join(__dirname, './data/prefix.json');
                fs.writeFileSync(prefixPath, JSON.stringify({ prefix: global.prefix }, null, 2));

                await sock.sendMessage(chatId, { text: `✅ Prefix has been permanently set to: *${displayPrefix}*`, ...channelInfo }, { quoted: message });
                commandExecuted = true;
                break;
            }

            case userMessage.startsWith('.nightmode'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.nightmode', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await nightmodeCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isBotAdmin, target.userMessage);
                }
                commandExecuted = true;
                break;
        
            case userMessage.startsWith('.alwaysonline'):
                await alwaysonlineCommand(sock, chatId, message, isOwnerOrSudoCheck, userMessage);
                commandExecuted = true;
                break;
            case userMessage === '.groupvcf' || userMessage === '.savecontact' || userMessage === '.savecontacts' || userMessage === '.extract':
                await groupVcfCommand(sock, chatId, message, isGroup, isSenderAdmin, isOwnerOrSudoCheck);
                commandExecuted = true;
                break;

            // Match the command token instead of the whole message so these
            // commands can receive inline text/captions, for example
            // `.tostatus Good morning` and `.togstatus Exam reminder`.
            case commandToken === '.tostatus':
                await toStatusCommand(sock, chatId, message, isOwnerOrSudoCheck);
                commandExecuted = true;
                break;
                
            case commandToken === '.togstatus':
                await togStatusCommand(sock, chatId, message, isOwnerOrSudoCheck, isGroup);
                commandExecuted = true;
                break;

            case userMessage === '.backup' || userMessage.startsWith('.backup '):
                await backupCommand(sock, chatId, message, isOwnerOrSudoCheck);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antibot'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antibot', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await antibotCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isBotAdmin, target.isOwner, target.userMessage);
                }
                commandExecuted = true;
                break;
            case commandToken === '.antiall':
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antiall', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await antiallCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isBotAdmin, target.isOwner, target.userMessage);
                }
                commandExecuted = true;
                break;

            case userMessage.startsWith('.antifake'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antifake', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await antifakeCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isBotAdmin, target.isOwner, target.userMessage);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.eval'):
                await evalCommand(sock, chatId, message, isOwnerOrSudoCheck, rawText);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.autodl'):
                await autodlCommand(sock, chatId, message, isGroup, isSenderAdmin, isOwnerOrSudoCheck, userMessage);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.antispam'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antispam', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await antispamCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isOwner, target.userMessage);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.broadcast') || userMessage.startsWith('.bc'):
                await broadcastCommand(sock, chatId, message, isOwnerOrSudoCheck, userMessage);
                commandExecuted = true;
                break;
                
            case userMessage === '.out' || userMessage.startsWith('.out '): {
                const mentionedJidListOut = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await kickCommand(sock, chatId, senderId, mentionedJidListOut, message, 'out');
                commandExecuted = true;
                break;
            }
            case userMessage.startsWith('.kick'): {
                const mentionedJidListKick = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await kickCommand(sock, chatId, senderId, mentionedJidListKick, message);
                commandExecuted = true;
                break;
            }
            case userMessage.startsWith('.antisticker'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antisticker', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await antistickerCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isBotAdmin, target.isOwner, target.userMessage);
                }
                commandExecuted = true;
                break;

            case userMessage.startsWith('.antiphoto'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antiphoto', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await antiphotoCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isBotAdmin, target.isOwner, target.userMessage);
                }
                commandExecuted = true;
                break;
            case commandToken === '.antiviewonce':
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antiviewonce', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else await antiviewonceCommand(sock, target.chatId, message, target.isGroup, target.isSenderAdmin, target.isOwner, target.userMessage);
                }
                commandExecuted = true;
                break;
            case commandToken === '.open' || commandToken === '.close' || commandToken === '.groupopen' || commandToken === '.groupclose' || commandToken === '.announce' || commandToken === '.unannounce':
                await groupModeCommand(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, isOwnerOrSudoCheck, userMessage);
                commandExecuted = true;
                break;
             case userMessage === '.link' || userMessage === '.grouplink' || userMessage === '.invite':
                await linkCommand(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, isOwnerOrSudoCheck, userMessage);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.autobio'):
                await autobioCommand(sock, chatId, message, isOwnerOrSudoCheck, userMessage);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.mute'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const muteArg = parts[1];
                    const muteDuration = muteArg !== undefined ? parseInt(muteArg, 10) : undefined;
                    if (muteArg !== undefined && (isNaN(muteDuration) || muteDuration <= 0)) {
                        await sock.sendMessage(chatId, { text: 'Please provide a valid number of minutes or use .mute with no number to mute immediately.', ...channelInfo }, { quoted: message });
                    } else {
                        await muteCommand(sock, chatId, senderId, message, muteDuration);
                    }
                }
                commandExecuted = true;
                break;
            case userMessage === '.unmute':
                await unmuteCommand(sock, chatId, senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ban'):
                await banCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.unban'):
                await unbanCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.help' || userMessage === '.menu' || userMessage === '.commands' || userMessage === '.devmenu' || userMessage === '.developermenu' || userMessage === '.devtools' || userMessage === '.tools' || userMessage === '.groupmenu' || userMessage === '.bot' || userMessage === '.list':
                await helpCommand(sock, chatId, message, global.channelLink);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setmenuimage') || userMessage.startsWith('.setmenu') || userMessage.startsWith('.menumode') || userMessage.startsWith('.menustyle') || userMessage.startsWith('.menufont'):
                await setMenuImageCommand(sock, chatId, message, isOwnerOrSudoCheck);
                commandExecuted = true;
                break;
             case userMessage.startsWith('.creategroup') || userMessage.startsWith('.cg'):
    // Split the message at the first space to get the name
    const groupName = userMessage.split(' ').slice(1).join(' ');

    if (!groupName) {
        await sock.sendMessage(chatId, { text: '❌ *Usage Error!*\nYou must provide a name.\nExample: *.cg My Cool Group*' }, { quoted: message });
    } else {
        // Only call the function if a name was provided
        await creategroupCommand(sock, chatId, message, isOwnerOrSudoCheck, groupName);
    }
    commandExecuted = true;
    break;
            case userMessage === '.sticker' || userMessage.startsWith('.sticker ') || userMessage === '.s':
                await stickerCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.warnings'):
                const mentionedJidListWarnings = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warningsCommand(sock, chatId, mentionedJidListWarnings);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.warn'):
                const mentionedJidListWarn = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await warnCommand(sock, chatId, senderId, mentionedJidListWarn, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tts'):
                const text = userMessage.slice(4).trim();
                await ttsCommand(sock, chatId, text, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.delete') || userMessage.startsWith('.del'):
                await deleteCommand(sock, chatId, message, senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.attp'):
                await attpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
              
                

            case userMessage === '.settings' || userMessage.startsWith('.settings '):
                await settingsCommand(sock, chatId, message, userMessage.trim().split(/\s+/)[1] || '');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.hidechannel') || userMessage.startsWith('.maintenance') || userMessage.startsWith('.ownerstatus'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const control = parts[0].slice(1);
                    await ownerControlsCommand(sock, chatId, message, `${control} ${parts.slice(1).join(' ')}`.trim());
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.mode'):
                let data;
                try {
                    data = { ...data, ...loadBotMode() };
                } catch (error) {
                    await sock.sendMessage(chatId, { text: 'Failed to read bot mode status', ...channelInfo });
                    break;
                }

                const action = userMessage.split(/\s+/)[1]?.toLowerCase();
                const supportedModes = ['public', 'private', 'group', 'dm'];
                if (!action || !supportedModes.includes(action)) {
                    const currentMode = data.mode || (data.isPublic ? 'public' : 'private');
                    await sock.sendMessage(chatId, {
                        text: `Current bot mode: *${currentMode}*\n\nUsage: .mode public|private|group|dm\n\npublic — everyone in groups and DMs\nprivate — owner, sudo, and developer only in groups and DMs\ngroup — everyone in groups only\ndm — everyone in private chats only`,
                        ...channelInfo
                    }, { quoted: message });
                    break;
                }

                try {
                    saveBotMode(action);
                    await sock.sendMessage(chatId, { text: `Bot is now in *${action}* mode`, ...channelInfo });
                } catch (error) {
                    await sock.sendMessage(chatId, { text: 'Failed to update bot access mode', ...channelInfo });
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.anticall'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await anticallCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pmblocker'):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    await pmblockerCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage === '.owner' || userMessage.startsWith('.owner '):
                await ownerCommand(sock, chatId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.add'):
                await addCommand(sock, chatId, message, isGroup, isSenderAdmin, isBotAdmin, isOwnerOrSudoCheck, rawText);
                commandExecuted = true;
                break;
            case userMessage === '.tagall' || userMessage.startsWith('.tagall '):
                await tagAllCommand(sock, chatId, senderId, message);
                commandExecuted = true;
                break;
            case userMessage === '.tagnotadmin':
                await tagNotAdminCommand(sock, chatId, senderId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.hidetag'):
                {
                    const messageText = rawText.slice(8).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await hideTagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tag'):
                {
                    const messageText = rawText.slice(4).trim();
                    const replyMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
                    await tagCommand(sock, chatId, senderId, messageText, replyMessage, message);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antilink'):
                if (isGroup && !isBotAdmin) {
                    await sock.sendMessage(chatId, { text: 'Please make the bot an admin first.', ...channelInfo }, { quoted: message });
                    break;
                }
                await handleAntilinkCommand(sock, chatId, userMessage, senderId, isSenderAdmin, message, isOwnerOrSudoCheck);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antitag'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antitag', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else if (!target.isBotAdmin) await sock.sendMessage(chatId, { text: 'Please make the bot an admin first.', ...channelInfo }, { quoted: message });
                    else await handleAntitagCommand(sock, target.chatId, target.userMessage, senderId, target.isSenderAdmin, message);
                }
                commandExecuted = true;
                break;
            case userMessage === '.meme' || userMessage.startsWith('.meme '):
                await memeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.joke' || userMessage.startsWith('.joke '):
                await jokeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.quote' || userMessage.startsWith('.quote '):
                await quoteCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.fact' || userMessage.startsWith('.fact '):
                await factCommand(sock, chatId, message, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.weather'):
                const city = userMessage.slice(9).trim();
                if (city) {
                    await weatherCommand(sock, chatId, message, city);
                } else {
                    await sock.sendMessage(chatId, { text: 'Please specify a city, e.g., .weather London', ...channelInfo }, { quoted: message });
                }
                commandExecuted = true;
                break;
            case userMessage === '.news' || userMessage.startsWith('.news '):
                await newsCommand(sock, chatId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ttt') || userMessage.startsWith('.tictactoe'):
                const tttText = userMessage.split(' ').slice(1).join(' ');
                await tictactoeCommand(sock, chatId, senderId, tttText);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.move'):
                const position = parseInt(userMessage.split(' ')[1]);
                if (!Number.isInteger(position) || position < 1 || position > 9) {
                    await sock.sendMessage(chatId, { text: 'Please provide a valid position number for Tic-Tac-Toe move.', ...channelInfo }, { quoted: message });
                } else {
                    await handleTicTacToeMove(sock, chatId, senderId, String(position));
                }
                commandExecuted = true;
                break;
           
            case userMessage === '.topmembers':
                topMembers(sock, chatId, isGroup);
                commandExecuted = true;
                break;
            
            case userMessage === '.onlinemembers':
                case userMessage === '.online':
                onlineMembers(sock, chatId, isGroup);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.decrypt'):
            // Parse arguments (passwords)
            const decryptArgs = userMessage.split(' ').slice(1);
            // Pass the correct parameters so the decrypt function works
            await decryptCommand(sock, chatId, message, isOwnerOrSudoCheck, decryptArgs);
            commandExecuted = true;
            break;
            case userMessage.startsWith('.hangman'):
                startHangman(sock, chatId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.guess'):
                const guessedLetter = userMessage.split(' ')[1];
                if (guessedLetter) {
                    guessLetter(sock, chatId, guessedLetter);
                } else {
                    sock.sendMessage(chatId, { text: 'Please guess a letter using .guess <letter>', ...channelInfo }, { quoted: message });
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.trivia'):
                startTrivia(sock, chatId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.answer'):
                const answer = userMessage.split(' ').slice(1).join(' ');
                if (answer) {
                    answerTrivia(sock, chatId, answer);
                } else {
                    sock.sendMessage(chatId, { text: 'Please provide an answer using .answer <answer>', ...channelInfo }, { quoted: message });
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.compliment'):
                await complimentCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.insult'):
                await insultCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.8ball'):
                const question = userMessage.split(' ').slice(1).join(' ');
                await eightBallCommand(sock, chatId, question);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.lyrics'):
                const songTitle = userMessage.split(' ').slice(1).join(' ');
                await lyricsCommand(sock, chatId, songTitle, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.simp'):
                const quotedMsgSimp = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const mentionedJidSimp = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await simpCommand(sock, chatId, quotedMsgSimp, mentionedJidSimp, senderId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.stupid') || userMessage.startsWith('.itssostupid') || userMessage.startsWith('.iss'):
                const stupidQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                const stupidMentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
                const stupidArgs = userMessage.split(' ').slice(1);
                await stupidCommand(sock, chatId, stupidQuotedMsg, stupidMentionedJid, senderId, stupidArgs);
                commandExecuted = true;
                break;
            case userMessage === '.dare' || userMessage.startsWith('.dare '):
                await dareCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.truth' || userMessage.startsWith('.truth '):
                await truthCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.clear':
                if (isGroup) await clearCommand(sock, chatId);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.promotion') || userMessage.startsWith('.promotions') || userMessage.startsWith('.promotemsg'):
                await promotionCommand(sock, chatId, message, userMessage.split(/\s+/)[1] || 'status');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antidemote'):
                await antiDemoteCommand(sock, chatId, message, userMessage.split(/\s+/)[1] || 'status');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antiban'):
                await antiBanCommand(sock, chatId, message, userMessage.split(/\s+/)[1] || 'status');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.promote') && !userMessage.startsWith('.promoteall'):
                const mentionedJidListPromote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await promoteCommand(sock, chatId, mentionedJidListPromote, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.demote') && !userMessage.startsWith('.demoteall'):
                const mentionedJidListDemote = message.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
                await demoteCommand(sock, chatId, mentionedJidListDemote, message);
                commandExecuted = true;
                break;
            case userMessage === '.ping' || userMessage.startsWith('.ping '):
                if (userMessage.split(/\s+/).length > 1) await pingHostCommand(sock, chatId, message, userMessage.split(/\s+/).slice(1));
                else await pingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.alive' || userMessage.startsWith('.alive '):
                await aliveCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.mention '):
                {
                    const args = userMessage.split(' ').slice(1).join(' ');
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await mentionToggleCommand(sock, chatId, message, args, isOwner);
                }
                commandExecuted = true;
                break;
            case userMessage === '.setmention':
                {
                    const isOwner = message.key.fromMe || senderIsSudo;
                    await setMentionCommand(sock, chatId, message, isOwner);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.blur'):
                const quotedMessageBlur = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                await blurCommand(sock, chatId, message, quotedMessageBlur);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.welcome'):
                if (isGroup) {
                    if (!isSenderAdmin) {
                        await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                    } else {
                        await welcomeCommand(sock, chatId, message);
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.goodbye'):
                if (isGroup) {
                    if (!isSenderAdmin) {
                        await sock.sendMessage(chatId, { text: 'Sorry, only group admins can use this command.', ...channelInfo }, { quoted: message });
                    } else {
                        await goodbyeCommand(sock, chatId, message);
                    }
                } else {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups.', ...channelInfo }, { quoted: message });
                }
                commandExecuted = true;
                break;
            case userMessage === '.git' || userMessage === '.github' || userMessage === '.sc' || userMessage === '.script' || userMessage === '.repo':
                await githubCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antibadword'):
                {
                    const target = await resolveModerationTarget(sock, { chatId, message, userMessage, command: '.antibadword', isGroup, isOwner: isOwnerOrSudoCheck, isSenderAdmin, isBotAdmin });
                    if (!target.ok) await sock.sendMessage(chatId, { text: target.error, ...channelInfo }, { quoted: message });
                    else if (!target.isBotAdmin) await sock.sendMessage(chatId, { text: '*Bot must be admin to use this feature*', ...channelInfo }, { quoted: message });
                    else await antibadwordCommand(sock, target.chatId, message, senderId, target.isSenderAdmin, target.userMessage);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoreply') || userMessage.startsWith('/autoreply'):
                if (!isOwnerOrSudoCheck) {
                    await sock.sendMessage(chatId, { text: '❌ Only the bot owner or sudo can control selected-contact autoreplies.', ...channelInfo }, { quoted: message });
                    break;
                }
                await handleAutoReplyCommand(sock, chatId, message, userMessage.slice(10).trim(), true);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.chatbot'):
                if (!isGroup) {
                    if (!isOwnerOrSudoCheck) {
                        await sock.sendMessage(chatId, { text: '❌ Only the bot owner or sudo can control a group chatbot from DM.', ...channelInfo }, { quoted: message });
                        break;
                    }
                    const dmMatch = userMessage.slice(8).trim();
                    await handleChatbotCommand(sock, chatId, message, dmMatch, { isOwnerDm: true });
                    commandExecuted = true;
                    break;
                }
                
                // --- ANTI-SPAM LOGIC ---
                if (global.antispamState === 'on' && !isSenderAdmin && !message.key.fromMe) {
                    global.spamMap = global.spamMap || {};
                    global.spamMap[senderId] = (global.spamMap[senderId] || 0) + 1;

                    if (global.spamMap[senderId] > 5) {
                        if (isBotAdmin) await sock.sendMessage(chatId, { delete: message.key }).catch(()=>null); 
                        if (global.spamMap[senderId] === 6) {
                            await sock.sendMessage(chatId, { 
                                text: `⚠️ @${senderId.split('@')[0]}, please stop spamming! Further messages will be deleted.`, 
                                mentions: [senderId] 
                            }).catch(()=>null);
                        }
                        return; 
                    }
                    setTimeout(() => { if (global.spamMap[senderId]) global.spamMap[senderId]--; }, 5000); 
                }

                if (!isSenderAdmin && !message.key.fromMe) {
                    await sock.sendMessage(chatId, { text: '*Only admins or bot owner can use this command*', ...channelInfo }, { quoted: message });
                    break;
                }

                const match = userMessage.slice(8).trim();
                await handleChatbotCommand(sock, chatId, message, match);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.take') || userMessage.startsWith('.steal'):
                {
                    const isSteal = userMessage.startsWith('.steal');
                    const sliceLen = isSteal ? 6 : 5; 
                    const takeArgs = rawText.slice(sliceLen).trim().split(' ');
                    await takeCommand(sock, chatId, message, takeArgs);
                }
                commandExecuted = true;
                break;
            case userMessage === '.flirt' || userMessage.startsWith('.flirt '):
                await flirtCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.character'):
                await characterCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.waste'):
                await wastedCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.ship':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    break;
                }
                await shipCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.groupinfo' || userMessage === '.infogp' || userMessage === '.infogrupo':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    break;
                }
                await groupInfoCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.resetlink' || userMessage.startsWith('.resetlink ') || userMessage === '.revoke' || userMessage.startsWith('.revoke ') || userMessage === '.anularlink' || userMessage.startsWith('.anularlink '):
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    break;
                }
                await resetlinkCommand(sock, chatId, senderId);
                commandExecuted = true;
                break;
            case userMessage === '.staff' || userMessage === '.admins' || userMessage === '.listadmin':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: 'This command can only be used in groups!', ...channelInfo }, { quoted: message });
                    break;
                }
                await staffCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case commandToken === '.adminstatus':
                await adminStatusCommand(sock, chatId, message, senderId, isGroup, isOwnerOrSudoCheck);
                commandExecuted = true;
                break;
            case commandToken === '.groupstats':
                await groupStatsCommand(sock, chatId, message, isGroup);
                commandExecuted = true;
                break;
            case commandToken === '.eat' || commandToken === '.eattime' || commandToken === '.time':
                await eatTimeCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case commandToken === '.tourl' || commandToken === '.url':
                await urlCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.emojimix') || userMessage.startsWith('.emix'):
                await emojimixCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tg') || userMessage.startsWith('.stickertelegram') || userMessage.startsWith('.tgsticker') || userMessage.startsWith('.telesticker'):
                await stickerTelegramCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.vv' || userMessage.startsWith('.vv '):
                await viewOnceCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.clearsession' || userMessage === '.clearsesi':
                await clearSessionCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoviewstatus'):
                await autoStatusCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoreact') || userMessage.startsWith('.autolikestatus'):
                await autoStatusCommand(sock, chatId, message, ['react', userMessage.split(' ')[1] || 'status']);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autostatus'):
                const autoStatusArgs = userMessage.split(' ').slice(1);
                await autoStatusCommand(sock, chatId, message, autoStatusArgs);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.metallic'):
                await textmakerCommand(sock, chatId, message, userMessage, 'metallic');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ice'):
                await textmakerCommand(sock, chatId, message, userMessage, 'ice');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.snow'):
                await textmakerCommand(sock, chatId, message, userMessage, 'snow');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.impressive'):
                await textmakerCommand(sock, chatId, message, userMessage, 'impressive');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.matrix'):
                await textmakerCommand(sock, chatId, message, userMessage, 'matrix');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.light'):
                await textmakerCommand(sock, chatId, message, userMessage, 'light');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.neon'):
                await textmakerCommand(sock, chatId, message, userMessage, 'neon');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.devil'):
                await textmakerCommand(sock, chatId, message, userMessage, 'devil');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.purple'):
                await textmakerCommand(sock, chatId, message, userMessage, 'purple');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.thunder'):
                await textmakerCommand(sock, chatId, message, userMessage, 'thunder');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.leaves'):
                await textmakerCommand(sock, chatId, message, userMessage, 'leaves');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.1917'):
                await textmakerCommand(sock, chatId, message, userMessage, '1917');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.arena'):
                await textmakerCommand(sock, chatId, message, userMessage, 'arena');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.hacker'):
                await textmakerCommand(sock, chatId, message, userMessage, 'hacker');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.sand'):
                await textmakerCommand(sock, chatId, message, userMessage, 'sand');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.blackpink'):
                await textmakerCommand(sock, chatId, message, userMessage, 'blackpink');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.glitch'):
                await textmakerCommand(sock, chatId, message, userMessage, 'glitch');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.fire'):
                await textmakerCommand(sock, chatId, message, userMessage, 'fire');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.antidelete'):
                const antideleteMatch = userMessage.slice(11).trim();
                await handleAntideleteCommand(sock, chatId, message, antideleteMatch);
                commandExecuted = true;
                break;
            case userMessage === '.cleartmp':
                await clearTmpCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.setpp' || userMessage.startsWith('.setpp '):
                await setProfilePicture(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setgdesc'):
                {
                    const text = rawText.slice(9).trim();
                    await setGroupDescription(sock, chatId, senderId, text, message);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setgname'):
                {
                    const text = rawText.slice(9).trim();
                    await setGroupName(sock, chatId, senderId, text, message);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.setgpp'):
                await setGroupPhoto(sock, chatId, senderId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.instagram') || userMessage.startsWith('.insta') || userMessage.startsWith('.ig'):
                await instagramCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.igsc'):
                await igsCommand(sock, chatId, message, true);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.igs'):
                await igsCommand(sock, chatId, message, false);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.fb') || userMessage.startsWith('.facebook'):
                await facebookCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.music'):
                await playCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.spotify'):
                await spotifyCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.play') || userMessage.startsWith('.mp3') || userMessage.startsWith('.ytmp3') || userMessage.startsWith('.song'):
                await songCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.video') || userMessage.startsWith('.ytmp4'):
                await videoCommand(sock, chatId, message);
                commandExecuted = true;
                break;

            case userMessage.startsWith('.download') || userMessage.startsWith('.dl'):
                await downloadCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tiktok') || userMessage.startsWith('.tt'):
                await tiktokCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.gpt') || userMessage.startsWith('.gemini'):
                await aiCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.translate') || userMessage.startsWith('.trt'):
                const commandLength = userMessage.startsWith('.translate') ? 10 : 4;
                await handleTranslateCommand(sock, chatId, message, userMessage.slice(commandLength));
                return;
            case userMessage.startsWith('.ss') || userMessage.startsWith('.ssweb') || userMessage.startsWith('.screenshot'):
                const ssCommandLength = userMessage.startsWith('.screenshot') ? 11 : (userMessage.startsWith('.ssweb') ? 6 : 3);
                await handleSsCommand(sock, chatId, message, userMessage.slice(ssCommandLength).trim());
                commandExecuted = true;
                break;
            case userMessage.startsWith('.areact') || userMessage.startsWith('.autoreact') || userMessage.startsWith('.autoreaction'):
                await handleAreactCommand(sock, chatId, message, isOwnerOrSudoCheck);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.sudo'):
                await sudoCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.goodnight' || userMessage === '.lovenight' || userMessage === '.gn':
                await goodnightCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.shayari' || userMessage === '.shayri':
                await shayariCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage === '.roseday':
                await rosedayCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.imagine') || userMessage.startsWith('.flux') || userMessage.startsWith('.dalle'): 
                await designCommand(sock, chatId, message, rawText.trim().split(/\s+/).slice(1));
                commandExecuted = true;
                break;
            case userMessage === '.jid':
                if (!isGroup) {
                    await sock.sendMessage(chatId, { text: "❌ This command can only be used in a group." });
                } else {
                    await sock.sendMessage(chatId, { text: `✅ Group JID: ${chatId}` }, { quoted: message });
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autotyping'):
                await autotypingCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.autoread'):
                await autoreadCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.heart'):
                await handleHeart(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.horny'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['horny', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.circle'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['circle', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.lgbt'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lgbt', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.lolice'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['lolice', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.simpcard'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['simpcard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tonikawa'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tonikawa', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.its-so-stupid'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['its-so-stupid', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.namecard'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['namecard', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.oogway2') || userMessage.startsWith('.oogway'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = userMessage.startsWith('.oogway2') ? 'oogway2' : 'oogway';
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.tweet'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['tweet', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.ytcomment'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = ['youtube-comment', ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.comrade') || userMessage.startsWith('.gay') || userMessage.startsWith('.glass') || userMessage.startsWith('.jail') || userMessage.startsWith('.passed') || userMessage.startsWith('.triggered'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const sub = userMessage.slice(1).split(/\s+/)[0];
                    const args = [sub, ...parts.slice(1)];
                    await miscCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.animu'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await animeCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage === '.payment' || userMessage === '.pay':
                await paymentCommand(sock, chatId, message);
                commandExecuted = true;
                break;
                
            case userMessage.startsWith('.setpayment'):
                {
                    const args = rawText.split(' ').slice(1); // Use rawText to keep your line breaks and emojis!
                    await setPaymentCommand(sock, chatId, message, args, isOwnerOrSudoCheck);
                }
                commandExecuted = true;
                break;

            // AI Image/Logo Generator
            case userMessage.startsWith('.design') || userMessage.startsWith('.imagine'):
                {
                    // Use rawText to capture exactly what the user typed (preserves line breaks/emojis for the AI)
                    const args = rawText.split(' ').slice(1);
                    await designCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.nom') || userMessage.startsWith('.poke') || userMessage.startsWith('.cry') || userMessage.startsWith('.kiss') || userMessage.startsWith('.pat') || userMessage.startsWith('.hug') || userMessage.startsWith('.wink') || userMessage.startsWith('.facepalm') || userMessage.startsWith('.face-palm') || userMessage.startsWith('.animuquote') || userMessage.startsWith('.quote') || userMessage.startsWith('.loli'):
                {
                    const parts = userMessage.trim().split(/\s+/);
                    let sub = parts[0].slice(1);
                    if (sub === 'facepalm') sub = 'face-palm';
                    if (sub === 'quote' || sub === 'animuquote') sub = 'quote';
                    await animeCommand(sock, chatId, message, [sub]);
                }
                commandExecuted = true;
                break;
            case userMessage === '.crop':
                await stickercropCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            case userMessage.startsWith('.pies'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const args = parts.slice(1);
                    await piesCommand(sock, chatId, message, args);
                }
                commandExecuted = true;
                break;
            case userMessage === '.china':
                await piesAlias(sock, chatId, message, 'china');
                commandExecuted = true;
                break;
            case userMessage === '.indonesia':
                await piesAlias(sock, chatId, message, 'indonesia');
                commandExecuted = true;
                break;
            case userMessage === '.japan':
                await piesAlias(sock, chatId, message, 'japan');
                commandExecuted = true;
                break;
            case userMessage === '.korea':
                await piesAlias(sock, chatId, message, 'korea');
                commandExecuted = true;
                break;
            case userMessage === '.india':
                await piesAlias(sock, chatId, message, 'india');
                commandExecuted = true;
                break;
            case userMessage === '.malaysia':
                await piesAlias(sock, chatId, message, 'malaysia');
                commandExecuted = true;
                break;
            case userMessage === '.thailand':
                await piesAlias(sock, chatId, message, 'thailand');
                commandExecuted = true;
                break;
            case userMessage.startsWith('.update'):
                {
                    const parts = rawText.trim().split(/\s+/);
                    const zipArg = parts[1] && parts[1].startsWith('http') ? parts[1] : '';
                    await updateCommand(sock, chatId, message, zipArg);
                }
                commandExecuted = true;
                break;
            case userMessage.startsWith('.removebg') || userMessage.startsWith('.rmbg') || userMessage.startsWith('.nobg'):
                await removebgCommand.exec(sock, message, userMessage.split(' ').slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.remini') || userMessage.startsWith('.enhance') || userMessage.startsWith('.upscale'):
                await reminiCommand(sock, chatId, message, userMessage.split(' ').slice(1));
                commandExecuted = true;
                break;
            case userMessage.startsWith('.sora'):
                await soraCommand(sock, chatId, message);
                commandExecuted = true;
                break;
            default:
                commandExecuted = await menuCompatCommand(sock, chatId, message, userMessage, {
                    isGroup,
                    isSenderAdmin,
                    isOwnerOrSudoCheck,
                    isBotAdmin,
                    senderId
                });
                if (!commandExecuted && isGroup) {
                    if (userMessage) {
                        await handleChatbotResponse(sock, chatId, message, userMessage, senderId).catch(()=>null);
                    }
                    await handleTagDetection(sock, chatId, message, senderId).catch(()=>null);
                    await handleMentionDetection(sock, chatId, message).catch(()=>null);
                }
                break;
        }

        global.lastCommandLatencyMs = Date.now() - commandStartedAt;
        if (commandExecuted) {
            await showTypingAfterCommand(sock, chatId).catch(()=>null);
        }

        if (userMessage.startsWith('.')) {
            if (typeof addCommandReaction === 'function') {
                await addCommandReaction(sock, message).catch(()=>null);
            }
        }

    } catch (error) {
        console.error('❌ Critical Error in handleMessages:', error.message);
    }
} 
// ==========================================
// END OF handleMessages
// ==========================================

// ==========================================
// 6. GROUP PARTICIPANT HANDLER
// ==========================================
async function handleGroupParticipantUpdate(sock, update) {
    try {
        const { id, participants, action, author } = update;

        if (!id.endsWith('@g.us')) return;

        let isPublic = true;
        try {
            isPublic = loadBotMode().isPublic;
        } catch (e) { }

        if (action === 'promote') {
            if (!isPublic || !isPromotionNotificationsEnabled(id)) return;
            if (typeof handlePromotionEvent === 'function') await handlePromotionEvent(sock, id, participants, author).catch(()=>null);
            return;
        }

        if (action === 'demote') {
            await handleAntiDemote(sock, id, participants, author).catch(() => null);
            if (!isPublic || !isPromotionNotificationsEnabled(id)) return;
            if (typeof handleDemotionEvent === 'function') await handleDemotionEvent(sock, id, participants, author).catch(()=>null);
            return;
        }

        if (action === 'add') {
            const antifakeState = global.antifakeState || {};
            if (antifakeState[id] === 'on') {
                const bannedPrefixes = ['212', '91', '92', '48']; 
                
                for (let user of participants) {
                    const isFake = bannedPrefixes.some(prefix => user.startsWith(prefix));
                    
                    if (isFake) {
                        try {
                            await sock.sendMessage(id, { 
                                text: `🌍 *Anti-Fake Alert*\n\nAuto-removing number from restricted region: @${user.split('@')[0]}`, 
                                mentions: [user] 
                            });
                            await sock.groupParticipantsUpdate(id, [user], "remove");
                            return; 
                        } catch (err) {
                            console.error("Failed to kick fake number:", err);
                        }
                    }
                }
            }

            if (typeof handleJoinEvent === 'function') await handleJoinEvent(sock, id, participants).catch(()=>null);
            if (isGroupAlertEnabled(id)) {
                const mentions = participants.map((participant) => typeof participant === 'string' ? participant : participant.id).filter(Boolean);
                await sock.sendMessage(id, { text: `📣 Group alert: ${mentions.map((jid) => `@${jid.split('@')[0]}`).join(', ')} joined the group.`, mentions }).catch(()=>null);
            }
        }

        if (action === 'remove') {
            if (typeof handleLeaveEvent === 'function') await handleLeaveEvent(sock, id, participants).catch(()=>null);
            if (isGroupAlertEnabled(id)) {
                const mentions = participants.map((participant) => typeof participant === 'string' ? participant : participant.id).filter(Boolean);
                await sock.sendMessage(id, { text: `📣 Group alert: ${mentions.map((jid) => `@${jid.split('@')[0]}`).join(', ')} left the group.`, mentions }).catch(()=>null);
            }
        }
    } catch (error) {
        console.error('Error in handleGroupParticipantUpdate:', error);
    }
}

// ==========================================
// 7. EXPORTS
// ==========================================
module.exports = {
    handleMessages,
    handleGroupParticipantUpdate,
    handleStatus: async (sock, status) => {
        if (typeof handleStatusUpdate === 'function') {
            await handleStatusUpdate(sock, status).catch(()=>null);
        }
    }
};
