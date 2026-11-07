'use strict';

const DEFAULT_SHORTCUTS = [
    { label: '⚡ Ping', command: 'ping' },
    { label: '🌐 GitHub', command: 'github' },
    { label: '📋 Menu', command: 'menu' },
];

function activePrefix(prefix = global.prefix) {
    return prefix === 'none' ? '.' : (String(prefix || '.').trim() || '.');
}

function validShortcut(item) {
    if (!item || typeof item !== 'object') return null;
    const label = String(item.label || item.title || '').trim().slice(0, 24);
    const command = String(item.command || item.trigger || '').trim().replace(/^\s+|\s+$/g, '');
    if (!label || !command || command.length > 80) return null;
    if (!/^[A-Za-z0-9_./:@!?=+\-\s]+$/.test(command)) return null;
    return { label, command };
}

function configuredShortcuts() {
    const raw = String(process.env.MENU_SHORTCUTS || '').trim();
    if (!raw) return DEFAULT_SHORTCUTS;
    try {
        const parsed = JSON.parse(raw);
        const values = Array.isArray(parsed) ? parsed : [parsed];
        const shortcuts = values.map(validShortcut).filter(Boolean).slice(0, 3);
        return shortcuts.length ? shortcuts : DEFAULT_SHORTCUTS;
    } catch (error) {
        console.warn('[menu] Invalid MENU_SHORTCUTS JSON; using default shortcuts.');
        return DEFAULT_SHORTCUTS;
    }
}

function shortcutCommand(command, prefix) {
    const p = activePrefix(prefix);
    const value = String(command).trim();
    if (value.startsWith(p)) return value;
    return `${p}${value.replace(/^[.!#$%^&*]+/, '')}`;
}

function menuShortcutButtons(prefix) {
    return configuredShortcuts().map(({ label, command }) => ({
        buttonId: shortcutCommand(command, prefix),
        buttonText: { displayText: label },
        type: 1,
    }));
}

module.exports = { DEFAULT_SHORTCUTS, activePrefix, configuredShortcuts, menuShortcutButtons };
