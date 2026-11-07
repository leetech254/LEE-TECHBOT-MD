# Deploy LEE TECHBOT on HostKB Cloud

HostKB deploys this repository as a Docker-based Node.js web application. The included multi-stage `Dockerfile` uses Node.js 20 and downloads a self-contained static FFmpeg/FFprobe bundle; it does not run `apt-get` in the final image.

## 1. Connect the repository

In HostKB Cloud:

1. Create or open a project.
2. Create an application from a Git repository.
3. Connect `https://github.com/leetech254/LEE-TECHBOT-MD`.
4. Select the `main` branch.
5. Select **Docker/Dockerfile**, not Railpack, and expose the application HTTP port.
6. Enable auto-deploy on push if desired.

HostKB supplies the public HTTPS URL and the runtime `PORT`. Do not hard-code the public URL or replace the start command with a second bot process.

## 2. Configure environment variables

The HostKB Docker image is configured for local session storage. Attach a HostKB persistent, **read-write** volume to `/app/auth` before the first deploy. The bot writes the WhatsApp credentials directly to that volume, so no external database is required.

Set these variables in HostKB’s application environment settings:

```env
NODE_ENV=production
AUTH_DIR=/app/auth
PAIRING_WEB_ENABLED=auto
```

The included Dockerfile declares `/app/auth` as a volume. If HostKB exposes a volume or persistent-disk setting, attach it to exactly that path, choose read-write mode, and keep it when rebuilding or redeploying. Do not mount an empty replacement volume after pairing.

Optional variables include `OWNER_NUMBER`, `BOT_MODE`, `PREFIX`, `PAIRING_WEB_PUBLIC_URL`, `HEALTHCHECK_URL`, and `HEALTHCHECK_AUTO_PING`. HostKB already keeps the service reachable through its application URL, so an external heartbeat is normally unnecessary; leave `HEALTHCHECK_AUTO_PING` unset unless you explicitly want one.

Interactive shortcut buttons use the defaults **Ping**, **GitHub**, and **Menu**. You can replace them with up to three validated shortcuts using JSON. Commands are routed through the normal command handler, so existing permissions and bot mode restrictions still apply:

```env
MENU_SHORTCUTS=[{"label":"📊 Health","command":"health"},{"label":"🎨 Menu style","command":"menustyle"},{"label":"📋 Menu","command":"menu"}]
```

Arguments are supported, for example `{"label":"✨ Premium menu","command":"menustyle premium"}`. Do not put secrets in this variable. Owners can also use `menustyle` to open interactive style choices; the full command remains available for `minimal`, `terminal`, and `royal`.

## 3. Build and pair

Build and deploy the application. When the status is **Running**, open:

```text
https://<your-hostkb-app-domain>/health
https://<your-hostkb-app-domain>/pairing
```

The bot binds to `0.0.0.0` and uses the provider-assigned `PORT`. The pairing page supports QR and phone-number pairing. Keep the pairing URL private while pairing is enabled.

After WhatsApp is linked, the credentials are written to `/app/auth`. On a process restart, the bot reuses the existing credentials and reconnects automatically. The startup recovery wrapper never deletes or resets the session unless `SESSION_RECOVERY_RESET=true` is explicitly set. Run only one HostKB instance against the volume.

You can verify the save state without exposing credentials:

```text
https://<your-hostkb-app-domain>/health
```

The JSON response includes `sessionStorage.mode`, `sessionStorage.healthy`, `sessionStorage.lastSyncAt`, and `sessionStorage.lastSyncFiles`. The local-volume profile reports `mode: "local"`; confirm that the auth directory is mounted to the persistent volume and that the HostKB volume remains attached after restart. The endpoint never returns session files, QR data, or pairing codes.

## 4. Troubleshooting

- **The app loses its session after redeploy:** confirm that `/app/auth` is a HostKB persistent volume, not ordinary container storage, and that the same volume remains attached.
- **Build fails while unpacking FFmpeg packages:** confirm the deployment is using the current multi-stage Dockerfile from `main`; it downloads static binaries and should not show a long Debian `apt-get install ffmpeg` step.
- **Runtime shows `EACCES: mkdir '/app/auth/data'`:** the app is running with a non-writable auth mount. Change the HostKB mount to read-write and redeploy. Do not switch to Railpack, which does not apply the Dockerfile’s volume ownership setup.
- **Health check fails:** confirm the HostKB app is configured as a web application and that the container is allowed to receive the injected `PORT`. Do not start a second process with another command.
- **Pairing page is unavailable:** open the application domain, not the HostKB dashboard URL, and append `/pairing`.
- **The `/health` response only proves that the process is alive:** local session durability depends on HostKB retaining the `/app/auth` volume across replacement.
- **The bot repeatedly reconnects:** confirm that only one running instance uses the same S3 prefix and that outbound HTTPS/WebSocket traffic is allowed.

HostKB’s current Node.js guide documents Git-based deployment, Dockerfile/Railpack builds, provider-assigned `PORT`, HTTPS, and real-time logs: <https://hostkb.com/docs/deploy-nodejs>.
