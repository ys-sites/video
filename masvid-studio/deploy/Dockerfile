# Node version follows scripts/runtime-lock.json and CI.
ARG NODE_VERSION=26.11.1

# Build stage: full dependencies, then the Studio bundle and generated UI.
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:studio

# Runtime stage: production dependencies, system Chromium, FFmpeg and fonts.
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates chromium ffmpeg fonts-noto-cjk fonts-noto-color-emoji tini \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY . .
COPY --from=build /app/studio/build ./studio/build
COPY --from=build /app/web/inline-video.html ./web/inline-video.html
COPY --from=build /app/mcp-ui/template-recommendations/build ./mcp-ui/template-recommendations/build

# The server listens on every container interface so Compose can publish the
# port; Compose publishes it on the host's loopback address only.
ENV PORT=4173 \
    MOTION_BIND_HOST=0.0.0.0 \
    MOTION_DATA_DIR=/data \
    MOTION_ACCOUNT_DIR=/data/account \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_FFMPEG_PATH=/usr/bin/ffmpeg \
    HYPERFRAMES_FFPROBE_PATH=/usr/bin/ffprobe
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["tini", "--"]
CMD ["node", "--experimental-strip-types", "server.ts"]
