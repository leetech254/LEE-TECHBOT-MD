'use strict';

const QRCode = require('qrcode');
const { normalizeWhatsAppNumber } = require('./phone');

function resolveHostPairingMode(env = process.env) {
    const method = String(env.AUTH_METHOD || '').trim().toLowerCase();
    if (method === 'qr') return { mode: 'qr' };

    if (['pair', 'pairing', 'code'].includes(method)) {
        const suppliedNumber = env.PAIRING_NUMBER || env.PHONE_NUMBER || '';
        if (!String(suppliedNumber).trim()) return null;
        const phone = normalizeWhatsAppNumber(suppliedNumber);
        return phone ? { mode: 'pair', phone } : { mode: 'invalid' };
    }

    return null;
}

function resolveHostMenuChoice(choice) {
    switch (String(choice || '').trim()) {
        case '1': return 'bundle';
        case '2': return 'pair';
        case '3': return 'web';
        default: return null;
    }
}

function renderTerminalQr(value) {
    return QRCode.toString(value, { type: 'terminal', small: true });
}

module.exports = { resolveHostPairingMode, resolveHostMenuChoice, renderTerminalQr };
