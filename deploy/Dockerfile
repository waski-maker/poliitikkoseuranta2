# Multi-stage image for self-hosting: API (Node), worker (cron) and web (Caddy).
#   docker build -f deploy/Dockerfile --target api .
#   docker build -f deploy/Dockerfile --target web --build-arg VITE_API_URL=https://example.fi .
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

FROM base AS build
ARG VITE_API_URL=/
ARG VITE_BASE_PATH=/
ENV VITE_API_URL=$VITE_API_URL VITE_BASE_PATH=$VITE_BASE_PATH
RUN pnpm build:web && pnpm --filter @ps/api build

FROM node:22-bookworm-slim AS api
WORKDIR /app
COPY --from=build /app/apps/api/dist/server.mjs ./server.mjs
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["node", "server.mjs"]

# Worker: same CLI as GitHub Actions, scheduled with cron. Needs pg_dump for backups.
FROM base AS worker
RUN apt-get update -qq && apt-get install -y -qq cron postgresql-client && rm -rf /var/lib/apt/lists/*
COPY deploy/crontab /etc/cron.d/poliitikkoseuranta
RUN chmod 0644 /etc/cron.d/poliitikkoseuranta && crontab /etc/cron.d/poliitikkoseuranta
CMD ["sh", "-c", "printenv | grep -v '^_' > /etc/environment && pnpm db:migrate && pnpm db:seed && cron -f"]

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
