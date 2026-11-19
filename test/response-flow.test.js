'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const pingCommand = require('../commands/ping')
const { createSelfChatSendQueue } = require('../lib/selfChat')
const { createMessageGuard } = require('../lib/runtime')

test('ping sends one complete response instead of a delayed second status message', async () => {
  const sent = []
  const sock = {
    async sendMessage(chatId, payload) {
      sent.push({ chatId, payload })
      return { key: { id: `sent-${sent.length}`, remoteJid: chatId } }
    }
  }
  await pingCommand(sock, '254781231617@s.whatsapp.net', { key: { id: 'ping-1' } })
  assert.equal(sent.length, 1)
  assert.match(sent[0].payload.text, /^Pong!\n/)
  assert.doesNotMatch(sent[0].payload.text, /Failed to get bot status/)
})

test('self-chat responses remain ordered and do not add an unnecessary warmup delay', async () => {
  const queue = createSelfChatSendQueue(0)
  const order = []
  await Promise.all([
    queue('254781231617@s.whatsapp.net', async () => order.push('first'), 0),
    queue('254781231617@s.whatsapp.net', async () => order.push('second'), 0),
    queue('254781231617@s.whatsapp.net', async () => order.push('third'), 0)
  ])
  assert.deepEqual(order, ['first', 'second', 'third'])
})

test('response guard suppresses duplicate messages and throttles bursts predictably', () => {
  const guard = createMessageGuard({ dedupeTtlMs: 60_000, maxCommands: 2, windowMs: 10_000 })
  assert.equal(guard.isDuplicate('message-1'), false)
  assert.equal(guard.isDuplicate('message-1'), true)
  assert.equal(guard.allowCommand('254781231617@s.whatsapp.net'), true)
  assert.equal(guard.allowCommand('254781231617@s.whatsapp.net'), true)
  assert.equal(guard.allowCommand('254781231617@s.whatsapp.net'), false)
})
