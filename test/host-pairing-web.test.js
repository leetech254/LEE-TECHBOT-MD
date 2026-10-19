'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHostPairingServer } = require('../lib/hostPairingWeb');


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
    const retryRequests = [];
    const pairing = createHostPairingServer({
        getRuntime: () => runtime,
        onMode: async mode => { runtime = { ...runtime, mode }; },
        onRetry: async () => {
            retryRequests.push(true);
            runtime = { ...runtime, mode: 'qr', connection: 'starting', ready: false, connected: false, registered: false, expired: false, qr: '', error: '' };
        },
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
        retryRequests,
        setRuntime(next) { runtime = { ...runtime, ...next }; },
        getRuntime() { return runtime; }
    };
}

function sameOrigin(host) {
    return { Origin: host.base, 'Content-Type': 'application/json' };
}

test('host pairing page and default QR status work without a key', async t => {
    const host = await withServer(t);
    const page = await fetch(`${host.base}/pairing`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Pair directly on this bot host/);
    assert.match(html, /Start a new pairing/);
    assert.match(html, /Live connection details/);
    assert.match(html, /id="whatsapp-state"/);
    assert.match(html, /id="pairing-state"/);
    assert.match(html, /Waiting for the bot to finish reconnecting/);
    const response = await fetch(`${host.base}/api/pairing/status`);
    const state = await response.json();
    assert.equal(response.status, 200);
    assert.equal(state.mode, 'qr');
    assert.match(html, /no key or session bundle to copy/);
});

test('pairing controls reject cross-origin browser POSTs without a key', async t => {
    const host = await withServer(t);
    const response = await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' },
        body: JSON.stringify({ mode: 'code' })
    });
    assert.equal(response.status, 403);
});

test('public cross-origin summary reports status but never exposes QR, code, or phone data', async t => {
    const host = await withServer(t);
    host.setRuntime({ ready: true, connected: false, registered: false, connection: 'connecting', qr: 'secret-qr-value', code: 'SECRET-CODE', phone: '254712345678' });
    const response = await fetch(`${host.base}/api/pairing/summary`, {
        headers: { Origin: 'https://proper-badger-techlee-pair.koyeb.app', 'Sec-Fetch-Site': 'cross-site' }
    });
    const summary = await response.json();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(summary.connection, 'connecting');
    assert.equal(summary.ready, true);
    assert.equal(Object.hasOwn(summary, 'qr'), false);
    assert.equal(Object.hasOwn(summary, 'code'), false);
    assert.equal(Object.hasOwn(summary, 'phone'), false);
    assert.equal(JSON.stringify(summary).includes('secret-qr-value'), false);
    assert.equal(JSON.stringify(summary).includes('SECRET-CODE'), false);
});

test('read-only status endpoint answers browser CORS preflight', async t => {
    const host = await withServer(t);
    const response = await fetch(`${host.base}/api/pairing/summary`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://pair.example', 'Access-Control-Request-Method': 'GET', 'Sec-Fetch-Site': 'cross-site' }
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-allow-methods') || '', /GET/);
});

test('expired pairing window stays readable but cannot return a QR or accept controls', async t => {
    const host = await withServer(t);
    host.setRuntime({ expired: true, ready: true, qr: 'expired-qr', error: 'Pairing window expired.' });
    const statusResponse = await fetch(`${host.base}/api/pairing/status`);
    const state = await statusResponse.json();
    assert.equal(state.expired, true);
    assert.equal(state.qr, '');
    const select = await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: sameOrigin(host), body: JSON.stringify({ mode: 'qr' })
    });
    assert.equal(select.status, 410);
    const retry = await fetch(`${host.base}/api/pairing/retry`, {
        method: 'POST', headers: sameOrigin(host), body: '{}'
    });
    assert.equal(retry.status, 200);
    assert.equal(host.getRuntime().expired, false);
    assert.equal(host.retryRequests.length, 1);
});

test('host pairing status and QR image work from the host page origin', async t => {
    const host = await withServer(t);
    host.setRuntime({ ready: true, qr: 'whatsapp-link-qr-test-value' });
    const select = await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: sameOrigin(host),
        body: JSON.stringify({ mode: 'qr' })
    });
    assert.equal(select.status, 200);
    const response = await fetch(`${host.base}/api/pairing/status`);
    const state = await response.json();
    assert.equal(state.mode, 'qr');
    assert.equal(state.ready, true);
    assert.match(state.qr, /^data:image\/png;base64,/);
});

test('host pairing code requests normalize the number and call the bot socket callback', async t => {
    const host = await withServer(t);
    host.setRuntime({ ready: true, qr: 'ready-qr' });
    await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: sameOrigin(host),
        body: JSON.stringify({ mode: 'code' })
    });
    const response = await fetch(`${host.base}/api/pairing/code`, {
        method: 'POST', headers: sameOrigin(host),
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
        method: 'POST', headers: sameOrigin(host),
        body: JSON.stringify({ mode: 'code' })
    });
    await fetch(`${host.base}/api/pairing/code`, {
        method: 'POST', headers: sameOrigin(host),
        body: JSON.stringify({ number: '254712345678' })
    });
    const response = await fetch(`${host.base}/api/pairing/status`);
    const state = await response.json();
    assert.equal(state.code, 'AB12CD34');
    assert.ok(state.codeExpiresAt > Date.now());
    assert.equal(host.requestedNumbers.length, 1);
});

test('host pairing code route rejects not-ready sockets and malformed numbers', async t => {
    const host = await withServer(t);
    await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: sameOrigin(host),
        body: JSON.stringify({ mode: 'code' })
    });
    const notReady = await fetch(`${host.base}/api/pairing/code`, {
        method: 'POST', headers: sameOrigin(host),
        body: JSON.stringify({ number: '254712345678' })
    });
    assert.equal(notReady.status, 409);
    host.setRuntime({ ready: true, qr: 'ready-qr' });
    const invalid = await fetch(`${host.base}/api/pairing/code`, {
        method: 'POST', headers: sameOrigin(host),
        body: JSON.stringify({ number: '123' })
    });
    assert.equal(invalid.status, 400);
});

test('host pairing page reports an already-linked bot without exposing a new code', async t => {
    const host = await withServer(t);
    host.setRuntime({ registered: true, connected: true, connection: 'open' });
    const response = await fetch(`${host.base}/api/pairing/mode`, {
        method: 'POST', headers: sameOrigin(host),
        body: JSON.stringify({ mode: 'qr' })
    });
    assert.equal(response.status, 409);
});
