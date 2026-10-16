'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHostPairingServer } = require('../lib/hostPairingWeb');

const TOKEN = 'unit-test-host-pairing-token-0123456789';

async function withServer(t, overrides = {}) {
    let runtime = {
        mode: null,
        connection: 'connecting',
        ready: false,
        connected: false,
        registered: false,
        qr: '',
        error: ''
    };
    const requestedNumbers = [];
    const pairing = createHostPairingServer({
        token: TOKEN,
        getRuntime: () => runtime,
        onMode: async mode => { runtime = { ...runtime, mode }; },
        requestPairingCode: async phone => {
            requestedNumbers.push(phone);
            return 'AB12CD34';
        },
        ...overrides
    });
    await new Promise((resolve, reject) => {
        pairing.server.once('error', reject);
        pairing.server.listen(0, '127.0.0.1', resolve);
    });
    const address = pairing.server.address();
    const base = `http://127.0.0.1:${address.port}`;
    t.after(() => new Promise(resolve => pairing.server.close(resolve)));
    return {
        base,
        requestedNumbers,
        setRuntime(next) { runtime = { ...runtime, ...next }; },
        getRuntime() { return runtime; }
    };
}

function authorized(token = TOKEN) {
    return { Authorization: `Bearer ${token}` };
}

test('host pairing page is served, but pairing APIs reject missing access keys', async t => {
    const host = await withServer(t);
    const page = await fetch(`${host.base}/pairing`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Pair directly on this bot host/);
    const denied = await fetch(`${host.base}/api/pairing/status`);
    assert.equal(denied.status, 401);
});

test('host pairing status and QR image require the access key', async t => {
    const host = await withServer(t);
    host.setRuntime({ ready: true, qr: 'whatsapp-link-qr-test-value' });
    const select = await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'qr' })
    });
    assert.equal(select.status, 200);
    const response = await fetch(`${host.base}/api/pairing/status`, { headers: authorized() });
    const state = await response.json();
    assert.equal(state.mode, 'qr');
    assert.equal(state.ready, true);
    assert.match(state.qr, /^data:image\/png;base64,/);
});

test('host pairing code requests normalize the number and call the bot socket callback', async t => {
    const host = await withServer(t);
    host.setRuntime({ ready: true, qr: 'ready-qr' });
    await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'code' })
    });
    const response = await fetch(`${host.base}/api/pairing/code`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: '+254 712 345 678' })
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.code, 'AB12CD34');
    assert.deepEqual(host.requestedNumbers, ['254712345678']);
});

test('host pairing code remains available after a page refresh until it expires', async t => {
    const host = await withServer(t);
    host.setRuntime({ ready: true, qr: 'ready-qr' });
    await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'code' })
    });
    await fetch(`${host.base}/api/pairing/code`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: '254712345678' })
    });
    const response = await fetch(`${host.base}/api/pairing/status`, { headers: authorized() });
    const state = await response.json();
    assert.equal(state.code, 'AB12CD34');
    assert.ok(state.codeExpiresAt > Date.now());
    assert.equal(host.requestedNumbers.length, 1);
});

test('host pairing code route rejects not-ready sockets and malformed numbers', async t => {
    const host = await withServer(t);
    await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'code' })
    });
    const notReady = await fetch(`${host.base}/api/pairing/code`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: '254712345678' })
    });
    assert.equal(notReady.status, 409);
    host.setRuntime({ ready: true, qr: 'ready-qr' });
    const invalid = await fetch(`${host.base}/api/pairing/code`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: '123' })
    });
    assert.equal(invalid.status, 400);
});

test('host pairing page reports an already-linked bot without exposing a new code', async t => {
    const host = await withServer(t);
    host.setRuntime({ registered: true, connected: true, connection: 'open' });
    const response = await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: { ...authorized(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'qr' })
    });
    assert.equal(response.status, 409);
});
