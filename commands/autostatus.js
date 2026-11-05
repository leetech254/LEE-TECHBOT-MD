const fs = require('fs').promises;
const { existsSync, writeFileSync } = require('fs');
const path = require('path');
const isOwnerOrSudo = require('../lib/isOwner');
const { DATA_DIR } = require('../lib/runtime');

const channelInfo = {
    contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363404186001130@newsletter',
            newsletterName: 'LEE TECHBot MD',
            serverMessageId: -1
        }
    }
};

const configPath = path.join(DATA_DIR, 'autoStatus.json');
const processedStatuses = new Set(); // Prevents duplicate processing in the same session

// Synchronous check only on startup
if (!existsSync(configPath)) {
    const dir = path.dirname(configPath);
    if (!existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
    writeFileSync(configPath, JSON.stringify({ 
        enabled: false, 
        reactOn: false,
        emoji: 'random' 
    }));
}

async function autoStatusCommand(sock, chatId, msg, args) {
    try {
        const senderId = msg.key.participant || msg.key.remoteJid;
        const isOwner = await isOwnerOrSudo(senderId, sock, chatId);
        
        if (!msg.key.fromMe && !isOwner) {
            return await sock.sendMessage(chatId, { text: '❌ This command can only be used by the owner!', ...channelInfo });
        }

        let data = await fs.readFile(configPath, 'utf-8');
        let config = JSON.parse(data);

        if (!args || args.length === 0) {
            const status = config.enabled ? 'ON ✅' : 'OFF ❌';
            const reactStatus = config.reactOn ? 'ON ✅' : 'OFF ❌';
            const currentEmoji = config.emoji === 'random' ? 'Random 🎲' : config.emoji;
            
            return await sock.sendMessage(chatId, { 
                text: `🔄 *AUTO STATUS SETTINGS*\n\n👀 *Auto View:* ${status}\n💫 *Auto React:* ${reactStatus}\n🎭 *Reaction Emoji:* ${currentEmoji}\n\n*Commands:*\n➤ .autostatus on/off\n➤ .autostatus react on/off\n➤ .autostatus emoji <emoji/random>`,
                ...channelInfo
            });
        }

        const command = args[0].toLowerCase();
        let message = '';

        switch (command) {
            case 'on':
                config.enabled = true;
                message = '✅ *Auto-View Enabled!*';
                break;
            case 'off':
                config.enabled = false;
                message = '❌ *Auto-View Disabled!*';
                break;
            case 'react':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Use: *.autostatus react on/off*', ...channelInfo });
                config.reactOn = args[1].toLowerCase() === 'on';
                message = config.reactOn ? '💫 *Auto-React Enabled!*' : '❌ *Auto-React Disabled!*';
                break;
            case 'emoji':
                if (!args[1]) return await sock.sendMessage(chatId, { text: '❌ Provide an emoji or "random"', ...channelInfo });
                config.emoji = args[1].toLowerCase() === 'random' ? 'random' : args[1];
                message = `🎭 *Emoji Updated to:* ${config.emoji === 'random' ? 'Random 🎲' : config.emoji}`;
                break;
            default:
                return await sock.sendMessage(chatId, { text: '❌ Invalid command!', ...channelInfo });
        }

        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        await sock.sendMessage(chatId, { text: message, ...channelInfo });

    } catch (error) {
        console.error('Error in autostatus command:', error);
    }
}

async function reactToStatus(sock, statusKey, emoji) {
    try {
        const sender = statusKey.participant || statusKey.remoteJid;
        await sock.sendMessage(sender, {
            react: { text: emoji, key: statusKey }
        });
    } catch (err) {
        // Silent catch to prevent console spamming on expired statuses
    }
}

async function handleStatusUpdate(sock, status) {
    try {
        const data = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(data);

        if (!config.enabled && !config.reactOn) return;

        let messages = status.messages || (status.key ? [status] : []);
        const randomEmojis = ['💚', '🔥', '😂', '😍', '👍', '💯', '✨', '🎉', '🙌', '😎', '❤️', '🥰', '🙏'];

        for (const msg of messages) {
            const key = msg.key;
            if (!key || key.remoteJid !== 'status@broadcast') continue;
            
            // Avoid re-processing the same message ID
            if (processedStatuses.has(key.id)) continue;
            processedStatuses.add(key.id);

            // Small delay to appear more "human" and let media load
            await new Promise(r => setTimeout(r, 2000));

            // Auto View
            if (config.enabled) {
                try {
                    await sock.readMessages([key]);
                } catch (e) {
                    if (e.message.includes('rate-overlimit')) await new Promise(r => setTimeout(r, 5000));
                }
            }

            // Auto React
            if (config.reactOn) {
                const emoji = config.emoji === 'random' 
                    ? randomEmojis[Math.floor(Math.random() * randomEmojis.length)] 
                    : config.emoji;
                await reactToStatus(sock, key, emoji);
            }

            // Spacing out requests to avoid banning
            await new Promise(r => setTimeout(r, 1000));
            
            // Keep memory clean (limit Set size)
            if (processedStatuses.size > 100) {
                const firstItem = processedStatuses.values().next().value;
                processedStatuses.delete(firstItem);
            }
        }
    } catch (error) {
        console.error('❌ Status Error:', error.message);
    }
}

module.exports = {
    autoStatusCommand,
    handleStatusUpdate
};
