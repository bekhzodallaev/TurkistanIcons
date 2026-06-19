# syntax=docker/dockerfile:1
# Multi-stage build for the NestJS API. Build context is the repo root:
#   docker build -f infra/docker/api.Dockerfile -t turkistan/api .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps: install with the full workspace manifest set ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
# Prisma schema is needed by the root postinstall (`prisma generate`).
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY . .
RUN pnpm --filter @turkistan/types build \
 && pnpm --filter @turkistan/api build \
 && pnpm --filter @turkistan/api deploy --prod /app

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4000
CMD ["node", "dist/main.js"]
