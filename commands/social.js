'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const settings = require('../settings');

const DEFAULT_API = 'https://api.vreden.my.id/api/download';
const SUPPORTED_HOSTS = new Set([
    'x.com', 'twitter.com', 't.co', 'reddit.com', 'redd.it', 'pinterest.com',
    'pin.it', 'threads.net', 'snapchat.com'
]);

async function retryRequest(request, attempts = 2) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try { return await request(); } catch (error) {
            lastError = error;
            if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 750));
        }
    }
    throw lastError;
}

function extractUrl(text = '') {
    return String(text).match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.!?]+$/, '') || '';
}

function isSupportedSocialUrl(url) {
    try {
        const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
        return [...SUPPORTED_HOSTS].some(domain => host === domain || host.endsWith(`.${domain}`));
    } catch { return false; }
}

function collectMedia(value, output = [], seen = new Set()) {
    if (!value || output.length >= 20) return output;
    if (typeof value === 'string') {
        if (/^https?:\/\//i.test(value) && /\.(mp4|m3u8|webm|mov|jpg|jpeg|png|gif|webp|mp3|m4a)(?:[?#].*)?$/i.test(value)) {
            if (!seen.has(value)) { seen.add(value); output.push({ url: value }); }
        }
        return output;
    }
    if (Array.isArray(value)) { value.forEach(item => collectMedia(item, output, seen)); return output; }
    if (typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
            if (/url|download|media|video|image|thumbnail|audio|hd|sd/i.test(key)) collectMedia(item, output, seen);
            else if (item && typeof item === 'object') collectMedia(item, output, seen);
        }
    }
    return output;
}

async function socialCommand(sock, chatId, message) {
    let tempFiles = [];
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const url = extractUrl(text);
        if (!url || !isSupportedSocialUrl(url)) {
            return sock.sendMessage(chatId, { text: '❌ Supported public links: X/Twitter, Reddit, Pinterest, Threads, and Snapchat.' }, { quoted: message });
        }
        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } }).catch(() => {});
        const apiBase = String(process.env.SOCIAL_DOWNLOAD_API_URL || settings.socialDownloadApiUrl || DEFAULT_API).trim();
        const response = await retryRequest(() => axios.get(apiBase, { params: { url }, timeout: 30000, maxContentLength: 2 * 1024 * 1024 }));
        const media = collectMedia(response.data);
        if (!media.length) throw new Error('The provider returned no public media');
        const tmpDir = require('../lib/runtime').TMP_DIR;
        fs.mkdirSync(tmpDir, { recursive: true });
        for (const item of media.slice(0, 10)) {
            const mediaResponse = await retryRequest(() => axios.get(item.url, {
                responseType: 'arraybuffer', timeout: 60000,
                maxContentLength: 100 * 1024 * 1024,
                validateStatus: status => status >= 200 && status < 400
            }));
            const contentType = String(mediaResponse.headers['content-type'] || '').toLowerCase();
            if (!mediaResponse.data?.length || contentType.includes('text/html')) throw new Error('Provider returned invalid media');
            const isVideo = contentType.includes('video') || /\.(mp4|webm|mov)(?:[?#].*)?$/i.test(item.url);
            const isAudio = contentType.includes('audio') || /\.(mp3|m4a)(?:[?#].*)?$/i.test(item.url);
            const extension = isVideo ? 'mp4' : isAudio ? 'mp3' : 'jpg';
            const tempPath = path.join(tmpDir, `social_${Date.now()}_${tempFiles.length}.${extension}`);
            fs.writeFileSync(tempPath, mediaResponse.data);
            tempFiles.push(tempPath);
            const payload = isVideo
                ? { video: { url: tempPath }, mimetype: contentType || 'video/mp4' }
                : isAudio
                    ? { audio: { url: tempPath }, mimetype: contentType || 'audio/mpeg' }
                    : { image: { url: tempPath }, mimetype: contentType || 'image/jpeg' };
            await sock.sendMessage(chatId, { ...payload, caption: `𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 ${settings.botName || 'LEE TECH BOT'}` }, { quoted: message });
        }
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } }).catch(() => {});
    } catch (error) {
        console.error('[social] download failed:', error.message || error);
        await sock.sendMessage(chatId, { text: '❌ Download failed. The post may be private, expired, unsupported, or temporarily unavailable.' }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } }).catch(() => {});
    } finally {
        for (const file of tempFiles) { try { fs.unlinkSync(file); } catch {} }
    }
}

module.exports = socialCommand;
module.exports.isSupportedSocialUrl = isSupportedSocialUrl;
module.exports.collectMedia = collectMedia;
