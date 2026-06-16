# System Architecture — TurkistanIcons

## 1. High-level diagram

```
                                  ┌─────────────────────────┐
                                  │        Users / Bots      │
                                  └────────────┬─────────────┘
                                               │ HTTPS
                                  ┌────────────▼─────────────┐
                                  │   Cloudflare (CDN/WAF)    │
                                  │  - DNS, TLS, WAF, rate    │
                                  │  - caches static + R2     │
                                  └─────┬───────────────┬─────┘
                        cached assets   │               │  app traffic
                       (SVG/PNG via R2) │               │
                          ┌─────────────▼──┐     ┌──────▼───────────────┐
                          │ Cloudflare R2  │     │   Next.js 15 (web)   │
                          │  SVG + PNG      │     │  App Router, SSR/ISR │
                          │  public bucket  │     │  React Server Comp.  │
                          └────────────────┘     └──────┬───────────────┘
                                                         │  REST (JSON), JWT
                                                  ┌──────▼───────────────┐
                                                  │   NestJS (api)        │
                                                  │  controllers/services │
                                                  │  guards (RBAC), DTOs  │
                                                  └──┬───────┬────────┬───┘
                                  ┌──────────────────┘       │        └───────────────┐
                          ┌───────▼────────┐        ┌────────▼───────┐        ┌────────▼────────┐
                          │  PostgreSQL    │        │     Redis      │        │  Cloudflare R2  │
                          │  (Prisma)      │        │ cache/session/ │        │  (signed PUT/   │
                          │  source of     │        │ BullMQ queues  │        │   GET)          │
                          │  truth + FTS    │        └────────┬───────┘        └─────────────────┘
                          └────────────────┘                 │
                                                     ┌────────▼─────────┐
                                                     │ Upload Worker(s) │
                                                     │ validate/sanitize│
                                                     │ /preview (BullMQ)│
                                                     └────────┬─────────┘
                                                              │
                                  ┌───────────────────────────┼───────────────────┐
                          ┌───────▼────────┐         ┌────────▼────────┐   ┌───────▼────────┐
                          │   Stripe       │         │  Meilisearch    │   │  Email (Resend)│
                          │  payments/     │         │  (Phase 2,      │   │  verify/reset/ │
                          │  webhooks      │         │  search index)  │   │  receipts      │
                          └────────────────┘         └─────────────────┘   └────────────────┘
```

## 2. Components

- **Cloudflare (edge):** DNS, TLS, WAF, bot/rate protection, CDN for static
  assets and R2-served icon files. First line of DoS/abuse defense.
- **web (Next.js 15):** public marketplace + authenticated dashboards. Server
  Components for data-heavy pages (SSR/ISR + caching); Client Components for
  interactive bits. Talks only to the API.
- **api (NestJS):** all business logic, authN/Z, validation, DB access via
  Prisma, R2 signed URLs, Stripe integration, queue producers.
- **PostgreSQL:** system of record. Postgres full-text search for MVP.
- **Redis:** response/query caching, session/refresh-token store, rate-limit
  counters, and BullMQ job queues.
- **Upload worker(s):** separate NestJS process consuming BullMQ jobs to
  validate/sanitize SVGs and render PNG previews (CPU-bound, isolated).
- **Cloudflare R2:** object storage for original SVGs and generated PNGs.
  Uploads via short-lived signed PUT; downloads via signed/public GET.
- **Stripe:** checkout + webhooks for purchases and creator payouts (Connect).
- **Meilisearch (Phase 2):** dedicated search engine when Postgres FTS is outgrown.
- **Email:** transactional (verification, reset, receipts, moderation notices).

## 3. Request paths

- **Browse/search (read):** web RSC → api → Postgres/Redis (cache-aside) →
  cached HTML/ISR at edge. Asset bytes come straight from R2 via CDN.
- **Download (free):** web → api authorizes → api issues signed R2 GET +
  records `download_history`.
- **Purchase:** web → api creates Stripe Checkout → Stripe webhook → api marks
  `purchase` paid → asset unlocked in user library.
- **Upload:** web → api creates `icon` (DRAFT) + signed PUT → client uploads to
  R2 → api enqueues processing job → worker validates/sanitizes/renders →
  status `PENDING_REVIEW` → admin approves → `PUBLISHED`. See
  [UPLOAD-PIPELINE.md](UPLOAD-PIPELINE.md).

## 4. Cross-cutting

- **AuthN:** JWT access (short) + refresh (rotating, stored in Redis). Google
  OAuth via Passport. Sessions revocable.
- **AuthZ:** NestJS `RolesGuard` + ownership checks; see [SECURITY.md](SECURITY.md).
- **Caching strategy:** edge (ISR) for public pages; Redis cache-aside for hot
  API reads (categories, trending, icon detail) with explicit invalidation on
  write; CDN for asset bytes.
- **Idempotency:** Stripe webhooks + upload jobs are idempotent (keyed by event/job id).
- **Observability:** OpenTelemetry traces, Prometheus metrics, Sentry errors,
  structured JSON logs with request IDs.

## 5. Scalability approach

- **Stateless** web and api → scale horizontally behind a load balancer.
- **Read scaling:** Postgres read replicas for browse/search; Redis cache for hot keys.
- **Asset scaling:** R2 + CDN handle the millions-of-downloads path; the API
  only issues signed URLs, never proxies bytes.
- **Write/queue scaling:** upload processing is async via BullMQ; add workers
  independently of the API.
- **Search scaling:** start with Postgres FTS + trigram; migrate to Meilisearch
  when query latency or relevance demands it (see [SEARCH.md](SEARCH.md)).
- **DB partitioning:** `download_history` and analytics tables partitioned by
  time; heavy aggregates precomputed into summary tables.
