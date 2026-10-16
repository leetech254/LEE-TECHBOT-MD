'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { URL } = require('url');
const { normalizeWhatsAppNumber } = require('./phone');

const PAGE_PATH = path.join(__dirname, '..', 'public', 'host-pairing.html');
const MAX_BODY_BYTES = 4096;
const HOST_PAGE = fs.readFileSync(PAGE_PATH);

function sendJson(res, status, body) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer'
    });
    res.end(JSON.stringify(body));
}

function readJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        let tooLarge = false;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                if (!tooLarge) reject(Object.assign(new Error('Request is too large.'), { statusCode: 413 }));
                tooLarge = true;
                return;
            }
            if (!tooLarge) body += chunk.toString('utf8');
        });
        req.on('end', () => {
            if (tooLarge) return;
            if (!body) return resolve({});
            try { resolve(JSON.parse(body)); }
            catch { reject(Object.assign(new Error('Send valid JSON.'), { statusCode: 400 })); }
        });
        req.on('error', reject);
    });
}

function safeTokenMatch(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createHostPairingServer({ token, getRuntime, onMode, requestPairingCode }) {
    if (typeof token !== 'string' || token.length < 24) {
        throw new Error('Host pairing access token must be at least 24 characters.');
    }
    if (typeof getRuntime !== 'function' || typeof onMode !== 'function' || typeof requestPairingCode !== 'function') {
        throw new Error('Host pairing server callbacks are required.');
    }

    let mode = null;
    let codeRequestInFlight = false;
    let codeRequests = 0;
    let latestCode = '';
    let latestCodeExpiresAt = 0;
    let cachedQr = '';
    let cachedQrDataUrl = '';

    const server = require('http').createServer(async (req, res) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost');
        const pathname = requestUrl.pathname.replace(/\/+$/, '') || '/';

        if (req.method === 'GET' && ['/', '/pairing'].includes(pathname)) {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, max-age=0',
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'DENY',
                'Referrer-Policy': 'no-referrer',
                'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'"
            });
            res.end(HOST_PAGE);
            return;
        }

        if (req.method === 'GET' && pathname === '/health') {
            sendJson(res, 200, { ok: true, service: 'LEE TECHBOT host pairing' });
            return;
        }

        if (!pathname.startsWith('/api/pairing/')) {
            sendJson(res, 404, { ok: false, error: 'Not found.' });
            return;
        }

        const authorization = String(req.headers.authorization || '');
        const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        if (!safeTokenMatch(suppliedToken, token)) {
            sendJson(res, 401, { ok: false, error: 'Enter the host pairing access key from your bot host settings/logs.' });
            return;
        }

        if (req.method === 'GET' && pathname === '/api/pairing/status') {
            const runtime = getRuntime() || {};
            let qrDataUrl = '';
            if (mode === 'qr' && runtime.qr && !runtime.connected) {
                if (cachedQr !== runtime.qr) {
                    cachedQr = runtime.qr;
                    cachedQrDataUrl = await QRCode.toDataURL(runtime.qr, {
                        width: 320,
                        margin: 1,
                        errorCorrectionLevel: 'M',
                        color: { dark: '#0b1724', light: '#ffffff' }
                    });
                }
                qrDataUrl = cachedQrDataUrl;
            }
            sendJson(res, 200, {
                ok: true,
                mode,
                connection: String(runtime.connection || 'starting'),
                ready: Boolean(runtime.ready),
                connected: Boolean(runtime.connected),
                registered: Boolean(runtime.registered),
                error: String(runtime.error || '').slice(0, 240),
                code: mode === 'code' && !runtime.connected && !runtime.registered && Date.now() < latestCodeExpiresAt ? latestCode : '',
                codeExpiresAt: latestCodeExpiresAt,
                qr: qrDataUrl
            });
            return;
        }

        if (req.method === 'POST' && pathname === '/api/pairing/mode') {
            try {
                const body = await readJson(req);
                if (!['code', 'qr'].includes(body.mode)) {
                    sendJson(res, 400, { ok: false, error: 'Choose pairing-code or QR mode.' });
                    return;
                }
                const runtime = getRuntime() || {};
                if (runtime.connected || runtime.registered) {
                    sendJson(res, 409, { ok: false, error: 'This bot is already linked. Its session is saved on this host.' });
                    return;
                }
                if (mode !== body.mode) { latestCode = ''; latestCodeExpiresAt = 0; }
                mode = body.mode;
                await onMode(mode);
                sendJson(res, 200, { ok: true, mode });
            } catch (error) {
                sendJson(res, error.statusCode || 500, { ok: false, error: error.statusCode ? error.message : 'Could not start that pairing method. Check the bot host logs.' });
            }
            return;
        }

        if (req.method === 'POST' && pathname === '/api/pairing/code') {
            try {
                if (mode !== 'code') {
                    sendJson(res, 409, { ok: false, error: 'Select pairing-code mode first.' });
                    return;
                }
                const body = await readJson(req);
                const phone = normalizeWhatsAppNumber(body.number);
                if (!phone) {
                    sendJson(res, 400, { ok: false, error: 'Enter 10–15 digits including the country code.' });
                    return;
                }
                const runtime = getRuntime() || {};
                if (!runtime.ready || runtime.connected || runtime.registered) {
                    sendJson(res, 409, { ok: false, error: runtime.connected || runtime.registered ? 'This bot is already linked.' : 'The WhatsApp connection is not ready yet. Wait a few seconds and try again.' });
                    return;
                }
                if (latestCode && Date.now() < latestCodeExpiresAt) {
                    sendJson(res, 200, { ok: true, code: latestCode, expiresInSeconds: Math.max(0, Math.ceil((latestCodeExpiresAt - Date.now()) / 1000)) });
                    return;
                }
                if (codeRequestInFlight) {
                    sendJson(res, 429, { ok: false, error: 'A pairing-code request is already in progress.' });
                    return;
                }
                if (codeRequests >= 4) {
                    sendJson(res, 429, { ok: false, error: 'Too many attempts. Restart the bot before requesting another code.' });
                    return;
                }
                codeRequestInFlight = true;
                codeRequests += 1;
                const code = String(await requestPairingCode(phone));
                latestCode = code;
                latestCodeExpiresAt = Date.now() + 60_000;
                sendJson(res, 200, { ok: true, code, expiresInSeconds: 60 });
            } catch (error) {
                const status = error.statusCode === 400 ? 400 : error.statusCode === 429 ? 429 : 502;
                sendJson(res, status, {
                    ok: false,
                    error: status === 400
                        ? 'WhatsApp rejected the pairing request. Try QR mode or retry later.'
                        : status === 429
                            ? 'A pairing-code request is already in progress.'
                            : 'WhatsApp did not confirm the pairing request. Try QR mode or check the bot host logs.'
                });
            } finally {
                codeRequestInFlight = false;
            }
            return;
        }

        sendJson(res, 404, { ok: false, error: 'Not found.' });
    });

    return { server, getMode: () => mode };
}

module.exports = { createHostPairingServer, safeTokenMatch };
