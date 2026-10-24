# ---------- Build stage: install deps + build the React/Vite frontend ----------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------- Runtime stage: Express server serving dist/ + API ----------
FROM node:24-alpine AS runtime
WORKDIR /app

# ffmpeg (with libass/fribidi/harfbuzz) renders the "voice video" MP4s; Noto fonts cover Arabic + Latin captions.
# Kufi and Naskh are the extra greeting fonts customers can pick (server/greeting-art.ts GREETING_FONTS).
RUN apk add --no-cache ffmpeg font-noto-arabic font-noto font-noto-kufi-arabic font-noto-naskh-arabic

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server.ts tsconfig.json vite.config.ts index.html metadata.json ./
COPY src ./src
COPY server ./server
# Arabic Google Fonts (OFL) for calm reels: installed system-wide so Pango (sharp) draws the captions with them
# (libass mis-shapes many of these faces, see server/calm-text.ts) and libass finds Amiri for the day sticker
COPY fonts ./fonts
RUN mkdir -p /usr/share/fonts/sawtik && cp fonts/*.ttf /usr/share/fonts/sawtik/ && fc-cache -f >/dev/null
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["npx", "tsx", "server.ts"]
