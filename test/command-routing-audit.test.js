'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { menuCompatCommand } = require('../commands/menuCompat');

test('strict menu audit requires a code route for every catalog command', () => {
    const repo = path.join(__dirname, '..');
    const result = spawnSync(process.execPath, ['scripts/audit-menu-commands.js', '--strict'], {
        cwd: repo,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const audit = JSON.parse(result.stdout);
    assert.equal(audit.total, 244);
    assert.equal(audit.routed, audit.total);
    assert.deepEqual(audit.unrouted, []);
});

test('recognized-command fallback never asks users to resend after connection', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'commands', 'menuCompat.js'), 'utf8');
    assert.doesNotMatch(source, /Please send it again after the bot has fully connected/i);
    assert.match(source, /handler is not available in this deployment/i);
});

test('reportcommand sends reports to the hardcoded developer number', async () => {
    const { superOwnerNumber } = require('../settings');
    const previous = process.env.DEVELOPER_NUMBER;
    process.env.DEVELOPER_NUMBER = '254700000001';
    const sent = [];
    const sock = { async sendMessage(chatId, payload) { sent.push({ chatId, payload }); } };
    const message = { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.reportcommand .opentime failed' } };
    await menuCompatCommand(sock, message.key.remoteJid, message, '.reportcommand .opentime failed', { isOwnerOrSudoCheck: true });
    assert.equal(sent[0].chatId, `${superOwnerNumber}@s.whatsapp.net`);
    assert.match(sent[0].payload.text, /\.opentime failed/);
    assert.match(sent.at(-1).payload.text, /Report sent/i);
    if (previous === undefined) delete process.env.DEVELOPER_NUMBER; else process.env.DEVELOPER_NUMBER = previous;
});
