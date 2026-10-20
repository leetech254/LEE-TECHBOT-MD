'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const updater = require('../commands/update');

test('updater accepts HTTPS URLs and rejects unsafe schemes', () => {
    assert.equal(updater.isSafeUpdateUrl('https://github.com/example/repo/archive/main.zip'), true);
    assert.equal(updater.isSafeUpdateUrl('http://github.com/example/repo/archive/main.zip'), false);
    assert.equal(updater.isSafeUpdateUrl('file:///tmp/update.zip'), false);
    assert.equal(updater.isSafeUpdateUrl('not a URL'), false);
});

test('updater exposes safe helper APIs', () => {
    assert.equal(typeof updater.downloadFile, 'function');
    assert.equal(typeof updater.updateViaGit, 'function');
    assert.equal(typeof updater.updateViaZip, 'function');
    assert.equal(typeof updater.writeRestartNotice, 'function');
    assert.equal(typeof updater.usesManagedProcessSupervisor, 'function');
});

test('host restart detection uses the platform supervisor instead of starting a competing child', () => {
    assert.equal(updater.usesManagedProcessSupervisor({ SERVER_PORT: '25034' }), true);
    assert.equal(updater.usesManagedProcessSupervisor({ DYNO: 'web.1' }), true);
    assert.equal(updater.usesManagedProcessSupervisor({ RENDER: 'true' }), true);
    assert.equal(updater.usesManagedProcessSupervisor({ RAILWAY_ENVIRONMENT: 'production' }), true);
    assert.equal(updater.usesManagedProcessSupervisor({}), false);
});

test('restart notice records the initiating chat and revision', () => {
    const noticePath = path.join(process.cwd(), 'data', '.pending-restart-notice.json');
    const previous = fs.existsSync(noticePath) ? fs.readFileSync(noticePath) : null;
    try {
        assert.equal(updater.writeRestartNotice('99887766@lid', '2.0.0', 'abc123'), noticePath);
        const payload = JSON.parse(fs.readFileSync(noticePath, 'utf8'));
        assert.equal(payload.targetJid, '99887766@lid');
        assert.equal(payload.version, '2.0.0');
        assert.equal(payload.revision, 'abc123');
        assert.equal(typeof payload.createdAt, 'string');
    } finally {
        if (previous) fs.writeFileSync(noticePath, previous); else fs.rmSync(noticePath, { force: true });
    }
});

test('archive safety allows the destination root but rejects traversal', () => {
    assert.doesNotThrow(() => updater.assertInside('/tmp/update-root', '/tmp/update-root'));
    assert.doesNotThrow(() => updater.assertInside('/tmp/update-root', '/tmp/update-root/project/file.js'));
    assert.throws(() => updater.assertInside('/tmp/update-root', '/tmp/update-root/../outside'));
});

test('runtime settings are treated as preserved paths', () => {
    assert.equal(updater.isPreservedPath('.env'), true);
    assert.equal(updater.isPreservedPath('env'), true);
    assert.equal(updater.isPreservedPath('config.env'), true);
    assert.equal(updater.isPreservedPath('data/userGroupData.json'), true);
    assert.equal(updater.isPreservedPath('data/autoStatus.json'), true);
    assert.equal(updater.isPreservedPath('data/channel-auto-state.json'), true);
    assert.equal(updater.isPreservedPath('session/creds.json'), true);
    assert.equal(updater.isPreservedPath('commands/update.js'), false);
});

test('Git porcelain parsing preserves leading status spaces and complete runtime paths', () => {
    const paths = updater.parseGitStatusPaths(' M data/userGroupData.json\n?? data/newRuntime.json\n M commands/example.js\n');
    assert.deepEqual(paths, ['data/userGroupData.json', 'data/newRuntime.json', 'commands/example.js']);
    assert.deepEqual(paths.filter(item => !updater.isPreservedPath(item)), ['commands/example.js']);
});

test('preservation snapshot can be created and restored safely', () => {
    const snapshot = updater.snapshotPreservedFiles();
    assert.ok(snapshot.snapshotRoot);
    assert.ok(Array.isArray(snapshot.copied));
    assert.ok(snapshot.copied.includes('.env') || snapshot.copied.includes('data/'));
    assert.doesNotThrow(() => updater.restorePreservedFiles(snapshot));
    assert.doesNotThrow(() => updater.restorePreservedFiles(snapshot));
});
