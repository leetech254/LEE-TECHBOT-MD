'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios');
const { menuCompatCommand } = require('../commands/menuCompat');
const { setAntilink, removeAntilink } = require('../lib/index');

function mockSock() {
    const sent = [];
    return {
        sent,
        async sendMessage(chatId, payload) { sent.push({ chatId, payload }); return { key: {} }; }
    };
}

const message = { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.test' } };

test('missing test command is routed by compatibility handler', async () => {
    const sock = mockSock();
    const handled = await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.test', {});
    assert.equal(handled, true);
    assert.match(sock.sent[0].payload.text, /router is working/i);
});

test('.create logo routes to image generation and returns the generated image', async () => {
    const sock = mockSock();
    const previousUrl = process.env.IMAGE_GENERATION_URL;
    const previousGet = axios.get;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/XZwAAAAASUVORK5CYII=', 'base64');
    let requestedUrl = '';
    try {
        process.env.IMAGE_GENERATION_URL = 'https://images.example/create/{prompt}';
        axios.get = async (url, options) => {
            requestedUrl = url;
            assert.equal(options.responseType, 'arraybuffer');
            assert.ok(options.timeout >= 10_000);
            return { data: png };
        };
        const handled = await menuCompatCommand(sock, '123@s.whatsapp.net', message,
            '.create logo a modern blue-and-silver logo for LEE TECH', {});
        assert.equal(handled, true);
        assert.match(decodeURIComponent(requestedUrl), /create a polished brand logo/i);
        assert.match(decodeURIComponent(requestedUrl), /LEE TECH/);
        assert.match(sock.sent[0].payload.text, /Creating your logo/);
        assert.equal(sock.sent[1].payload.image.equals(png), true);
        assert.equal(sock.sent[1].payload.mimetype, 'image/png');
        assert.match(sock.sent[1].payload.caption, /Logo generated/);

        const logoSock = mockSock();
        assert.equal(await menuCompatCommand(logoSock, '123@s.whatsapp.net', message, '.logo a warm orange fox emblem', {}), true);
        assert.match(logoSock.sent[0].payload.text, /Creating your logo/);
        assert.equal(logoSock.sent[1].payload.image.equals(png), true);
    } finally {
        axios.get = previousGet;
        if (previousUrl === undefined) delete process.env.IMAGE_GENERATION_URL;
        else process.env.IMAGE_GENERATION_URL = previousUrl;
    }
});

test('.create handles provider failures with actionable feedback', async () => {
    const sock = mockSock();
    const previousGet = axios.get;
    try {
        axios.get = async () => { throw Object.assign(new Error('provider unavailable'), { response: { status: 503 } }); };
        const handled = await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.create a watercolor fox', {});
        assert.equal(handled, true);
        assert.match(sock.sent.at(-1).payload.text, /temporarily unavailable \(HTTP 503\)/);
        assert.doesNotMatch(sock.sent.at(-1).payload.text, /handler is not available/i);
    } finally {
        axios.get = previousGet;
    }
});

test('speed and ping aliases use the local latency handler', async () => {
    const sock = mockSock();
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.speed', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /SPEED TEST|Measuring response speed/i);
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.ping', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /SPEED TEST|Measuring response speed/i);
});

test('health and botinfo diagnostics return local runtime data', async () => {
    const sock = mockSock();
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.health', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /BOT HEALTH|Status:/i);
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.botinfo', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /Commands:/i);
});

test('group menu lists the .out removal command', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'menuCatalog.js'), 'utf8');
    assert.match(source, /commands: \[[^\]]*'kick', 'out', 'kickall'/);
});

test('catalog fallback never emits the removed provider warning', async () => {
    const sock = mockSock();
    const handled = await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.menu', {});
    assert.equal(handled, true);
    assert.doesNotMatch(sock.sent[0].payload.text, /needs a provider or handler configuration/i);
    const source = fs.readFileSync(path.join(__dirname, '..', 'commands', 'menuCompat.js'), 'utf8');
    assert.doesNotMatch(source, /needs a provider or handler configuration/i);
});

test('truth command accepts an optional argument without falling into compatibility fallback', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(source, /userMessage === '\.truth' \|\| userMessage\.startsWith\('\.truth '\)/);
    const sock = mockSock();
    const handled = await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.truth and', {});
    assert.equal(handled, true);
    assert.doesNotMatch(sock.sent[0].payload.text, /recognized command|primary command dispatcher/i);
});

test('owner-only missing commands are rejected for non-owners', async () => {
    const sock = mockSock();
    const handled = await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.restart', { isOwnerOrSudoCheck: false });
    assert.equal(handled, true);
    assert.match(sock.sent[0].payload.text, /owner or sudo/i);
});

test('group-only missing commands are rejected outside groups', async () => {
    const sock = mockSock();
    const handled = await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.addall', { isGroup: false, isOwnerOrSudoCheck: false });
    assert.equal(handled, true);
    assert.match(sock.sent[0].payload.text, /only be used in a group/i);
});

test('listgroup shows anti-link status and the indexed DM command', async () => {
    const sock = mockSock();
    const group = '120363000000000010@g.us';
    sock.groupFetchAllParticipating = async () => ({
        [group]: { subject: 'Selected Group', participants: [{ id: 'member@s.whatsapp.net' }] }
    });
    const ownerMessage = { key: { remoteJid: 'owner@s.whatsapp.net', fromMe: true }, message: { conversation: '.listgroup' } };
    try {
        await setAntilink(group, 'on', 'delete', { mode: 'scam', silent: true });
        const handled = await menuCompatCommand(sock, 'owner@s.whatsapp.net', ownerMessage, '.listgroup', { isOwnerOrSudoCheck: true });
        assert.equal(handled, true);
        assert.match(sock.sent.at(-1).payload.text, /Anti-link: ON \| Mode: scam \| Action: delete/);
        assert.match(sock.sent.at(-1).payload.text, /DM command: \.antilink 1 get/);
        assert.match(sock.sent.at(-1).payload.text, /\.antilink <list number> on all silent/);
    } finally {
        await removeAntilink(group, 'on');
    }
});

test('local poll command produces a native WhatsApp poll payload', async () => {
    const sock = mockSock();
    const handled = await menuCompatCommand(sock, '123@g.us', message, '.poll Choose | A | B', { isGroup: true, isSenderAdmin: true });
    assert.equal(handled, true);
    assert.deepEqual(sock.sent[0].payload.poll.values, ['A', 'B']);
});

test('autoviewstatus uses the persistent auto-status handler instead of a provider warning', async () => {
    const sock = mockSock();
    const ownerMessage = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.autoviewstatus' } };
    const handled = await menuCompatCommand(sock, '123@s.whatsapp.net', ownerMessage, '.autoviewstatus', { isOwnerOrSudoCheck: true });
    assert.equal(handled, true);
    assert.match(sock.sent[0].payload.text, /AUTO STATUS SETTINGS|Auto-View/i);
});

test('group menu command calls the real group-info handler', async () => {
    const sock = mockSock();
    sock.user = { id: '254700000000:1@s.whatsapp.net' };
    sock.groupMetadata = async () => ({ id: '123@g.us', subject: 'Test Group', participants: [], announce: false, restrict: false });
    const ownerMessage = { key: { remoteJid: '123@g.us', fromMe: true }, message: { conversation: '.group' } };
    const handled = await menuCompatCommand(sock, '123@g.us', ownerMessage, '.group', { isGroup: true, isSenderAdmin: true, isOwnerOrSudoCheck: true });
    assert.equal(handled, true);
    assert.match(sock.sent[0].payload.text || sock.sent[0].payload.caption, /GROUP INFO|SUBJECT/i);
});

test('invite uses the real group invite-link handler', async () => {
    const sock = mockSock();
    sock.groupInviteCode = async () => 'invite-code';
    sock.groupMetadata = async () => ({ subject: 'Test Group' });
    const handled = await menuCompatCommand(sock, '123@g.us', message, '.invite', {
        isGroup: true, isSenderAdmin: true, isBotAdmin: true
    });
    assert.equal(handled, true);
    assert.match(sock.sent.at(-1).payload.text, /chat\.whatsapp\.com\/invite-code/);
});

test('savecontact uses the real group VCF handler', async () => {
    const sock = mockSock();
    sock.groupMetadata = async () => ({ subject: 'Test Group', participants: [{ id: '254700000001@s.whatsapp.net', notify: 'Alice Example' }] });
    const namedMessage = { ...message, pushName: 'Brian Admin' };
    const handled = await menuCompatCommand(sock, '123@g.us', namedMessage, '.savecontact', {
        isGroup: true, isSenderAdmin: true
    });
    assert.equal(handled, true);
    assert.equal(sock.sent.at(-1).payload.mimetype, 'text/vcard');
    assert.match(sock.sent.at(-1).payload.fileName, /Brian Admin_Contacts\.vcf/);
    const vcf = sock.sent.at(-1).payload.document.toString('utf8');
    assert.match(vcf, /FN:Alice Example/);
    assert.doesNotMatch(vcf, /Test Group/);
});

test('vcf alias uses the same named group contact export', async () => {
    const sock = mockSock();
    sock.groupMetadata = async () => ({ subject: 'Another Group', participants: [{ id: '254700000002@s.whatsapp.net', name: 'Carol Name' }] });
    const handled = await menuCompatCommand(sock, '123@g.us', { ...message, pushName: 'Derek' }, '.vcf', {
        isGroup: true, isSenderAdmin: true
    });
    assert.equal(handled, true);
    assert.equal(sock.sent.at(-1).payload.mimetype, 'text/vcard');
    assert.match(sock.sent.at(-1).payload.document.toString('utf8'), /FN:Carol Name/);
});

test('VCF prefers the user contact-book name for a group member', async () => {
    const sock = mockSock();
    sock.store = { contacts: {
        '254700000003@s.whatsapp.net': { id: '254700000003@s.whatsapp.net', name: 'Saved Contact Name' }
    } };
    sock.groupMetadata = async () => ({ subject: 'Contacts Group', participants: [{
        id: '254700000003@s.whatsapp.net', notify: 'WhatsApp Profile Name'
    }] });
    const handled = await menuCompatCommand(sock, '123@g.us', { ...message, pushName: 'Admin' }, '.savecontacts', {
        isGroup: true, isSenderAdmin: true
    });
    assert.equal(handled, true);
    const vcf = sock.sent.at(-1).payload.document.toString('utf8');
    assert.match(vcf, /FN:Saved Contact Name/);
    assert.doesNotMatch(vcf, /WhatsApp Profile Name/);
});

test('local note and rate commands execute without an external provider', async () => {
    const sock = mockSock();
    const ownerMessage = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.note test item' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', ownerMessage, '.note test item', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /Note saved/i);
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', ownerMessage, '.listnote', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /test item/i);
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', ownerMessage, '.rate music', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /rate/i);
});

test('internal general aliases execute real handlers without generic warnings', async () => {
    const sock = mockSock();
    const message = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.audiospeed' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.audiospeed', { isOwnerOrSudoCheck: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /Reply to an audio|Speed must/i);
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.lid', {}), true);
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.clearchat', {}), true);
    assert.ok(sock.sent.length >= 2);
});

test('joingc accepts an invite link and calls groupAcceptInvite', async () => {
    const sock = mockSock();
    let accepted;
    sock.groupAcceptInvite = async (code) => { accepted = code; return '123@g.us'; };
    const message = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.joingc https://chat.whatsapp.com/ABC_123' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, message.message.conversation, { isOwnerOrSudoCheck: true }), true);
    assert.equal(accepted, 'ABC_123');
    assert.match(sock.sent.at(-1).payload.text, /Successfully joined/i);
});

test('joingc returns usage instead of a provider warning when link is missing', async () => {
    const sock = mockSock();
    const message = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.joingc' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.joingc', { isOwnerOrSudoCheck: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /Usage:/i);
});

test('joingc extracts the invite link from a quoted message', async () => {
    const sock = mockSock();
    let accepted;
    sock.groupAcceptInvite = async (code) => { accepted = code; return '123@g.us'; };
    const message = {
        key: { remoteJid: '123@s.whatsapp.net', fromMe: true },
        message: { extendedTextMessage: { text: '.joingc', contextInfo: { quotedMessage: { conversation: 'Join us: https://chat.whatsapp.com/REPLIED_456' } } } }
    };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.joingc', { isOwnerOrSudoCheck: true }), true);
    assert.equal(accepted, 'REPLIED_456');
    assert.match(sock.sent.at(-1).payload.text, /Successfully joined/i);
});

test('promoteall and demoteall update every non-bot group member without mentions', async () => {
    const sock = mockSock();
    sock.user = { id: '999:1@s.whatsapp.net' };
    sock.groupMetadata = async () => ({ participants: [
        { id: '999@s.whatsapp.net' }, { id: '111@s.whatsapp.net' }, { id: '222@s.whatsapp.net' }
    ] });
    const updates = [];
    sock.groupParticipantsUpdate = async (chatId, ids, action) => { updates.push({ ids, action }); return {}; };
    const message = { key: { remoteJid: '123@g.us', fromMe: true }, message: { conversation: '.promoteall' } };
    const context = { isGroup: true, isSenderAdmin: true, isOwnerOrSudoCheck: true };
    assert.equal(await menuCompatCommand(sock, '123@g.us', message, '.promoteall', context), true);
    assert.equal(await menuCompatCommand(sock, '123@g.us', message, '.demoteall', context), true);
    assert.deepEqual(updates.map((u) => u.action), ['promote', 'promote', 'demote', 'demote']);
    assert.deepEqual(updates[0].ids, ['111@s.whatsapp.net']);
});

test('edit updates the replied bot message without a provider fallback', async () => {
    const sock = mockSock();
    const message = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: {
        extendedTextMessage: { text: '.edit Updated text', contextInfo: { stanzaId: 'BOT_MSG_1', participant: '999@s.whatsapp.net' } }
    } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.edit Updated text', { isOwnerOrSudoCheck: true }), true);
    assert.equal(sock.sent[0].payload.edit.id, 'BOT_MSG_1');
    assert.equal(sock.sent[0].payload.text, 'Updated text');
});

test('listonline uses local group presence data instead of a provider fallback', async () => {
    const sock = mockSock();
    sock.groupMetadata = async () => ({ participants: [{ id: '111@s.whatsapp.net' }, { id: '222@s.whatsapp.net' }] });
    sock.presence = { '111@s.whatsapp.net': { lastKnownPresence: 'available' } };
    const message = { key: { remoteJid: '123@g.us', fromMe: true }, message: { conversation: '.listonline' } };
    assert.equal(await menuCompatCommand(sock, '123@g.us', message, '.listonline', { isOwnerOrSudoCheck: true, isGroup: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /ONLINE MEMBERS/);
    assert.deepEqual(sock.sent.at(-1).payload.mentions, ['111@s.whatsapp.net']);
});

test('listgroup uses native participating-group metadata', async () => {
    const sock = mockSock();
    sock.groupFetchAllParticipating = async () => ({
        '123@g.us': { subject: 'LEE TECH GROUP', participants: [{ id: '111@s.whatsapp.net' }] }
    });
    const message = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.listgroup' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.listgroup', { isOwnerOrSudoCheck: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /LEE TECH GROUP/);
});

test('gsettings resolves a numbered participating group from owner DM', async () => {
    const sock = mockSock();
    sock.groupFetchAllParticipating = async () => ({
        '123@g.us': { subject: 'LEE TECH GROUP', participants: [] }
    });
    const message = { key: { remoteJid: '999@s.whatsapp.net', fromMe: true }, message: { conversation: '.gsettings 1' } };
    assert.equal(await menuCompatCommand(sock, '999@s.whatsapp.net', message, '.gsettings 1', { isOwnerOrSudoCheck: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /LEE TECH GROUP/);
    assert.match(sock.sent.at(-1).payload.text, /Usage: .gsettings/);
});

test('gsettings accepts a full numeric group number without a JID suffix', async () => {
    const sock = mockSock();
    sock.groupFetchAllParticipating = async () => ({
        '120363123456789012@g.us': { subject: 'FULL NUMBER GROUP', participants: [] }
    });
    const message = { key: { remoteJid: '999@s.whatsapp.net', fromMe: true }, message: { conversation: '.gsettings 120363123456789012' } };
    assert.equal(await menuCompatCommand(sock, '999@s.whatsapp.net', message, '.gsettings 120363123456789012', { isOwnerOrSudoCheck: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /FULL NUMBER GROUP/);
});

test('gsettings rejects non-owner remote targeting before fetching groups', async () => {
    const sock = mockSock();
    let fetched = false;
    sock.groupFetchAllParticipating = async () => { fetched = true; return {}; };
    const message = { key: { remoteJid: '999@s.whatsapp.net' }, message: { conversation: '.gsettings 1 antilink on' } };
    assert.equal(await menuCompatCommand(sock, '999@s.whatsapp.net', message, '.gsettings 1 antilink on', { isOwnerOrSudoCheck: false }), true);
    assert.equal(fetched, false);
    assert.match(sock.sent.at(-1).payload.text, /owner or sudo/i);
});

test('setfullpp and reveal use real owner-protected handlers', async () => {
    const sock = mockSock();
    sock.user = { id: '999@s.whatsapp.net' };
    const message = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.setfullpp' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.setfullpp', { isOwnerOrSudoCheck: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /reply to an image/i);
    const reveal = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.reveal' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', reveal, '.reveal', { isOwnerOrSudoCheck: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /View Once/i);
});

test('setpaypoint uses the persistent payment settings handler', async () => {
    const sock = mockSock();
    const message = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.setpaypoint' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.setpaypoint', { isOwnerOrSudoCheck: true }), true);
    assert.match(sock.sent.at(-1).payload.text, /provide the new payment details/i);
});

test('gitclone validates GitHub repository input before downloading', async () => {
    const sock = mockSock();
    const message = { key: { remoteJid: '123@s.whatsapp.net', fromMe: true }, message: { conversation: '.gitclone' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.gitclone', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /Usage:.*github.com/i);
});

test('toimage routes to local sticker-to-image conversion validation', async () => {
    const sock = mockSock();
    const message = { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.toimage' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.toimage', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /reply to a sticker/i);
});

test('donate uses the persistent payment information handler', async () => {
    const sock = mockSock();
    const message = { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.donate' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.donate', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /PAYMENT METHODS|M-PESA/i);
});

test('groq alias gives a configuration message without an API key', async () => {
    const sock = mockSock();
    const previous = process.env.GROQ_API_KEY;
    const previousGrok = process.env.GROK_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROK_API_KEY;
    const message = { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.grok say hello' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.grok say hello', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /GROQ_API_KEY/i);
    if (previous === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = previous;
    if (previousGrok === undefined) delete process.env.GROK_API_KEY;
    else process.env.GROK_API_KEY = previousGrok;
});

test('restored legacy commands use explicit handlers instead of the generic fallback', async () => {
    const sock = mockSock();
    const message = { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.toqr hello' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', message, '.toqr hello', {}), true);
    assert.ok(sock.sent.at(-1).payload.image, 'toqr should generate an image payload');

    const flip = { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.fliptext hello' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', flip, '.fliptext hello', {}), true);
    assert.equal(sock.sent.at(-1).payload.text, 'olleh');

    const media = { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: '.tomp3' } };
    assert.equal(await menuCompatCommand(sock, '123@s.whatsapp.net', media, '.tomp3', {}), true);
    assert.match(sock.sent.at(-1).payload.text, /Reply to an image, video, or audio/i);
});
