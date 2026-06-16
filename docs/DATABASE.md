# Database Schema — TurkistanIcons (PostgreSQL + Prisma)

System of record is PostgreSQL. This document is the canonical schema; keep it in
sync with `prisma/schema.prisma`.

## Conventions

- Primary keys: `uuid` (`@default(uuid())`) unless noted.
- Timestamps: `created_at`, `updated_at` on every table.
- Money: store **minor units** as `Int` (cents) plus a `currency` char(3); never floats.
- Soft delete: `deleted_at TIMESTAMPTZ NULL` where deletion must be reversible.
- Enums via Postgres enums (Prisma `enum`).
- Snake_case columns via Prisma `@map`.

## Entity overview

```
users ──1:1── creators
users ──1:N── favorites ──N:1── icons
users ──1:N── collections ──1:N── collection_items ──N:1── icons
users ──1:N── purchases ──1:N── purchase_items ──N:1── icons/icon_packs
users ──1:N── download_history ──N:1── icons
users ──1:N── reviews ──N:1── icons
creators ──1:N── icons
creators ──1:N── icon_packs ──1:N── pack_items ──N:1── icons
categories ──1:N── icons          (self-referential parent/child)
icons ──N:M── tags  (icon_tags)
purchases ──1:1── payments
creators ──1:N── payouts
```

## Enums

```prisma
enum Role          { VISITOR USER CREATOR ADMIN }
enum IconStatus    { DRAFT PROCESSING PENDING_REVIEW PUBLISHED REJECTED ARCHIVED }
enum PriceType     { FREE PREMIUM }
enum LicenseType   { FREE_ATTRIBUTION PREMIUM_STANDARD PREMIUM_EXTENDED }
enum PurchaseStatus{ PENDING PAID FAILED REFUNDED }
enum PayoutStatus  { PENDING PROCESSING PAID FAILED }
enum CreatorAppStatus { PENDING APPROVED REJECTED }
enum ModerationAction { APPROVE REJECT REQUEST_CHANGES }
```

## Tables

### users
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| email | citext UNIQUE | |
| email_verified_at | timestamptz null | |
| password_hash | text null | null for OAuth-only |
| name | text | |
| avatar_url | text null | |
| role | Role | default USER |
| google_id | text null UNIQUE | |
| status | text | active / suspended |
| created_at / updated_at | timestamptz | |

Indexes: `email`, `google_id`.

### creators (1:1 with users)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK→users UNIQUE | |
| display_name | text | |
| slug | citext UNIQUE | public profile URL |
| bio | text null | |
| website | text null | |
| country | text null | |
| revenue_share_bps | int | default 7000 (=70%) |
| stripe_account_id | text null | Stripe Connect |
| total_downloads | int | denormalized counter |
| total_revenue_cents | bigint | denormalized counter |
| created_at / updated_at | timestamptz | |

### creator_applications
`id, user_id FK, status CreatorAppStatus, portfolio_url, message, reviewed_by FK→users, review_note, created_at, updated_at`.

### categories (self-referential tree)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| parent_id | uuid FK→categories null | |
| name | text | |
| slug | citext UNIQUE | |
| description | text null | |
| icon_count | int | denormalized |
| sort_order | int | |

### tags
`id, name citext UNIQUE, slug citext UNIQUE, usage_count int`.

### icons
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| creator_id | uuid FK→creators | |
| category_id | uuid FK→categories | |
| name | text | |
| slug | citext | unique per creator |
| description | text null | |
| status | IconStatus | default DRAFT |
| price_type | PriceType | FREE / PREMIUM |
| price_cents | int | 0 when FREE |
| currency | char(3) | default USD |
| license | LicenseType | |
| svg_key | text | R2 object key (sanitized SVG) |
| svg_raw_key | text null | original upload (quarantine) |
| png_key | text null | generated preview |
| thumb_key | text null | small thumb |
| width / height | int null | viewBox dims |
| file_size | int | bytes |
| checksum | text | sha256 of sanitized SVG (dedupe) |
| download_count | int | denormalized |
| favorite_count | int | denormalized |
| rejection_reason | text null | |
| published_at | timestamptz null | |
| search_vector | tsvector | generated, GIN-indexed (see SEARCH.md) |
| created_at / updated_at / deleted_at | timestamptz | |

Indexes: `(status, published_at)`, `category_id`, `creator_id`, `checksum`,
GIN on `search_vector`, trigram on `name`.

### icon_tags (join)
`icon_id FK, tag_id FK` — composite PK `(icon_id, tag_id)`.

### icon_packs
`id, creator_id FK, name, slug, description, status IconStatus, price_cents, currency, license, cover_icon_id FK→icons null, download_count, published_at, timestamps`.

### pack_items (join)
`pack_id FK, icon_id FK` — composite PK; `sort_order int`.

### favorites
`id, user_id FK, icon_id FK, created_at` — UNIQUE `(user_id, icon_id)`.

### collections
`id, user_id FK, name, slug, is_public bool, description null, timestamps`.

### collection_items
`collection_id FK, icon_id FK, sort_order, added_at` — composite PK `(collection_id, icon_id)`.

### purchases
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK→users | |
| status | PurchaseStatus | |
| subtotal_cents | int | |
| total_cents | int | |
| currency | char(3) | |
| stripe_checkout_id | text null | |
| stripe_payment_intent | text null | |
| created_at / updated_at | timestamptz | |

### purchase_items
`id, purchase_id FK, item_type ('ICON'|'PACK'), icon_id FK null, pack_id FK null, creator_id FK, unit_price_cents, platform_fee_cents, creator_earnings_cents`.
A purchase item is what grants download entitlement.

### payments (1:1 purchase)
`id, purchase_id FK UNIQUE, provider ('stripe'), amount_cents, currency, status, stripe_event_id text UNIQUE (idempotency), raw_payload jsonb, created_at`.

### payouts
`id, creator_id FK, amount_cents, currency, status PayoutStatus, stripe_transfer_id, period_start, period_end, created_at`.

### download_history (partitioned by month)
`id, user_id FK null, icon_id FK, pack_id FK null, ip inet, user_agent text, was_free bool, created_at`.
Partition by `created_at` (range, monthly). Heavy write path.

### reviews
`id, user_id FK, icon_id FK, rating smallint (1-5), comment text null, timestamps` — UNIQUE `(user_id, icon_id)`.

### moderation_events
`id, icon_id FK null, pack_id FK null, moderator_id FK→users, action ModerationAction, reason text null, created_at`.

### audit_log
`id, actor_id FK→users null, action text, entity text, entity_id uuid, metadata jsonb, ip inet, created_at` — admin/security trail.

### sessions / refresh tokens
Refresh tokens stored in **Redis** (rotating, TTL = refresh TTL), not Postgres.
Optionally mirror a `user_sessions` row for "active devices" UX.

## Counters & integrity

- Denormalized counters (`download_count`, `favorite_count`, `icon_count`,
  `usage_count`, creator totals) updated transactionally or via queue; reconcile
  nightly with a job.
- All money math in integer minor units; `creator_earnings + platform_fee = unit_price`.
- Entitlement check for premium download = exists published `purchase_item` for
  `(user, icon|pack)` with parent purchase `PAID`, OR icon is `FREE`.

## Migrations

Use `prisma migrate`. Never edit applied migrations; create new ones. Seed
categories/tags via `prisma/seed.ts`.
