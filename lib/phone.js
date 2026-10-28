'use strict';

const { parsePhoneNumberFromString } = require('libphonenumber-js');

const DIGIT_BLOCKS = [
    [0x0660, 0x0669], [0x06F0, 0x06F9], [0x0966, 0x096F], [0x09E6, 0x09EF],
    [0x0A66, 0x0A6F], [0x0AE6, 0x0AEF], [0x0B66, 0x0B6F], [0x0BE6, 0x0BEF],
    [0x0C66, 0x0C6F], [0x0CE6, 0x0CEF], [0x0D66, 0x0D6F], [0x0E50, 0x0E59],
    [0x0ED0, 0x0ED9], [0x0F20, 0x0F29], [0x1040, 0x1049], [0x17E0, 0x17E9],
    [0xFF10, 0xFF19]
];

function toAsciiDigits(value) {
    return Array.from(String(value ?? ''), character => {
        const codePoint = character.codePointAt(0);
        for (const [start, end] of DIGIT_BLOCKS) {
            if (codePoint >= start && codePoint <= end) return String(codePoint - start);
        }
        return character;
    }).join('');
}

function normalizeWhatsAppNumber(value) {
    let raw = toAsciiDigits(value).trim();
    if (!raw) return '';
    raw = raw.replace(/[\u00A0\u2000-\u200B]/g, '');
    let digits = raw.replace(/[^0-9]/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (!/^[1-9][0-9]{7,14}$/.test(digits)) return '';

    // Parse as an international number when metadata recognizes its country.
    // isPossible() intentionally allows valid ranges that are not yet active
    // in metadata, which is safer for WhatsApp's global numbering coverage.
    const parsed = parsePhoneNumberFromString(`+${digits}`);
    if (parsed && !parsed.isPossible()) return '';
    if (parsed?.number) return parsed.number.slice(1);

    // Keep a conservative E.164 fallback for non-geographic or newly assigned
    // ranges that WhatsApp accepts before phone metadata catches up.
    return digits;
}

module.exports = { normalizeWhatsAppNumber, toAsciiDigits };
