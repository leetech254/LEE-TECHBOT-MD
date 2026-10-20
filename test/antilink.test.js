'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Antilink, shouldDeleteLink, extractDomains } = require('../lib/antilink');
const { handleAntilinkCommand, resolveAntilinkTarget } = require('../commands/antilink');
const { getAntilink, removeAntilink, setAntilink, incrementWarningCount } = require('../lib/index');

const stateFile = path.join(process.cwd(), 'data', 'userGroupData.json');
const originalState = fs.existsSync(stateFile) ? fs.readFileSync(stateFile) : null;
const bannedFile = path.join(process.cwd(), 'data', 'banned.json');
const originalBanned = fs.existsSync(bannedFile) ? fs.readFileSync(bannedFile) : Buffer.from('[]');

function dmMessage(text) {
    return { key: { remoteJid: '254700000000@s.whatsapp.net', participant: '254700000000@s.whatsapp.net' }, message: { conversation: text } };
}

test('anti-link supports silent all-link deletion with WhatsApp allowlist', () => {
    const settings = { enabled: true, mode: 'all', silent: true, allowDomains: ['chat.whatsapp.com', 'wa.me'], denyDomains: [] };
    assert.deepEqual(extractDomains('Join https://chat.whatsapp.com/ABC and visit evil.example/path'), ['chat.whatsapp.com', 'evil.example']);
    assert.equal(shouldDeleteLink('Join https://chat.whatsapp.com/ABC', settings), false);
    assert.equal(shouldDeleteLink('Visit https://evil.example/path', settings), true);
    assert.equal(shouldDeleteLink('https://evil.example https://wa.me/123', settings), true);
});

test('anti-link supports scam-only and specific denied domains', () => {
    assert.equal(shouldDeleteLink('Visit https://example.com', { enabled: true, mode: 'scam', silent: true }), false);
    assert.equal(shouldDeleteLink('Claim your prize at https://gift.example.com', { enabled: true, mode: 'scam', silent: true }), true);
    assert.equal(shouldDeleteLink('Visit https://safe.example.com', { enabled: true, mode: 'custom', denyDomains: ['example.com'] }), true);
    assert.equal(shouldDeleteLink('Visit https://safe.example.com', { enabled: true, mode: 'custom', allowDomains: ['example.com'] }), false);
});

test('anti-link does not treat email addresses as website links', () => {
    const settings = { enabled: true, mode: 'all' };
    assert.equal(shouldDeleteLink('Contact admin@example.com for support', settings), false);
    assert.equal(shouldDeleteLink('Visit example.com for details', settings), true);
});

test('silent anti-link deletes only and sends no warning or information', async () => {
    const sent = [];
    const group = '120363000000000001@g.us';
    const sender = '254700000001@s.whatsapp.net';
    const sock = {
        user: { id: '254700000099@s.whatsapp.net' },
        async groupMetadata() { return { participants: [{ id: '254700000099@s.whatsapp.net', admin: 'admin' }] }; },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await setAntilink(group, 'on', 'delete', { mode: 'all', silent: true });
        await Antilink({ key: { remoteJid: group, participant: sender, id: 'message-1' }, message: { conversation: 'https://blocked.example/scam' } }, sock);
        assert.equal(sent.length, 1);
        assert.deepEqual(sent[0].payload, { delete: { remoteJid: group, participant: sender, id: 'message-1' } });
    } finally {
        await removeAntilink(group, 'on');
    }
});

test('silent deletion does not prevent configured kick enforcement or its removal notice', async () => {
    const sent = [];
    const removals = [];
    const group = '120363000000000011@g.us';
    const sender = '254700000011@s.whatsapp.net';
    const sock = {
        user: { id: '254700000099@s.whatsapp.net' },
        async groupMetadata() { return { participants: [{ id: '254700000099@s.whatsapp.net', admin: 'admin' }] }; },
        async groupParticipantsUpdate(chatId, jids, action) { removals.push({ chatId, jids, action }); },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await setAntilink(group, 'on', 'kick', { mode: 'all', silent: true });
        await Antilink({ key: { remoteJid: group, participant: sender, id: 'kick-message-1' }, message: { conversation: 'https://blocked.example' } }, sock);
        assert.deepEqual(removals, [{ chatId: group, jids: [sender], action: 'remove' }]);
        assert.equal(sent.filter(({ payload }) => payload.delete).length, 1);
        assert.match(sent.find(({ payload }) => payload.text)?.payload.text, /was removed for sending a blocked link/i);
    } finally {
        await removeAntilink(group, 'on');
    }
});

test('silent deletion still counts configured warnings and enforces the threshold', async () => {
    const sent = [];
    const removals = [];
    const group = '120363000000000012@g.us';
    const sender = '254700000012@s.whatsapp.net';
    const sock = {
        user: { id: '254700000099@s.whatsapp.net' },
        async groupMetadata() { return { participants: [{ id: '254700000099@s.whatsapp.net', admin: 'admin' }] }; },
        async groupParticipantsUpdate(chatId, jids, action) { removals.push({ chatId, jids, action }); },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await setAntilink(group, 'on', 'warn', { mode: 'all', silent: true, threshold: 2 });
        for (let index = 1; index <= 2; index += 1) {
            await Antilink({ key: { remoteJid: group, participant: sender, id: `warn-message-${index}` }, message: { conversation: `https://blocked${index}.example` } }, sock);
        }
        assert.deepEqual(removals, [{ chatId: group, jids: [sender], action: 'remove' }]);
        assert.equal(sent.filter(({ payload }) => payload.delete).length, 2);
        assert.equal(sent.filter(({ payload }) => payload.text).length, 2);
    } finally {
        await removeAntilink(group, 'on');
    }
});

test('ban anti-link action bans and removes a repeat offender after three links', async () => {
    const sent = [];
    const removals = [];
    const group = '120363000000000005@g.us';
    const sender = '254700000005@s.whatsapp.net';
    const sock = {
        user: { id: '254700000099@s.whatsapp.net' },
        async groupMetadata() { return { participants: [{ id: '254700000099@s.whatsapp.net', admin: 'admin' }] }; },
        async groupParticipantsUpdate(chatId, jids, action) { removals.push({ chatId, jids, action }); },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await setAntilink(group, 'on', 'ban', { mode: 'all', silent: true });
        for (let index = 1; index <= 3; index += 1) {
            await Antilink({ key: { remoteJid: group, participant: sender, id: `ban-message-${index}` }, message: { conversation: `https://blocked${index}.example` } }, sock);
        }
        const bannedUsers = JSON.parse(fs.readFileSync(bannedFile, 'utf8'));
        assert.ok(bannedUsers.includes(sender));
        assert.deepEqual(removals, [{ chatId: group, jids: [sender], action: 'remove' }]);
        assert.equal(sent.filter((item) => item.payload.delete).length, 3);
        assert.match(sent.at(-1).payload.text, /globally banned and removed after 3 unauthorized links/i);
    } finally {
        await removeAntilink(group, 'on');
        if (originalState === null) fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, originalState);
        fs.writeFileSync(bannedFile, originalBanned);
    }
});

test('anti-link settings and violation counters persist fully on disk', async () => {
    const group = '120363000000000006@g.us';
    const sender = '254700000006@s.whatsapp.net';
    try {
        await setAntilink(group, 'on', 'ban', {
            mode: 'custom', silent: true,
            allowDomains: ['chat.whatsapp.com'], denyDomains: ['short.example']
        });
        await incrementWarningCount(group, sender);
        const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        assert.deepEqual(saved.antilink[group], {
            enabled: true,
            action: 'ban',
            mode: 'custom',
            silent: true,
            threshold: 3,
            allowDomains: ['chat.whatsapp.com'],
            denyDomains: ['short.example']
        });
        assert.equal(saved.warnings[group][sender], 1);
        // getAntilink reads JSON on every call, proving this survives a restart.
        assert.deepEqual(await getAntilink(group, 'on'), saved.antilink[group]);
        await removeAntilink(group, 'on');
        const cleared = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        assert.equal(cleared.antilink?.[group], undefined);
        assert.equal(cleared.warnings?.[group], undefined);
    } finally {
        await removeAntilink(group, 'on');
        if (originalState === null) fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, originalState);
    }
});

test('automatic ban uses the configured per-group threshold', async () => {
    const sent = [];
    const removals = [];
    const group = '120363000000000008@g.us';
    const sender = '254700000008@s.whatsapp.net';
    const sock = {
        user: { id: '254700000099@s.whatsapp.net' },
        async groupMetadata() { return { participants: [{ id: '254700000099@s.whatsapp.net', admin: 'admin' }] }; },
        async groupParticipantsUpdate(chatId, jids, action) { removals.push({ chatId, jids, action }); },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await setAntilink(group, 'on', 'ban', { mode: 'all', silent: true, threshold: 2 });
        for (let index = 1; index <= 2; index += 1) {
            await Antilink({ key: { remoteJid: group, participant: sender, id: `threshold-message-${index}` }, message: { conversation: `https://threshold${index}.example` } }, sock);
        }
        assert.deepEqual(removals, [{ chatId: group, jids: [sender], action: 'remove' }]);
        assert.match(sent.at(-1).payload.text, /after 2 unauthorized links/i);
    } finally {
        await removeAntilink(group, 'on');
        if (originalState === null) fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, originalState);
        fs.writeFileSync(bannedFile, originalBanned);
    }
});

test('linked-account DM can configure and persist a group anti-link rule', async () => {
    const sent = [];
    const sock = { async sendMessage(chatId, payload) { sent.push({ chatId, payload }); } };
    const group = '120363000000000000@g.us';
    try {
        await handleAntilinkCommand(sock, '254700000000@s.whatsapp.net', `.antilink ${group} set all silent allow chat.whatsapp.com,wa.me deny bit.ly`, '254700000000@s.whatsapp.net', false, dmMessage(`.antilink ${group} set all silent allow chat.whatsapp.com,wa.me deny bit.ly`), true);
        const settings = await getAntilink(group, 'on');
        assert.equal(settings.enabled, true);
        assert.equal(settings.mode, 'all');
        assert.equal(settings.silent, true);
        assert.deepEqual(settings.allowDomains, ['chat.whatsapp.com', 'wa.me']);
        assert.deepEqual(settings.denyDomains, ['bit.ly']);
        assert.match(sent.at(-1).payload.text, /settings saved/i);
    } finally {
        await removeAntilink(group, 'on');
        if (originalState === null) fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, originalState);
    }
});

test('admins can persist a custom anti-link threshold and view it in status', async () => {
    const sent = [];
    const group = '120363000000000007@g.us';
    const sock = {
        async groupMetadata() { return { subject: 'Threshold Group' }; },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await handleAntilinkCommand(sock, group, '.antilink on', 'admin@s.whatsapp.net', true, { key: { remoteJid: group } }, false);
        await handleAntilinkCommand(sock, group, '.antilink threshold 5', 'admin@s.whatsapp.net', true, { key: { remoteJid: group } }, false);
        assert.match(sent.at(-1).payload.text, /threshold for Threshold Group: 5/i);
        assert.equal((await getAntilink(group, 'on')).threshold, 5);
        await handleAntilinkCommand(sock, group, '.antilink get', 'admin@s.whatsapp.net', true, { key: { remoteJid: group } }, false);
        assert.match(sent.at(-1).payload.text, /Warning threshold: 5/);
    } finally {
        await removeAntilink(group, 'on');
        if (originalState === null) fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, originalState);
    }
});

test('anti-link enable confirmation shows the group name instead of the JID', async () => {
    const sent = [];
    const group = '65@g.us';
    const sock = {
        async groupMetadata() { return { subject: 'My Community Group' }; },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await handleAntilinkCommand(sock, group, '.antilink on', '254700000000@s.whatsapp.net', true, { key: { remoteJid: group } }, false);
        assert.match(sent.at(-1).payload.text, /Anti-link enabled for My Community Group\./);
        assert.doesNotMatch(sent.at(-1).payload.text, /65@g\.us/);
    } finally {
        await removeAntilink(group, 'on');
        if (originalState === null) fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, originalState);
    }
});

test('anti-link off/on commands preserve saved policy and domain rules', async () => {
    const sent = [];
    const group = '120363000000000013@g.us';
    const sock = {
        async groupMetadata() { return { subject: 'Persistent Rules Group' }; },
        async sendMessage(chatId, payload) { sent.push(payload.text); }
    };
    try {
        await setAntilink(group, 'on', 'warn', {
            mode: 'custom', silent: true, threshold: 7,
            allowDomains: ['example.org'], denyDomains: ['blocked.example']
        });
        await handleAntilinkCommand(sock, group, '.antilink off', 'admin@s.whatsapp.net', true, { key: { remoteJid: group } }, false);
        const disabled = await getAntilink(group, 'on');
        assert.equal(disabled.enabled, false);
        assert.equal(disabled.action, 'warn');
        assert.equal(disabled.mode, 'custom');
        assert.equal(disabled.threshold, 7);
        assert.equal(disabled.silent, true);
        assert.deepEqual(disabled.allowDomains, ['example.org']);
        assert.deepEqual(disabled.denyDomains, ['blocked.example']);

        await handleAntilinkCommand(sock, group, '.antilink on', 'admin@s.whatsapp.net', true, { key: { remoteJid: group } }, false);
        const enabled = await getAntilink(group, 'on');
        assert.equal(enabled.enabled, true);
        assert.equal(enabled.action, 'warn');
        assert.equal(enabled.mode, 'custom');
        assert.equal(enabled.threshold, 7);
        assert.equal(enabled.silent, true);
        assert.deepEqual(enabled.allowDomains, ['example.org']);
        assert.deepEqual(enabled.denyDomains, ['blocked.example']);
        assert.match(sent[0], /Saved rules were kept/);
    } finally {
        await removeAntilink(group, 'on');
    }
});

test('DM status includes the resolved group name and group ID', async () => {
    const sent = [];
    const group = '120363000000000002@g.us';
    const sock = {
        async groupMetadata(chatId) {
            assert.equal(chatId, group);
            return { subject: 'Family & Friends' };
        },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await setAntilink(group, 'on', 'delete', { mode: 'all', silent: true });
        await handleAntilinkCommand(sock, '254700000000@s.whatsapp.net', `.antilink ${group} get`, '254700000000@s.whatsapp.net', false, dmMessage(`.antilink ${group} get`), true);
        assert.match(sent.at(-1).payload.text, /Group: Family & Friends/);
        assert.match(sent.at(-1).payload.text, /Group ID: 120363000000000002@g\.us/);
    } finally {
        await removeAntilink(group, 'on');
        if (originalState === null) fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, originalState);
    }
});

test('DM status still works when group metadata is unavailable', async () => {
    const sent = [];
    const group = '120363000000000003@g.us';
    const sock = {
        async groupMetadata() { throw new Error('temporary metadata failure'); },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await handleAntilinkCommand(sock, '254700000000@s.whatsapp.net', `.antilink ${group} get`, '254700000000@s.whatsapp.net', false, dmMessage(`.antilink ${group} get`), true);
        assert.match(sent.at(-1).payload.text, /Group: Unknown group/);
        assert.match(sent.at(-1).payload.text, /Group ID: 120363000000000003@g\.us/);
    } finally {
        await removeAntilink(group, 'on');
        if (originalState === null) fs.rmSync(stateFile, { force: true });
        else fs.writeFileSync(stateFile, originalState);
    }
});

test('anti-link DM target accepts the numbered group shown by listgroup', async () => {
    const group = '120363000000000004@g.us';
    const sock = {
        async groupFetchAllParticipating() {
            return { [group]: { subject: 'Numbered Group', participants: [] } };
        }
    };
    assert.deepEqual(await resolveAntilinkTarget(sock, '254700000000@s.whatsapp.net', '1'), {
        jid: group,
        number: '120363000000000004',
        source: 'number',
        subject: 'Numbered Group',
        participants: [],
        metadata: { subject: 'Numbered Group', participants: [] },
        index: 1
    });
});

test('anti-link can enforce links from an administrator when explicitly enabled', async () => {
    const sent = [];
    const group = '120363000000000009@g.us';
    const sender = '254700000009@s.whatsapp.net';
    const sock = {
        user: { id: '254700000099@s.whatsapp.net' },
        async groupMetadata() { return { participants: [{ id: sender, admin: 'admin' }, { id: '254700000099@s.whatsapp.net', admin: 'admin' }] }; },
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); }
    };
    try {
        await setAntilink(group, 'on', 'delete', { mode: 'all', silent: true, enforceAdmins: true });
        await Antilink({ key: { remoteJid: group, participant: sender, fromMe: true, id: 'admin-link-1' }, message: { conversation: 'https://blocked.example' } }, sock);
        assert.equal(sent.filter((item) => item.payload.delete).length, 1);
    } finally {
        await removeAntilink(group, 'on');
    }
});

test('anti-link enforce command persists and reports admin enforcement', async () => {
    const sent = [];
    const group = '120363000000000010@g.us';
    const sock = {
        async groupMetadata() { return { subject: 'Enforced Group' }; },
        async sendMessage(chatId, payload) { sent.push(payload.text); }
    };
    try {
        await handleAntilinkCommand(sock, group, '.antilink enforce on', 'admin@s.whatsapp.net', true, { key: { remoteJid: group } }, false);
        assert.equal((await getAntilink(group, 'on')).enforceAdmins, true);
        await handleAntilinkCommand(sock, group, '.antilink get', 'admin@s.whatsapp.net', true, { key: { remoteJid: group } }, false);
        assert.match(sent.at(-1), /Admin enforcement: ON/);
    } finally {
        await removeAntilink(group, 'on');
    }
});
