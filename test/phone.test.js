'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeWhatsAppNumber } = require('../lib/phone');

test('normalizes supported international formats', () => {
    assert.equal(normalizeWhatsAppNumber('254781231617'), '254781231617');
    assert.equal(normalizeWhatsAppNumber('+254 781 231 617'), '254781231617');
    assert.equal(normalizeWhatsAppNumber('00254-781-231-617'), '254781231617');
    assert.equal(normalizeWhatsAppNumber('254 11 234 5678'), '254112345678');
    assert.equal(normalizeWhatsAppNumber('+1 (202) 555-0123'), '12025550123');
    assert.equal(normalizeWhatsAppNumber('+44 7911 123456'), '447911123456');
    assert.equal(normalizeWhatsAppNumber('+971 50 123 4567'), '971501234567');
    assert.equal(normalizeWhatsAppNumber('٠٠٩٧١ ٥٠ ١٢٣ ٤٥٦٧'), '971501234567');
    assert.equal(normalizeWhatsAppNumber('００８１ ９０ １２３４ ５６７８'), '819012345678');
});

test('rejects empty, local-only, and partial numbers', () => {
    assert.equal(normalizeWhatsAppNumber(''), '');
    assert.equal(normalizeWhatsAppNumber('0781231617'), '');
    assert.equal(normalizeWhatsAppNumber('25411'), '');
    assert.equal(normalizeWhatsAppNumber('+1 202 555'), '');
    assert.equal(normalizeWhatsAppNumber('254781231617abc'), '254781231617');
});
