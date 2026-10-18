<div align="center">
  <h1>LEE TECHBOT</h1>
  <a href="https://git.io/typing-svg">
    <img src="https://readme-typing-svg.demolab.com?font=Rockwell&size=45&pause=1000&color=33ff00&center=true&width=800&height=80&lines=LEE+TECHBOT;Multi+Device+WhatsApp+Bot;Made+by+LEE+TECH" alt="LEE TECHBOT" />
  </a>
</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/networkserver06-commits/LEE-TECHBOT-MD/main/assets/bot_image.jpg" alt="LEE TECHBOT" height="280">
</div>

---

<div align="center">
  <img src="https://readme-typing-svg.demolab.com/?lines=Deploy+LEE+TECHBOT;On+free+hosting+panels+easily" alt="Deploy LEE TECHBOT on free hosting panels" />
</div>

---

> ⚡ **Quick Actions**

<div align="center">

| Action | Link |
|--------|------|
| **Fork Repository** | <a href="https://github.com/networkserver06-commits/LEE-TECHBOT-MD/fork"><img src="https://img.shields.io/badge/Fork%20Repo-24292e?style=for-the-badge&logo=github&logoColor=white" alt="Fork repository"></a> |
| **Download ZIP** | <a href="https://github.com/networkserver06-commits/LEE-TECHBOT-MD/archive/refs/heads/main.zip"><img src="https://img.shields.io/badge/Download-2ea043?style=for-the-badge&logo=github&logoColor=white" alt="Download ZIP"></a> |

</div>

---

> 🌐 **Free Deployment Options**

<div align="center">

| Platform | Button |
|----------|--------|
| **Katabump** | <a href="https://rl.katabump.fr/2db624"><img src="https://img.shields.io/badge/Katabump-5b21b6?style=for-the-badge&logo=server&logoColor=white" alt="Deploy on Katabump"></a> |
| **Bot Hosting** | <a href="https://bot-hosting.net/?aff=leetech254"><img src="https://img.shields.io/badge/Bot%20Hosting-111827?style=for-the-badge&logo=server&logoColor=white" alt="Deploy on Bot Hosting"></a> |

</div>

> **Recommended start command:** `npm start`
> **Node.js:** 18 or newer, with Node.js 20+ recommended.
> **Important:** Free hosts may sleep, restart, or delete storage. Keep the bot’s auth/session directory persistent.

---

> 🔑 **Session & Pairing**

<div align="center">

| Method | Button |
|--------|--------|
| **Pairing Site** | <a href="https://proper-badger-techlee-pair.koyeb.app/"><img src="https://img.shields.io/badge/Pair%20WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="Open pairing site"></a> |

</div>

1. For bundle-based linking, open the pairing site and use **QR scan** or **Pairing code**. To link directly into the bot host instead, use the site’s **On bot host** tab and follow the section below.
2. For the bundle-based flow only, copy the complete single-line `LEE-TECHBOT~...` token sent first to WhatsApp.
3. Add it to your host environment variables:

```env
BOT_MODE=private
PREFIX=.
AUTH_DIR=./auth
SESSION_BUNDLE=LEE-TECHBOT~your_complete_session_token
```

4. Start or restart the bot with `npm start`.

### Pair directly on the bot host (third website option)

At startup choose **3** to start the bot-host pairing website. It binds to `0.0.0.0` on `PAIRING_WEB_PORT`, the platform's `PORT`, or port `8000`, starts with QR pairing, and keeps polling until WhatsApp links. The web page also offers phone-number code. Credentials are saved directly into `AUTH_DIR`, so no `SESSION_BUNDLE` copy is needed. No private key or access key is required.

For a public URL, expose this same Node service through the hosting panel's HTTP/domain feature. On Bot-Hosting.net, use the service's **Domains** tab to activate a server-provided HTTPS subdomain; then open `<assigned-public-url>/pairing`, or enter the public service URL in the pairing site's **On bot host** tab. The panel's deployment/dashboard URL is not the app URL. The process must be running and the public domain must map to the port where the bot is listening. `PAIRING_WEB_PUBLIC_URL` is optional and only makes the bot print the assigned URL in its logs.

Alternatively set `PAIRING_WEB_ENABLED=true` to start the page on every bot boot. The page is deliberately open during pairing so there is no key to enter: anyone who gets the link during that short window can control pairing. Keep the link private; pairing controls stop once linked, and an unlinked window closes after 30 minutes. Keep `AUTH_DIR` on persistent storage and run only one bot process against it.

For hosts without an interactive console, set `PAIRING_WEB_ENABLED=true` and expose an HTTP domain/port. For hosts that cannot expose HTTP, use one of these environment configurations and restart the bot:

```env
# Direct QR pairing; scan the QR displayed in the host console/logs
AUTH_METHOD=qr
AUTH_DIR=./auth
```

```env
# Direct phone-number code pairing
AUTH_METHOD=pair
PHONE_NUMBER=254712345678
AUTH_DIR=./auth
```

Keep `AUTH_DIR` on persistent host storage and run only one bot process against it. If the host console does not accept interactive input, set `AUTH_METHOD=qr` for console QR or provide `PHONE_NUMBER` with `AUTH_METHOD=pair`; `SESSION_TERMINAL_PROMPT=true` enables the menu where the panel supports stdin.

> Never share `SESSION_BUNDLE`, commit `.env`, or run multiple bot processes with the same auth directory.

---

> 🛠️ **Useful Commands**

```text
.menu                 # Show the full command menu
.help <command>       # Command help
.ping                 # Check response speed
.health               # Check bot health
.mode private         # Restrict use to owner and sudo users
.tostatus hello 👋    # Post text to WhatsApp Status
```

The bot also includes group moderation, anti-link controls, stickers, downloads, text-to-speech, AI integrations, games, media tools, and owner-only group management.

---

> 💬 **Community & Support**

<div align="center">

| Platform | Link |
|----------|------|
| **WhatsApp Group** | <a href="https://chat.whatsapp.com/HyRgJzzjaVrI1ofiuKDHS2?s=cl&p=a&mlu=4&ilr=4"><img src="https://img.shields.io/badge/WhatsApp%20Group-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="Join WhatsApp group"></a> |
| **Telegram** | <a href="https://t.me/techleetel"><img src="https://img.shields.io/badge/Telegram-229ED9?style=for-the-badge&logo=telegram&logoColor=white" alt="Join Telegram"></a> |
| **YouTube** | <a href="https://www.youtube.com/@techlee-z2f"><img src="https://img.shields.io/badge/YouTube-FF0000?style=for-the-badge&logo=youtube&logoColor=white" alt="Visit YouTube channel"></a> |

</div>

---

> ⚠️ **Disclaimer**

LEE TECHBOT is an unofficial WhatsApp automation project and is not affiliated with WhatsApp or Meta. Use it responsibly, do not spam, and follow WhatsApp’s terms and applicable laws. Account restrictions or bans are possible.

<div align="center">
  <sub>Built with Baileys by <a href="https://github.com/networkserver06-commits">LEE TECH</a></sub>
</div>
