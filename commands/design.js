'use strict';

const axios = require('axios');

const DEFAULT_IMAGE_URL = 'https://image.pollinations.ai/prompt/{prompt}';
const configuredTimeout = Number(process.env.IMAGE_GENERATION_TIMEOUT_MS || 90_000);
const IMAGE_TIMEOUT_MS = Number.isFinite(configuredTimeout)
    ? Math.max(10_000, Math.min(configuredTimeout, 180_000))
    : 90_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function detectImageMime(buffer) {
    if (!Buffer.isBuffer(buffer)) return null;
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif';
    return null;
}

function buildImagePrompt(input, forcedMode = '') {
    let prompt = String(input || '').trim();
    let mode = forcedMode;
    const modeMatch = prompt.match(/^(logo|image|art)\s*[:,\-]?\s*/i);
    if (!mode && modeMatch) mode = modeMatch[1].toLowerCase();
    if (modeMatch) prompt = prompt.slice(modeMatch[0].length).trim();
    if (!mode && /\b(logo|emblem|brand mark)\b/i.test(prompt)) mode = 'logo';
    if (prompt.length > 700) prompt = prompt.slice(0, 700).trim();
    if (!prompt) return { prompt: '', mode: mode || 'image' };

    const enhanced = mode === 'logo'
        ? `Create a polished brand logo based on this brief: ${prompt}. Use a distinctive, clean vector-inspired mark, balanced typography, a centered composition, strong legibility at small sizes, and a restrained professional color palette. Show the logo artwork only, not a mockup, scene, watermark, or extra text.`
        : `Create a high-quality original image based on this brief: ${prompt}. Use a clear focal point, thoughtful composition, refined lighting, and crisp detail. Do not add a watermark or unrelated text.`;
    return { prompt: enhanced, mode: mode === 'logo' ? 'logo' : 'image' };
}

function buildImageUrl(prompt) {
    const template = String(process.env.IMAGE_GENERATION_URL || DEFAULT_IMAGE_URL).trim();
    if (!template.includes('{prompt}')) {
        throw new Error('IMAGE_GENERATION_URL must be an HTTPS URL template containing {prompt}.');
    }
    const url = template.replaceAll('{prompt}', encodeURIComponent(prompt));
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('Image generation requires an HTTPS provider URL.');
    return parsed.toString();
}

function providerError(error) {
    const status = Number(error?.response?.status || 0);
    if (status === 401 || status === 403) return 'The configured image provider rejected its credentials. Check IMAGE_GENERATION_API_KEY.';
    if (status === 429) return 'The image provider is rate-limiting requests. Wait a little and try again.';
    if (status >= 500) return `The image provider is temporarily unavailable (HTTP ${status}). Try again later.`;
    if (error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT') return 'Image generation timed out. Try a shorter prompt or retry later.';
    if (status >= 400) return `The image provider rejected the request (HTTP ${status}). Check the prompt or provider configuration.`;
    if (/IMAGE_GENERATION_URL|HTTPS provider/i.test(String(error?.message || ''))) return error.message;
    return 'The image provider did not return a valid image. Check outbound HTTPS access or configure another image endpoint.';
}

async function generateImage(prompt) {
    const url = buildImageUrl(prompt);
    const headers = { Accept: 'image/png,image/jpeg,image/webp,image/gif' };
    const apiKey = String(process.env.IMAGE_GENERATION_API_KEY || '').trim();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: IMAGE_TIMEOUT_MS,
        maxContentLength: MAX_IMAGE_BYTES,
        maxBodyLength: MAX_IMAGE_BYTES,
        headers
    });
    const buffer = Buffer.from(response.data || []);
    if (buffer.length > MAX_IMAGE_BYTES) throw new Error('Generated image exceeded the 12 MB upload limit.');
    const mimetype = detectImageMime(buffer);
    if (!mimetype) throw new Error('Image provider returned non-image or invalid data.');
    return { buffer, mimetype };
}

async function designCommand(sock, chatId, message, args = []) {
    const rawInput = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();
    const { prompt, mode } = buildImagePrompt(rawInput);
    if (!prompt) {
        await sock.sendMessage(chatId, {
            text: '🎨 *LEE TECH Image & Logo Maker*\n\nUse `.create <image description>` or `.create logo <brand and style>`.\nAliases: `.design`, `.imagine`, `.flux`, `.dalle`, `.logo`, `.firelogo`.\n\nExample: `.create logo a modern blue-and-silver logo for a tech company named LEE TECH`'
        }, { quoted: message });
        return true;
    }

    await sock.sendMessage(chatId, {
        text: `🎨 ${mode === 'logo' ? 'Creating your logo' : 'Creating your image'}…\nThis may take up to 90 seconds.`
    }, { quoted: message });

    try {
        const { buffer, mimetype } = await generateImage(prompt);
        await sock.sendMessage(chatId, {
            image: buffer,
            mimetype,
            caption: `${mode === 'logo' ? '✅ Logo' : '✅ Image'} generated.\nPrompt: ${rawInput}`
        }, { quoted: message });
        return true;
    } catch (error) {
        console.error(`[image-create] ${error?.message || error}`);
        await sock.sendMessage(chatId, {
            text: `❌ ${providerError(error)}\n\nTry .create <shorter prompt> or .create logo <brand brief>.`
        }, { quoted: message });
        return true;
    }
}

module.exports = {
    designCommand,
    buildImagePrompt,
    buildImageUrl,
    detectImageMime,
    generateImage,
    providerError,
    DEFAULT_IMAGE_URL,
    MAX_IMAGE_BYTES
};
