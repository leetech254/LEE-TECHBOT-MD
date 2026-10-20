'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const PROVIDER_COMMANDS = new Set([
    'addpdf', 'brat', 'carbon', 'catbox', 'clearpdf', 'ephoto', 'ephotolist',
    'fakechannel', 'fakedana', 'fakeigstory', 'firelogo', 'fliptext', 'img2pdf',
    'img2txt', 'imgbb', 'ocr', 'pickupline', 'predict', 'qrscan', 'roast',
    'stickkill', 'story', 'tiktokstalk', 'tiny'
]);
const IMAGE_ALIASES = new Set(['brat', 'carbon', 'fakechannel', 'fakedana', 'fakeigstory', 'toanime']);
const MEDIA_OUTPUTS = {
    toaudio: { ext: 'mp3', args: ['-vn', '-codec:a', 'libmp3lame', '-q:a', '4'], type: 'audio', mimetype: 'audio/mpeg' },
    tomp3: { ext: 'mp3', args: ['-vn', '-codec:a', 'libmp3lame', '-q:a', '4'], type: 'audio', mimetype: 'audio/mpeg' },
    tovideo: { ext: 'mp4', args: ['-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart'], type: 'video', mimetype: 'video/mp4' },
    tovideonote: { ext: 'mp4', args: ['-c:v', 'libx264', '-c:a', 'aac', '-vf', 'crop=min(iw\,ih):min(iw\,ih)', '-movflags', '+faststart'], type: 'video', mimetype: 'video/mp4' },
    tovn: { ext: 'ogg', args: ['-vn', '-c:a', 'libopus', '-b:a', '96k'], type: 'audio', mimetype: 'audio/ogg; codecs=opus' },
    togif: { ext: 'gif', args: ['-vf', 'fps=12,scale=480:-1:flags=lanczos', '-loop', '0'], type: 'video', mimetype: 'image/gif' }
};

function reply(sock, chatId, message, text) {
    return sock.sendMessage(chatId, { text }, { quoted: message });
}

function quotedMessage(message) {
    return message?.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
}

function mediaType(quoted) {
    if (!quoted) return null;
    if (quoted.imageMessage) return 'image';
    if (quoted.videoMessage) return 'video';
    if (quoted.audioMessage) return 'audio';
    if (quoted.documentMessage) return 'document';
    return null;
}

async function downloadQuoted(quoted, type) {
    const payload = quoted[`${type}Message`] || quoted.documentMessage;
    const stream = await downloadContentFromMessage(payload, type === 'document' ? 'document' : type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

function runFfmpeg(input, output, args) {
    return new Promise((resolve, reject) => {
        const child = spawn('ffmpeg', ['-y', '-i', input, ...args, output], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        child.on('error', reject);
        child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-500) || `ffmpeg exited ${code}`)));
    });
}

async function mediaConvert(sock, chatId, message, command) {
    const spec = MEDIA_OUTPUTS[command];
    const quoted = quotedMessage(message);
    const type = mediaType(quoted);
    if (!spec || !type) {
        return reply(sock, chatId, message, `Reply to an image, video, or audio with .${command}.`);
    }
    const tempDir = path.join(process.cwd(), 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const input = path.join(tempDir, `legacy_${stamp}.input`);
    const output = path.join(tempDir, `legacy_${stamp}.${spec.ext}`);
    try {
        fs.writeFileSync(input, await downloadQuoted(quoted, type));
        await runFfmpeg(input, output, spec.args);
        const buffer = fs.readFileSync(output);
        const payload = spec.type === 'audio'
            ? { audio: buffer, mimetype: spec.mimetype, ptt: command === 'tovn' }
            : { video: buffer, mimetype: spec.mimetype, gifPlayback: command === 'togif', caption: `✅ ${command} conversion complete.` };
        await sock.sendMessage(chatId, payload, { quoted: message });
    } catch (error) {
        console.error(`[${command}]`, error.message || error);
        await reply(sock, chatId, message, `❌ ${command} conversion failed. The quoted media may be unsupported or too large.`);
    } finally {
        for (const file of [input, output]) { try { fs.unlinkSync(file); } catch (_) {} }
    }
}

const textResponses = {
    pickupline: ['Are you a keyboard? Because you are just my type.', 'You must be Wi-Fi, because I feel a connection.'],
    roast: ['You bring everyone so much joy… when you leave the chat.', 'Your confidence has better uptime than your logic.'],
    predict: ['Prediction: your next message will be more interesting than the last one.', 'The stars say success is loading; please keep going.'],
    story: ['Once upon a time, a small idea became a great project because someone finally started.'],
    stickkill: ['Reply to a sticker with .stickkill to remove it from the chat.'],
    fakechannel: ['Usage: .fakechannel <channel name> — this command needs a configured media provider.'],
    fakedana: ['Usage: .fakedana <amount> — this command needs a configured media provider.'],
    tiktokstalk: ['Usage: .tiktokstalk <username> — this command needs a configured public-profile provider.']
};

async function legacyCommand(sock, chatId, message, command, args = []) {
    if (MEDIA_OUTPUTS[command]) return mediaConvert(sock, chatId, message, command);
    if (command === 'toqr') {
        const value = args.join(' ').trim();
        if (!value) return reply(sock, chatId, message, 'Usage: .toqr <text or URL>');
        try {
            const png = await QRCode.toBuffer(value, { width: 640, margin: 2 });
            return sock.sendMessage(chatId, { image: png, caption: '✅ QR code generated.' }, { quoted: message });
        } catch (error) {
            return reply(sock, chatId, message, '❌ Could not generate the QR code.');
        }
    }
    if (command === 'firelogo') {
        const { designCommand } = require('./design');
        return designCommand(sock, chatId, message, ['logo', ...args]);
    }
    if (IMAGE_ALIASES.has(command)) {
        const prompt = args.join(' ').trim();
        if (!prompt) return reply(sock, chatId, message, `Usage: .${command} <prompt>`);
        const routed = command === 'toanime' ? `anime-style illustration of ${prompt}` : prompt;
        const { designCommand } = require('./design');
        return designCommand(sock, chatId, message, [routed]);
    }
    if (textResponses[command]) {
        const choices = textResponses[command];
        return reply(sock, chatId, message, choices[Math.floor(Math.random() * choices.length)]);
    }
    if (command === 'fliptext') {
        const value = args.join(' ').trim();
        return reply(sock, chatId, message, value ? value.split('').reverse().join('') : 'Usage: .fliptext <text>');
    }
    if (command === 'tiny') {
        const value = args.join(' ').trim();
        return reply(sock, chatId, message, value ? value.toLowerCase().replace(/[aeiou]/gi, '') : 'Usage: .tiny <text>');
    }
    if (command === 'ephoto' || command === 'ephotolist') {
        const textmakerCommand = require('./textmaker');
        return textmakerCommand(sock, chatId, message, `.${command} ${args.join(' ')}`, 'metallic');
    }
    if (PROVIDER_COMMANDS.has(command)) {
        return reply(sock, chatId, message, `⚠️ .${command} is routed, but requires a configured provider/API in this deployment.`);
    }
    return reply(sock, chatId, message, `⚠️ .${command} is recognized but has no implementation.`);
}

module.exports = { legacyCommand, mediaConvert, MEDIA_OUTPUTS, PROVIDER_COMMANDS };
