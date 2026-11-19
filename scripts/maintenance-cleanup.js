'use strict'

const { resolveAuthDir } = require('../lib/storagePaths')
const { cleanupUnwantedFiles } = require('../lib/diskCleanup')

const removed = cleanupUnwantedFiles({ authDir: resolveAuthDir(process.env) })
console.log(`[maintenance] Removed ${removed.length} safe temporary, log, or old cache artifact(s).`)
console.log('[maintenance] Active auth, session, sessions, and data directories were preserved.')
