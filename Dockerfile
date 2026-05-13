# syntax=docker/dockerfile:1
# Build front (dist-all) + native deps (better-sqlite3).
FROM node:22-bookworm AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Vite is invoked with `--mode all`, i.e. it reads `.env.all`. The BuildKit
# secret `vite_build_env` (declared in docker-compose) is the source file:
# we materialise it as `.env.all` just for the duration of the build and
# delete it before the image layer is finalised.
RUN --mount=type=secret,id=vite_build_env,target=/run/vite_build_env,required=false \
  bash -c 'set -euo pipefail; \
    if [ -s /run/vite_build_env ]; then cp /run/vite_build_env .env.all; fi; \
    npm run build:all; \
    rm -f .env.all'

# Runtime image: only what `node server/index.js` needs.
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# /data is mounted as a volume in docker-compose: SQLite DB + upload staging.
RUN mkdir -p /data /data/uploads \
  && chown -R node:node /data

ENV NODE_ENV=production
ENV PORT=3002
ENV PORTAL_ADMIN_DB_PATH=/data/admin.db
ENV PORTAL_UPLOAD_STAGING_DIR=/data/uploads

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/shared ./shared
COPY --from=builder --chown=node:node /app/dist-all ./dist-all

USER node
EXPOSE 3002

CMD ["node", "server/index.js"]
