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

# ffmpeg (with libass/fribidi/harfbuzz) renders the "voice video" MP4s; Noto fonts cover Arabic + Latin captions
RUN apk add --no-cache ffmpeg font-noto-arabic font-noto

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server.ts tsconfig.json vite.config.ts index.html metadata.json ./
COPY src ./src
COPY server ./server
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null || exit 1

CMD ["npx", "tsx", "server.ts"]
