'use strict'

const fs = require('fs')
const { normalizeJid } = require('./runtime')
const STORE_FILE = './baileys_store.json'

// Config: keep last 20 messages per chat (configurable) - More aggressive for lower RAM
let MAX_MESSAGES = 20
let MAX_CHATS = 1500
let MAX_CONTACTS = 3000

// Try to read config from settings
try {
    const settings = require('../settings.js')
    if (settings.maxStoreMessages && typeof settings.maxStoreMessages === 'number') MAX_MESSAGES = settings.maxStoreMessages
    if (settings.maxStoredChats && typeof settings.maxStoredChats === 'number') MAX_CHATS = settings.maxStoredChats
    if (settings.maxStoredContacts && typeof settings.maxStoredContacts === 'number') MAX_CONTACTS = settings.maxStoredContacts
} catch (e) {
    // Use default if settings not available
}

function canonicalJid(jid) {
    const value = String(jid || '').trim()
    return normalizeJid(value) || value
}

function messageId(message) {
    return message?.key?.id ? String(message.key.id) : ''
}

function trimObject(object, maximum) {
    const keys = Object.keys(object || {})
    while (keys.length > maximum) delete object[keys.shift()]
    return object
}
function mergeAndTrim(messages) {
    const byId = new Map()
    for (const message of Array.isArray(messages) ? messages : []) {
        const id = messageId(message)
        if (!id) continue
        byId.set(id, message)
    }
    return [...byId.values()].slice(-MAX_MESSAGES)
}

const store = {
    messages: {},
    contacts: {},
    chats: {},
    dirty: false,

    readFromFile(filePath = STORE_FILE) {
        try {
            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
                this.contacts = data.contacts || {}
                this.chats = data.chats || {}
                this.messages = data.messages || {}
                this.dirty = false

                // Clean up any existing data to match new format and merge
                // device-specific JID keys into one canonical chat bucket.
                this.cleanupData()
            }
        } catch (e) {
            console.warn('Failed to read store file:', e.message)
        }
    },

    writeToFile(filePath = STORE_FILE) {
        if (!this.dirty && fs.existsSync(filePath)) return
        try {
            const data = JSON.stringify({
                contacts: this.contacts,
                chats: this.chats,
                messages: this.messages
            })
            fs.writeFileSync(filePath, data)
            this.dirty = false
        } catch (e) {
            console.warn('Failed to write store file:', e.message)
        }
    },

    cleanupData() {
        const normalizedMessages = {}
        for (const [jid, value] of Object.entries(this.messages || {})) {
            const key = canonicalJid(jid)
            const entries = Array.isArray(value) ? value : Object.values(value || {})
            normalizedMessages[key] = mergeAndTrim([...(normalizedMessages[key] || []), ...entries])
        }
        this.messages = trimObject(normalizedMessages, MAX_CHATS)
        trimObject(this.contacts, MAX_CONTACTS)
        trimObject(this.chats, MAX_CHATS)
    },

    saveMessage(message) {
        const jid = canonicalJid(message?.key?.remoteJid)
        if (!jid || !messageId(message)) return false
        this.messages[jid] = mergeAndTrim([...(this.messages[jid] || []), message])
        trimObject(this.messages, MAX_CHATS)
        this.dirty = true
        return true
    },

    async loadMessage(jid, id) {
        const wantedId = String(id || '')
        if (!wantedId) return null
        const canonical = canonicalJid(jid)
        const primary = this.messages[canonical] || this.messages[String(jid || '')] || []
        const direct = primary.find(message => messageId(message) === wantedId)
        if (direct) return direct

        // WhatsApp can retry a message with a PN JID, LID JID, or a
        // device-suffixed JID different from the one used in messages.upsert.
        // Message IDs are the final reliable key for this bounded local store.
        for (const messages of Object.values(this.messages || {})) {
            const match = Array.isArray(messages)
                ? messages.find(message => messageId(message) === wantedId)
                : null
            if (match) return match
        }
        return null
    },

    cleanupDataLegacy() {
        // Kept as a compatibility alias for callers from older deployments.
        this.cleanupData()
    },

    bind(ev) {
        ev.on('messages.upsert', ({ messages }) => {
            messages.forEach(msg => this.saveMessage(msg))
        })

        ev.on('contacts.update', (contacts) => {
            contacts.forEach(contact => {
                if (contact.id) {
                    this.contacts[contact.id] = {
                        id: contact.id,
                        name: contact.notify || contact.name || ''
                    }
                    trimObject(this.contacts, MAX_CONTACTS)
                    this.dirty = true
                }
            })
        })

        ev.on('chats.set', (chats) => {
            this.chats = {}
            chats.forEach(chat => {
                this.chats[chat.id] = { id: chat.id, subject: chat.subject || '' }
            })
            trimObject(this.chats, MAX_CHATS)
            this.dirty = true
        })
    },

    // Get store statistics
    getStats() {
        let totalMessages = 0
        let totalContacts = Object.keys(this.contacts).length
        let totalChats = Object.keys(this.chats).length

        Object.values(this.messages).forEach(chatMessages => {
            if (Array.isArray(chatMessages)) {
                totalMessages += chatMessages.length
            }
        })

        return {
            messages: totalMessages,
            contacts: totalContacts,
            chats: totalChats,
            maxMessagesPerChat: MAX_MESSAGES,
            maxChats: MAX_CHATS,
            maxContacts: MAX_CONTACTS
        }
    }
}

module.exports = store
