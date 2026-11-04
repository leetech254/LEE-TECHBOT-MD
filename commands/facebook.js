'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const settings = require('../settings');

function extractUrl(text = '') {
    return text.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.!?]+$/, '') || '';
}

function cleanUrl(value) {
    if (!value || typeof value !== 'string') return '';
    let result = value.replace(/\\\//g, '/').replace(/\\u0025/g, '%').replace(/\\u003A/gi, ':').replace(/\\u002F/gi, '/');
    try { result = JSON.parse(`"${result.replace(/"/g, '\\"')}"`); } catch {}
    return result.replace(/&amp;/g, '&');
}

function findPlayableUrl(payload) {
    if (!payload) return '';
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const patterns = [
        /playable_url_quality_hd(?:\\?":|":)"([^"\n]+)"/i,
        /browser_native_hd_url(?:\\?":|":)"([^"\n]+)"/i,
        /playable_url(?:\\?":|":)"([^"\n]+)"/i,
        /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        const candidate = cleanUrl(match?.[1]);
        if (/^https?:\/\//i.test(candidate)) return candidate;
    }
    return '';
}

async function directFacebookVideoUrl(url) {
    const response = await axios.get(url, {
        timeout: 20000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml'
        }
    });
    return findPlayableUrl(response.data);
}

async function apiFacebookVideoUrl(url) {
    const apiUrl = `https://api.vreden.my.id/api/facebook?url=${encodeURIComponent(url)}`;
    const response = await axios.get(apiUrl, { timeout: 15000 });
    const result = response.data?.result;
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) {
        return result.find((item) => item?.url)?.url || result.find((item) => typeof item === 'string') || '';
    }
    return result?.hd || result?.HD || result?.High_Resolution || result?.sd || result?.SD || result?.video || result?.url || findPlayableUrl(response.data);
}

async function facebookCommand(sock, chatId, message) {
    let tempPath = null;
    try {
        const text = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        const url = extractUrl(text);
        if (!url || !/facebook\.com|fb\.watch/i.test(url)) {
            return sock.sendMessage(chatId, { text: '📝 *Usage:* .fb <public Facebook video or reel link>' }, { quoted: message });
        }

        await sock.sendMessage(chatId, { react: { text: '🔄', key: message.key } });
        let videoUrl = '';
        try { videoUrl = await directFacebookVideoUrl(url); } catch (error) { console.warn('[facebook] direct extraction failed:', error.message); }
        if (!videoUrl) {
            try { videoUrl = await apiFacebookVideoUrl(url); } catch (error) { console.warn('[facebook] API fallback failed:', error.message); }
        }
        if (!/^https?:\/\//i.test(videoUrl)) throw new Error('No public playable Facebook video was found');

        const tmpDir = require('../lib/runtime').TMP_DIR;
        fs.mkdirSync(tmpDir, { recursive: true });
        tempPath = path.join(tmpDir, `fb_${Date.now()}.mp4`);
        const writer = fs.createWriteStream(tempPath);
        const response = await axios.get(videoUrl, {
            responseType: 'stream', timeout: 60000,
            headers: { 'User-Agent': 'Mozilla/5.0 Chrome/124 Safari/537.36', Referer: 'https://www.facebook.com/' }
        });
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.once('finish', resolve);
            writer.once('error', reject);
            response.data.once('error', reject);
        });
        const stats = fs.statSync(tempPath);
        if (stats.size < 2048) throw new Error('Facebook returned an empty or blocked media file');

        await sock.sendMessage(chatId, {
            video: { url: tempPath },
            mimetype: 'video/mp4',
            fileName: `facebook_${Date.now()}.mp4`,
            caption: `𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗗 𝗕𝗬 ${settings.botName || 'LEE TECH BOT'}\n\n⚖️ Size: ${(stats.size / 1048576).toFixed(2)} MB`
        }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '✅', key: message.key } });
    } catch (error) {
        console.error('[facebook] download failed:', error.message || error);
        await sock.sendMessage(chatId, { text: '❌ Facebook download failed. Only public videos/reels are supported; private, login-only, or region-blocked links cannot be downloaded.' }, { quoted: message });
        await sock.sendMessage(chatId, { react: { text: '❌', key: message.key } }).catch(() => {});
    } finally {
        if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
}

module.exports = facebookCommand;
module.exports.extractUrl = extractUrl;
module.exports.findPlayableUrl = findPlayableUrl;
