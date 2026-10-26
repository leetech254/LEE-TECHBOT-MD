# LEE TECH BOT — Premium Upgrade

This release hardens the existing Baileys bot without removing its existing command catalog. It is intended to be deployed as a fresh application build, with credentials supplied through environment variables.

## What changed

- **Secrets removed from source:** owner number, Giphy key, and provider keys are now read from `.env` or the host’s secret manager.
- **Owner authorization fixed:** an unset `OWNER_NUMBER` can no longer authorize every sender because an empty string matched every JID.
- **Startup made safe:** saved sessions reconnect silently; new sessions can use the QR-first bot-host `/pairing` website or the direct code/QR/bundle options.
- **Message resilience added:** duplicate WhatsApp deliveries are ignored, command bursts are rate-limited, and lightweight health metrics are maintained in memory.
- **State writes made safer:** new runtime helpers support atomic JSON replacement and safe fallback reads, preventing partially-written state files.
- **Deployment scripts corrected:** the Docker image command is valid, the project has a reproducible `package-lock.json`, and `npm run check` performs syntax and test validation.
- **Runtime cleanup fixed:** temporary-file cleanup no longer calls `.catch()` on a non-Promise callback return.
- **Premium AI chatbot:** `.chatbot on` can use any OpenAI-compatible provider through `AI_API_URL`, `AI_API_KEY`, and `AI_MODEL`, with timeout and bounded retry controls.
- **Responsible anti-ban protection:** duplicate suppression, command throttling, bounded AI retries, and exponential reconnect backoff reduce accidental spam and connection churn. No bot can guarantee immunity from WhatsApp enforcement; use the official terms-compliant account and avoid bulk messaging.
- **Stream-conflict recovery:** a WhatsApp `Stream Errored (conflict)` is treated as a single-process session collision. The bot closes the conflicted socket and exits once so Katabump/Pterodactyl can restart one clean instance instead of repeatedly creating competing sockets.
- **Connection stability and throughput:** reconnects reuse one negotiated Baileys version instead of downloading a potentially different version on every handoff, message retry state is no longer cleared on every message, duplicate socket starts are suppressed, and Signal decryption failures are recovered through the same guarded session-rotation path. `WA_KEEPALIVE_MS` can tune the keepalive interval; the default remains 10 seconds for responsive panel deployments.
- **Complete chat modes:** `.mode public`, `.mode private`, `.mode group`, and `.mode dm` are persisted. `public` allows everyone in groups and DMs; `private` allows only the owner, sudo, or developer in groups and DMs; `group` allows everyone in groups only; and `dm` allows everyone in private chats only.
- **Privacy improved:** example owner and premium data files no longer contain personal phone numbers.
- **Panel deployment optimized:** Katabump can use `npm run install:panel` for lockfile-based production installs and `npm run start:panel` for a bounded-memory production process; npm audit, funding, and progress overhead are disabled through `.npmrc`.
- **Terminal deployment added:** local VPS, Linux terminal, and SSH deployments can use `npm run deploy:terminal`; it installs dependencies, applies the Baileys pairing patch, rebuilds `sharp`, and starts the bot with the direct pairing website or optional host prompt.
- **Termux compatibility improved:** native `sharp` loading is optional at startup, so pairing and core bot features can run on Android; sharp-based image commands report a clear feature-level warning if Android cannot build `sharp`.

## Secure setup

1. Copy `.env.example` to `.env`.
2. Set `OWNER_NUMBER` to the bot owner’s international number, digits only. The developer/super-owner support number is fixed in `settings.js` as `254116553618`, does not use an environment variable, and is included automatically by `.owner`.
3. For direct bot-host pairing, default `PAIRING_WEB_ENABLED=auto` serves `/pairing` on normal boots, starts QR automatically when no session exists, and reopens after a saved-session 401. It binds to `SERVER_PORT` on panel hosts or `PORT` on Heroku/Render/Railway/Koyeb, with `0.0.0.0` as the public bind address; the included `Procfile` runs `web: npm start`. Expose that port through the provider's HTTP/domain feature and keep `AUTH_DIR` persistent. Open the assigned public service URL followed by `/pairing`, or use the standalone pairing site's **On bot host** tab and **Check bot-host status** control. No key or `SESSION_BUNDLE` copy is needed. Keep the link private; after 30 minutes, use the page's **Start a new pairing** button rather than restarting the bot. Heroku dyno disk is ephemeral and does not preserve `AUTH_DIR`; a durable auth store is required to survive dyno replacement.
4. Add provider keys only for services you actually use.
5. Keep the `session/` directory private and never commit it.
6. Install and validate with:

```bash
npm run install:panel
npm run check
npm run start:panel
```

The bot defaults to public mode and the `.` prefix. Change `BOT_MODE` and `PREFIX` in `.env` or use the bot’s owner settings where supported.

## Terminal deployment

On a Linux terminal or VPS, clone the repository and run:

```bash
git clone https://github.com/networkserver06-commits/LEE-TECHBOT-MD.git
cd LEE-TECHBOT-MD
npm run deploy:terminal
```

For a new session, the terminal prompts for the complete international WhatsApp number. Enter digits such as `254781231617`; formatted values such as `+254 781 231 617` are also normalized. Keep `./session` on persistent disk. For a background terminal service, use a process manager such as systemd or PM2 and ensure only one process uses the session directory.

### Termux and VPS prerequisites

On Termux:

```bash
pkg update -y
pkg install nodejs-lts git ffmpeg -y
git clone https://github.com/networkserver06-commits/LEE-TECHBOT-MD.git
cd LEE-TECHBOT-MD
npm run deploy:termux
```

On a VPS, install Node.js, Git, and FFmpeg, then run `npm run deploy:terminal`. Termux and VPS deployments must keep `./session` persistent and run only one bot process per session. Termux intentionally skips the unsupported Android ARM64 sharp package; the core WhatsApp connection does not depend on sharp, so only sharp-based image commands are unavailable on Termux. VPS/Linux installs still build sharp normally.

## Katabump panel linking-code deployment

You **do not** need to upload a session file or configure `SESSION_ID`. Add these panel environment variables:

```env
PHONE_NUMBER=
PAIRING_NUMBER=
PAIRING_CODE=true
AUTH_METHOD=pairing
USE_MOBILE=false
AUTH_DIR=./session
```

Start the bot with `npm start`. If a saved session exists, it reconnects without asking anything. For a new session, it creates the auth directory automatically and prompts directly in the Katabump console for the WhatsApp number. Enter digits with country code, for example `254781231617`; the linking code is then printed in the logs. Keep `AUTH_DIR` on persistent panel storage so the bot reconnects without relinking.

If the Katabump console closes stdin, set `PHONE_NUMBER=254781231617` as a panel environment variable and fully restart/redeploy the application. The bot also accepts `PAIRING_NUMBER`, `PAIRING_PHONE`, `WHATSAPP_NUMBER`, `WHATSAPP_PHONE`, `WA_NUMBER`, `BOT_PHONE_NUMBER`, or `OWNER_NUMBER` as aliases. A numeric `PAIRING_CODE` is also accepted for legacy panel configurations, although `PAIRING_NUMBER` is preferred. The variable must be attached to the running service, not only saved in a local `.env` file. Startup logs report only `number detected` or `number missing`; they never print the number.

If WhatsApp displays “Waiting for this message” and the console reports `Bad MAC`, `verifyMAC`, or “failed to decrypt,” the saved Signal session is stale or corrupted. The bot now skips that message without sending a misleading error reply, but cryptographic state cannot be repaired in place. Stop the bot, remove the contents of the configured `AUTH_DIR`, remove the old linked device in WhatsApp, and link again with a new pairing code. Run only one bot process against each `AUTH_DIR` and prefer an absolute Katabump path such as `/home/container/session`.

The same recovery applies when libsignal reports `SessionError: Over 2000 messages into the future`. The bot logs the issue, closes the affected socket, and reconnects while preserving `AUTH_DIR`; the supervisor also restarts the process without renaming or deleting credentials. This prevents a transient decryption error from silently removing the linked device. Only an explicit WhatsApp logout (`401`/`loggedOut`) clears credentials and requires pairing again. If a Signal session is genuinely unrecoverable, stop the bot and reset `AUTH_DIR` manually after confirming that a new pairing is acceptable.

To use terminal-only direct QR pairing on a host that cannot expose HTTP, set `AUTH_METHOD=qr`; the QR is rendered in the host console and credentials are saved to `AUTH_DIR`. For interactive hosts that can expose the web port, choose option 3 at startup to open the deployed pairing page. A saved session reconnects without showing the pairing menu.

## AI chatbot

Configure an OpenAI-compatible endpoint, for example `AI_API_URL=https://api.openai.com/v1`, plus a private `AI_API_KEY`. Then an administrator can enable group replies with `.chatbot on`. The bot only responds when mentioned or when a user replies to the bot, which reduces unsolicited traffic. If no AI key is configured, the existing compatibility provider remains available.

## Operations

The command burst limit defaults to eight commands per sender per ten seconds. Tune `COMMAND_RATE_LIMIT` and `COMMAND_RATE_WINDOW_MS` for the deployment. `global.botHealth.snapshot()` is available to an internal diagnostics integration if a health endpoint is added later.

The owner-only `.update` command now updates directly from the repository’s GitHub `main` branch. A Git checkout uses `git fetch` and a ZIP deployment automatically uses the public main-branch archive, so `UPDATE_ZIP_URL` is optional. WhatsApp receives visible progress stages, the final Git revision and package version, and one restart notice. The command installs JavaScript dependencies without blocking on optional native `sharp` scripts, then restarts according to the host: the configured PM2 app (`PM2_APP_NAME`, default `leetechbot`), a clean panel exit for Katabump/Pterodactyl supervisors, or a delayed detached Node restart on a direct VPS host. Set `RESTART_COMMAND` for a custom supervisor command, `RESTART_MODE=panel|pm2|none` to force behavior, or leave `RESTART_MODE=auto` by default.

## Dependency note

The current feature set contains several legacy media and scraper packages. `npm audit` reports transitive vulnerabilities, including issues through `libsignal`, `sharp`, `request`, `ytdl-core`/scrapers, and older parser packages. They should be migrated in a dedicated compatibility pass rather than applying `npm audit fix --force`, which proposes breaking upgrades. Do not expose the bot to untrusted arbitrary code execution while legacy `.eval` functionality remains enabled; keep owner credentials private and consider removing that command for multi-operator deployments.

## Premium Text-Only Menu Styling

The menu can remain fully text-only while using persistent border themes and heading fonts. These settings are stored in `data/menuSettings.json` and survive restarts.

Owner commands:

- `.menumode text` — disable the menu image and use text-only mode.
- `.menustyle premium|neon|minimal|terminal|royal` — select the border and section design.
- `.menustyle status` — show the active border theme.
- `.menufont clean|bold|double|mono` — select the heading font treatment. Command lines remain normal text so they stay easy to copy and use.
- `.menufont status` — show the active heading font.

Recommended combinations include `cyberpunk` with `bold` for a neon-terminal look, `neon` with `bold` for a high-contrast premium look, `terminal` with `mono` for a developer console style, and `minimal` with `clean` for maximum compatibility on older WhatsApp clients. If a font is not rendered by a particular client, switch back to `.menufont clean`; command functionality is unaffected.

## Delayed duplicate-message protection

Inbound WhatsApp message IDs are now deduplicated for 24 hours by default. This prevents a delayed redelivery after a message deletion, reconnect, or temporary stream interruption from entering the command router again and causing the bot to send the same text twice. Deployments can tune the window with `MESSAGE_DEDUPE_TTL_MS` when necessary.

## Heroku durable session storage

Heroku dyno filesystems are ephemeral. The bot now supports an optional S3-compatible auth store so Baileys credentials are restored before startup and synchronized after credential updates. This is required if a Heroku dyno replacement must reconnect without pairing again.

Create a private bucket in AWS S3, Cloudflare R2, Backblaze B2, or another S3-compatible provider. Set these Heroku Config Vars (never commit them):

```env
AUTH_STORE=s3
AUTH_DIR=/tmp/lee-techbot-auth
S3_BUCKET=your-private-bucket
S3_REGION=us-east-1
S3_PREFIX=lee-techbot/production/auth
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
# Required for R2, B2, MinIO, or another non-AWS endpoint:
S3_ENDPOINT=https://your-s3-compatible-endpoint
S3_FORCE_PATH_STYLE=false
AUTH_STORE_DEBOUNCE_MS=2000
```

For AWS S3, leave `S3_ENDPOINT` empty. For Cloudflare R2, use the account endpoint and set `S3_REGION=auto`. Grant the access key only `s3:GetObject`, `s3:PutObject`, and `s3:DeleteObject` on the chosen bucket/prefix. Keep exactly one `web` dyno using a given WhatsApp auth store; multiple bot processes sharing one session can cause WhatsApp stream conflicts.

On boot the app restores the latest version referenced by `current.json`, then Baileys opens from that restored directory. Credential updates are written locally first and uploaded as an immutable generation; the pointer is published last so a dyno restart never reads a half-uploaded generation. An explicit WhatsApp logout clears the remote pointer and requires a new pairing. Old generations may remain for manual recovery and can be lifecycle-expired in the bucket.
