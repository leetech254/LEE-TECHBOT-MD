'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const entry = path.resolve(process.env.BOT_ENTRY || path.join(process.cwd(), 'index.js'));
const authDir = path.resolve(process.env.AUTH_DIR || (process.env.PORT ? '/app/auth' : path.join(process.cwd(), 'session')));
const badMacPattern = /bad mac|verif(?:y|ication)mac|failed to decrypt|decrypt.*session|failed to decrypt message with any known session|over\s+\d+\s+messages?\s+into\s+the\s+future/i;
// Never destroy a paired session automatically. Set SESSION_RECOVERY_RESET=true
// only for an intentional manual relink after backing up the auth directory.
const shouldResetSession = process.env.SESSION_RECOVERY_RESET === 'true';
let alreadyRecovered = process.env.SESSION_RECOVERY_USED === '1';
let child = null;
let recovering = false;
let stopping = false;

function log(message) {
    process.stdout.write(`[session-recovery] ${message}\n`);
}

function stopChild() {
    if (!child || child.killed) return;
    child.kill('SIGTERM');
    setTimeout(() => {
        if (child && !child.killed) child.kill('SIGKILL');
    }, 5000).unref();
}

function resetBrokenSession() {
    if (!shouldResetSession || !fs.existsSync(authDir)) return false;
    const backupDir = `${authDir}.bad-mac-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
        fs.renameSync(authDir, backupDir);
        fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
        log(`Moved the broken auth folder to ${backupDir} and created a clean auth folder.`);
        return true;
    } catch (error) {
        console.error(`[session-recovery] Could not reset auth folder: ${error.message}`);
        return false;
    }
}

function launch() {
    child = spawn(process.execPath, [entry], {
        cwd: process.cwd(),
        env: { ...process.env, SESSION_RECOVERY_USED: alreadyRecovered ? '1' : '0' },
        stdio: ['inherit', 'pipe', 'pipe']
    });

    const inspect = chunk => {
        const text = String(chunk);
        process.stdout.write(text);
        if (!recovering && !alreadyRecovered && badMacPattern.test(text)) {
            recovering = true;
            if (shouldResetSession) {
                log('Signal decryption failure detected. Reset mode is enabled; backing up the auth folder and starting a clean pairing session.');
                resetBrokenSession();
            } else {
                log('Signal decryption failure detected. Preserving the paired auth folder and restarting without relinking.');
            }
            stopChild();
        } else if (alreadyRecovered && badMacPattern.test(text)) {
            log('Bad MAC happened again after recovery. No further automatic reset will be attempted. Check for duplicate bot instances or relink manually.');
        }
    };

    child.stdout.on('data', inspect);
    child.stderr.on('data', inspect);
    child.on('error', error => console.error(`[session-recovery] Child error: ${error.message}`));
    child.on('close', (code, signal) => {
        child = null;
        if (stopping) process.exit(code || 0);
        if (recovering) {
            recovering = false;
            alreadyRecovered = true;
            process.env.SESSION_RECOVERY_USED = '1';
            launch();
            return;
        }
        if (alreadyRecovered && code !== 0) {
            log(`Bot stopped after the one recovery attempt (code=${code}, signal=${signal || 'none'}). Link the device manually after checking the backup.`);
        }
        process.exit(code ?? 0);
    });
}

process.on('SIGINT', () => { stopping = true; stopChild(); });
process.on('SIGTERM', () => { stopping = true; stopChild(); });

if (!fs.existsSync(entry)) {
    console.error(`[session-recovery] Bot entrypoint not found: ${entry}`);
    process.exit(1);
}
launch();
