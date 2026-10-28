# Lambda image for calm / Quran reels: the site's renderer (server/calm-render.ts) on the same Alpine, ffmpeg and
# fonts as the site's own image (Dockerfile at the repo root), so a reel looks the same wherever it is made.
# Build from the repo root:  docker build -f lambda/reel/Dockerfile -t sawtik-reel-render .

# ---------- Bundle the handler and the renderer into one file (sharp stays a native module) ----------
FROM node:24-alpine AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY server ./server
COPY src ./src
COPY lambda ./lambda
RUN npx esbuild lambda/reel/bootstrap.ts --bundle --platform=node --target=node24 --format=cjs \
      --external:sharp --outfile=dist/bootstrap.cjs

# ---------- Runtime ----------
FROM node:24-alpine
RUN apk add --no-cache ffmpeg font-noto-arabic font-noto font-noto-kufi-arabic font-noto-naskh-arabic
WORKDIR /var/task
RUN npm init -y >/dev/null && npm install --omit=dev sharp@0.35.5 && npm cache clean --force
# Caption fonts (Pango through sharp) and the day-sticker artwork, at the paths the renderer resolves
COPY fonts ./fonts
RUN mkdir -p /usr/share/fonts/sawtik && cp fonts/*.ttf /usr/share/fonts/sawtik/ && fc-cache -f >/dev/null
COPY public/days ./public/days
COPY --from=build /build/dist/bootstrap.cjs ./bootstrap.cjs
# Only /tmp is writable in Lambda (clips, frames, fontconfig cache)
ENV NODE_ENV=production HOME=/tmp XDG_CACHE_HOME=/tmp
ENTRYPOINT ["node", "/var/task/bootstrap.cjs"]
