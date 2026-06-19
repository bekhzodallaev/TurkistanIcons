# syntax=docker/dockerfile:1
# Upload worker — same build as the API, different entrypoint. The worker is a
# separate process so it can be scaled independently (see docs/ARCHITECTURE.md).
#   docker build -f infra/docker/worker.Dockerfile -t turkistan/worker .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/ui/package.json packages/ui/package.json
# Prisma schema is needed by the root postinstall (`prisma generate`).
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @turkistan/types build \
 && pnpm --filter @turkistan/api build \
 && pnpm --filter @turkistan/api deploy --prod /app

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
CMD ["node", "dist/worker.js"]
