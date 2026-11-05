'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const configuredAuthDir = String(process.env.AUTH_DIR || (process.env.PORT ? '/app/auth' : '')).trim();
const DATA_DIR = path.resolve(process.env.DATA_DIR || (configuredAuthDir ? path.join(configuredAuthDir, 'data') : path.join(process.cwd(), 'data')));
const TMP_DIR = path.resolve(process.env.TEMP_DIR || path.join(os.tmpdir(), 'lee-techbot'));

function ensureRuntimeDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath, value) {
  ensureRuntimeDirs();
  const target = path.resolve(filePath);
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function normalizeJid(jid = '') {
  return String(jid).replace(/:\d+(?=@)/, '').trim().toLowerCase();
}

function createMessageGuard({ dedupeTtlMs = 60_000, windowMs = 10_000, maxCommands = 8 } = {}) {
  const seen = new Map();
  const windows = new Map();
  const now = () => Date.now();

  const prune = (map, ttl) => {
    const cutoff = now() - ttl;
    for (const [key, timestamp] of map) if (timestamp < cutoff) map.delete(key);
  };

  return {
    isDuplicate(messageId) {
      if (!messageId) return false;
      prune(seen, dedupeTtlMs);
      if (seen.has(messageId)) return true;
      seen.set(messageId, now());
      return false;
    },
    allowCommand(senderId) {
      const key = normalizeJid(senderId) || 'unknown';
      const timestamp = now();
      const recent = (windows.get(key) || []).filter((entry) => timestamp - entry < windowMs);
      if (recent.length >= maxCommands) {
        windows.set(key, recent);
        return false;
      }
      recent.push(timestamp);
      windows.set(key, recent);
      return true;
    },
    clear() {
      seen.clear();
      windows.clear();
    }
  };
}

function createHealthMetrics() {
  const startedAt = Date.now();
  const metrics = { messages: 0, commands: 0, errors: 0, lastMessageAt: null, lastCommandAt: null };
  return {
    recordMessage() { metrics.messages += 1; metrics.lastMessageAt = new Date().toISOString(); },
    recordCommand() { metrics.commands += 1; metrics.lastCommandAt = new Date().toISOString(); },
    recordError() { metrics.errors += 1; },
    snapshot() { return { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), ...metrics }; }
  };
}

module.exports = { DATA_DIR, TMP_DIR, ensureRuntimeDirs, readJson, atomicWriteJson, normalizeJid, createMessageGuard, createHealthMetrics };
