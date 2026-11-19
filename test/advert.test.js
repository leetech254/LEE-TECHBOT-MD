'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const advert = require('../commands/advert')

function mockSocket() {
  const sent = []
  return {
    user: { id: '254700000000:1@s.whatsapp.net' },
    sent,
    async sendMessage(chatId, payload) {
      sent.push({ chatId, payload })
      return { key: { id: String(sent.length) } }
    }
  }
}

function message() {
  return { key: { remoteJid: '123@g.us', fromMe: true }, message: { conversation: '.advert' } }
}

test('advert interval parser enforces safe 10-minute to 30-day limits', () => {
  assert.equal(advert.parseInterval('10m'), 10 * 60 * 1000)
  assert.equal(advert.parseInterval('6h'), 6 * 60 * 60 * 1000)
  assert.equal(advert.parseInterval('2d'), 2 * 24 * 60 * 60 * 1000)
  assert.equal(advert.parseInterval('9m'), null)
  assert.equal(advert.parseInterval('31d'), null)
  assert.equal(advert.parseInterval('soon'), null)
})

test('advert configuration is owner-only and group-scoped', async () => {
  const sock = mockSocket()
  await advert.advertCommand(sock, '123@g.us', message(), '.advert set 1h | Buy now', { isOwnerOrSudoCheck: false, isGroup: true })
  assert.match(sock.sent.at(-1).payload.text, /owner or sudo/i)

  await advert.advertCommand(sock, '254700000000@s.whatsapp.net', message(), '.advert set 1h | Buy now', { isOwnerOrSudoCheck: true, isGroup: false })
  assert.match(sock.sent.at(-1).payload.text, /configure adverts inside each target group/i)
})

test('advert set, status, off, and now persist and control one group', async () => {
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    const sock = mockSocket()
    const context = { isOwnerOrSudoCheck: true, isGroup: true }
    await advert.advertCommand(sock, '123@g.us', message(), '.advert set 1h | Buy our service', context)
    assert.match(sock.sent.at(-1).payload.text, /enabled/i)
    assert.equal(advert.loadState().groups['123@g.us'].enabled, true)

    await advert.advertCommand(sock, '123@g.us', message(), '.advert status', context)
    assert.match(sock.sent.at(-1).payload.text, /ADVERT STATUS/)

    await advert.advertCommand(sock, '123@g.us', message(), '.advert now', context)
    assert.equal(sock.sent.filter((entry) => entry.chatId === '123@g.us' && /ADVERTISEMENT/.test(entry.payload.text)).length, 1)
    assert.match(sock.sent.find((entry) => entry.payload.text.includes('ADVERTISEMENT')).payload.text, /Buy our service/)
    assert.equal(advert.loadState().groups['123@g.us'].lastDelivery, 'sent')
    assert.equal(advert.loadState().groups['123@g.us'].lastMessageId, '3')

    await advert.advertCommand(sock, '123@g.us', message(), '.advert off', context)
    assert.equal(advert.loadState().groups['123@g.us'].enabled, false)
  } finally {
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
  }
})

test('advert command preserves multiline message formatting', async () => {
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    const sock = mockSocket()
    await advert.advertCommand(sock, '123@g.us', message(), '.advert set 1h | Line one\n✨ Line two\nhttps://example.com', { isOwnerOrSudoCheck: true, isGroup: true })
    assert.equal(advert.loadState().groups['123@g.us'].message, 'Line one\n✨ Line two\nhttps://example.com')
  } finally {
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
  }
})

test('owner DM can inspect and immediately broadcast to enabled groups', async () => {
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    advert.saveState({ version: 1, groups: {
      '111@g.us': { enabled: true, intervalMs: 3600000, message: 'First group', nextAt: Date.now() },
      '222@g.us': { enabled: true, intervalMs: 3600000, message: 'Second group', nextAt: Date.now() },
      '333@g.us': { enabled: false, intervalMs: 3600000, message: 'Paused group', nextAt: Date.now() }
    } })
    const sock = mockSocket()
    const dm = { key: { remoteJid: '254700000000@s.whatsapp.net' }, message: { conversation: '.advert' } }
    const context = { isOwnerOrSudoCheck: true, isGroup: false }

    await advert.advertCommand(sock, '254700000000@s.whatsapp.net', dm, '.advert status', context)
    assert.match(sock.sent.at(-1).payload.text, /111@g\.us/)
    assert.match(sock.sent.at(-1).payload.text, /333@g\.us/)

    await advert.advertCommand(sock, '254700000000@s.whatsapp.net', dm, '.advert now', context)
    const deliveries = sock.sent.filter((entry) => /ADVERTISEMENT/.test(entry.payload.text))
    assert.deepEqual(deliveries.map((entry) => entry.chatId).sort(), ['111@g.us', '222@g.us'])
    assert.match(sock.sent.at(-1).payload.text, /Sent: \*2\/2\* enabled groups/)
  } finally {
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
  }
})

test('image adverts send an image payload with the saved caption', async () => {
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  const mediaPath = `${advert.SETTINGS_PATH}.image-test.jpg`
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    fs.mkdirSync(require('node:path').dirname(mediaPath), { recursive: true })
    fs.writeFileSync(mediaPath, Buffer.from('fake-image'))
    advert.saveState({ version: 1, groups: { '123@g.us': { enabled: true, intervalMs: 3600000, message: 'Image caption', media: { type: 'image', file: require('node:path').basename(mediaPath) } } } })
    const sock = mockSocket()
    assert.equal(await advert.sendAdvert(sock, '123@g.us', advert.loadState().groups['123@g.us'], true), true)
    assert.deepEqual(sock.sent[0].payload.image, Buffer.from('fake-image'))
    assert.equal(sock.sent[0].payload.caption, '📢 *ADVERTISEMENT*\n\nImage caption')
  } finally {
    fs.rmSync(mediaPath, { force: true })
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
  }
})

test('configured channel updates forward once to enabled groups only', async () => {
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    advert.saveState({ version: 1, channelJid: '777@newsletter', channelMessageIds: [], groups: {
      '111@g.us': { enabled: true, intervalMs: 3600000, message: 'A' },
      '222@g.us': { enabled: false, intervalMs: 3600000, message: 'B' }
    } })
    const sock = mockSocket()
    const channelMessage = { key: { remoteJid: '777@newsletter', id: 'channel-1' }, message: { conversation: 'New channel update' } }
    assert.equal(await advert.handleChannelUpdate(sock, channelMessage), true)
    assert.deepEqual(sock.sent.map((entry) => entry.chatId), ['111@g.us'])
    assert.match(sock.sent[0].payload.text, /New channel update/)
    assert.equal(await advert.handleChannelUpdate(sock, channelMessage), false)
  } finally {
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
  }
})

test('existing followed channels are used without manual channel configuration', async () => {
  const path = require('node:path')
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  const channelStatePath = path.join(path.dirname(advert.SETTINGS_PATH), '.channel-automation.json')
  const originalChannels = fs.existsSync(channelStatePath) ? fs.readFileSync(channelStatePath) : null
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    fs.writeFileSync(channelStatePath, JSON.stringify({ accounts: { bot: { channelJids: { first: '888@newsletter' } } } }))
    advert.saveState({ version: 1, groups: { '111@g.us': { enabled: true, intervalMs: 3600000, message: 'A' } } })
    const sock = mockSocket()
    const forwarded = await advert.handleChannelUpdate(sock, { key: { remoteJid: '888@newsletter', id: 'existing-1' }, message: { conversation: 'Existing channel post' } })
    assert.equal(forwarded, true)
    assert.equal(sock.sent[0].chatId, '111@g.us')
  } finally {
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
    if (originalChannels === null) fs.rmSync(channelStatePath, { force: true })
    else fs.writeFileSync(channelStatePath, originalChannels)
  }
})
