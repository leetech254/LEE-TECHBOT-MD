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
  assert.match(sock.sent.at(-1).payload.text, /inside the group/i)
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

    await advert.advertCommand(sock, '123@g.us', message(), '.advert off', context)
    assert.equal(advert.loadState().groups['123@g.us'].enabled, false)
  } finally {
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
  }
})
