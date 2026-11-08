'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MENU_CATEGORIES, getCategory, allCommands } = require('../lib/menuCatalog');
const help = require('../commands/help');
const { botInfoCommand } = require('../commands/utility');
const { MENU_STYLES } = require('../commands/setmenuimage');

test('menu catalog contains every requested top-level category', () => {
    assert.deepEqual(
        MENU_CATEGORIES.map((category) => category.key),
        ['settings', 'class-rep', 'media-utilities', 'class-moderation', 'student', 'developer', 'academic', 'groups', 'ai', 'anime', 'img-maker', 'convert', 'fun', 'downloads', 'general']
    );
});

test('category aliases resolve to focused menus', () => {
    assert.equal(getCategory('group').key, 'groups');
    assert.equal(getCategory('image').key, 'img-maker');
    assert.equal(getCategory('download').key, 'downloads');
});

test('interactive menu style selector exposes all supported styles', () => {
    assert.deepEqual(MENU_STYLES.map(style => style.name), ['premium', 'neon', 'cyberpunk', 'minimal', 'terminal', 'royal']);
    for (const style of MENU_STYLES) {
        assert.ok(style.label);
        assert.ok(style.description);
    }
});

test('image maker category exposes working image and logo commands', () => {
    const category = getCategory('image');
    for (const command of ['create', 'logo', 'design', 'imagine', 'flux', 'dalle', 'firelogo']) {
        assert.ok(category.commands.includes(command), `image category should include ${command}`);
    }
    assert.equal(category.commands.includes('deepfake'), false);
});

test('catalog commands are unique and menu exposes category navigation', () => {
    const commands = allCommands();
    assert.equal(new Set(commands).size, commands.length);
    const menu = help.buildMenu();
    assert.match(menu, /menu <category>/);
    assert.match(menu, /SETTINGS|Settings/);
    assert.match(menu, /DOWNLOADS|Downloads/);
    assert.match(menu, /POWERED BY LEE TECH/);
    assert.match(menu, /OWNER: LEETECH/);
    assert.match(menu, /MENU CONTROLS/);
    assert.match(menu, /menustyle premium\|neon\|cyberpunk\|minimal\|terminal\|royal/);
    assert.match(menu, /menufont clean\|bold\|double\|mono/);
    assert.match(menu, /menumode image\|text\|status/);
});

test('full menu numbers every catalog command in stable catalog order', () => {
    const commands = allCommands();
    const menu = help.buildMenu();
    assert.match(menu, /╾ 001\. Addowner/);
    assert.match(menu, new RegExp(`╾ ${String(commands.length).padStart(3, '0')}\\. `));
    const numberedLines = menu.split('\n').filter((line) => /╾ \d{3}\. /.test(line));
    assert.equal(numberedLines.length, commands.length);
    assert.deepEqual(numberedLines.map((line) => Number(line.match(/╾ (\d{3})\./)[1])), commands.map((_, index) => index + 1));
});

test('menu renders live user, mode, speed, and feature status fields', () => {
    const menu = help.buildMenu({
        chatId: '254700000000@s.whatsapp.net',
        message: { key: { remoteJid: '254700000000@s.whatsapp.net' } }
    });
    assert.match(menu, /USER:\* 254700000000/);
    assert.match(menu, /MODE:\* (Public|Private)/);
    assert.match(menu, /SPEED:\* \d+\.\d{4}ms/);
    assert.doesNotMatch(menu, /AUTOREAD:\* (ON|OFF)/);
    assert.doesNotMatch(menu, /AUTOSTATUS:\* (ON|OFF)/);
    const featureStatus = help.buildFeatureStatus({ chatId: '254700000000@s.whatsapp.net', message: { key: { remoteJid: '254700000000@s.whatsapp.net' } } });
    assert.match(featureStatus, /AUTOREAD:\* (ON|OFF)/);
    assert.match(featureStatus, /AUTOSTATUS:\* (ON|OFF)/);
});

test('menu prefers linked WhatsApp name while retaining linked number', () => {
    const menu = help.buildMenu({
        chatId: '254700000000@s.whatsapp.net',
        message: { pushName: 'Lee Tech User', key: { remoteJid: '254700000000@s.whatsapp.net' } }
    });
    assert.match(menu, /USER:\* Lee Tech User/);
    assert.match(menu, /NUMBER:\* 254700000000/);
});

test('menu omits the number when only a long WhatsApp LID is available', () => {
    const menu = help.buildMenu({
        chatId: '174719890415834@s.whatsapp.net',
        message: { key: { remoteJid: '174719890415834@s.whatsapp.net' } }
    });
    assert.doesNotMatch(menu, /NUMBER:\* 174719890415834/);
});

test('main menu keeps feature toggles out of the runtime header', () => {
    const menu = help.buildMenu();
    assert.doesNotMatch(menu, /FEATURE SETTINGS/);
    assert.match(menu, /Features/);
    assert.match(help.buildFeatureStatus({ chatId: '123@g.us', message: { key: { remoteJid: '123@g.us' } } }), /FEATURE SETTINGS/);
    assert.match(help.buildFeatureStatus({ chatId: '123@g.us', message: { key: { remoteJid: '123@g.us' } } }), /ANTILINK:/);
});

test('menu detects supported hosting providers from environment signals', () => {
    const keys = ['LEETEC_HOSTING', 'DYNO', 'PTERODACTYL_SERVER_UUID'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
        delete process.env.DYNO;
        delete process.env.PTERODACTYL_SERVER_UUID;
        process.env.LEETEC_HOSTING = 'true';
        assert.match(help.buildMenu(), /PLATFORM:\* ☁️ Lee Tech Hosting/);
        delete process.env.LEETEC_HOSTING;
        process.env.DYNO = 'web.1';
        assert.match(help.buildMenu(), /PLATFORM:\* ☁️ Heroku/);
        delete process.env.DYNO;
        process.env.PTERODACTYL_SERVER_UUID = 'server';
        assert.match(help.buildMenu(), /PLATFORM:\* ☁️ Panel/);
    } finally {
        for (const key of keys) {
            if (previous[key] === undefined) delete process.env[key];
            else process.env[key] = previous[key];
        }
    }
});

test('bot information reports the live catalog command count', async () => {
    const sent = [];
    const sock = { async sendMessage(chatId, payload) { sent.push(payload); } };
    await botInfoCommand(sock, '123@s.whatsapp.net', { key: { remoteJid: '123@s.whatsapp.net' } });
    assert.match(sent[0].text, new RegExp(`Commands: \\*${allCommands().length}\\*`));
});
