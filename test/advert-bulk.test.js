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
        '111@g.us': { subject: 'Sales', participants: [] },
        '222@g.us': { subject: 'Support', participants: [] },
        '333@g.us': { subject: 'News', participants: [] }
      }
    },
    async sendMessage(chatId, payload) {
      sent.push({ chatId, payload })
      return { key: { id: String(sent.length) } }
    }
  }
}

test('owner DM can configure all or selected groups with one advert', async () => {
  const original = fs.existsSync(advert.SETTINGS_PATH) ? fs.readFileSync(advert.SETTINGS_PATH) : null
  try {
    fs.rmSync(advert.SETTINGS_PATH, { force: true })
    const sock = socket()
    const chatId = '254700000000@s.whatsapp.net'
    const message = { key: { remoteJid: chatId }, message: { conversation: '.advert' } }
    const context = { isOwnerOrSudoCheck: true, isGroup: false }

    await advert.advertCommand(sock, chatId, message, '.advert set all 1h | One shared advert', context)
    let state = advert.loadState()
    assert.deepEqual(Object.keys(state.groups).sort(), ['111@g.us', '222@g.us', '333@g.us'])
    assert.equal(state.groups['111@g.us'].message, 'One shared advert')
    assert.equal(state.groups['222@g.us'].enabled, false)
    assert.match(sock.sent.at(-1).payload.text, /all 3 participating groups/)

    await advert.advertCommand(sock, chatId, message, '.advert on all', context)
    state = advert.loadState()
    assert.equal(state.groups['111@g.us'].enabled, true)
    assert.equal(state.groups['333@g.us'].enabled, true)

    await advert.advertCommand(sock, chatId, message, '.advert all off', context)
    state = advert.loadState()
    assert.equal(state.groups['111@g.us'].enabled, false)
    assert.equal(state.groups['333@g.us'].enabled, false)

    await advert.advertCommand(sock, chatId, message, '.advert set 1,3 2h | Selected advert', context)
    state = advert.loadState()
    assert.equal(state.groups['111@g.us'].message, 'Selected advert')
    assert.equal(state.groups['333@g.us'].message, 'Selected advert')
    assert.equal(state.groups['222@g.us'].message, 'One shared advert')

    await advert.advertCommand(sock, chatId, message, '.advert clear 1,3', context)
    state = advert.loadState()
    assert.equal(state.groups['111@g.us'], undefined)
    assert.equal(state.groups['333@g.us'], undefined)
    assert.equal(state.groups['222@g.us'].message, 'One shared advert')
  } finally {
    if (original === null) fs.rmSync(advert.SETTINGS_PATH, { force: true })
    else fs.writeFileSync(advert.SETTINGS_PATH, original)
  }
})

test('bulk image command reads the replied image caption and supports inline captions', () => {
  const replied = {
    message: {
      extendedTextMessage: {
        text: '.advert set all 6h',
        contextInfo: { quotedMessage: { imageMessage: { caption: 'Caption from the original image' } } }
      }
    }
  }
  assert.equal(advert.mediaFromCommand(replied).type, 'image')
  assert.equal(advert.captionFromCommand(replied), 'Caption from the original image')

  const inline = { message: { imageMessage: { caption: 'Buy now\nhttps://example.com' } } }
  assert.equal(advert.captionFromCommand(inline), 'Buy now\nhttps://example.com')
})
