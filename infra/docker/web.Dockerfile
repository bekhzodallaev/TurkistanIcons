# syntax=docker/dockerfile:1
# Multi-stage build for the Next.js web app. Build context is the repo root:
#   docker build -f infra/docker/web.Dockerfile -t turkistan/web .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

# ---- deps ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM deps AS build
COPY . .
RUN pnpm --filter @turkistan/types build \
 && pnpm --filter @turkistan/web build

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
EXPOSE 3000
CMD ["pnpm", "--filter", "@turkistan/web", "start"]
