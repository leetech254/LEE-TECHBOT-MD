'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    resolveHostPairingMode,
    resolveHostMenuChoice,
    resolvePairingWebStartupMode,
    resolveHostPairingPort,
    shouldAutoStartPairingWeb,
    renderTerminalQr
} = require('../lib/hostPairing');

test('AUTH_METHOD=qr selects direct QR pairing without a phone number', () => {
    assert.deepEqual(resolveHostPairingMode({ AUTH_METHOD: 'qr' }), { mode: 'qr' });
});

test('AUTH_METHOD=pair accepts an international phone number from host variables', () => {
    assert.deepEqual(resolveHostPairingMode({ AUTH_METHOD: 'pair', PHONE_NUMBER: '+254 712 345 678' }), {
        mode: 'pair',
        phone: '254712345678'
    });
    assert.deepEqual(resolveHostPairingMode({ AUTH_METHOD: 'pairing', PAIRING_NUMBER: '447911123456' }), {
        mode: 'pair',
        phone: '447911123456'
    });
});

test('pairing mode with no configured number falls through to the interactive menu', () => {
    assert.equal(resolveHostPairingMode({ AUTH_METHOD: 'pair' }), null);
});

test('invalid configured phone number is rejected', () => {
    assert.deepEqual(resolveHostPairingMode({ AUTH_METHOD: 'pair', PHONE_NUMBER: '123' }), { mode: 'invalid' });
});

test('host login menu maps bundle, direct code, and deployed pairing website choices', () => {
    assert.equal(resolveHostMenuChoice('1'), 'bundle');
    assert.equal(resolveHostMenuChoice('2'), 'pair');
    assert.equal(resolveHostMenuChoice('3'), 'web');
    assert.equal(resolveHostMenuChoice('4'), null);
});

test('pairing website starts automatically by default, with explicit always and manual modes', () => {
    assert.equal(resolvePairingWebStartupMode(undefined), 'auto');
    assert.equal(resolvePairingWebStartupMode('auto'), 'auto');
    assert.equal(resolvePairingWebStartupMode('true'), 'always');
    assert.equal(resolvePairingWebStartupMode('false'), 'manual');
});

test('Bot-Hosting SERVER_PORT is preferred unless an explicit pairing port is configured', () => {
    assert.equal(resolveHostPairingPort({ SERVER_PORT: '5200', PORT: '3000' }), '5200');
    assert.equal(resolveHostPairingPort({ PAIRING_WEB_PORT: '7070', SERVER_PORT: '5200' }), '7070');
    assert.equal(resolveHostPairingPort({ PORT: '3000' }), '3000');
    assert.equal(resolveHostPairingPort({}), '8000');
});

test('automatic web pairing is limited to a new session without explicit terminal choices', () => {
    const defaults = { startupMode: 'auto', registered: false, hasSessionBundle: false, hasTerminalPairing: false, promptEnabled: false };
    assert.equal(shouldAutoStartPairingWeb(defaults), true);
    assert.equal(shouldAutoStartPairingWeb({ ...defaults, registered: true }), false);
    assert.equal(shouldAutoStartPairingWeb({ ...defaults, hasSessionBundle: true }), false);
    assert.equal(shouldAutoStartPairingWeb({ ...defaults, hasTerminalPairing: true }), false);
    assert.equal(shouldAutoStartPairingWeb({ ...defaults, promptEnabled: true }), false);
});

test('terminal QR helper returns a rendered QR for the host console', async () => {
    const output = await renderTerminalQr('LEE TECHBOT host QR pairing test');
    assert.equal(typeof output, 'string');
    assert.ok(output.length > 100);
});
