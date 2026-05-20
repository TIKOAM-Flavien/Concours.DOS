# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS builder
COPY . .
ARG VITE_BUILD_MODE=all
RUN --mount=type=secret,id=vite_build_env,target=/run/vite_build_env,required=false \
  sh -ec 'if [ -s /run/vite_build_env ]; then cp /run/vite_build_env .env.${VITE_BUILD_MODE}; fi; \
    case "${VITE_BUILD_MODE}" in \
      portal) npm run build:portal ;; \
      admin) npm run build:admin ;; \
      *) npm run build:all ;; \
    esac; \
    rm -f .env.portal .env.admin .env.all'

FROM node:22-bookworm-slim AS runner-base
WORKDIR /app
RUN mkdir -p /data/uploads && chown -R node:node /data
ENV NODE_ENV=production
ENV PORT=3002
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/package.json ./package.json
COPY --chown=node:node server ./server
COPY --chown=node:node src ./src
COPY --chown=node:node shared ./shared
USER node
EXPOSE 3002
CMD ["node", "server/index.js"]

FROM runner-base AS admin
ENV PORTAL_APP_ROLE=admin
ENV PORTAL_UPLOAD_STAGING_DIR=/data/uploads
COPY --from=builder --chown=node:node /app/dist-admin ./dist-admin

FROM runner-base AS portal
ENV PORTAL_APP_ROLE=portal
ENV PORTAL_UPLOAD_STAGING_DIR=/data/uploads
COPY --from=builder --chown=node:node /app/dist-portal ./dist-portal

FROM runner-base AS all
ENV PORTAL_APP_ROLE=all
ENV PORTAL_UPLOAD_STAGING_DIR=/data/uploads
COPY --from=builder --chown=node:node /app/dist-all ./dist-all
