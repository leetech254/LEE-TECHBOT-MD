'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatConnectedMessage, formatReconnectedMessage } = require('../lib/connectionNotice');

test('connected notice gives the owner useful startup details without storage errors', () => {
    const message = formatConnectedMessage({
        botName: 'LEE TECH BOT',
        version: '2.1.0',
        prefix: '!',
        storageStatus: { enabled: true, healthy: false, error: 'private endpoint and credentials' },
        connectedAt: new Date('2026-11-19T12:00:00.000Z'),
        timeZone: 'Africa/Nairobi'
    });

    assert.match(message, /LEE TECH BOT CONNECTED/);
    assert.match(message, /online and ready/i);
    assert.match(message, /Version: \*2\.1\.0\*/);
    assert.match(message, /Prefix: `!`/);
    assert.match(message, /!menu/);
    assert.match(message, /!health/);
    assert.match(message, /backup needs attention/i);
    assert.doesNotMatch(message, /private endpoint|credentials/);
});

test('connected notice explains prefix-free command use and persistent storage', () => {
    const message = formatConnectedMessage({
        prefix: 'none',
        storageStatus: { localPersistent: true },
        connectedAt: new Date('2026-11-19T12:00:00.000Z'),
        timeZone: 'Africa/Nairobi'
    });

    assert.match(message, /No prefix \(use \.\)/);
    assert.match(message, /\.menu/);
    assert.match(message, /persistent host storage detected/i);
});

test('reconnect notice provides the current prefix and next steps', () => {
    const message = formatReconnectedMessage({ botName: 'LEE TECH BOT', version: '2.1.0', prefix: '#' });

    assert.match(message, /LEE TECH BOT RECONNECTED/);
    assert.match(message, /online and ready/i);
    assert.match(message, /Prefix: `#`/);
    assert.match(message, /#menu/);
    assert.match(message, /#health/);
});
