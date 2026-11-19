'use strict';

const fs = require('fs');
const path = require('path');
const { allCommands } = require('../lib/menuCatalog');

const repo = path.join(__dirname, '..');
const attachedPath = process.argv[2] || process.env.ATTACHED_MENU_FILE || '';

function commandsFromAttachedMenu(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
        .split('\n')
        .map((line) => line.match(/╾\s+([A-Za-z0-9-]+)/)?.[1]?.toLowerCase())
        .filter(Boolean);
}

const attached = commandsFromAttachedMenu(attachedPath);
const catalog = [...new Set(attached.length ? attached : allCommands())];
const routeSource = [
    fs.readFileSync(path.join(repo, 'main.js'), 'utf8'),
    fs.readFileSync(path.join(repo, 'commands', 'menuCompat.js'), 'utf8')
].join('\n');
const hasDirectRoute = (command) => {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const direct = new RegExp(`(?:command|userMessage)\\s*(?:===|startsWith\\()\\s*['"]\\.?${escaped}(?:['"]|\\b)`, 'i');
    const literal = new RegExp(`['"\\x60]\\.?${escaped}['"\\x60]`, 'i');
    const aliasKey = new RegExp(`\\b${escaped}\\s*:`, 'i');
    return direct.test(routeSource) || literal.test(routeSource) || aliasKey.test(routeSource);
};
const direct = catalog.filter((command) => {
    const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:command|userMessage)\\s*(?:===|startsWith\\()\\s*['"]\\.?${escaped}(?:['"]|\\b)`, 'i').test(routeSource);
});
const unrouted = catalog.filter((command) => !hasDirectRoute(command));

console.log(JSON.stringify({
    source: attached.length ? attachedPath : 'lib/menuCatalog.js',
    total: catalog.length,
    direct: direct.length,
    indirect: catalog.length - direct.length - unrouted.length,
    routed: catalog.length - unrouted.length,
    unrouted,
    strict: process.argv.includes('--strict')
}, null, 2));

if (unrouted.length && process.argv.includes('--strict')) process.exitCode = 1;
