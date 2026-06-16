# Deployment Architecture — TurkistanIcons

How TurkistanIcons is built, shipped, and run — from a laptop to production at
scale (100k+ icons, 10k+ creators, millions of downloads). Stack and component
boundaries are defined in [ARCHITECTURE.md](ARCHITECTURE.md) and
[CLAUDE.md](../CLAUDE.md); this doc covers the runtime/infra side.

Deployable units (all stateless except the datastores):

- **web** — Next.js 15 (App Router), SSR/ISR.
- **api** — NestJS HTTP service (business logic, Prisma, R2 signed URLs, Stripe).
- **worker** — NestJS process consuming BullMQ queues (SVG sanitize, PNG/thumb
  render, search sync, embeddings). CPU-bound, scaled independently of `api`.

Backing services: **PostgreSQL** (system of record, + read replica in prod),
**Redis** (cache/sessions/BullMQ), **Cloudflare R2** (objects) behind
**Cloudflare CDN/WAF**.

---

## 1. Local development (Docker Compose)

One command brings up the whole stack. **MinIO** stands in for Cloudflare R2
(S3-compatible API), so the upload pipeline works offline.

```bash
docker compose -f infra/compose/docker-compose.yml up -d   # per CLAUDE.md
pnpm --filter api prisma migrate dev                        # apply migrations
pnpm dev                                                    # web + api (turbo); worker via compose
```

### 1.1 `infra/compose/docker-compose.yml`

```yaml
name: turkistan-icons

x-api-env: &api-env
  DATABASE_URL: postgresql://app:app@postgres:5432/turkistan?schema=public
  REDIS_URL: redis://redis:6379
  # MinIO as the R2 stand-in (S3-compatible)
  R2_ENDPOINT: http://minio:9000
  R2_ACCESS_KEY_ID: minioadmin
  R2_SECRET_ACCESS_KEY: minioadmin
  R2_BUCKET: icons
  R2_PUBLIC_URL: http://localhost:9000/icons
  NODE_ENV: development

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: turkistan
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d turkistan"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    ports: ["6379:6379"]
    volumes: ["redisdata:/data"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio: # Cloudflare R2 stand-in
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports: ["9000:9000", "9001:9001"] # API + web console
    volumes: ["miniodata:/data"]
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio-setup: # create the bucket on first run
    image: minio/mc:latest
    depends_on:
      minio: { condition: service_healthy }
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb -p local/icons &&
      mc anonymous set download local/icons || true"

  api:
    build:
      context: ../..
      dockerfile: infra/docker/api.Dockerfile
      target: dev
    environment:
      <<: *api-env
    command: pnpm --filter api start:dev
    ports: ["4000:4000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
    volumes:
      - ../../:/app
      - /app/node_modules

  worker:
    build:
      context: ../..
      dockerfile: infra/docker/worker.Dockerfile
      target: dev
    environment:
      <<: *api-env
    command: pnpm --filter api start:worker
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
    volumes:
      - ../../:/app
      - /app/node_modules

  web:
    build:
      context: ../..
      dockerfile: infra/docker/web.Dockerfile
      target: dev
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:4000
      NODE_ENV: development
    command: pnpm --filter web dev
    ports: ["3000:3000"]
    depends_on:
      api: { condition: service_started }
    volumes:
      - ../../:/app
      - /app/node_modules

volumes:
  pgdata:
  redisdata:
  miniodata:
```

> `api` and `worker` share one image (same NestJS codebase, different start
> command) — `worker.Dockerfile` can simply re-use `api.Dockerfile`. Kept
> separate here so worker-specific native deps (e.g. `sharp`, `librsvg`,
> rasterizer) can diverge if needed.

### 1.2 Dockerfiles (multi-stage)

All images are pnpm-workspace aware and multi-stage: a `deps` layer (cached),
a `build` layer, and a slim `runner`. A `dev` target supports the compose
hot-reload mounts above.

**`infra/docker/api.Dockerfile`**

```dockerfile
# ---- base: pnpm + corepack ----
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# ---- deps: install workspace deps (cached on lockfile) ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- dev target: full source, used by docker-compose with bind mount ----
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
RUN pnpm --filter api exec prisma generate
EXPOSE 4000
CMD ["pnpm", "--filter", "api", "start:dev"]

# ---- build: compile + prune to prod deps ----
FROM deps AS build
COPY . .
RUN pnpm --filter api exec prisma generate \
 && pnpm --filter api build \
 && pnpm deploy --filter api --prod /out

# ---- runner: minimal runtime ----
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
# native libs for SVG/PNG handled in worker image; api stays minimal
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
```

**`infra/docker/worker.Dockerfile`** — same as api but the runner installs the
rasterization toolchain and starts the worker:

```dockerfile
# reuse api stages...
FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
# librsvg/sharp deps for SVG sanitize + PNG/thumb render
RUN apt-get update && apt-get install -y --no-install-recommends \
      libvips librsvg2-2 fonts-noto && rm -rf /var/lib/apt/lists/*
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /out ./
USER app
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('./apps/api/dist/worker-health').check()" || exit 1
CMD ["node", "apps/api/dist/worker.js"]
```

**`infra/docker/web.Dockerfile`** — Next.js `standalone` output:

```dockerfile
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 3000
CMD ["pnpm", "--filter", "web", "dev"]

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm --filter web build      # next.config: output: 'standalone'

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --from=build --chown=app:app /app/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /app/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
```

---

## 2. Production topology

```
                              ┌───────────────────────────────────────┐
                              │            Cloudflare (edge)            │
                              │   DNS · TLS · WAF · bot/rate limiting   │
                              │   CDN cache (static + R2 asset bytes)   │
                              └───┬─────────────────────────────┬───────┘
                  app traffic     │                             │  asset bytes (SVG/PNG)
                                  │                             │  cached at edge
                       ┌──────────▼───────────┐        ┌────────▼─────────┐
                       │   Load Balancer /     │        │  Cloudflare R2   │
                       │   ingress (TLS term)  │        │  buckets:        │
                       └────┬─────────────┬────┘        │  icons (public)  │
                            │             │             │  quarantine(priv)│
              ┌─────────────▼──┐    ┌─────▼──────────┐  │  versioning ON   │
              │  web (Next.js) │    │  api (NestJS)  │  └──────────────────┘
              │  N replicas    │    │  N replicas    │            ▲
              │  stateless     │    │  stateless     │            │ signed PUT/GET
              └────────────────┘    └──┬────────┬────┘            │
                                       │        │                 │
              ┌────────────────────────┘        └───────────┐     │
              │                                              │     │
   ┌──────────▼───────────┐   ┌──────────────────┐  ┌───────▼─────┴───┐
   │  Managed PostgreSQL  │   │  Managed Redis    │  │  worker(s)      │
   │  primary (writes)    │   │  cache · sessions │  │  BullMQ:        │
   │     │  streaming      │   │  · BullMQ queues  │  │  sanitize/render│
   │     ▼  replication    │   └──────────────────┘  │  /search-sync   │
   │  read replica(s)     │◀───── search/browse ─────│  /embeddings    │
   │  PITR backups        │                          │  M replicas     │
   └──────────────────────┘                          └─────────────────┘
                                                              │
                        ┌─────────────────────────┬──────────┴─────────┐
                  ┌─────▼──────┐          ┌────────▼────────┐   ┌───────▼────────┐
                  │  Stripe    │          │  Meilisearch    │   │ Email (Resend) │
                  │ payments/  │          │ (Phase 2 search │   │ verify/reset/  │
                  │ webhooks   │          │  index)         │   │ receipts       │
                  └────────────┘          └─────────────────┘   └────────────────┘

  Observability (cross-cutting): Sentry (errors) · OpenTelemetry → traces/metrics
  · Prometheus + Grafana (metrics/dashboards/alerts) · log aggregation (Loki/Datadog)
```

Key properties:

- **web / api / worker are stateless** → scale horizontally; no sticky sessions
  (sessions/refresh tokens live in Redis, per DATABASE.md).
- **Reads go to the Postgres read replica** (browse/search), writes to primary
  (ARCHITECTURE.md §5). The api uses a replica-aware Prisma datasource.
- **Asset bytes never traverse the api** — clients PUT/GET R2 via signed URLs and
  the CDN serves cached objects (the millions-of-downloads path).

---

## 3. Hosting options & recommendation

| Option | Pros | Cons | Fit |
|--------|------|------|-----|
| **Fly.io** | Containers near users, easy multi-region, cheap, built-in private networking, managed Postgres/Redis available | Smaller managed-DB maturity; you own more of HA | **Recommended default for MVP→growth** |
| **Railway** | Fastest DX, great for MVP, managed PG/Redis, simple deploys | Costs climb with scale; less infra control | Great for earliest MVP/staging |
| **Render** | Simple, managed PG/Redis, autoscaling, cron, background workers as first-class | Less regional flexibility; pricier at scale | Solid middle ground |
| **AWS ECS Fargate** | Serverless containers, deep AWS integration (RDS, ElastiCache), mature | More setup (IAM, VPC, ALB, Terraform); ops overhead | When you need AWS ecosystem |
| **Kubernetes (EKS/GKE)** | Ultimate control, HPA, ecosystem | High operational cost; overkill early | Only at large scale / dedicated platform team |

**Recommendation:**

- **MVP / growth:** **Fly.io** — run `web`, `api`, `worker` as separate Fly apps
  (independent scaling), with **managed Postgres + read replica** and **managed
  Redis** (Upstash/Fly). Cloudflare in front for DNS/CDN/WAF, R2 for objects.
  Low cost, multi-region capable, minimal ops.
- **Scale / enterprise:** migrate to **AWS ECS Fargate** (RDS Postgres
  Multi-AZ + read replicas, ElastiCache Redis) if/when compliance, deep AWS
  integration, or org standardization demand it; Kubernetes only with a platform
  team.

R2 + Cloudflare are used in **every** tier regardless of compute host.

---

## 4. Environments

| Env | Purpose | Data | Notes |
|-----|---------|------|-------|
| **dev** | Local laptops | Disposable (compose, MinIO) | Hot reload; seeded fixtures |
| **staging** | Pre-prod mirror | Anonymized/synthetic | Same images + migrations as prod; runs e2e smoke; test Stripe keys, separate R2 bucket |
| **prod** | Live | Real | Manual approval gate to deploy; full observability |

Each environment is fully isolated: own database, Redis, R2 bucket, Stripe
account/keys, and secret set. Image promotion is **build once, deploy many** —
the exact image validated in staging is promoted to prod (no rebuild).

### 4.1 Config & secrets

- **Config contract:** `.env.example` is the source of truth for required vars
  (CLAUDE.md). App boots fail fast if required env is missing (zod-validated env
  schema at startup).
- **Secrets:** never in git. Use the platform secret store — Fly secrets / AWS
  Secrets Manager / Doppler / 1Password Connect. Injected as env at runtime.
- **Rotation:** DB/Redis/Stripe/R2 credentials rotatable without redeploy where
  the platform supports live secret updates; otherwise rolling restart.
- **Separation:** distinct secrets per environment; prod secrets accessible only
  to the deploy pipeline and on-call.

---

## 5. CI/CD pipeline (GitHub Actions)

Two workflows: **CI** on every PR (fast feedback), **CD** on merge to `main`
(staging → manual approval → prod).

```yaml
# .github/workflows/ci.yml
name: ci
on:
  pull_request:
  push: { branches: [main] }

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: test }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U app" --health-interval 5s
          --health-timeout 3s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    env:
      DATABASE_URL: postgresql://app:app@localhost:5432/test
      REDIS_URL: redis://localhost:6379
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint                                  # eslint
      - run: pnpm typecheck                             # tsc --noEmit, strict
      - run: pnpm --filter api exec prisma migrate deploy
      - run: pnpm test                                  # unit + integration
      - run: pnpm build                                 # turbo build all
```

```yaml
# .github/workflows/cd.yml
name: cd
on:
  push: { branches: [main] }

permissions: { contents: read, packages: write, id-token: write }

jobs:
  build-images:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with: { registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }} }
      - name: Build & push (api / worker / web)
        run: |
          for app in api worker web; do
            docker buildx build \
              -f infra/docker/$app.Dockerfile \
              -t ghcr.io/${{ github.repository }}/$app:${{ github.sha }} \
              -t ghcr.io/${{ github.repository }}/$app:latest \
              --target runner --push .
          done

  deploy-staging:
    needs: build-images
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4
      - name: Migrate DB (expand phase)             # run BEFORE rolling new code
        run: pnpm --filter api exec prisma migrate deploy
        env: { DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }} }
      - name: Deploy services
        run: ./infra/deploy.sh staging ${{ github.sha }}   # fly deploy / ecs update
      - name: E2E smoke
        run: pnpm test:e2e:smoke --base-url ${{ vars.STAGING_URL }}

  deploy-prod:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production            # GitHub "Environment" requires manual approval
    steps:
      - uses: actions/checkout@v4
      - name: Migrate DB (expand phase)
        run: pnpm --filter api exec prisma migrate deploy
        env: { DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }} }
      - name: Deploy services (rolling, zero-downtime)
        run: ./infra/deploy.sh production ${{ github.sha }}
      - name: E2E smoke + health gate
        run: pnpm test:e2e:smoke --base-url ${{ vars.PROD_URL }}
```

Pipeline stages: **lint → typecheck → test → build → migrate deploy → build/push
images → deploy (staging) → e2e smoke → manual approval → migrate + deploy
(prod) → e2e smoke**. Images are immutable and tagged by commit SHA; the same
SHA flows staging → prod.

---

## 6. Zero-downtime deploys & DB migrations

### 6.1 Rolling deploys

`web` / `api` / `worker` are stateless, so deploys are **rolling**: bring up new
replicas, wait for **readiness**, drain old ones (connection draining at the LB),
then terminate. No request is sent to a pod until `/health/ready` passes. Blue-
green is available on ECS/Fly for higher-risk releases; rolling is the default.

### 6.2 Expand / contract migration strategy

DB schema must be **backward compatible** with the currently running code, so
migrations run **before** the new image and never break the old one. Use the
three-phase **expand → migrate code → contract** pattern:

1. **Expand** (deploy N): add new columns/tables/indexes **nullable/with
   defaults**; create indexes **`CONCURRENTLY`** to avoid table locks (Prisma:
   put `CREATE INDEX CONCURRENTLY` in a migration marked to run outside a
   transaction). Old code ignores them.
2. **Migrate code** (deploy N): new app version reads/writes both old and new
   shapes; backfill data via a background/`worker` job.
3. **Contract** (deploy N+1, after old code is gone): drop old columns / rename
   completions / tighten `NOT NULL` constraints.

Rules: never rename a column in one step (add new → backfill → switch reads →
drop old); never make a column `NOT NULL` in the same release that adds it; large
backfills run in batches via BullMQ, not in the migration. `prisma migrate
deploy` (forward-only) runs in CI/CD before the rollout (§5). Roll forward to fix
issues; destructive rollbacks are avoided by design.

### 6.3 Migrations vs workers

`prisma migrate deploy` runs **once** per deploy (a CI step), never on every
container boot — multiple replicas must not race the migration. Workers and api
share the schema; deploy migrations before either rolls.

---

## 7. Health checks & readiness

| Endpoint | Used by | Checks |
|----------|---------|--------|
| `GET /health/live` (api) | LB/orchestrator liveness | process is up |
| `GET /health/ready` (api) | LB readiness / deploy gate | DB ping, Redis ping, R2 reachable |
| `GET /api/health` (web) | LB | server up, can reach api |
| worker heartbeat | orchestrator | BullMQ connection alive, recent job processing |

- **Liveness** failing → restart the container.
- **Readiness** failing → pull the pod out of the LB rotation (don't restart),
  e.g. during a brief DB blip, so traffic shifts to healthy pods.
- Readiness gates the rolling deploy (§6.1).

---

## 8. Autoscaling

- **web / api:** scale horizontally on **CPU + request latency/RPS**. HPA-style
  min/max replicas; scale up fast, down slow. Stateless → trivial.
- **worker:** scale **separately** on **BullMQ queue depth / oldest-job age** —
  upload bursts (a creator dumping a 500-icon pack) must not require scaling the
  api. Different queues (sanitize/render vs search-sync vs embeddings) can map to
  different worker pools with their own concurrency.
- **Postgres:** scale **reads** with replicas; scale writes vertically (right-
  size the primary) — the write path is light relative to reads/downloads.
- **Redis:** scale vertically / add a replica; keep queues and cache on separate
  logical DBs (or instances) so a cache flood can't starve queues.
- **R2 + CDN:** effectively infinite for the download path; no app scaling needed.

---

## 9. Backups & disaster recovery

| Asset | Strategy | Target |
|-------|----------|--------|
| **PostgreSQL** | Managed automated daily snapshots + **PITR** (WAL) | RPO ≤ 5 min, RTO < 1 h |
| **R2 objects** | **Bucket versioning ON** + lifecycle rules; quarantine bucket retains raw uploads | Recover deleted/overwritten objects |
| **Redis** | AOF/snapshot on managed instance | Rebuildable: queues replay from outbox, cache is regenerable, sessions are non-critical (users re-login) |
| **Meilisearch** (Phase 2) | None needed — **rebuildable** from Postgres via reindex job (SEARCH.md §3.3) | Treat as derived data |
| **Secrets/config** | Stored in secret manager with its own backup | — |

DR plan: Postgres is the only irreplaceable store. Practice **PITR restore to a
fresh instance** quarterly. R2 versioning protects asset bytes. Everything else
(search index, cache, queues) is derived and rebuildable from Postgres + R2.
Document and rehearse the restore runbook; keep cross-region snapshot copies for
region-loss scenarios.

---

## 10. Observability

Aligned with ARCHITECTURE.md §4:

- **Errors:** **Sentry** in web, api, and worker (source maps uploaded in CI;
  releases tagged by commit SHA for regression tracking).
- **Traces & metrics:** **OpenTelemetry** SDK in api/worker → OTLP collector.
  Trace the full request (web → api → Postgres/Redis/R2) and BullMQ jobs;
  propagate a **request ID** end to end.
- **Metrics dashboards:** **Prometheus + Grafana** — golden signals (latency,
  traffic, errors, saturation) per service, plus domain metrics: search p95,
  queue depth/age, upload success rate, download throughput, Stripe webhook lag.
- **Logs:** structured JSON with request IDs, shipped to aggregation
  (Loki/Grafana, or Datadog/CloudWatch). Never log secrets or full SVG payloads.
- **Alerting:** on error-rate spikes, p95 latency SLO breach, queue backlog,
  replica lag, low disk, failed migrations/deploys, Stripe webhook failures.
- **Uptime:** external synthetic checks against `/health` and a key search query.

---

## 11. Cost-aware MVP vs scaled deployment

### MVP (cost-optimized)

- **Compute:** Fly.io / Railway — 1–2 small `web`, 1–2 small `api`, **1 worker**.
- **Postgres:** single managed small instance (**no replica yet**); daily
  backups + PITR.
- **Redis:** one small managed instance (or Upstash) — cache + sessions + BullMQ.
- **Storage:** Cloudflare R2 (cheap, **no egress fees**) + Cloudflare free/Pro
  CDN/WAF.
- **Search:** **Postgres FTS** — no extra service (SEARCH.md §1).
- **Observability:** Sentry free tier + platform metrics/logs + an uptime ping.
- **Rough monthly:** tens of dollars + Stripe fees. R2 zero-egress keeps the
  download path cheap even with many downloads.

### Scaled (millions of downloads, 100k+ icons)

- **Compute:** autoscaled `web` (3+) and `api` (3+); **worker pool** (3+) scaled
  on queue depth; multi-region web optional.
- **Postgres:** larger primary + **≥1 read replica** for search/browse; PITR +
  cross-region snapshots; consider time-partitioned `download_history` already
  defined in DATABASE.md.
- **Redis:** larger instance + replica; queues isolated from cache.
- **Search:** **Meilisearch** cluster fed by the outbox/BullMQ sync (SEARCH.md
  §3) once FTS is outgrown.
- **CDN/WAF:** Cloudflare Pro/Business; tuned cache rules for R2 asset bytes.
- **Observability:** full OTel + managed Prometheus/Grafana (or Datadog), Sentry
  paid, log retention, on-call alerting.
- **Cost driver:** mostly Postgres size/replicas and observability — **not**
  bandwidth, thanks to R2 (no egress) + CDN caching of asset bytes.

The architecture is the same in both tiers; the scaled tier just adds replicas,
a worker pool, and Meilisearch. Start cheap, grow on real signals.
