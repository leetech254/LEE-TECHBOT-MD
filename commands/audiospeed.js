'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const execFileAsync = promisify(execFile);

function quotedMessage(message) {
    return message?.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
}

async function audioSpeedCommand(sock, chatId, message) {
    const quoted = quotedMessage(message);
    const audio = quoted?.audioMessage || message?.message?.audioMessage;
    const value = message?.message?.conversation?.trim()?.split(/\s+/)?.[1];
    const speed = Number(value || 1.25);
    if (!audio) {
        await sock.sendMessage(chatId, { text: 'Reply to an audio/voice note. Usage: `.audiospeed 1.25` (range 0.5–2).' }, { quoted: message });
        return;
    }
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
        await sock.sendMessage(chatId, { text: 'Speed must be between 0.5 and 2. Example: `.audiospeed 1.5`.' }, { quoted: message });
        return;
    }
    const workDir = require('../lib/runtime').TMP_DIR;
    fs.mkdirSync(workDir, { recursive: true });
    const input = path.join(workDir, `speed-${Date.now()}-${Math.random().toString(16).slice(2)}.ogg`);
    const output = `${input}.mp3`;
    try {
        const stream = await downloadContentFromMessage(audio, 'audio');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        fs.writeFileSync(input, Buffer.concat(chunks));
        await execFileAsync('ffmpeg', ['-y', '-i', input, '-filter:a', `atempo=${speed}`, '-vn', '-codec:a', 'libmp3lame', '-q:a', '4', output]);
        await sock.sendMessage(chatId, { audio: fs.readFileSync(output), mimetype: 'audio/mpeg', ptt: Boolean(audio.ptt) }, { quoted: message });
    } catch (error) {
        console.error('[audiospeed]', error.message || error);
        await sock.sendMessage(chatId, { text: '❌ Could not process that audio. Make sure the media is still available.' }, { quoted: message });
    } finally {
        for (const file of [input, output]) { try { fs.unlinkSync(file); } catch (_) {} }
    }
}

module.exports = audioSpeedCommand;
