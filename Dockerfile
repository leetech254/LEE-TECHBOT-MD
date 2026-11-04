FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    AUTH_DIR=/app/auth \
    PAIRING_WEB_ENABLED=auto \
    NODE_OPTIONS="--max-old-space-size=384 --expose-gc"

WORKDIR /app

# ffmpeg is used by media commands. Keep the runtime image self-contained.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=node:node . .
RUN mkdir -p /app/auth /app/data /app/temp \
    && chown -R node:node /app/auth /app/data /app/temp

USER node

# HostKB must attach persistent storage at this path. The WhatsApp session is
# stored here directly; no external database is required for this profile.
VOLUME ["/app/auth"]

# HostKB injects PORT at runtime. The application also exposes /health and /pairing.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
