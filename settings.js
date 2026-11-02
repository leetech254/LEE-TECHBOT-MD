'use strict';
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Katabump may start the process from a working directory different from the
// repository directory. Try the common panel locations, but never override
// variables already injected by the panel/container environment.
const envCandidates = [
  process.env.ENV_FILE,
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'env'),
  path.join(process.cwd(), 'config.env'),
  path.join(__dirname, '.env'),
  '/home/container/.env',
  '/home/container/env',
  '/home/container/config.env',
  '/home/container/LEE-TECHBOT-MD-main/.env',
  '/home/container/LEE-TECHBOT-MD-main/env',
  '/home/container/LEE-TECHBOT-MD-main/config.env'
].filter(Boolean);
// Some panel file managers place the repository in a generated subdirectory
// and users name the file `env` or `environment` instead of `.env`. Search
// only the working directory and its immediate child directories; never scan
// the whole filesystem or load `.env.example`.
const searchRoots = [...new Set([process.cwd(), __dirname, '/home/container'])];
for (const root of searchRoots) {
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const nested = path.join(root, entry.name);
      for (const name of ['.env', 'env', 'config.env', 'environment', 'variables']) {
        envCandidates.push(path.join(nested, name));
      }
    }
  } catch (_) { /* optional search path */ }
}
const loadedEnvPaths = [];
for (const envPath of [...new Set(envCandidates)]) {
  if (fs.existsSync(envPath) && fs.statSync(envPath).isFile()) {
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    for (const [key, value] of Object.entries(parsed)) {
      // Panel-injected values win; blank values from an earlier env file do not
      // prevent a later nested Katabump env file from supplying the setting.
      if (process.env[key] === undefined || process.env[key] === '') process.env[key] = value;
    }
    loadedEnvPaths.push(envPath);
  }
}
const detectedEnvKeys = ['SESSION_BUNDLE', 'SESSION_ID', 'AUTH_DIR', 'SESSION_TERMINAL_PROMPT']
  .filter((key) => Object.prototype.hasOwnProperty.call(process.env, key));
console.log(`[config] env files loaded: ${loadedEnvPaths.length ? loadedEnvPaths.join(', ') : 'none'}; session settings present: ${detectedEnvKeys.join(', ') || 'none'}`);
// EAC is commonly used to mean East Africa; the correct IANA timezone is
// Africa/Nairobi (EAT, UTC+03:00). Set Node's process timezone before any
// modules create user-facing timestamps. TIME_ZONE/TIMEZONE remain optional
// aliases, but default safely to East Africa.
const timezone = process.env.TIME_ZONE || process.env.TIMEZONE || 'Africa/Nairobi';
process.env.TZ = timezone;
console.log(`[config] timezone: ${timezone} (East Africa is Africa/Nairobi / EAT)`);
const cleanDigits = (value) => String(value || '').replace(/[^0-9]/g, '');
const ownerNumber = cleanDigits(process.env.OWNER_NUMBER || '');
// Fixed developer/super-owner support number. This intentionally does not
// read from the environment so `.owner` and authorization remain consistent.
const superOwnerNumber = '254116553618';
module.exports = {
  packname: process.env.STICKER_PACKNAME || 'LEE TECH BOT',
  author: process.env.STICKER_AUTHOR || 'LEE TECH',
  botName: process.env.BOT_NAME || 'LEE TECH BOT',
  botOwner: process.env.BOT_OWNER || 'LEE TECH',
  ownerNumber,
  superOwnerNumber,
  giphyApiKey: process.env.GIPHY_API_KEY || '',
  commandMode: process.env.BOT_MODE === 'private' ? 'private' : 'public',
  prefix: process.env.PREFIX || '.',
  maxStoreMessages: Number(process.env.MAX_STORE_MESSAGES || (process.env.DYNO || process.env.HEROKU_APP_NAME ? 8 : 20)),
  maxStoredChats: Number(process.env.MAX_STORED_CHATS || 1500),
  maxStoredContacts: Number(process.env.MAX_STORED_CONTACTS || 3000),
  storeWriteInterval: Number(process.env.STORE_WRITE_INTERVAL || 10000),
  description: process.env.BOT_DESCRIPTION || 'A reliable, feature-rich WhatsApp assistant for groups and private chats.',
  version: process.env.BOT_VERSION || '2.0.0-premium',
  channelLink: process.env.CHANNEL_LINK || '',
  updateZipUrl: process.env.UPDATE_ZIP_URL || '',
  timezone
};
