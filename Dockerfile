# syntax=docker/dockerfile:1

# Fetch a self-contained static FFmpeg bundle without pulling Debian's large
# FFmpeg dependency tree into the build or runtime image.
FROM alpine:3.20 AS ffmpeg-fetch
ARG FFMPEG_URL=https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz
ARG FFMPEG_SHA256=
RUN apk add --no-cache ca-certificates curl tar xz \
    && mkdir -p /opt/ffmpeg \
    && curl --fail --silent --show-error --location --retry 3 --retry-all-errors "$FFMPEG_URL" -o /tmp/ffmpeg.tar.xz \
    && if [ -n "$FFMPEG_SHA256" ]; then echo "$FFMPEG_SHA256  /tmp/ffmpeg.tar.xz" | sha256sum -c -; fi \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=1 \
    && test -x /opt/ffmpeg/ffmpeg \
    && test -x /opt/ffmpeg/ffprobe \
    && /opt/ffmpeg/ffmpeg -version | head -n 1 \
    && rm -f /tmp/ffmpeg.tar.xz

FROM node:20-bookworm-slim AS production
ENV NODE_ENV=production \
    AUTH_DIR=/app/auth \
    PAIRING_WEB_ENABLED=auto \
    NODE_OPTIONS="--max-old-space-size=384 --expose-gc"
WORKDIR /app

COPY --from=ffmpeg-fetch /opt/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg-fetch /opt/ffmpeg/ffprobe /usr/local/bin/ffprobe
RUN chmod 0755 /usr/local/bin/ffmpeg /usr/local/bin/ffprobe \
    && mkdir -p /app/auth /app/data /app/temp \
    && chown -R node:node /app/auth /app/data /app/temp

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force
COPY --chown=node:node . .

# HostKB should keep this volume attached and writable for the node user.
VOLUME ["/app/auth"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
USER node
CMD ["npm", "start"]
