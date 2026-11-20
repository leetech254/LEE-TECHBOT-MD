'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { test } = require('node:test')
const advert = require('../commands/advert')

function socket() {
  const sent = []
  return {
    sent,
    user: { id: '254700000000@s.whatsapp.net' },
    async groupFetchAllParticipating() {
      return {
        '111@g.us': { subject: 'Sales Group', participants: [] },
        '222@g.us': { subject: 'Support Group', participants: [] }
      }
    },
    async sendMessage(chatId, payload) {
      sent.push({ chatId, payload })
      return { key: { id: String(sent.length) } }
    }
  }
}

function restore(file, original) {
  if (original === null) fs.rmSync(file, { force: true })
  else fs.writeFileSync(file, original)
}

test('owner DM can list groups and configure one by list number', async () => {
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    const sock = socket()
    const dm = { key: { remoteJid: '254700000000@s.whatsapp.net' }, message: { conversation: '.advert' } }
    const context = { isOwnerOrSudoCheck: true, isGroup: false }

    await advert.advertCommand(sock, dm.key.remoteJid, dm, '.advert groups', context)
    assert.match(sock.sent.at(-1).payload.text, /Sales Group/)
    assert.match(sock.sent.at(-1).payload.text, /Support Group/)

    await advert.advertCommand(sock, dm.key.remoteJid, dm, '.advert set 1 1h | Buy now', context)
    assert.equal(advert.loadState().groups['111@g.us'].message, 'Buy now')
    assert.equal(advert.loadState().groups['111@g.us'].enabled, false)

    await advert.advertCommand(sock, dm.key.remoteJid, dm, '.advert on 1', context)
    assert.equal(advert.loadState().groups['111@g.us'].enabled, true)

    await advert.advertCommand(sock, dm.key.remoteJid, dm, '.advert clear 111@g.us', context)
    assert.equal(advert.loadState().groups['111@g.us'], undefined)
  } finally {
    restore(advert.SETTINGS_PATH, original)
  }
})

test('owner DM schedule lists active adverts and next broadcast times', async () => {
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    const nextAt = Date.now() + 60 * 60 * 1000
    advert.saveState({ version: 1, groups: {
      '111@g.us': { enabled: true, intervalMs: 3600000, message: 'Active advert', nextAt, lastDelivery: 'sent', sentCount: 2 },
      '222@g.us': { enabled: false, intervalMs: 3600000, message: 'Paused advert', nextAt }
    } })
    const sock = socket()
    const chatId = '254700000000@s.whatsapp.net'
    const message = { key: { remoteJid: chatId }, message: { conversation: '.advert schedule' } }
    await advert.advertCommand(sock, chatId, message, '.advert schedule', { isOwnerOrSudoCheck: true, isGroup: false })
    const output = sock.sent.at(-1).payload.text
    assert.match(output, /ACTIVE ADVERT SCHEDULE/)
    assert.match(output, /111@g\.us/)
    assert.match(output, /Next broadcast:/)
    assert.doesNotMatch(output, /222@g\.us/)
    assert.ok(Array.isArray(sock.sent.at(-1).payload.buttons))
  } finally {
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
  }
})
