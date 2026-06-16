# REST API Design — TurkistanIcons

Canonical reference for the public/authenticated REST API served by `apps/api`
(NestJS). Keep this in sync with the controllers (see [BACKEND.md](BACKEND.md))
and the data model in [DATABASE.md](DATABASE.md). Per CLAUDE.md, when you
add/modify an endpoint, update this file in the same change.

## 1. Conventions

### Base URL & versioning

All endpoints are prefixed and **versioned via the URI**:

```
https://api.turkistanicons.com/api/v1
```

The `/api/v1` prefix is implied in every path table below.

### Content types

- Requests/responses: `application/json; charset=utf-8`.
- Errors: `application/problem+json` (RFC-7807, see §6).
- Stripe webhook: `application/json` with **raw body preserved** for signature
  verification.

### Authentication

- **Bearer access JWT** in `Authorization: Bearer <token>` (short-lived).
- **Refresh token** is rotating, stored server-side in Redis, sent on
  `POST /auth/refresh`. It is delivered as an `httpOnly`, `Secure`, `SameSite`
  cookie (web) or returned in the body (programmatic clients).
- Google OAuth via Passport (`/auth/google`).

### Roles & authorization

Role hierarchy `VISITOR < USER < CREATOR < ADMIN`. Each endpoint lists the
minimum role. Authorization is enforced server-side by `JwtAuthGuard` +
`RolesGuard` + ownership guards (BACKEND.md §5). `VISITOR` = no auth required.

### Standard headers

| Header | Direction | Purpose |
|---|---|---|
| `Authorization: Bearer <jwt>` | request | access token |
| `X-Request-Id` | both | correlation id; echoed back, appears in problem JSON |
| `Idempotency-Key` | request | required on upload init + checkout (§7) |
| `X-RateLimit-Limit` | response | requests allowed in the window |
| `X-RateLimit-Remaining` | response | requests left in the current window |
| `X-RateLimit-Reset` | response | epoch seconds when the window resets |
| `Retry-After` | response | seconds to wait (on `429`) |

### Pagination (cursor-based)

List endpoints use **opaque, keyset cursors** — never offset/limit — so deep
pages stay fast over 100k+ icons.

Query params:

| Param | Type | Default | Notes |
|---|---|---|---|
| `cursor` | string | — | opaque base64url cursor from a previous response |
| `limit` | int | `24` | 1–100 |

Response envelope:

```json
{
  "data": [ /* items */ ],
  "page": {
    "nextCursor": "eyJpZCI6IjAxOGYuLi4iLCJrIjoiMjAyNi0wMS0wMSJ9",
    "hasMore": true
  }
}
```

When `hasMore` is `false`, `nextCursor` is `null`. Pass `nextCursor` back as
`cursor` to fetch the next page.

### Filtering & sorting

Common query params on collection endpoints (each endpoint documents its own
allowed set):

- **Filtering:** `categoryId`, `tag`, `creatorId`, `priceType=FREE|PREMIUM`,
  `license`, `format`, `status` (admin/creator-scoped only).
- **Sorting:** `sort=trending|newest|downloads|name` (default `trending`).
- **Search:** `q=<text>` (full-text, see `/search` and `/icons`).

Unknown query params are rejected by the zod validation pipe (`422`).

### Status codes

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `202` | Accepted (async work enqueued, e.g. upload finalize) |
| `204` | No content (deletes, logout) |
| `400` | Malformed request |
| `401` | Missing/invalid/expired token |
| `403` | Authenticated but not allowed (role/ownership) |
| `404` | Not found (also returned to hide existence of unowned resources) |
| `409` | Conflict (duplicate email, already favorited, already reviewed) |
| `410` | Gone (expired signed URL / expired verification token) |
| `422` | Validation failed (zod) — includes field errors |
| `429` | Rate limited |
| `500` | Internal error (no stack trace leaked) |

## 2. Endpoint index

| Area | Base path |
|---|---|
| Auth | `/auth` |
| Users | `/users`, `/me` |
| Creators (public) | `/creators` |
| Icons | `/icons` |
| Packs | `/packs` |
| Categories | `/categories` |
| Tags | `/tags` |
| Search | `/search` |
| Uploads | `/uploads` |
| Favorites | `/favorites` |
| Collections | `/collections` |
| Reviews | `/icons/:id/reviews` |
| Purchases | `/purchases` |
| Downloads | `/downloads` |
| Payments (webhook) | `/webhooks/stripe` |
| Creator dashboard | `/creator` |
| Admin | `/admin` |
| Notifications | `/notifications` |
| Health | `/health` |

---

## 3. Auth — `/auth`

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/register` | VISITOR | Create account (email+password); sends verification email |
| POST | `/auth/login` | VISITOR | Email+password → access + refresh tokens |
| POST | `/auth/refresh` | VISITOR* | Rotate refresh token → new access + refresh |
| POST | `/auth/logout` | USER | Revoke current refresh token (Redis) |
| GET | `/auth/google` | VISITOR | Start Google OAuth redirect |
| GET | `/auth/google/callback` | VISITOR | OAuth callback → issues tokens |
| POST | `/auth/verify-email` | VISITOR | Confirm email with token |
| POST | `/auth/resend-verification` | USER | Re-send verification email |
| POST | `/auth/forgot-password` | VISITOR | Send password reset email |
| POST | `/auth/reset-password` | VISITOR | Reset password with token |
| GET | `/auth/me` | USER | Current user profile + role |

\* `/auth/refresh` requires a valid refresh token (cookie or body), not an
access token. Auth endpoints are **strictly rate-limited** (§ rate limits).

**`POST /auth/register`** — request:

```json
{ "email": "aziza@example.com", "password": "S0meStr0ng!pass", "name": "Aziza K." }
```

Response `201`:

```json
{
  "user": { "id": "018f...", "email": "aziza@example.com", "name": "Aziza K.", "role": "USER", "emailVerifiedAt": null },
  "accessToken": "eyJ...",
  "expiresIn": 900
}
```

`409` if email already exists. `422` on weak password / invalid email.

**`POST /auth/login`** — request `{ "email", "password" }`. Response `200` mirrors
register (refresh token set as `httpOnly` cookie). `401` on bad credentials;
`403` if the account is `suspended` or email unverified (policy-dependent).

**`GET /auth/me`** — response `200`:

```json
{
  "id": "018f...",
  "email": "aziza@example.com",
  "name": "Aziza K.",
  "avatarUrl": null,
  "role": "CREATOR",
  "emailVerifiedAt": "2026-02-01T10:00:00Z",
  "creator": { "id": "01a2...", "slug": "aziza-k", "displayName": "Aziza K." }
}
```

---

## 4. Users — `/users`, `/me`

| Method | Path | Role | Description |
|---|---|---|---|
| PATCH | `/me` | USER | Update own profile (name, avatar) |
| PATCH | `/me/password` | USER | Change password (requires current password) |
| DELETE | `/me` | USER | Soft-delete own account |
| GET | `/users/:id` | USER | Public-safe user summary |

`PATCH /me` request: `{ "name"?, "avatarUrl"? }`. Avatar is uploaded via the
generic upload init (§ Uploads) then its key is set here.

---

## 5. Creators (public) — `/creators`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/creators` | VISITOR | List/browse creators (cursor) |
| GET | `/creators/:slug` | VISITOR | Public creator profile |
| GET | `/creators/:slug/icons` | VISITOR | Creator's PUBLISHED icons (cursor, sort/filter) |
| GET | `/creators/:slug/packs` | VISITOR | Creator's PUBLISHED packs |

`GET /creators/:slug` response `200`:

```json
{
  "id": "01a2...",
  "slug": "aziza-k",
  "displayName": "Aziza K.",
  "bio": "Suzani & Atlas pattern iconography.",
  "website": "https://aziza.example.com",
  "country": "UZ",
  "totalDownloads": 18420,
  "iconCount": 212,
  "createdAt": "2026-01-10T09:00:00Z"
}
```

(`revenue_share_bps`, `stripe_account_id`, `total_revenue_cents` are never
exposed publicly — owner sees them via `/creator/analytics`.)

---

## 6. Error format (RFC-7807)

All non-2xx responses use `application/problem+json`:

```json
{
  "type": "https://turkistanicons.com/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/api/v1/icons",
  "requestId": "req_8f3c2a1b",
  "errors": { "fieldErrors": { "limit": ["Number must be less than or equal to 100"] } }
}
```

- `type` — stable URI per error class.
- `requestId` — matches `X-Request-Id`; quote it in bug reports.
- `errors` — present on `422`; zod flattened field/form errors.
- Stack traces are never serialized.

---

## 7. Idempotency

Two write paths require an `Idempotency-Key` header (a client-generated UUID):

- **`POST /uploads/init`** — prevents duplicate DRAFT icons + signed URLs on
  retry.
- **`POST /purchases/checkout`** — prevents double Stripe Checkout sessions /
  double charge on retry.

The server stores the key → first response for a TTL (Redis); a repeat request
with the same key + same body returns the original response. A same-key request
with a **different** body returns `409`.

**Stripe webhooks** are idempotent independently: each event is keyed by
`stripe_event_id` (UNIQUE on `payments`, see DATABASE.md), so re-delivered events
are no-ops.

---

## 8. Icons — `/icons`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/icons` | VISITOR | List/search icons (cursor, filter, sort) |
| GET | `/icons/:slug` | VISITOR | Icon detail (PUBLISHED only) |
| GET | `/icons/:id/related` | VISITOR | Related icons (same category + tag overlap) |
| GET | `/icons/:id/download` | USER | Entitlement-checked signed R2 download URL |
| PATCH | `/icons/:id` | CREATOR (owner) | Edit metadata (name, desc, tags, category, price, license) |
| DELETE | `/icons/:id` | CREATOR (owner) | Soft-delete / archive |

**`GET /icons`** query params: `q`, `categoryId`, `tag`, `creatorId`,
`priceType`, `license`, `sort` (`trending|newest|downloads|name`), `cursor`,
`limit`. Example request:

```
GET /api/v1/icons?q=suzani&priceType=FREE&sort=downloads&limit=24
```

Response `200`:

```json
{
  "data": [
    {
      "id": "018f...",
      "slug": "suzani-flower-ornament",
      "name": "Suzani Flower Ornament",
      "priceType": "FREE",
      "priceCents": 0,
      "currency": "USD",
      "license": "FREE_ATTRIBUTION",
      "previewUrl": "https://cdn.turkistanicons.com/png/018f....png",
      "thumbUrl": "https://cdn.turkistanicons.com/thumb/018f....png",
      "width": 512,
      "height": 512,
      "downloadCount": 3421,
      "favoriteCount": 210,
      "isFavorited": false,
      "category": { "id": "0c1...", "name": "Suzani", "slug": "suzani" },
      "creator": { "id": "01a2...", "displayName": "Aziza K.", "slug": "aziza-k" }
    }
  ],
  "page": { "nextCursor": "eyJpZCI6IjAxOGYifQ", "hasMore": true }
}
```

**`GET /icons/:slug`** response `200` (detail):

```json
{
  "id": "018f...",
  "slug": "suzani-flower-ornament",
  "name": "Suzani Flower Ornament",
  "description": "Hand-traced suzani floral motif from Bukhara.",
  "priceType": "PREMIUM",
  "priceCents": 299,
  "currency": "USD",
  "license": "PREMIUM_STANDARD",
  "previewUrl": "https://cdn.turkistanicons.com/png/018f....png",
  "thumbUrl": "https://cdn.turkistanicons.com/thumb/018f....png",
  "formats": ["svg", "png"],
  "width": 512,
  "height": 512,
  "fileSize": 8240,
  "downloadCount": 3421,
  "favoriteCount": 210,
  "isFavorited": true,
  "isOwned": false,
  "rating": { "average": 4.7, "count": 38 },
  "category": { "id": "0c1...", "name": "Suzani", "slug": "suzani" },
  "creator": { "id": "01a2...", "displayName": "Aziza K.", "slug": "aziza-k" },
  "tags": [ { "name": "suzani", "slug": "suzani" }, { "name": "floral", "slug": "floral" } ],
  "publishedAt": "2026-02-15T12:00:00Z"
}
```

R2 object keys (`svg_key`, `svg_raw_key`, …) are never returned; clients get
CDN preview URLs and obtain the file via `/download`.

**`GET /icons/:id/download`** — role `USER`. The server checks entitlement
(icon is `FREE`, OR a `PAID` `purchase_item` exists for `(user, icon)` or a pack
containing it — DATABASE.md), records `download_history` (async via `analytics`
queue), and returns a short-lived signed R2 GET URL.

```json
{ "url": "https://r2.turkistanicons.com/svg/018f....svg?X-Amz-Expires=300&...", "expiresIn": 300, "format": "svg" }
```

`403` if premium and not owned. `410` after the signed URL expires (re-request).

---

## 9. Packs — `/packs`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/packs` | VISITOR | List icon packs (cursor, filter, sort) |
| GET | `/packs/:slug` | VISITOR | Pack detail + item list |
| GET | `/packs/:id/download` | USER | Entitlement-checked bundle download (zip via signed URL) |
| PATCH | `/packs/:id` | CREATOR (owner) | Edit pack metadata / bulk price |
| DELETE | `/packs/:id` | CREATOR (owner) | Archive pack |

`GET /packs/:slug` returns pack fields + `items` (icon summaries) + `coverIcon`.

---

## 10. Categories — `/categories`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/categories` | VISITOR | Full category tree (self-referential) |
| GET | `/categories/:slug` | VISITOR | Category detail + child categories |
| GET | `/categories/:slug/icons` | VISITOR | PUBLISHED icons in category (cursor, filter, sort) |

`GET /categories` is cache-aside (Redis) and returns the nested tree with
`iconCount` per node.

---

## 11. Tags — `/tags`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/tags` | VISITOR | List tags (supports `q` prefix, `sort=usage`) |
| GET | `/tags/:slug/icons` | VISITOR | PUBLISHED icons with tag (cursor) |

---

## 12. Search — `/search`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/search` | VISITOR | Full-text search across icons (+ creators/packs facets) |
| GET | `/search/suggest` | VISITOR | Typeahead suggestions |

Postgres FTS + trigram for MVP (Meilisearch in Phase 2 — see ARCHITECTURE.md).

**`GET /search`** query: `q` (required), `categoryId`, `tag`, `priceType`,
`license`, `sort` (`relevance|trending|newest|downloads`, default `relevance`),
`cursor`, `limit`.

```
GET /api/v1/search?q=do%27ppi%20hat&priceType=PREMIUM&sort=relevance&limit=24
```

Response `200`:

```json
{
  "query": "do'ppi hat",
  "data": [
    {
      "id": "021a...",
      "slug": "doppi-traditional-hat",
      "name": "Do'ppi Traditional Hat",
      "priceType": "PREMIUM",
      "priceCents": 199,
      "currency": "USD",
      "license": "PREMIUM_STANDARD",
      "previewUrl": "https://cdn.turkistanicons.com/png/021a....png",
      "thumbUrl": "https://cdn.turkistanicons.com/thumb/021a....png",
      "downloadCount": 980,
      "score": 0.91,
      "category": { "name": "Clothing", "slug": "clothing" },
      "creator": { "displayName": "Aziza K.", "slug": "aziza-k" }
    }
  ],
  "facets": {
    "categories": [ { "slug": "clothing", "name": "Clothing", "count": 12 } ],
    "priceType": [ { "value": "FREE", "count": 5 }, { "value": "PREMIUM", "count": 14 } ]
  },
  "page": { "nextCursor": "eyJzIjowLjkxfQ", "hasMore": true }
}
```

`200` with empty `data` on zero results (tracked as a quality metric, PRD §7).

---

## 13. Uploads — `/uploads`

Creator upload uses a three-step **signed-PUT** flow (ARCHITECTURE.md §3,
BACKEND.md §10). All require role `CREATOR`.

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/uploads/init` | CREATOR | Create DRAFT icon + return signed PUT URL (idempotent) |
| POST | `/uploads/:id/finalize` | CREATOR (owner) | Confirm R2 object → enqueue processing |
| GET | `/uploads/:id/status` | CREATOR (owner) | Poll processing/moderation status |

**`POST /uploads/init`** — header `Idempotency-Key: <uuid>` required. Request:

```json
{
  "fileName": "doppi.svg",
  "contentType": "image/svg+xml",
  "fileSize": 9210,
  "name": "Do'ppi Traditional Hat",
  "categoryId": "0c2...",
  "priceType": "PREMIUM",
  "priceCents": 199,
  "license": "PREMIUM_STANDARD",
  "tags": ["doppi", "hat", "clothing"]
}
```

Response `201`:

```json
{
  "icon": { "id": "021a...", "status": "DRAFT", "slug": "doppi-traditional-hat" },
  "upload": {
    "url": "https://r2.turkistanicons.com/raw/01a2.../021a....svg?X-Amz-Signature=...",
    "method": "PUT",
    "headers": { "Content-Type": "image/svg+xml" },
    "maxBytes": 2097152,
    "expiresIn": 300
  }
}
```

The client then `PUT`s the raw SVG directly to R2 (quarantine bucket).
`422` if `contentType`/`fileSize` violate limits; size/type are re-validated
server-side by content (not extension) during processing per CLAUDE.md.

**`POST /uploads/:id/finalize`** — server verifies the R2 object exists
(`headObject`), sets status `PROCESSING`, and enqueues the `icon-processing`
BullMQ job (sanitize SVG → render PNG/thumb). Response `202`:

```json
{ "id": "021a...", "status": "PROCESSING" }
```

**`GET /uploads/:id/status`** — response `200`:

```json
{
  "id": "021a...",
  "status": "PENDING_REVIEW",
  "checksum": "sha256:7f9c...",
  "previewUrl": "https://cdn.turkistanicons.com/png/021a....png",
  "rejectionReason": null
}
```

`status` walks `DRAFT → PROCESSING → PENDING_REVIEW → PUBLISHED` (or `REJECTED`
with `rejectionReason`), matching `IconStatus` in DATABASE.md.

> The same init/finalize pattern (without processing/moderation) backs avatar and
> creator-asset uploads via `purpose: "avatar"` on init.

---

## 14. Favorites — `/favorites`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/favorites` | USER | List own favorited icons (cursor) |
| POST | `/favorites` | USER | Favorite an icon `{ iconId }` |
| DELETE | `/favorites/:iconId` | USER | Unfavorite |

`POST` returns `201`; `409` if already favorited (UNIQUE `(user_id, icon_id)`).
Updates `favorite_count` via the analytics queue.

---

## 15. Collections — `/collections`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/collections` | USER | List own collections |
| POST | `/collections` | USER | Create `{ name, isPublic?, description? }` |
| GET | `/collections/:slug` | VISITOR* | Get collection (public, or owner) |
| PATCH | `/collections/:id` | USER (owner) | Rename / toggle visibility |
| DELETE | `/collections/:id` | USER (owner) | Delete collection |
| POST | `/collections/:id/items` | USER (owner) | Add icon `{ iconId }` |
| DELETE | `/collections/:id/items/:iconId` | USER (owner) | Remove icon |

\* private collections return `404` to non-owners (existence hidden). Ownership
enforced by `OwnershipGuard` (BACKEND.md §5).

---

## 16. Reviews — `/icons/:id/reviews`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/icons/:id/reviews` | VISITOR | List reviews for an icon (cursor) |
| POST | `/icons/:id/reviews` | USER | Create `{ rating (1-5), comment? }` |
| PATCH | `/icons/:id/reviews/:reviewId` | USER (owner) | Edit own review |
| DELETE | `/icons/:id/reviews/:reviewId` | USER (owner) | Delete own review |

`POST` returns `409` if the user already reviewed the icon (UNIQUE
`(user_id, icon_id)`). `422` if rating out of range.

---

## 17. Purchases — `/purchases`

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/purchases/checkout` | USER | Create Stripe Checkout for icons/packs (idempotent) |
| GET | `/purchases` | USER | List own purchases (cursor) |
| GET | `/purchases/:id` | USER (owner) | Purchase detail + items + entitlement |

**`POST /purchases/checkout`** — header `Idempotency-Key` required. Request:

```json
{
  "items": [
    { "type": "ICON", "id": "021a..." },
    { "type": "PACK", "id": "07bb..." }
  ],
  "successUrl": "https://turkistanicons.com/checkout/success",
  "cancelUrl": "https://turkistanicons.com/checkout/cancel"
}
```

The server prices items server-side (never trusts client prices), creates a
`purchase` (`PENDING`) + `purchase_items` with `unit_price_cents`,
`platform_fee_cents`, `creator_earnings_cents` (revenue split per
`revenue_share_bps`), and opens a Stripe Checkout Session. Response `201`:

```json
{
  "purchaseId": "0p11...",
  "status": "PENDING",
  "totalCents": 498,
  "currency": "USD",
  "checkoutUrl": "https://checkout.stripe.com/c/pay/cs_test_...",
  "stripeCheckoutId": "cs_test_a1b2c3"
}
```

The purchase flips to `PAID` only via the Stripe webhook (§18); entitlement +
download access unlock then. `409` if the same `Idempotency-Key` is reused with a
different body. `422` if an item is not purchasable (free / not PUBLISHED).

**`GET /purchases/:id`** response `200`:

```json
{
  "id": "0p11...",
  "status": "PAID",
  "subtotalCents": 498,
  "totalCents": 498,
  "currency": "USD",
  "items": [
    { "itemType": "ICON", "iconId": "021a...", "name": "Do'ppi Traditional Hat", "unitPriceCents": 199 },
    { "itemType": "PACK", "packId": "07bb...", "name": "Navruz Pack", "unitPriceCents": 299 }
  ],
  "createdAt": "2026-03-01T15:20:00Z"
}
```

---

## 18. Payments / webhook — `/webhooks/stripe`

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/webhooks/stripe` | (Stripe) | Stripe event sink — signature-verified, idempotent |

- **Not** behind `JwtAuthGuard` (marked `@Public()`); authenticated by the
  `Stripe-Signature` header against the webhook secret.
- Requires the **raw request body** (configured in `main.ts`, BACKEND.md §8).
- **Idempotent**: each event recorded by `stripe_event_id` (UNIQUE on
  `payments`); re-delivered events return `200` without reprocessing.

Handled events:

| Event | Effect |
|---|---|
| `checkout.session.completed` | mark `purchase` `PAID`, write `payment`, unlock entitlements, queue receipt email |
| `checkout.session.expired` | mark `purchase` `FAILED` |
| `charge.refunded` | mark `purchase` `REFUNDED`, revoke entitlement |
| `transfer.*` / `payout.*` | update `payouts` (Stripe Connect) |

Always responds `200` quickly (side effects done synchronously-but-fast or
enqueued). Invalid signature → `400`.

---

## 19. Downloads — `/downloads`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/downloads` | USER | Own download history (cursor) |

The actual file delivery is `GET /icons/:id/download` (§8). History is written to
the partitioned `download_history` table.

---

## 20. Creator dashboard — `/creator`

All require role `CREATOR` (apply requires only `USER`). Scoped to the calling
creator.

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/creator/apply` | USER | Submit creator application `{ portfolioUrl, message }` |
| GET | `/creator/application` | USER | Status of own application |
| GET | `/creator/icons` | CREATOR | Own icons across all statuses (cursor, `status` filter) |
| GET | `/creator/packs` | CREATOR | Own packs |
| GET | `/creator/analytics` | CREATOR | Downloads, revenue, top icons, conversion |
| GET | `/creator/payouts` | CREATOR | Payout history + pending balance |

**`POST /creator/apply`** → `201` with `{ status: "PENDING" }`. `409` if an
application is already pending or the user is already a creator.

**`GET /creator/analytics`** response `200` (creator-private; exposes the revenue
figures hidden from public profiles):

```json
{
  "range": { "from": "2026-05-01", "to": "2026-05-31" },
  "totals": { "downloads": 4210, "revenueCents": 128400, "currency": "USD", "newReviews": 22 },
  "topIcons": [ { "id": "021a...", "name": "Do'ppi Traditional Hat", "downloads": 980, "revenueCents": 19500 } ],
  "payouts": { "pendingCents": 41000, "lastPayoutAt": "2026-05-15T00:00:00Z" }
}
```

---

## 21. Admin — `/admin`

All require role `ADMIN`.

### Moderation

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/admin/moderation/queue` | ADMIN | Icons/packs in `PENDING_REVIEW` (cursor) |
| POST | `/admin/moderation/:iconId/approve` | ADMIN | Approve → `PUBLISHED` |
| POST | `/admin/moderation/:iconId/reject` | ADMIN | Reject → `REJECTED` `{ reason }` |
| POST | `/admin/moderation/:iconId/request-changes` | ADMIN | `{ reason }` |

Each action writes a `moderation_events` row (`ModerationAction`) and queues a
notification email to the creator.

### Users

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/admin/users` | ADMIN | List/search users (cursor, filter by role/status) |
| GET | `/admin/users/:id` | ADMIN | User detail |
| PATCH | `/admin/users/:id` | ADMIN | Change role / suspend / reactivate |

### Creators / applications

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/admin/creator-applications` | ADMIN | List applications (filter by status) |
| POST | `/admin/creator-applications/:id/approve` | ADMIN | Approve → grant `CREATOR` role |
| POST | `/admin/creator-applications/:id/reject` | ADMIN | Reject `{ reviewNote }` |

### Categories / taxonomy

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/admin/categories` | ADMIN | Create category `{ name, parentId?, sortOrder? }` |
| PATCH | `/admin/categories/:id` | ADMIN | Edit / re-parent / reorder |
| DELETE | `/admin/categories/:id` | ADMIN | Delete (if no icons) |
| POST | `/admin/tags` / PATCH / DELETE | ADMIN | Manage tags |

### Analytics

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/admin/analytics` | ADMIN | Platform GMV, downloads, signups, top creators |

```json
{
  "range": { "from": "2026-05-01", "to": "2026-05-31" },
  "gmvCents": 2840000,
  "downloads": 482000,
  "signups": 3120,
  "newCreators": 84,
  "topCreators": [ { "slug": "aziza-k", "revenueCents": 412000, "downloads": 41020 } ],
  "moderation": { "pending": 37, "rejectRate": 0.12, "avgTurnaroundHours": 9.4 }
}
```

---

## 22. Notifications — `/notifications`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/notifications` | USER | List in-app notifications (cursor, `unreadOnly`) |
| POST | `/notifications/read` | USER | Mark all/`{ ids }` as read |
| GET | `/notifications/unread-count` | USER | Badge count |

In-app notifications are paired with transactional email via the `email` queue
(moderation results, purchase receipts, payout updates).

---

## 23. Health — `/health`

| Method | Path | Role | Description |
|---|---|---|---|
| GET | `/health` | VISITOR | Liveness (always `200` if process up) |
| GET | `/health/ready` | VISITOR | Readiness — checks Postgres, Redis, R2 |

`GET /health/ready` returns `200`/`503`:

```json
{ "status": "ok", "checks": { "postgres": "up", "redis": "up", "r2": "up" } }
```

---

## 24. Rate limits

Redis-backed (`ThrottlerGuard`), per IP for anonymous and per user for
authenticated requests. Every response carries `X-RateLimit-*` headers; `429`
adds `Retry-After`.

| Bucket | Endpoints | Limit (default) |
|---|---|---|
| Auth | `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/refresh` | 10 / 15 min / IP |
| Upload | `/uploads/*` | 30 / hour / creator |
| Download | `/icons/:id/download`, `/packs/:id/download` | 120 / hour / user |
| Search/browse | `/search`, `/icons`, public reads | 600 / 15 min / IP |
| Default | everything else | 300 / 15 min / principal |

`429` response (problem JSON):

```json
{
  "type": "https://turkistanicons.com/errors/rate-limit",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "Rate limit exceeded for auth. Retry after 42s.",
  "instance": "/api/v1/auth/login",
  "requestId": "req_2b9d..."
}
```
