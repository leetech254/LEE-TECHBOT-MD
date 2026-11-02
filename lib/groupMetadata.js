'use strict';

const cacheBySocket = new WeakMap();
const DEFAULT_TTL_MS = 15_000;
const ERROR_TTL_MS = 5_000;
const MAX_CACHE_ENTRIES = 256;

function isRateLimitError(error) {
    const text = String(error?.message || error || '').toLowerCase();
    const status = error?.output?.statusCode || error?.statusCode || error?.data?.statusCode;
    return status === 429 || text.includes('rate-overlimit') || text.includes('rate limit') || text.includes('too many requests');
}

function getSocketCache(sock) {
    let cache = cacheBySocket.get(sock);
    if (!cache) {
        cache = new Map();
        cacheBySocket.set(sock, cache);
    }
    return cache;
}

async function getGroupMetadata(sock, chatId, options = {}) {
    if (!sock || !chatId || !String(chatId).endsWith('@g.us') || typeof sock.groupMetadata !== 'function') return null;
    const cache = getSocketCache(sock);
    const key = String(chatId);
    const now = Date.now();
    const existing = cache.get(key);
    if (!options.force && existing && existing.expiresAt > now) return existing.promise;

    const entry = { expiresAt: now + DEFAULT_TTL_MS, promise: null };
    entry.promise = Promise.resolve()
        .then(() => sock.groupMetadata(key))
        .then((metadata) => metadata || null)
        .catch((error) => {
            entry.expiresAt = Date.now() + ERROR_TTL_MS;
            if (isRateLimitError(error)) {
                if (!existing || existing.lastLoggedAt + ERROR_TTL_MS < now) {
                    console.warn(`[groupMetadata] WhatsApp rate limit for ${key}; reusing the cooldown window.`);
                }
            } else {
                console.error(`[groupMetadata] Failed for ${key}:`, error?.message || error);
            }
            return null;
        });
    cache.set(key, entry);
    return entry.promise;
}

function clearGroupMetadataCache(sock, chatId) {
    const cache = cacheBySocket.get(sock);
    if (!cache) return;
    if (chatId) cache.delete(String(chatId));
    else cache.clear();
}

module.exports = { getGroupMetadata, clearGroupMetadataCache, isRateLimitError };
