# Deploy LEE TECHBOT on HostKB Cloud

HostKB deploys this repository as a Docker-based Node.js web application. The included `Dockerfile` installs Node.js 20, FFmpeg, production dependencies, and starts the bot with `npm start`.

## 1. Connect the repository

In HostKB Cloud:

1. Create or open a project.
2. Create an application from a Git repository.
3. Connect `https://github.com/leetech254/LEE-TECHBOT-MD`.
4. Select the `main` branch.
5. Use the repository Dockerfile and expose the application HTTP port.
6. Enable auto-deploy on push if desired.

HostKB supplies the public HTTPS URL and the runtime `PORT`. Do not hard-code the public URL or replace the start command with a second bot process.

## 2. Configure environment variables

The bot uses an S3-compatible store for WhatsApp credentials because container-local files may not survive an application replacement. Add these variables in HostKB’s application environment settings before the first build:

```env
NODE_ENV=production
AUTH_STORE=s3
AUTH_DIR=/app/auth
PAIRING_WEB_ENABLED=auto
S3_BUCKET=your-private-bucket
S3_REGION=us-east-1
S3_PREFIX=lee-techbot/hostkb/production
S3_ENDPOINT=https://your-s3-compatible-endpoint
S3_ACCESS_KEY_ID=your-restricted-access-key
S3_SECRET_ACCESS_KEY=your-restricted-secret-key
S3_FORCE_PATH_STYLE=false
```

For AWS S3, leave `S3_ENDPOINT` empty. For Cloudflare R2, use `S3_REGION=auto`, set the account R2 S3 endpoint, and use an R2 access key with access limited to the configured prefix. Use a unique `S3_PREFIX` for every deployed bot.

Never commit these values, paste them into a public repository, or reuse a bucket prefix shared by another bot. Mark access keys and secrets as sensitive variables in HostKB.

Optional variables include `OWNER_NUMBER`, `BOT_MODE`, `PREFIX`, `PAIRING_WEB_PUBLIC_URL`, `HEALTHCHECK_URL`, and `HEALTHCHECK_AUTO_PING`. HostKB already keeps the service reachable through its application URL, so an external heartbeat is normally unnecessary; leave `HEALTHCHECK_AUTO_PING` unset unless you explicitly want one.

## 3. Build and pair

Build and deploy the application. When the status is **Running**, open:

```text
https://<your-hostkb-app-domain>/health
https://<your-hostkb-app-domain>/pairing
```

The bot binds to `0.0.0.0` and uses the provider-assigned `PORT`. The pairing page supports QR and phone-number pairing. Keep the pairing URL private while pairing is enabled.

After WhatsApp is linked, the credentials are synchronized to the S3-compatible store. On later container restarts, the bot restores the session before reconnecting. Run only one HostKB instance against a given `S3_PREFIX`.

## 4. Troubleshooting

- **The app fails with missing S3 configuration:** add `S3_BUCKET`, credentials, and the correct endpoint before restarting. This is intentional; pairing without durable storage can lose the WhatsApp session.
- **Health check fails:** confirm the HostKB app is configured as a web application and that the container is allowed to receive the injected `PORT`. Do not start a second process with another command.
- **Pairing page is unavailable:** open the application domain, not the HostKB dashboard URL, and append `/pairing`.
- **Session disappears after redeploy:** verify the bucket, prefix, region, endpoint, and access-key permissions. The `/health` response only proves that the process is alive; it does not prove that the auth store is durable.
- **The bot repeatedly reconnects:** confirm that only one running instance uses the same S3 prefix and that outbound HTTPS/WebSocket traffic is allowed.

HostKB’s current Node.js guide documents Git-based deployment, Dockerfile/Railpack builds, provider-assigned `PORT`, HTTPS, and real-time logs: <https://hostkb.com/docs/deploy-nodejs>.
