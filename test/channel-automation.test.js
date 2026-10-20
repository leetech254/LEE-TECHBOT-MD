'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    CHANNEL_LINKS,
    DEFAULT_REACTION,
    inviteCodeFromChannelUrl,
    createChannelAutomation
} = require('../lib/channelAutomation');

const silentLogger = { info() {}, warn() {} };

test('channel invite parser accepts only exact HTTPS WhatsApp channel links', () => {
    assert.equal(inviteCodeFromChannelUrl(CHANNEL_LINKS[0].url), '0029Vb9GMft7YSd5GfsIyZ2H');
    assert.equal(inviteCodeFromChannelUrl(CHANNEL_LINKS[1].url), '0029VbBu1EgJUM2iVI3tPE0S');
    assert.equal(inviteCodeFromChannelUrl('http://whatsapp.com/channel/0029Vb9GMft7YSd5GfsIyZ2H'), null);
    assert.equal(inviteCodeFromChannelUrl('https://evil.example/channel/0029Vb9GMft7YSd5GfsIyZ2H'), null);
    assert.equal(inviteCodeFromChannelUrl('https://whatsapp.com/channel/../not-a-channel'), null);
});

test('only the two explicitly configured channels are resolved and followed once per account', async () => {
    assert.deepEqual(CHANNEL_LINKS.map(channel => channel.url), [
        'https://whatsapp.com/channel/0029Vb9GMft7YSd5GfsIyZ2H',
        'https://whatsapp.com/channel/0029VbBu1EgJUM2iVI3tPE0S'
    ]);
    const calls = [];
    const state = {};
    let persistCount = 0;
    const automation = createChannelAutomation({
        state,
        persist: () => { persistCount += 1; },
        logger: silentLogger
    });
    const socket = {
        async newsletterMetadata(type, code) {
            calls.push(['metadata', type, code]);
            const id = code === '0029Vb9GMft7YSd5GfsIyZ2H' ? '120363000000000001@newsletter' : '120363000000000002@newsletter';
            return { id, name: `Channel ${code}` };
        },
        async newsletterFollow(jid) { calls.push(['follow', jid]); }
    };

    const first = await automation.followChannels(socket, '12345:8@s.whatsapp.net');
    assert.equal(first.length, 2);
    assert.deepEqual(first.map(item => item.followed), [true, true]);
    assert.deepEqual(calls.filter(call => call[0] === 'follow').map(call => call[1]), [
        '120363000000000001@newsletter',
        '120363000000000002@newsletter'
    ]);
    assert.equal(persistCount, 4);

    calls.length = 0;
    const second = await automation.followChannels(socket, '12345:8@s.whatsapp.net');
    assert.deepEqual(second.map(item => item.alreadyFollowed), [true, true]);
    assert.equal(calls.filter(call => call[0] === 'follow').length, 0);
    assert.equal(calls.filter(call => call[0] === 'metadata').length, 2);
    assert.deepEqual((await automation.followChannels(socket, '67890@s.whatsapp.net')).map(item => item.followed), [true, true]);

    const afterRestart = createChannelAutomation({ state, persist() {}, logger: silentLogger });
    calls.length = 0;
    const restarted = await afterRestart.followChannels(socket, '12345:8@s.whatsapp.net');
    assert.deepEqual(restarted.map(item => item.alreadyFollowed), [true, true]);
    assert.equal(calls.filter(call => call[0] === 'follow').length, 0);
});

test('channel reactions are restricted to allowlisted new posts and deduplicated', async () => {
    assert.equal(DEFAULT_REACTION, '💠');
    const state = {};
    const reacted = [];
    const automation = createChannelAutomation({ state, persist() {}, logger: silentLogger });
    const socket = {
        async newsletterMetadata(_type, code) { return { id: code === '0029Vb9GMft7YSd5GfsIyZ2H' ? '120363000000000001@newsletter' : '120363000000000002@newsletter' }; },
        async newsletterFollow() {},
        async newsletterReactMessage(...args) { reacted.push(args); }
    };
    const account = '12345@s.whatsapp.net';
    await automation.followChannels(socket, account);

    const channel = '120363000000000001@newsletter';
    const post = { key: { remoteJid: channel, server_id: 'post-1', fromMe: false }, message: { conversation: 'News' } };
    assert.equal(await automation.handleMessage(socket, post, account, 'notify'), true);
    assert.equal(await automation.handleMessage(socket, post, account, 'notify'), true);
    assert.deepEqual(reacted, [[channel, 'post-1', '💠']]);

    assert.equal(await automation.handleMessage(socket, { ...post, key: { ...post.key, server_id: 'history-1' } }, account, 'append'), true);
    assert.equal(await automation.handleMessage(socket, { ...post, key: { ...post.key, remoteJid: 'another@newsletter', server_id: 'post-2' } }, account, 'notify'), true);
    assert.equal(await automation.handleMessage(socket, { ...post, key: { remoteJid: '12345@s.whatsapp.net', id: 'dm-1' } }, account, 'notify'), false);
    assert.equal(reacted.length, 1);
});

test('a failed channel follow does not prevent attempting the other configured channel', async () => {
    const attempted = [];
    const automation = createChannelAutomation({ state: {}, persist() {}, logger: silentLogger });
    const socket = {
        async newsletterMetadata(_type, code) { return { id: code === '0029Vb9GMft7YSd5GfsIyZ2H' ? '120363000000000001@newsletter' : '120363000000000002@newsletter' }; },
        async newsletterFollow(jid) {
            attempted.push(jid);
            if (jid.startsWith('120363000000000001')) throw new Error('temporary WhatsApp error');
        }
    };
    const result = await automation.followChannels(socket, '12345@s.whatsapp.net');
    assert.equal(attempted.length, 2);
    assert.deepEqual(result.map(item => item.followed), [false, true]);
});

test('follow and reaction opt-outs work independently', async () => {
    const state = {};
    let followCount = 0;
    let reactionCount = 0;
    const automation = createChannelAutomation({
        state,
        followEnabled: false,
        reactEnabled: false,
        persist() {},
        logger: silentLogger
    });
    const socket = {
        async newsletterMetadata(_type, code) { return { id: code === '0029Vb9GMft7YSd5GfsIyZ2H' ? '120363000000000001@newsletter' : '120363000000000002@newsletter' }; },
        async newsletterFollow() { followCount += 1; },
        async newsletterReactMessage() { reactionCount += 1; }
    };
    const account = '12345@s.whatsapp.net';
    const outcomes = await automation.followChannels(socket, account);
    assert.deepEqual(outcomes.map(item => item.disabled), [true, true]);
    await automation.handleMessage(socket, {
        key: { remoteJid: '120363000000000001@newsletter', server_id: 'post-1' },
        message: { conversation: 'A post' }
    }, account, 'notify');
    assert.equal(followCount, 0);
    assert.equal(reactionCount, 0);
});
