# Roadmap — TurkistanIcons

This document defines three phased roadmaps (MVP, Phase 2, Phase 3) plus a
recommended, dependency-aware **development order** for the MVP build.

Terminology and architecture follow [PRD.md](PRD.md),
[ARCHITECTURE.md](ARCHITECTURE.md), and [DATABASE.md](DATABASE.md). Roles are
`VISITOR → USER → CREATOR → ADMIN`. Scale targets: 100k+ icons, 10k+ creators,
millions of downloads.

> Legend: `[ ]` not started · acceptance criteria are the definition of done for
> a milestone. A milestone is **not done** until every box and every acceptance
> criterion is met, plus `pnpm lint && pnpm typecheck && pnpm test` is green.

---

## Part 1 — MVP Roadmap

Goal: the minimum to launch a secure, working marketplace where users browse,
search, and download free icons, creators upload through a moderated pipeline,
and premium icons/packs can be bought via Stripe one-time purchases.

### Milestone M0 — Foundation & Infrastructure

Set up the monorepo, tooling, and local dev environment so every later milestone
ships into a consistent skeleton.

- [ ] pnpm workspace monorepo per [CLAUDE.md](../CLAUDE.md) layout (`apps/web`, `apps/api`, `packages/types|config|ui`, `infra/`, `prisma/`)
- [ ] Turborepo pipeline (`dev`, `build`, `lint`, `typecheck`, `test`)
- [ ] Shared `packages/config` (eslint, tsconfig `strict`, tailwind preset) and `packages/types` (zod schemas / DTOs)
- [ ] Next.js 15 (App Router) scaffolded in `apps/web`; NestJS scaffolded in `apps/api`
- [ ] `infra/compose/docker-compose.yml`: Postgres, Redis, MinIO (R2-compatible) for local dev
- [ ] `.env.example` as the env contract; secrets loaded from env only
- [ ] Dockerfiles for web, api, and upload worker in `infra/docker`
- [ ] CI: install → lint → typecheck → test → build on every PR
- [ ] Base observability wiring: structured JSON logs with request IDs, Sentry stub, health endpoints

**Acceptance criteria**
- `pnpm install && pnpm dev` boots web + api locally against dockerized Postgres/Redis/MinIO.
- `pnpm lint && pnpm typecheck && pnpm test` passes in CI from a clean clone.
- A trivial `/health` endpoint on the API returns 200 and is hit by CI.

---

### Milestone M1 — Data Model & Migrations

Materialize the canonical schema so all features have tables to build on.

- [ ] `prisma/schema.prisma` implements all enums and tables from [DATABASE.md](DATABASE.md)
- [ ] Money stored as integer minor units + `currency` char(3); UUID PKs; `created_at`/`updated_at` everywhere; soft-delete where specified
- [ ] Indexes: `users.email`, `users.google_id`, icons `(status, published_at)`, `category_id`, `creator_id`, `checksum`, GIN on `search_vector`, trigram on `name`
- [ ] `download_history` range-partitioned by month
- [ ] Initial `prisma migrate` migration committed; `prisma/seed.ts` seeds categories (Do'ppi, Atlas, Suzani, Registan, Bukhara, tea sets, Plov, Silk Road, Navruz) and starter tags
- [ ] Prisma client wrapped in a NestJS module; the web app never touches Postgres directly

**Acceptance criteria**
- `pnpm --filter api prisma migrate dev` applies cleanly to an empty DB.
- Seed produces the category tree and starter taxonomy.
- `DATABASE.md` and `schema.prisma` are byte-for-byte consistent in field names.

---

### Milestone M2 — Auth & RBAC

Identity is a prerequisite for downloads, uploads, purchases, and dashboards.

- [ ] Email/password register + login; Argon2/bcrypt password hashing
- [ ] Email verification + password reset (transactional email via Resend)
- [ ] Google OAuth via Passport; account linking by verified email / `google_id`
- [ ] JWT short-lived access token + rotating refresh token stored in Redis; revocable sessions
- [ ] NestJS `RolesGuard` + ownership checks; roles `VISITOR/USER/CREATOR/ADMIN`
- [ ] Rate limiting on auth endpoints (login, register, reset) via Redis counters
- [ ] zod validation on all auth DTOs; RFC-7807 problem JSON on errors

**Acceptance criteria**
- A user can register, verify email, log in (password and Google), refresh, and log out.
- Refresh-token rotation invalidates the previous token; reuse is detected and rejected.
- A `USER` calling a `CREATOR`/`ADMIN` route gets 403; guards are unit-tested.
- No endpoint trusts a client-supplied role.

---

### Milestone M3 — Categories & Taxonomy

Browsing and upload metadata both depend on a stable taxonomy.

- [ ] Public read API for the category tree (self-referential parent/child) and tags
- [ ] Admin CRUD for categories (with `sort_order`, `parent_id`) and tags
- [ ] Slugs (citext, unique); denormalized `icon_count` / `usage_count` maintained
- [ ] Redis cache-aside for the category tree with explicit invalidation on write

**Acceptance criteria**
- The category tree renders from a single cached API call.
- Admin can create/rename/reparent categories; cache invalidates on write.

---

### Milestone M4 — Creator Application & (basic) Dashboard

Supply side: turn a `USER` into a `CREATOR`.

- [ ] Creator application flow (`creator_applications`): portfolio URL + message → `PENDING`
- [ ] Admin review queue: approve/reject with note; approval creates a `creators` row and promotes role to `CREATOR`
- [ ] Public creator profile (slug, display name, bio, country, website)
- [ ] Basic creator dashboard shell: my icons, status counts, downloads/revenue placeholders (real analytics in Phase 2)

**Acceptance criteria**
- A user applies, an admin approves, and the user gains `CREATOR` role + a profile.
- Rejected applicants get a reason and may reapply.

---

### Milestone M5 — Icon Upload Pipeline (security-critical)

The highest-risk subsystem. Treat every uploaded SVG as hostile.

- [ ] API creates `icon` in `DRAFT` and issues a short-lived signed R2 PUT (original goes to a quarantine key `svg_raw_key`)
- [ ] Validate file by **content** not extension; enforce size/type limits
- [ ] BullMQ job enqueued on upload; dedicated **upload worker** process consumes it (idempotent by job id)
- [ ] Sanitization: SVGO/DOMPurify with a strict allowlist — strip `<script>`, event handlers (`on*`), external refs, `<foreignObject>`, remote `href`/`xlink:href`, DOCTYPE/entities (XXE)
- [ ] Render PNG + thumbnail previews; extract viewBox `width`/`height`; compute sha256 `checksum` for dedupe
- [ ] Sanitized SVG written to `svg_key`; status → `PENDING_REVIEW`; failures → `REJECTED` with reason
- [ ] User-uploaded assets served from a separate origin/CDN; never inlined into app HTML
- [ ] Single-icon and multi-icon **pack** uploads; pack metadata + `pack_items`
- [ ] Creator metadata editor (name, description, tags, category, license, price)
- [ ] Rate limiting on upload endpoints

**Acceptance criteria**
- A known-malicious SVG corpus (scripts, event handlers, XXE, external refs) is fully neutralized — verified by automated tests.
- Upload → quarantine → sanitize → preview → `PENDING_REVIEW` works end to end.
- Worker is idempotent: replaying a job does not duplicate assets.
- Duplicate uploads (same checksum) are detected.

---

### Milestone M6 — Admin Moderation

Quality + safety gate before anything is published.

- [ ] Moderation queue listing `PENDING_REVIEW` icons/packs with preview
- [ ] Approve → `PUBLISHED` (+ `published_at`); reject → `REJECTED` with reason; request changes
- [ ] `moderation_events` recorded for every action; `audit_log` for admin actions
- [ ] Email notification to creator on approve/reject
- [ ] Admin user management: suspend user, change role; manage creator applications

**Acceptance criteria**
- Only `PUBLISHED` icons appear in public browse/search/detail.
- Every moderation decision is auditable with actor, action, and reason.

---

### Milestone M7 — Browse & Search (Postgres FTS)

Demand side: discovery.

- [ ] Homepage: featured / trending / new icons + categories
- [ ] Category and collection browsing with filters (free/premium, style, format)
- [ ] Search by name/tag/category/creator using Postgres `tsvector` (GIN) + trigram on `name`
- [ ] Related icons (by category/tags) on detail pages
- [ ] SSR/ISR for public pages; Redis cache-aside for hot reads (trending, detail); structured data (SEO)

**Acceptance criteria**
- p95 search latency < 300ms at MVP data volumes.
- Search covers name, tags, category, and creator; zero-result rate is measured.
- Public icon detail TTFB < 200ms when cached.

---

### Milestone M8 — Icon Detail & Free Download

- [ ] Icon detail page: preview, formats, license, tags, creator, related, download/buy CTA
- [ ] Authenticated free download: API authorizes → issues signed R2 GET → records `download_history`
- [ ] Re-download of previously downloaded free assets from history
- [ ] Rate limiting on download endpoints; download counters updated (transactionally or via queue)

**Acceptance criteria**
- A logged-in user downloads a free icon; a row lands in `download_history`; `download_count` increments.
- Asset bytes are served from R2/CDN, never proxied through the API.

---

### Milestone M9 — Profiles, Favorites & Collections

- [ ] Profile management (name, avatar, password change)
- [ ] Favorite/unfavorite icons (unique `(user, icon)`); `favorite_count` maintained
- [ ] Create/manage collections; add/remove `collection_items`; public/private toggle

**Acceptance criteria**
- Favorites and collections persist and render on the user dashboard.
- A public collection is viewable by URL; a private one is not.

---

### Milestone M10 — Payments: Stripe One-Time Purchases

Monetization for premium icons and packs (no subscriptions in MVP).

- [ ] Premium icons/packs priced in minor units; `creator_earnings + platform_fee = unit_price` (default 70/30, `revenue_share_bps`)
- [ ] Checkout: API creates Stripe Checkout session → `purchase` (`PENDING`) + `purchase_items`
- [ ] Webhook handler: idempotent by `stripe_event_id`; marks `purchase` `PAID`, writes `payments` row, unlocks entitlement
- [ ] Entitlement check on download: published `purchase_item` for `(user, icon|pack)` with `PAID` parent, OR icon is `FREE`
- [ ] Purchase + download history; receipts via email; refund path → `REFUNDED`

**Acceptance criteria**
- A user buys a premium icon/pack, the webhook confirms, and the asset unlocks in their library.
- Replayed/duplicate webhooks are ignored (idempotency proven by test).
- A user cannot download a premium asset they have not purchased.

---

### Milestone M11 — Hardening & Deployment

- [ ] Cloudflare in front: DNS, TLS, WAF, bot/rate protection, CDN for static + R2
- [ ] Managed Postgres + Redis in prod; R2 buckets (public preview, separate origin for user SVGs)
- [ ] Secrets management; per-env config; DB migration step in deploy
- [ ] Observability live: OpenTelemetry traces, Prometheus metrics, Sentry, alerting
- [ ] Backups + restore drill for Postgres; runbook for upload-worker scaling
- [ ] Load/security smoke tests on auth, upload, download, checkout paths
- [ ] Legal pages: ToS, privacy, license terms, DMCA/takedown contact

**Acceptance criteria**
- Public read paths meet the 99.9% availability target in staging soak.
- A SEV runbook, backups, and alerting are in place.
- A full user journey (signup → browse → download → buy → re-download) passes in production.

---

## Part 2 — Phase 2 Roadmap (Growth)

Builds on a launched MVP. Focus: monetization depth, search relevance, creator
economics, engagement, and reach.

### P2.1 — Subscriptions & Plans
- [ ] Recurring plans (unlimited downloads / no-attribution license) via Stripe Billing
- [ ] Plan-aware entitlement check (subscription OR purchase OR free)
- [ ] Upgrade/downgrade, proration, dunning, cancellation
- **Acceptance:** an active subscriber downloads any premium icon without per-item purchase; lapsed subscribers lose access.

### P2.2 — Meilisearch Migration
- [ ] Index `PUBLISHED` icons in Meilisearch; sync on publish/update/unpublish
- [ ] Typo tolerance, faceting (category/style/format/free-premium), synonyms, ranking rules
- [ ] Cutover behind a flag with Postgres FTS fallback
- **Acceptance:** p95 search < 150ms with better relevance than FTS; index stays consistent with DB.

### P2.3 — Creator Analytics & Payouts (Stripe Connect)
- [ ] Stripe Connect onboarding (`stripe_account_id`); KYC handled by Stripe
- [ ] Scheduled payouts; `payouts` ledger with period + status; statements
- [ ] Rich creator analytics: downloads, revenue, top icons, conversion, geography over time
- **Acceptance:** a creator onboards, earns, and receives an automated payout reconciled against `purchase_items`.

### P2.4 — Reviews & Ratings
- [ ] 1–5 ratings + comments (`reviews`, unique per user/icon), aggregate score on detail
- [ ] Moderation of abusive reviews
- **Acceptance:** ratings display and feed into ranking; spam is reportable/removable.

### P2.5 — Collections Sharing
- [ ] Shareable public collection URLs, social/OG cards, follow/like collections
- **Acceptance:** a public collection is shareable and renders rich previews.

### P2.6 — Blog CMS
- [ ] Authoring + publishing for marketing/SEO content; categories, SEO metadata
- **Acceptance:** editors publish posts that are SSR/ISR-rendered and indexable.

### P2.7 — Recommendations / Related Improvements
- [ ] Better "related," "you might like," and trending using behavior signals
- **Acceptance:** measurable lift in downloads-per-session vs MVP baseline.

### P2.8 — Internationalization (English / Uzbek / Russian)
- [ ] i18n framework, translated UI, locale routing, localized SEO
- **Acceptance:** full UI available in en/uz/ru with locale-aware URLs.

### P2.9 — Email Campaigns
- [ ] Lifecycle + marketing email (digests, new-from-creators-you-follow), consent + unsubscribe
- **Acceptance:** opt-in campaigns send with tracked open/click and honored unsubscribes.

### P2.10 — Partner / Public API
- [ ] Versioned REST API + API keys, scoped rate limits, docs
- **Acceptance:** a partner can search and fetch licensed assets via documented, authenticated API.

---

## Part 3 — Phase 3 Roadmap (Scale & Platform)

For 100k+ icons, 10k+ creators, millions of downloads, and platform expansion.

### P3.1 — Scale & Performance
- [ ] Postgres read replicas for browse/search; connection pooling (PgBouncer)
- [ ] Partition + archive `download_history` and analytics; precomputed summary tables
- [ ] Multi-layer caching (edge ISR, Redis, CDN) with disciplined invalidation
- **Acceptance:** read paths hold p95 SLOs at 10x MVP traffic in load tests.

### P3.2 — AI Features
- [ ] Auto-tagging / auto-categorization of uploads (ML-assisted)
- [ ] Semantic / vector search (embeddings + pgvector or vector DB)
- [ ] AI icon generation (style-consistent, cultural-authenticity guardrails)
- **Acceptance:** auto-tags reduce manual metadata effort; semantic search improves recall on intent queries.

### P3.3 — Enterprise / Team Seats
- [ ] Org accounts, seat management, shared libraries, SSO/SAML, consolidated billing
- **Acceptance:** an org admin manages seats and a shared asset library under one invoice.

### P3.4 — Mobile Apps
- [ ] Native iOS/Android (browse, search, favorites, purchases) on the public API
- **Acceptance:** parity for discovery + purchase flows; store-compliant.

### P3.5 — Design-Tool Plugins (Figma, etc.)
- [ ] Figma (and similar) plugin to search/insert licensed icons in-canvas
- **Acceptance:** a designer inserts an owned/free icon directly from Figma with license honored.

### P3.6 — Marketplace Expansion
- [ ] Adjacent assets (illustrations, animated SVG/Lottie, photo packs), broader Central Asian scope
- **Acceptance:** new asset types flow through upload/moderation/pricing without schema rewrites.

### P3.7 — Fraud / Abuse Systems
- [ ] Payment-fraud scoring, refund/chargeback abuse detection, download-bot mitigation, creator collusion detection
- **Acceptance:** automated signals flag/limit abuse with low false-positive rate.

### P3.8 — Advanced Moderation (ML-assisted)
- [ ] Automated pre-screening (IP/duplicate/cultural-sensitivity/NSFW), human-in-the-loop for edge cases
- **Acceptance:** ML triage cuts moderation turnaround while maintaining reject-quality.

---

## Part 4 — Recommended Development Order

Build in dependency order. Each step exists because later steps need it. Items
marked **‖ parallel** can proceed alongside the prior step once their inputs
exist.

1. **Foundation & infra (M0).** Nothing compiles, deploys, or is testable without
   the monorepo, Docker dev stack, CI, and config/types packages. This is the
   substrate every other step lands in.

2. **Data model & migrations (M1).** Every feature reads/writes these tables.
   Locking the schema early prevents churn and rework across services.
   - ‖ parallel: design-system / UI shell (`packages/ui`, layout, theming) can
     start now since it has no data dependency.

3. **Auth & RBAC (M2).** Downloads, uploads, purchases, and dashboards all gate
   on identity and roles. Authorization guards must exist before any protected
   route is built, or they get bolted on insecurely later.

4. **Categories & taxonomy (M3).** Both upload metadata and browse/search depend
   on a stable category tree and tags, so it precedes both.

5. **Creator application & basic dashboard (M4).** You need `CREATOR` accounts
   before anyone can upload. Admin review here also seeds the moderation muscle
   used in M6.
   - ‖ parallel: public marketing pages, profile UI, and the dashboard shell can
     be built against M2/M3.

6. **Upload pipeline (M5).** This is the riskiest, most security-sensitive system
   and the source of all content. It depends on auth (who uploads), taxonomy
   (metadata), and R2/queue infra (from M0). Build and red-team it before content
   can enter the system.

7. **Admin moderation (M6).** Content from M5 must pass a human gate before it is
   public. Moderation must exist before browse/search, so only `PUBLISHED`
   content is ever discoverable.

8. **Browse & search (M7).** Now that published content exists, build discovery on
   Postgres FTS. Depends on taxonomy (M3) and published icons (M5+M6).
   - ‖ parallel: SEO/ISR plumbing and homepage composition.

9. **Icon detail & free download (M8).** The core value loop. Depends on auth
   (M2), published content (M6), search/detail rendering (M7), and R2 signed GETs.

10. **Profiles, favorites & collections (M9).** Engagement features layered on the
    download loop; depend on auth and icons.
    - ‖ parallel with M10 (independent surfaces, same auth/data base).

11. **Payments — Stripe one-time (M10).** Monetization is built once free flows
    are proven, because entitlement reuses the download authorization path and the
    purchase library reuses download history. Doing it after M8 means the secure
    download path already exists to extend.

12. **Hardening & deployment (M11).** Cloudflare/WAF, managed datastores,
    observability, backups, legal pages, and load/security tests. Comes last
    because it secures and ships the *complete* surface; partial hardening wastes
    effort on systems still in flux.

**Parallelization summary**
- Frontend UI shell / design system → from step 2 onward.
- Marketing, profile, and dashboard UI → alongside steps 5–9 against stable APIs.
- Favorites/collections (M9) and payments (M10) → can run concurrently after M8.
- Observability and infra hardening → wire continuously from M0, formalized in M11.

**Critical path:** M0 → M1 → M2 → M3 → M5 → M6 → M7 → M8 → M10. Treat the upload
pipeline (M5) and payments webhook idempotency (M10) as the two milestones that
most warrant extra review time.
