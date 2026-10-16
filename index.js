/**
 * LEE TECH BOT - A WhatsApp Bot
 * Copyright (c) 2024 Professor
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const { randomBytes } = require('crypto')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
// Using a lightweight persisted store instead of makeInMemoryStore (compat across versions)
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')
const { ensureRuntimeDirs, readJson } = require('./lib/runtime')
const { normalizeWhatsAppNumber } = require('./lib/phone')
const { restoreSessionBundle } = require('./lib/sessionBundle')
const { resolveHostPairingMode, resolveHostMenuChoice, renderTerminalQr } = require('./lib/hostPairing')
const { createHostPairingServer } = require('./lib/hostPairingWeb')
const selfChatModule = require('./lib/selfChat')
const { selfChatSendOptions, isSelfChat, createSelfChatSendQueue } = selfChatModule
const enqueueSelfChatSend = typeof createSelfChatSendQueue === 'function'
    ? createSelfChatSendQueue()
    : (jid, send) => send()
const persistMessage = typeof selfChatModule.persistMessage === 'function'
    ? selfChatModule.persistMessage
    : (store, message, maxMessages = 20) => {
        const jid = String(message?.key?.remoteJid || '').trim()
        const id = String(message?.key?.id || '')
        if (!store || !jid || !id) return false
        if (!store.messages || typeof store.messages !== 'object') store.messages = {}
        const bucket = Array.isArray(store.messages[jid]) ? store.messages[jid] : []
        const existing = bucket.findIndex(item => String(item?.key?.id || '') === id)
        if (existing >= 0) bucket[existing] = message
        else bucket.push(message)
        store.messages[jid] = bucket.slice(-Math.max(1, Number(maxMessages) || 20))
        store.dirty = true
        return true
    }
ensureRuntimeDirs()

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)
let reconnectAttempts = 0
let streamRestartAttempts = 0
let ackStreamAttempts = 0
let activeSocket = null
let reconnectTimer = null
let socketStartInFlight = false
let selfChatWarmupUntil = 0
const connectionNoticePath = path.join(process.env.AUTH_DIR || './session', '.connection-notice.json')
let hasAnnouncedConnection = Boolean(readJson(connectionNoticePath, {}).sent)
const pendingRestartNoticePath = path.join(process.cwd(), 'data', '.pending-restart-notice.json')
let pendingRestartNotice = readJson(pendingRestartNoticePath, {})
const decryptWarningCache = new Map()
const signalDecryptFailures = []
let signalRecoveryScheduled = false
let signalConsoleIntercepting = false
const deletedMessageKeys = new Map()
const DELETED_KEY_TTL_MS = 24 * 60 * 60 * 1000

function deletedKey(remoteJid, messageId) {
    return `${remoteJid || ''}:${messageId || ''}`
}

function rememberDeletedMessage(remoteJid, messageId) {
    if (!remoteJid || !messageId) return
    const now = Date.now()
    deletedMessageKeys.set(deletedKey(remoteJid, messageId), now)
    for (const [key, timestamp] of deletedMessageKeys) {
        if (now - timestamp > DELETED_KEY_TTL_MS) deletedMessageKeys.delete(key)
    }
}

function wasDeletedMessage(remoteJid, messageId) {
    const timestamp = deletedMessageKeys.get(deletedKey(remoteJid, messageId))
    return Boolean(timestamp && Date.now() - timestamp <= DELETED_KEY_TTL_MS)
}

function isSignalDecryptError(error) {
    const text = String(error?.stack || error?.message || error || '').toLowerCase()
    return /bad mac|verif(?:y|ication)mac|failed to decrypt|decrypt.*session|known session|signal.*session|waiting for this message|over\s+\d+\s+messages?\s+into\s+the\s+future/.test(text)
}

function logDecryptWarningOnce(messageId, error) {
    const key = messageId || 'unknown'
    const now = Date.now()
    const previous = decryptWarningCache.get(key) || 0
    if (now - previous < 60000) return
    decryptWarningCache.set(key, now)
    if (decryptWarningCache.size > 1000) {
        for (const [id, timestamp] of decryptWarningCache) {
            if (now - timestamp > 60000) decryptWarningCache.delete(id)
        }
    }
    console.warn(`[crypto] message skipped because Signal could not decrypt it${error?.message ? `: ${error.message}` : ''}`)
}

function scheduleSignalSessionRecovery(error) {
    const now = Date.now()
    signalDecryptFailures.push(now)
    while (signalDecryptFailures[0] && now - signalDecryptFailures[0] > 60000) signalDecryptFailures.shift()
    if (signalRecoveryScheduled || signalDecryptFailures.length < 3) return
    if (process.env.SESSION_RECOVERY_RESET !== 'true') {
        signalRecoveryScheduled = true
        console.warn('[crypto] Repeated Signal decryption failures detected; preserving the paired auth session. Messages that cannot be decrypted will be skipped.')
        return
    }
    signalRecoveryScheduled = true
    // When npm start is using the recovery supervisor, let the supervisor
    // rotate the auth directory. This prevents two processes from renaming
    // the same folder at the same time.
    if (process.env.SESSION_RECOVERY_USED !== undefined) return
    console.error(`[crypto] Repeated Signal decryption errors detected. Backing up the broken session and restarting for a fresh pairing.`)
    try {
        const resolvedAuthDir = path.resolve(authDir)
        const backupDir = `${resolvedAuthDir}.bad-mac-${new Date().toISOString().replace(/[:.]/g, '-')}`
        if (fs.existsSync(resolvedAuthDir)) {
            fs.renameSync(resolvedAuthDir, backupDir)
            fs.mkdirSync(resolvedAuthDir, { recursive: true, mode: 0o700 })
        console.error(`[crypto] Broken auth folder moved to ${backupDir}. Starting a fresh pairing socket.`)
        }
    } catch (resetError) {
        console.error(`[crypto] Could not reset the broken auth folder: ${resetError.message || resetError}`)
    }
    const brokenSocket = activeSocket
    activeSocket = null
    try {
        if (brokenSocket?.ws && typeof brokenSocket.ws.close === 'function') brokenSocket.ws.close()
    } catch (_) {}
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null
        if (global.__updateRestarting || activeSocket) return
        await startXeonBotInc()
    }, 3000)
    reconnectTimer.unref?.()
}

// libsignal can catch decryption failures inside its queue and print them
// directly instead of rejecting the Baileys message event. Intercept only
// known Signal failures so a stale session is recovered even when the panel
// launches `node index.js` directly rather than through the recovery wrapper.
const originalConsoleError = console.error.bind(console)
console.error = (...args) => {
    const text = args.map((value) => value instanceof Error ? value.stack || value.message : String(value)).join(' ')
    const signalError = isSignalDecryptError(text)
    if (signalError && signalRecoveryScheduled) return
    originalConsoleError(...args)
    if (signalConsoleIntercepting || !signalError) return
    signalConsoleIntercepting = true
    try { scheduleSignalSessionRecovery(new Error(text)) }
    finally { signalConsoleIntercepting = false }
}

// Memory optimization - Force garbage collection if available
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000) // every 1 minute

// Memory monitoring - Restart if RAM gets too high
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1) // Panel will auto-restart
    }
}, 30_000) // check every 30 seconds

let owner = readJson('./data/owner.json', { owner: settings.ownerNumber || '' })

global.botname = "LEE TECH BOT"
global.themeemoji = "•"
const authDir = process.env.AUTH_DIR || './session'

let sessionBundle = process.env.SESSION_BUNDLE || process.env.SESSION_ID || ''
const pairingWebEnabled = String(process.env.PAIRING_WEB_ENABLED || '').trim().toLowerCase() === 'true'
const pairingWebToken = process.env.PAIRING_WEB_TOKEN || randomBytes(32).toString('base64url')
const hostPairingRuntime = { connection: 'starting', ready: false, connected: false, registered: false, qr: '', error: '', mode: null }
let hostWebPairingMode = null
let hostWebPairingCodeInFlight = false
let hostPairingWebServer = null
const configuredHostPairingMode = resolveHostPairingMode(process.env)
let terminalQrMode = !pairingWebEnabled && configuredHostPairingMode?.mode === 'qr'
let terminalPairingNumber = !pairingWebEnabled && configuredHostPairingMode?.mode === 'pair' ? configuredHostPairingMode.phone : ''
let terminalPairingStopped = false
if (pairingWebEnabled && !process.env.PAIRING_WEB_TOKEN) {
    console.log(`[pairing-web] Private access key (copy from host logs and keep secret): ${pairingWebToken}`)
    console.log('[pairing-web] Open your bot service URL followed by /pairing to link WhatsApp directly into AUTH_DIR.')
}
if (sessionBundle) {
    try {
        const imported = restoreSessionBundle(sessionBundle, authDir)
        console.log(`[auth] SESSION_BUNDLE ${imported.imported ? `imported (${imported.files} files)` : imported.reason}.`)
    } catch (error) {
        console.error(`[auth] SESSION_BUNDLE could not be imported: ${error.message || error}`)
    }
}

// Katabump consoles can expose stdin without reporting a TTY, so keep the
// prompt available in both terminal and panel-console deployments.
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY })
const question = (text) => {
    if (rl && !rl.closed) {
        return new Promise((resolve) => rl.question(text, resolve))
    }
    const error = new Error('Pairing input console is closed')
    error.code = 'SESSION_INPUT_CLOSED'
    return Promise.reject(error)
}

function startHostPairingWebServer() {
    if (!pairingWebEnabled || hostPairingWebServer) return Promise.resolve()
    if (pairingWebToken.length < 24) {
        const error = new Error('PAIRING_WEB_TOKEN must be at least 24 characters when configured.')
        error.code = 'PAIRING_WEB_CONFIG_INVALID'
        return Promise.reject(error)
    }
    const rawPort = process.env.PAIRING_WEB_PORT || process.env.PORT || '8000'
    const port = Number(rawPort)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        const error = new Error('PAIRING_WEB_PORT/PORT must be an integer from 1 to 65535.')
        error.code = 'PAIRING_WEB_CONFIG_INVALID'
        return Promise.reject(error)
    }
    const host = process.env.PAIRING_WEB_HOST || '0.0.0.0'
    const pairing = createHostPairingServer({
        token: pairingWebToken,
        getRuntime: () => hostPairingRuntime,
        onMode: async (mode) => {
            hostWebPairingMode = mode
            hostPairingRuntime.mode = mode
            hostPairingRuntime.error = ''
            if (!activeSocket && !socketStartInFlight && !global.__updateRestarting) {
                startXeonBotInc().catch(error => {
                    hostPairingRuntime.error = 'The bot could not restart its WhatsApp connection. Check host logs.'
                    console.error('[pairing-web] Could not start bot socket:', error.message || error)
                })
            }
        },
        requestPairingCode: async (phone) => {
            if (hostWebPairingCodeInFlight) throw Object.assign(new Error('A code request is already in progress.'), { statusCode: 429 })
            if (!activeSocket || !hostPairingRuntime.ready) throw Object.assign(new Error('The WhatsApp connection is not ready.'), { statusCode: 503 })
            hostWebPairingCodeInFlight = true
            try {
                const code = await activeSocket.requestPairingCode(phone)
                hostPairingRuntime.error = ''
                return code
            } catch (error) {
                hostPairingRuntime.error = 'WhatsApp did not confirm the pairing-code request. Try QR mode or retry later.'
                throw error
            } finally {
                hostWebPairingCodeInFlight = false
            }
        }
    })
    hostPairingWebServer = pairing.server
    return new Promise((resolve, reject) => {
        const onError = error => { hostPairingWebServer = null; reject(error) }
        pairing.server.once('error', onError)
        pairing.server.listen(port, host, () => {
            pairing.server.off('error', onError)
            const address = pairing.server.address()
            const boundPort = typeof address === 'object' && address ? address.port : port
            console.log(`[pairing-web] Direct pairing page listening on ${host}:${boundPort}/pairing`)
            resolve()
        })
    })
}

async function startXeonBotInc() {
    if (activeSocket || socketStartInFlight || global.__updateRestarting || terminalPairingStopped) return activeSocket
    socketStartInFlight = true
    try {
        // Supply SESSION_BUNDLE/SESSION_ID in the environment, or choose a
        // session bundle, direct host pairing code, or direct host QR from the prompt.
        let { state, saveCreds } = await useMultiFileAuthState(authDir)
        hostPairingRuntime.registered = Boolean(state.creds.registered)
        hostPairingRuntime.connected = false
        await startHostPairingWebServer()
        if (!pairingWebEnabled && !state.creds.registered && configuredHostPairingMode?.mode === 'invalid') {
            throw new Error('Invalid PHONE_NUMBER or PAIRING_NUMBER. Use 8–15 digits including the country code, for example 254712345678.')
        }
        if (!state.creds.registered && !sessionBundle && !terminalPairingNumber && !terminalQrMode && !pairingWebEnabled) {
            const promptEnabled = process.env.SESSION_TERMINAL_PROMPT === 'true'
                || (process.stdin.isTTY && process.env.SESSION_TERMINAL_PROMPT !== 'false')
            if (!promptEnabled) {
                const error = new Error('No registered WhatsApp session. Set SESSION_BUNDLE, use AUTH_METHOD=qr for direct host QR pairing, configure PHONE_NUMBER with AUTH_METHOD=pair, or enable SESSION_TERMINAL_PROMPT=true for the host menu.')
                error.code = 'NO_SESSION_CONFIGURED'
                throw error
            }
            const choice = String(await question(chalk.bgBlack(chalk.greenBright('Choose how to connect this bot:\n1. Paste SESSION_BUNDLE from the pairing website\n2. Pair directly on this host with a phone-number code\n3. Pair directly on this host with a QR code\nChoice [1/2/3]: ')))).trim()
            const hostChoice = resolveHostMenuChoice(choice)
            if (!hostChoice) throw new Error('Choose 1, 2, or 3 and restart the bot.')
            if (hostChoice === 'pair') {
                terminalPairingNumber = normalizeWhatsAppNumber(await question(chalk.bgBlack(chalk.greenBright('Enter your international WhatsApp number with country code, digits only:\nNumber: '))))
                if (!terminalPairingNumber) {
                    const error = new Error('Invalid phone number. Restart and enter a complete international number, for example 254712345678.')
                    error.code = 'NO_SESSION_CONFIGURED'
                    throw error
                }
            } else if (hostChoice === 'qr') {
                terminalQrMode = true
            } else {
                const pasted = await question(chalk.bgBlack(chalk.greenBright('Paste SESSION_BUNDLE (or SESSION_ID) and press Enter:\n')))
                if (!String(pasted || '').trim()) {
                    const error = new Error('No session bundle was pasted. Choose a direct host method or add SESSION_BUNDLE to the environment.')
                    error.code = 'NO_SESSION_CONFIGURED'
                    throw error
                }
                sessionBundle = String(pasted).trim()
                restoreSessionBundle(sessionBundle, authDir)
                ;({ state, saveCreds } = await useMultiFileAuthState(authDir))
            }
        }
        if (!state.creds.registered && !terminalPairingNumber && !terminalQrMode && !pairingWebEnabled) {
            const error = new Error('No usable WhatsApp session. Choose direct host pairing (code or QR) or provide SESSION_BUNDLE.')
            error.code = 'NO_SESSION_CONFIGURED'
            throw error
        }
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            // Use the Web version bundled and tested with Baileys rc14.
            // Fetching a newer Web version can invalidate phone pairing codes.
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            // Keep outgoing messages flowing through messages.upsert so the
            // retry callback can return their original plaintext to WhatsApp.
            emitOwnEvents: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                // Never give Baileys the original payload for a message that
                // WhatsApp has revoked; doing so can make an old bot text be
                // retried and appear again after it was deleted.
                if (wasDeletedMessage(jid, key.id)) return undefined
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || undefined
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: Number(process.env.WA_KEEPALIVE_MS || 10000),
        })
        activeSocket = XeonBotInc

        // WhatsApp can leave replies to the linked bot account's own chat
        // showing "Waiting for this message" when the retry callback cannot
        // find the original self-chat message. Normalize self-chat JIDs,
        // remove the unsafe optional quote, and persist the returned outgoing
        // message as a final guarantee even if emitOwnEvents is delayed.
        const rawSendMessage = XeonBotInc.sendMessage.bind(XeonBotInc)
        XeonBotInc.sendMessage = async (jid, content, options = {}) => {
            const prepared = selfChatSendOptions(XeonBotInc, jid, options)
            const send = async () => {
                const sent = await rawSendMessage(prepared.jid, content, prepared.options)
                persistMessage(store, sent, settings.maxStoreMessages)
                return sent
            }
            if (!isSelfChat(XeonBotInc, jid)) return send()
            const warmupDelay = Math.max(250, selfChatWarmupUntil - Date.now())
            return enqueueSelfChatSend(prepared.jid, send, warmupDelay)
        }

        // Persist every pairing and key update. Keep the listener guarded so a
        // storage failure is visible without becoming an unhandled rejection
        // that can restart the bot after an otherwise successful pairing.
        XeonBotInc.ev.on('creds.update', async (update) => {
            try {
                await saveCreds(update)
            } catch (error) {
                console.error(`[auth] Could not persist WhatsApp session: ${error.message || error}`)
            }
        })

    store.bind(XeonBotInc.ev)

    // Message handling
    XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
        try {
            const mek = chatUpdate.messages[0]
            if (!mek.message) return
            // Do not process encrypted updates while Baileys is still opening
            // or handing off a reconnecting socket. Processing them too early
            // can create duplicate replies and WhatsApp's "waiting for this
            // message" placeholders while Signal sessions catch up.
            if (!XeonBotInc.__connectionOpened || activeSocket !== XeonBotInc) return
            const protocol = mek.message.protocolMessage
            if (protocol?.type === 0 && protocol.key?.id) {
                rememberDeletedMessage(protocol.key.remoteJid || mek.key?.remoteJid, protocol.key.id)
            }
            mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
            if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                await handleStatus(XeonBotInc, chatUpdate);
                return;
            }
            // Private/public/group/DM access is enforced by main.js through the
            // persisted mode and linked owner/sudo identity. Do not duplicate
            // that check here: XeonBotInc.public is not a synchronized setting
            // and an early gate incorrectly drops authorized private messages.
            if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

            try {
                await handleMessages(XeonBotInc, chatUpdate, true)
            } catch (err) {
                if (isSignalDecryptError(err)) {
                    logDecryptWarningOnce(mek.key?.id, err)
                    scheduleSignalSessionRecovery(err)
                    return
                }
                console.error("Error in handleMessages:", err)
                // Only try to send error message if we have a valid chatId
                if (mek.key && mek.key.remoteJid) {
                    await XeonBotInc.sendMessage(mek.key.remoteJid, {
                        text: '❌ An error occurred while processing your message.',
                        contextInfo: {
                            forwardingScore: 1,
                            isForwarded: true,
                            forwardedNewsletterMessageInfo: {
                                newsletterJid: '120363404186001130@newsletter',
                                newsletterName: 'LEE TECHBot MD',
                                serverMessageId: -1
                            }
                        }
                    }).catch(console.error);
                }
            }
        } catch (err) {
            if (isSignalDecryptError(err)) {
                logDecryptWarningOnce(chatUpdate?.messages?.[0]?.key?.id, err)
                scheduleSignalSessionRecovery(err)
                return
            }
            console.error("Error in messages.upsert:", err)
        }
    })

    // Add these event handlers for better functionality
    XeonBotInc.decodeJid = (jid) => {
        if (!jid) return jid
        if (/:\d+@/gi.test(jid)) {
            let decode = jidDecode(jid) || {}
            return decode.user && decode.server && decode.user + '@' + decode.server || jid
        } else return jid
    }

    XeonBotInc.ev.on('contacts.update', update => {
        for (let contact of update) {
            let id = XeonBotInc.decodeJid(contact.id)
            if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
        }
    })

    XeonBotInc.getName = (jid, withoutContact = false) => {
        id = XeonBotInc.decodeJid(jid)
        withoutContact = XeonBotInc.withoutContact || withoutContact
        let v
        if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
            v = store.contacts[id] || {}
            if (!(v.name || v.subject)) v = XeonBotInc.groupMetadata(id) || {}
            resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
        })
        else v = id === '0@s.whatsapp.net' ? {
            id,
            name: 'WhatsApp'
        } : id === XeonBotInc.decodeJid(XeonBotInc.user.id) ?
            XeonBotInc.user :
            (store.contacts[id] || {})
        return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
    }

    XeonBotInc.public = true

    XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

    let terminalPairingRequested = false
    let lastTerminalQr = ''
    const requestTerminalPairingCode = async () => {
        if (terminalPairingStopped || !terminalPairingNumber || terminalPairingRequested || state.creds.registered) return
        terminalPairingRequested = true
        try {
            for (let attempt = 1; attempt <= 3; attempt += 1) {
                try {
                    if (activeSocket !== XeonBotInc) return
                    const code = await XeonBotInc.requestPairingCode(terminalPairingNumber)
                    console.log(chalk.green(`Your terminal pairing code: ${String(code).match(/.{1,4}/g)?.join('-') || code}`))
                    console.log(chalk.yellow('Open WhatsApp → Linked devices → Link a device → Link with phone number instead, then enter the code.'))
                    return
                } catch (error) {
                    if (attempt === 3) throw error
                    await delay(2500)
                }
            }
        } catch (error) {
            terminalPairingRequested = false
            console.error(chalk.red(`Terminal pairing code unavailable: ${error.message || error}`))
        }
    }

    // Connection handling
    XeonBotInc.ev.on('connection.update', async (s) => {
        const { connection, lastDisconnect, qr } = s

        // A previous socket can emit delayed events during an update or
        // reconnect handoff. Never let those events print a second banner or
        // start another lifecycle action.
        if (activeSocket !== XeonBotInc) return
        
        if (connection) hostPairingRuntime.connection = connection
        hostPairingRuntime.connected = connection === 'open'
        hostPairingRuntime.registered = Boolean(XeonBotInc.authState?.creds?.registered)
        if (qr) {
            hostPairingRuntime.qr = qr
            hostPairingRuntime.ready = true
            hostPairingRuntime.error = ''
        }
        if (connection === 'open') {
            hostPairingRuntime.registered = true
            hostPairingRuntime.qr = ''
            hostPairingRuntime.ready = false
            hostPairingRuntime.error = ''
        } else if (connection === 'close') {
            hostPairingRuntime.connected = false
            hostPairingRuntime.ready = false
            hostPairingRuntime.qr = ''
        }

        if (connection === 'connecting') {
            if (XeonBotInc.__connectingLogged) return
            XeonBotInc.__connectingLogged = true
            console.log(chalk.yellow('🔄 Connecting to WhatsApp...'))
        }

        // Baileys emits a QR value while the unauthenticated socket is ready
        // for linking. Pairing-code requests must be made here: requesting
        // before this event can close the socket with a 401, while waiting for
        // `open` is too late because `open` happens only after linking.
        if (qr && terminalPairingNumber) {
            await requestTerminalPairingCode()
        }
        if (qr && terminalQrMode && qr !== lastTerminalQr) {
            lastTerminalQr = qr
            console.log(chalk.green('\nScan this QR from WhatsApp → Linked devices → Link a device. The QR refreshes automatically if it expires.'))
            try {
                console.log(await renderTerminalQr(qr))
            } catch (error) {
                console.error(chalk.red(`Could not render the host QR code: ${error.message || error}`))
            }
        }
        
        if (connection === "open") {
            if (XeonBotInc.__connectionOpened) return
            XeonBotInc.__connectionOpened = true
            // WhatsApp may report the WebSocket open before the own PN/LID
            // Signal sessions are usable. Delay only self-chat sends so the
            // first post-restart owner reply is not rendered as a retry
            // placeholder; groups and ordinary DMs remain immediate.
            selfChatWarmupUntil = Date.now() + 5000
            signalRecoveryScheduled = false
            signalDecryptFailures.length = 0
            if (reconnectTimer) {
                clearTimeout(reconnectTimer)
                reconnectTimer = null
            }
            reconnectAttempts = 0
            streamRestartAttempts = 0
            ackStreamAttempts = 0
            console.log(chalk.magenta(` `))
            console.log(chalk.yellow(`🌿Connected to => ` + JSON.stringify(XeonBotInc.user, null, 2)))

            if (!hasAnnouncedConnection) {
                hasAnnouncedConnection = true
                try {
                    const botNumber = XeonBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    await XeonBotInc.sendMessage(botNumber, {
                        text: `🤖 Bot connected successfully for the first time in this run.\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and ready!`,
                    });
                    fs.mkdirSync(path.dirname(connectionNoticePath), { recursive: true })
                    fs.writeFileSync(connectionNoticePath, JSON.stringify({ sent: true, sentAt: new Date().toISOString() }))
                } catch (error) {
                    console.error('Error sending initial connection message:', error.message)
                }
            }

            if (pendingRestartNotice?.targetJid) {
                const notice = pendingRestartNotice
                try {
                    await XeonBotInc.sendMessage(notice.targetJid, {
                        text: `✅ *Bot updated and restarted successfully*\nVersion: *${notice.version || settings.version}*\nRevision: *${notice.revision || 'archive'}*\nStatus: Online and ready.`
                    })
                    rmSync(pendingRestartNoticePath, { force: true })
                    pendingRestartNotice = {}
                } catch (error) {
                    console.error('Error sending post-restart update notice:', error.message || error)
                }
            }

            await delay(1999)
            console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ${global.botname || 'LEE TECH BOT'} ]`)}\n\n`))
            console.log(chalk.cyan(`< ================================================== >`))
            console.log(chalk.magenta(`\n${global.themeemoji || '•'} YT CHANNEL: Network Server`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} GITHUB: networkserver06-commits`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} WA NUMBER: ${owner}`))
            console.log(chalk.magenta(`${global.themeemoji || '•'} CREDIT: LEE TECH`))
            console.log(chalk.green(`${global.themeemoji || '•'} 🤖 Bot Connected Successfully! ✅`))
            console.log(chalk.blue(`Bot Version: ${settings.version}`))
        }
        
        if (connection === 'close') {
            if (activeSocket !== XeonBotInc) {
                console.log(chalk.yellow('Ignoring close event from a stale WhatsApp socket.'))
                return
            }
            XeonBotInc.__connectionOpened = false
            activeSocket = null
            if (global.__updateRestarting) {
                console.log(chalk.yellow('Update restart requested; suppressing reconnect for the closing socket.'))
                return
            }
            const statusCode = lastDisconnect?.error?.output?.statusCode
            const disconnectText = String(lastDisconnect?.error?.message || lastDisconnect?.error || '')
            const needsFreshPairing = statusCode === DisconnectReason.loggedOut || statusCode === 401
            hostPairingRuntime.connection = 'close'
            hostPairingRuntime.connected = false
            hostPairingRuntime.ready = false
            hostPairingRuntime.qr = ''
            hostPairingRuntime.registered = Boolean(XeonBotInc.authState?.creds?.registered)
            const hostWebPairingPending = Boolean(pairingWebEnabled && hostWebPairingMode && !XeonBotInc.authState?.creds?.registered)
            const terminalPairingPending = Boolean((terminalPairingNumber || terminalQrMode) && !XeonBotInc.authState?.creds?.registered) || hostWebPairingPending
            const shouldReconnect = !needsFreshPairing && !global.__updateRestarting
            const isStreamConflict = statusCode === 440 || /stream errored.*conflict|conflict.*stream errored/i.test(disconnectText)
            const isRestartRequired = statusCode === DisconnectReason.restartRequired || /stream errored.*restart required|restart required/i.test(disconnectText)
            const isAckStreamError = /stream errored.*\back\b|\back\b.*stream errored/i.test(disconnectText)

            if (isStreamConflict) {
                global.__conflictRestarting = true
                console.error(chalk.red('WhatsApp stream conflict detected. Another bot instance is using this auth folder; reconnecting is paused to avoid a loop. Stop the other instance, then restart this bot.'))
                try {
                    if (XeonBotInc?.ws && typeof XeonBotInc.ws.close === 'function') XeonBotInc.ws.close()
                } catch (_) {}
                return
            }

            if (isRestartRequired) {
                streamRestartAttempts += 1
                reconnectAttempts = 0
                const restartDelay = Math.min(120000, 15000 * (2 ** Math.min(streamRestartAttempts - 1, 3)))
                console.log(chalk.yellow(`WhatsApp requested a normal stream restart (515). Reconnecting in ${Math.ceil(restartDelay / 1000)}s (attempt ${streamRestartAttempts})...`))
                if (!reconnectTimer) {
                    reconnectTimer = setTimeout(async () => {
                        reconnectTimer = null
                        if (global.__updateRestarting || activeSocket) return
                        await startXeonBotInc()
                    }, restartDelay)
                }
                return
            }

            if (isAckStreamError) {
                ackStreamAttempts += 1
                reconnectAttempts = 0
                const ackDelay = Math.min(90000, 10000 * (2 ** Math.min(ackStreamAttempts - 1, 3)))
                console.warn(chalk.yellow(`WhatsApp ACK stream reset; preserving the paired session and reconnecting in ${Math.ceil(ackDelay / 1000)}s (attempt ${ackStreamAttempts}).`))
                if (!reconnectTimer) {
                    reconnectTimer = setTimeout(async () => {
                        reconnectTimer = null
                        if (global.__updateRestarting || activeSocket) return
                        await startXeonBotInc()
                    }, ackDelay)
                }
                return
            }
            
            console.log(chalk.red(`Connection closed due to ${lastDisconnect?.error} (status ${statusCode || 'unknown'}), reconnecting ${shouldReconnect}`))
            
            if ((statusCode === DisconnectReason.loggedOut || statusCode === 401) && !terminalPairingPending) {
                try {
                    rmSync(authDir, { recursive: true, force: true })
                    console.log(chalk.yellow(`Auth directory deleted: ${authDir}. Please re-authenticate.`))
                } catch (error) {
                    console.error('Error deleting session:', error)
                }
                console.log(chalk.red('Session logged out. Restart and choose direct host pairing (code or QR), or use the pairing website to create a new SESSION_BUNDLE.'))
            }

            if (terminalPairingPending && !global.__updateRestarting) {
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    if (hostWebPairingPending) {
                        try { rmSync(authDir, { recursive: true, force: true }) } catch (error) {
                            console.error('[pairing-web] Could not clear incomplete unregistered auth files:', error.message || error)
                        }
                        hostPairingRuntime.error = 'WhatsApp rejected this link attempt. Select QR or code and try a fresh attempt.'
                        console.error(chalk.red('WhatsApp rejected the bot-host pairing attempt. Incomplete unregistered auth files were cleared; the direct pairing page remains available so you can switch methods.'))
                        return
                    }
                    terminalPairingStopped = true
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer)
                        reconnectTimer = null
                    }
                    const method = terminalQrMode ? 'host QR linking' : 'host phone-number linking'
                    console.error(chalk.red(`WhatsApp rejected ${method} with status 401. No session was saved. Try the other direct-host method or use the pairing website.`))
                    return
                }
                reconnectAttempts = 0
                console.log(chalk.yellow('Terminal pairing socket closed before linking. Keeping the terminal pairing flow active and requesting a fresh code...'))
                if (!reconnectTimer) {
                    reconnectTimer = setTimeout(async () => {
                        reconnectTimer = null
                        if (global.__updateRestarting || activeSocket) return
                        await startXeonBotInc()
                    }, 3000)
                }
                return
            }
            
            if (shouldReconnect) {
                if (reconnectTimer) return
                reconnectAttempts += 1
                const backoffMs = Math.min(60000, 5000 * (2 ** Math.min(reconnectAttempts - 1, 4)))
                console.log(chalk.yellow(`Reconnecting in ${Math.ceil(backoffMs / 1000)}s (attempt ${reconnectAttempts})...`))
                reconnectTimer = setTimeout(async () => {
                    reconnectTimer = null
                    if (global.__updateRestarting || activeSocket) return
                    await startXeonBotInc()
                }, backoffMs)
            }
        }
    })

    // Track recently-notified callers to avoid spamming messages
    const antiCallNotified = new Set();

    // Anticall handler: block callers when enabled
    XeonBotInc.ev.on('call', async (calls) => {
        try {
            const { readState: readAnticallState } = require('./commands/anticall');
            const state = readAnticallState();
            if (!state.enabled) return;
            for (const call of calls) {
                const callerJid = call.from || call.peerJid || call.chatId;
                if (!callerJid) continue;
                try {
                    // First: attempt to reject the call if supported
                    try {
                        if (typeof XeonBotInc.rejectCall === 'function' && call.id) {
                            await XeonBotInc.rejectCall(call.id, callerJid);
                        } else if (typeof XeonBotInc.sendCallOfferAck === 'function' && call.id) {
                            await XeonBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
                        }
                    } catch {}

                    // Notify the caller only once within a short window
                    if (!antiCallNotified.has(callerJid)) {
                        antiCallNotified.add(callerJid);
                        setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                        await XeonBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.' });
                    }
                } catch {}
                // Then: block after a short delay to ensure rejection and message are processed
                setTimeout(async () => {
                    try { await XeonBotInc.updateBlockStatus(callerJid, 'block'); } catch {}
                }, 800);
            }
        } catch (e) {
            // ignore
        }
    });

    XeonBotInc.ev.on('group-participants.update', async (update) => {
        await handleGroupParticipantUpdate(XeonBotInc, update);
    });

    XeonBotInc.ev.on('messages.upsert', async (m) => {
        if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
            await handleStatus(XeonBotInc, m);
        }
    });

    XeonBotInc.ev.on('status.update', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    XeonBotInc.ev.on('messages.reaction', async (status) => {
        await handleStatus(XeonBotInc, status);
    });

    socketStartInFlight = false
    return XeonBotInc
    } catch (error) {
        socketStartInFlight = false
        activeSocket = null
        if (error?.code === 'NO_SESSION_CONFIGURED' || error?.code === 'SESSION_INPUT_CLOSED' || error?.code === 'ERR_USE_AFTER_CLOSE' || error?.code === 'PAIRING_WEB_CONFIG_INVALID') {
            console.error(error.message)
            process.exit(1)
        }
        console.error('Error in startXeonBotInc:', error)
        await delay(Math.min(30000, 5000 * Math.max(1, reconnectAttempts)))
        if (!activeSocket && !reconnectTimer && !global.__updateRestarting) startXeonBotInc()
    }
}


// Start the bot with error handling
startXeonBotInc().catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
})
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
    if (isSignalDecryptError(err)) scheduleSignalSessionRecovery(err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
    if (isSignalDecryptError(err)) scheduleSignalSessionRecovery(err)
})

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})
