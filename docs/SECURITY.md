# Security Model — TurkistanIcons

Threat model and controls for an icon marketplace that ingests **untrusted
SVG** from the public, handles **payments**, and stores **PII**. Principle
throughout: **deny by default, validate by content, never trust the client.**

Companion docs: [ARCHITECTURE.md](ARCHITECTURE.md),
[UPLOAD-PIPELINE.md](UPLOAD-PIPELINE.md), [DATABASE.md](DATABASE.md).

---

## 1. SVG sanitization (the headline risk)

SVG is XML that browsers execute as active content. An attacker-supplied SVG can
run script, exfiltrate data, or attack our infrastructure. Because Creators
upload SVGs and we serve them to everyone, this is our highest-severity surface.

### Threats and exact mitigations

| Threat | What it looks like | Mitigation |
|---|---|---|
| **XSS via SVG** | `<script>`, `on*` handlers, `javascript:` href, `<foreignObject>` smuggling HTML | Strict **allowlist** sanitization (DOMPurify in jsdom + svgo); strip all scripting elements/attrs; serve from a **separate origin** so even a missed payload can't touch the app session |
| **XXE** | `<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]>` | Parse with **DTD disabled, external entities disabled, no network/file resolution**; reject any `<!DOCTYPE>`/`<!ENTITY>` |
| **Billion laughs / decompression bomb** | Nested entity expansion or huge generated geometry | No entity expansion (DTD off) **plus** complexity caps: bytes, element count, nesting depth, total path-point count; hard byte cap on download |
| **SSRF / data exfil via external refs** | `xlink:href="http://internal/…"`, `<image href="http://…">`, CSS `url(http://…)`, `@import` | Reject **all remote** `href`/`url()`; allow only inline/relative; render with networking disabled |
| **JS execution at render time** | scripts firing in a headless renderer | Render with **resvg** (static rasterizer, no JS engine) from the **sanitized** SVG only |
| **CSS-based attacks** | `<style>@import`, remote fonts, `expression()` | Strip `@import` and remote `url()`; allowlist CSS properties |

### Sanitization pipeline (summary)

Performed in the isolated upload worker — see
[UPLOAD-PIPELINE.md](UPLOAD-PIPELINE.md) §4:

1. **Content sniff** — confirm real SVG/XML (magic/leading bytes), not a renamed
   binary, HTML, or polyglot.
2. **Hardened XML parse** — DTD off, external entities off, no network.
3. **Allowlist sanitize** — **DOMPurify (jsdom, `USE_PROFILES:{ svg:true }`)** as
   the security boundary, plus **svgo** for optimization. Strip:
   `<script>`, `on*` attributes, `<foreignObject>`, `<!ENTITY>`/`<!DOCTYPE>`,
   remote `href`/`xlink:href`/`url()`, `javascript:`/`vbscript:`/non-image
   `data:` URIs, CSS `@import`, and any element/attribute not on the allowlist.
4. **Malicious-pattern scan** — heuristic regex pass as defense-in-depth.
5. **Optimize/normalize** with svgo → canonical safe SVG.
6. **Render previews** (resvg/sharp) from the sanitized SVG only.

> svgo is **optimization**, not security. The allowlist sanitizer (DOMPurify +
> explicit element/attr allowlist) is the trust boundary. Never rely on svgo
> alone.

### Why a separate origin / CDN + CSP

Untrusted SVGs are served from a **dedicated asset origin** (R2 via CDN, e.g.
`assets.turkistanicons.com`), **never** inlined into app HTML and never from the
app's origin. Rationale:

- An SVG opened directly on the asset origin runs in **that origin's** context —
  it has no access to app cookies, tokens, or `localStorage` (origin isolation).
- We additionally set a **restrictive CSP on the asset origin** (`script-src
  'none'`, `sandbox`) and serve with `Content-Disposition`/correct content type.
- In the app, icons are displayed as `<img src>` / CSS background where browsers
  treat SVG as a passive image (no script execution), never via inline `<svg>`
  injection of untrusted markup or `dangerouslySetInnerHTML`.

---

## 2. Authentication

- **JWT access + refresh.** Short-lived access token (≈15 min); long-lived
  **refresh token rotated on every use** and stored/tracked in **Redis** (TTL =
  refresh lifetime). Rotation detects reuse: a replayed (already-rotated) refresh
  token invalidates the whole token family → forced re-login. Sessions are
  revocable (logout / "sign out all devices" deletes the Redis family).
- **Password hashing: argon2id** with tuned memory/time/parallelism cost; never
  MD5/SHA/bcrypt-without-reason, never plaintext. `password_hash` is nullable for
  OAuth-only accounts ([DATABASE.md](DATABASE.md)).
- **Google OAuth** via Passport; verify the ID token (issuer, audience, expiry)
  server-side. Link to existing account only after **email is verified** to
  prevent account-takeover via OAuth pre-link.
- **Email verification** — `email_verified_at`; unverified accounts cannot
  upload, purchase, or appear publicly. Verification tokens are random,
  single-use, short-TTL, stored hashed.
- **Password reset** — random single-use token, short TTL, hashed at rest,
  invalidated on use or on password change; **constant-time** lookup and generic
  responses (no account-existence oracle).

---

## 3. Authorization (RBAC)

- Roles: `VISITOR → USER → CREATOR → ADMIN` ([CLAUDE.md](../CLAUDE.md)).
- **Deny by default.** Every non-public route requires `JwtAuthGuard`; protected
  actions add `RolesGuard` with required role(s). No route is reachable without
  an explicit grant.
- **Ownership checks** beyond role: a `CREATOR` may only mutate **their own**
  icons/packs (`icon.creator_id === caller.creatorId`); a `USER` only their own
  collections/favorites/purchases. Role alone is never sufficient for
  resource-scoped writes.
- **Admin actions are audited** — every moderation/admin mutation writes
  `audit_log` (`actor_id`, `action`, `entity`, `entity_id`, `metadata`, `ip`)
  and, for moderation, `moderation_events` ([DATABASE.md](DATABASE.md)).
- Authorization is **server-side only**; the web app's role checks are UX hints,
  never enforcement.

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('CREATOR')
@Patch('icons/:id')
update(@Param('id') id: string, @CurrentUser() u: AuthUser, @Body() dto: UpdateIconDto) {
  return this.icons.updateOwned(id, u.creatorId, dto); // throws 403 if not owner
}
```

---

## 4. Rate limiting & abuse throttling

Layered: **Cloudflare WAF/rate rules at the edge** (first line vs DoS/bots) plus
**app-level throttling** backed by **Redis counters** (per-IP and per-user).

| Surface | Limit (illustrative) | Key |
|---|---|---|
| `POST /auth/login`, `/auth/register` | 5 / min, then exponential lockout | IP + email |
| `POST /auth/forgot-password` | 3 / hour | IP + email |
| `POST /uploads/init` | per-creator quota + burst | userId |
| Download (free) | per-user & per-IP burst caps | userId / IP |
| Search | generous per-IP | IP |

- App throttler (e.g. `@nestjs/throttler` with Redis store) enforces sliding
  windows; auth endpoints get stricter limits + lockout/backoff.
- Cloudflare provides bot management, geo/ASN rules, and absorbs volumetric
  attacks before they reach the API.

---

## 5. File validation

Applies to single SVGs and pack zips (see [UPLOAD-PIPELINE.md](UPLOAD-PIPELINE.md)):

- **Content-type sniffing** — validate by **content**, not extension or
  client-declared MIME ([CLAUDE.md](../CLAUDE.md) rule).
- **Magic bytes** — confirm SVG/XML signature; reject polyglots and renamed
  binaries.
- **Size caps** — enforced three times: signed-URL `Content-Length` constraint,
  R2 `HEAD` at finalize, and a hard streamed byte cap in the worker.
- **Dimension caps** — reject absurd `viewBox`/raster dimensions (DoS on
  render).
- **Complexity caps** — element count, nesting depth, path-point totals (parse
  blowup).
- **Zip-bomb protection (packs)** — cap entry count, **total uncompressed**
  size, per-entry size, and compression ratio; reject path traversal (`../`,
  absolute paths) and non-`.svg` entries; stream-extract and never trust the
  zip's declared sizes.

---

## 6. XSS prevention (beyond SVG)

- **Output encoding** — React escapes by default; **no `dangerouslySetInnerHTML`
  with untrusted data**, ever.
- **CSP** on the app origin (see §13) restricts script/style/connect sources.
- **No inline untrusted SVG** — icons rendered as images from the asset origin
  (§1), never injected as markup.
- **Sanitize user text** — creator bios, icon descriptions, reviews, collection
  names: strip/encode HTML on input and encode on output; treat all as untrusted.

---

## 7. SQL injection prevention

- **Prisma only**, parameterized queries throughout. The web app never touches
  Postgres ([CLAUDE.md](../CLAUDE.md)).
- **No raw string-built SQL.** If `$queryRaw` is ever required, it must use
  Prisma's tagged-template parameter binding (`Prisma.sql`), never string
  concatenation. This is enforced in review.

---

## 8. CSRF

- Auth cookies (where used) are **`httpOnly` + `Secure` + `SameSite=Lax`** (or
  `Strict` for sensitive flows), so JS can't read tokens and cross-site requests
  don't auto-send them.
- For cookie-authenticated state-changing routes, add **double-submit CSRF
  tokens** (cookie + matching header) as defense-in-depth.
- The Bearer-token API path (access token in `Authorization` header, not a
  cookie) is inherently CSRF-resistant.

---

## 9. Secrets management

- **Env only** — secrets via environment variables; `.env` is never committed;
  `.env.example` is the contract ([CLAUDE.md](../CLAUDE.md)).
- Production secrets live in a managed secret store / platform secrets, not in
  the image or repo.
- **Rotation** — JWT signing keys, R2 credentials, Stripe keys, and DB creds are
  rotatable; support key overlap (kid-based JWT verification) for zero-downtime
  rotation. Revoke on suspected compromise.

---

## 10. Payment security (Stripe)

- **Webhook signature verification** — every Stripe webhook is verified with the
  signing secret (`Stripe-Signature`) against the **raw** request body; reject
  unverified events.
- **Idempotency** — `payments.stripe_event_id` is **UNIQUE**
  ([DATABASE.md](DATABASE.md)); re-delivered events are no-ops. Use Stripe
  idempotency keys on outbound calls.
- **Never trust client amounts** — prices, totals, fees, and entitlements are
  computed **server-side** from DB records and confirmed against the verified
  webhook; the client cannot influence `total_cents` or what gets unlocked.
- **Entitlement** is granted only when the parent `purchase` is `PAID` per a
  verified event, then checked on every premium download.

---

## 11. PII & data protection

- PII (email, name, OAuth ids, IPs in `download_history`/`audit_log`) is
  minimized and access-controlled; only the owning user + admins can read a
  user's PII.
- TLS everywhere (Cloudflare-terminated + internal); encryption at rest for DB,
  Redis, and R2.
- Passwords/tokens are **never logged**; logs carry hashes/ids, not raw SVGs,
  secrets, or card data (card data never touches our servers — Stripe-hosted).
- Account deletion / data export support; soft-delete via `deleted_at` where
  reversibility is required, with a hard-delete path for true erasure requests.

---

## 12. Dependency / supply-chain & general abuse

- **Lockfile committed** (pnpm) for reproducible installs; renovate/dependabot
  for updates; `pnpm audit` (or equivalent) in CI; fail build on high-severity
  CVEs.
- Pin and review new dependencies; don't add a dep for something the stack
  already covers ([CLAUDE.md](../CLAUDE.md)).
- **Download abuse / scraping** — per-user & per-IP download caps, signed
  short-lived GET URLs (premium), Cloudflare bot management, anomaly detection on
  `download_history`.
- **Account takeover** — argon2id, refresh-token reuse detection (§2), login
  rate-limit + lockout, email alerts on new-device/password-change, optional MFA
  for admins/creators.
- **CDN cache poisoning** — content-addressed/immutable asset keys; sanitize
  cache keys.

---

## 13. CSP example

**App origin** (Next.js) — strict, nonce-based scripts, no inline untrusted SVG:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{RANDOM}' https://js.stripe.com;
  style-src 'self' 'nonce-{RANDOM}';
  img-src 'self' https://assets.turkistanicons.com data: blob:;
  font-src 'self';
  connect-src 'self' https://api.turkistanicons.com https://api.stripe.com;
  frame-src https://js.stripe.com https://hooks.stripe.com;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests
```

**Asset origin** (`assets.turkistanicons.com`, serving user SVG/PNG) — lock down
hard so even a sanitizer miss is inert:

```
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox
X-Content-Type-Options: nosniff
Content-Disposition: inline
Cross-Origin-Resource-Policy: cross-origin
```

Plus on both: `Strict-Transport-Security`, `X-Frame-Options: DENY` (or
`frame-ancestors`), `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Content-Type-Options: nosniff`, `Permissions-Policy` minimized.

---

## 14. Security checklist

**SVG / uploads**
- [ ] Raw uploads land in private `quarantine/`; never publicly readable
- [ ] DOMPurify(jsdom) + svgo allowlist; `<script>`/`on*`/`<foreignObject>` stripped
- [ ] XML parsed with DTD + external entities **disabled** (XXE)
- [ ] Complexity/size/dimension caps enforced (billion-laughs, render DoS)
- [ ] All remote `href`/`url()`/`@import` rejected (SSRF/exfil)
- [ ] Previews rendered from sanitized SVG with networking off
- [ ] User SVGs served from separate asset origin with locked-down CSP
- [ ] Zip packs: entry/size/ratio caps + path-traversal rejection

**Auth & authz**
- [ ] argon2id password hashing
- [ ] Access + rotating refresh tokens in Redis; reuse detection
- [ ] Google OAuth token verified server-side; link only after email verified
- [ ] Email verification, single-use hashed reset tokens (no account oracle)
- [ ] Deny-by-default guards; ownership checks on resource writes
- [ ] Admin actions written to `audit_log` + `moderation_events`

**Platform**
- [ ] Edge (Cloudflare WAF) + app (Redis throttler) rate limits on auth/upload/download/search
- [ ] File validation by content (sniff + magic bytes), not extension
- [ ] Prisma parameterized queries only; no string-built SQL
- [ ] Cookies `httpOnly`+`Secure`+`SameSite`; CSRF tokens where cookie-auth
- [ ] CSP + security headers on both origins
- [ ] Secrets in env/secret store only; rotation supported
- [ ] Stripe webhook signatures verified; `stripe_event_id` unique (idempotent)
- [ ] Amounts/entitlements computed server-side, never from client
- [ ] PII access-controlled; no secrets/PII/raw SVG in logs
- [ ] Lockfile committed; dependency audit in CI
- [ ] Download abuse / scraping / ATO controls in place
```
