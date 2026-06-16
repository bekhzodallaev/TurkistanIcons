# Risks and Challenges — TurkistanIcons

A living register of the material risks to building and operating TurkistanIcons,
a production icon marketplace for Uzbek and Central Asian cultural icons. Each
risk has a description, **impact**, **likelihood**, and concrete **mitigation**.

Context: untrusted SVG uploads, two-sided marketplace, Stripe payments, creators
concentrated in Central Asia, scale targets of 100k+ icons / 10k+ creators /
millions of downloads. See [SECURITY.md](SECURITY.md),
[UPLOAD-PIPELINE.md](UPLOAD-PIPELINE.md), [ARCHITECTURE.md](ARCHITECTURE.md).

Scales used below:

- **Impact:** Low · Medium · High · Critical
- **Likelihood:** Rare · Possible · Likely · Almost certain

---

## 1. Security

### 1.1 Untrusted SVG → XSS / XXE / SVG abuse (TOP RISK)
- **Description:** Uploaded SVGs are arbitrary XML and can carry `<script>`,
  `on*` event handlers, external/remote references, `<foreignObject>`, CSS
  exfiltration, billion-laughs / external-entity (XXE) payloads, and
  self-referential bombs. If an SVG is served inline on the app origin or
  rendered unsanitized, it executes in victims' sessions.
- **Impact:** Critical — stored XSS can hijack any session including `ADMIN`,
  exfiltrate tokens, and pivot to full account/platform takeover.
- **Likelihood:** Almost certain (malicious uploads are guaranteed at any scale).
- **Mitigation:**
  - [ ] Treat every upload as hostile; validate by content, not extension.
  - [ ] Server-side sanitize in the isolated **upload worker** (SVGO/DOMPurify, strict allowlist); strip `<script>`, `on*`, external/remote `href`/`xlink:href`, `<foreignObject>`, DOCTYPE/entities (XXE), and unknown elements.
  - [ ] Quarantine the raw upload (`svg_raw_key`); only the sanitized output (`svg_key`) is ever served.
  - [ ] Serve all user SVGs from a **separate origin/CDN** (R2), never inline into app HTML; restrictive CSP and `Content-Disposition`/sandboxing.
  - [ ] Hard limits on size/dimensions/entity expansion to defuse XML bombs.
  - [ ] Maintain a malicious-SVG test corpus in CI; fail builds on regressions.

### 1.2 Payment fraud
- **Description:** Stolen-card purchases, friendly-fraud chargebacks, and
  self-buying to inflate creator earnings / extract payouts.
- **Impact:** High — chargeback fees, fraud-rate penalties, fraudulent payouts.
- **Likelihood:** Likely (marketplaces with payouts are prime targets).
- **Mitigation:**
  - [ ] Stripe as PCI boundary; enable Radar fraud rules + 3-D Secure (SCA).
  - [ ] Idempotent webhooks keyed by `stripe_event_id`; entitlement only after confirmed `PAID`.
  - [ ] Detect self-purchase / creator-buyer collusion; hold/delay first payouts.
  - [ ] Velocity + anomaly limits; manual review thresholds (mature into Phase 3 fraud systems).

### 1.3 Account takeover (ATO)
- **Description:** Credential stuffing, weak/reused passwords, phishing,
  session/refresh-token theft, OAuth account-linking abuse.
- **Impact:** High — theft of paid libraries, creator earnings, or admin powers.
- **Likelihood:** Likely.
- **Mitigation:**
  - [ ] Strong hashing (Argon2/bcrypt), rate-limit + lockout on auth endpoints.
  - [ ] Rotating refresh tokens in Redis with reuse detection; revocable sessions.
  - [ ] Email verification; safe OAuth linking only on verified-email match.
  - [ ] Offer 2FA (esp. creators/admins); audit-log sensitive actions.

---

## 2. Technical

### 2.1 Search scaling & relevance
- **Description:** Postgres FTS may degrade in latency/relevance approaching 100k+
  icons and complex faceted queries.
- **Impact:** Medium — slow/poor search hurts discovery and conversion.
- **Likelihood:** Likely (at scale).
- **Mitigation:** GIN `tsvector` + trigram and cache hot queries for MVP; planned
  Meilisearch migration (Phase 2) behind a flag with FTS fallback; track p95 and
  zero-result rate as triggers.

### 2.2 Upload pipeline reliability
- **Description:** BullMQ jobs can fail, stall, double-process, or back up; worker
  crashes can lose previews or leave icons stuck in `PROCESSING`.
- **Impact:** High — broken supply path; stuck/duplicate content.
- **Likelihood:** Possible.
- **Mitigation:** Idempotent jobs (keyed by job id); retries with backoff + DLQ;
  status reconciliation job for stuck states; alerting on queue depth/age; scale
  workers independently of the API.

### 2.3 R2 / CDN cost & egress
- **Description:** Millions of downloads + PNG previews drive storage and request
  costs; un-cached or hot-linked assets amplify egress.
- **Impact:** Medium — margin erosion.
- **Likelihood:** Likely (success-correlated).
- **Mitigation:** R2 (no egress fees) + Cloudflare CDN caching; signed/short-TTL
  GETs to deter hot-linking; aggressive cache headers; thumbnail tiering; cost
  dashboards + budget alerts.

### 2.4 Database scaling
- **Description:** `download_history` and analytics are heavy write paths;
  contention and table bloat threaten the single primary.
- **Impact:** High — write contention or outage on the system of record.
- **Likelihood:** Possible (at scale).
- **Mitigation:** Monthly range-partition `download_history`; denormalized
  counters updated transactionally/via queue and reconciled nightly; read
  replicas + pooling (PgBouncer); precomputed summary tables (Phase 3).

### 2.5 Image processing cost / DoS
- **Description:** SVG→PNG rendering is CPU-bound; crafted complex SVGs can act as
  resource-exhaustion attacks on workers.
- **Impact:** Medium — pipeline slowdown / cost spikes.
- **Likelihood:** Possible.
- **Mitigation:** Per-job CPU/time/memory limits + timeouts; isolated worker pool;
  size/complexity caps; rate-limit uploads per creator; autoscale workers on
  queue depth.

---

## 3. Product / Market

### 3.1 Cold-start two-sided marketplace (supply vs demand)
- **Description:** Buyers won't come without enough quality icons; creators won't
  upload without buyers — the classic chicken-and-egg.
- **Impact:** High — stalls growth despite a working product.
- **Likelihood:** Likely.
- **Mitigation:** Seed initial supply (commission/in-house cultural icon sets
  across all categories) before public launch; recruit anchor creators with
  favorable revenue share; lead with strong free catalog to pull demand; focus
  marketing on the under-served cultural niche.

### 3.2 Content quality / curation
- **Description:** Open uploads risk low-quality, off-style, or duplicate icons
  diluting the curated value proposition.
- **Impact:** Medium — weakens the differentiator vs generic marketplaces.
- **Likelihood:** Likely.
- **Mitigation:** Mandatory moderation gate (only `PUBLISHED` is public); checksum
  dedupe; style/quality guidelines; reject reasons; featured/curated surfaces;
  ML-assisted pre-screening later (Phase 3).

### 3.3 Niche market size
- **Description:** Central Asian cultural iconography is a deliberately narrow
  niche; addressable demand may cap revenue.
- **Impact:** Medium — limits TAM/ceiling.
- **Likelihood:** Possible.
- **Mitigation:** Own the niche as the authoritative source (SEO, authenticity,
  education/B2B/government/tourism buyers); i18n (uz/ru) to widen regional reach;
  planned adjacent-asset and broader Central Asian expansion (Phase 3).

---

## 4. Legal / Content

### 4.1 Copyright / IP infringement of uploaded icons
- **Description:** Creators may upload assets they don't own or that infringe
  third-party IP/trademarks.
- **Impact:** High — legal liability, takedowns, reputational harm.
- **Likelihood:** Likely.
- **Mitigation:** Creator agreement warranting ownership; checksum/duplicate
  detection; reporting flow; clear takedown SLA; suspend repeat infringers; audit
  trail of who uploaded what.

### 4.2 Cultural sensitivity / appropriation
- **Description:** Sacred, regional, or ethnically specific motifs (Suzani,
  Atlas, Navruz symbols) may be misrepresented or seen as appropriated/commodified.
- **Impact:** High — community backlash undermines the authenticity brand.
- **Likelihood:** Possible.
- **Mitigation:** Cultural review guidelines + advisors; provenance/attribution
  metadata where relevant; prioritize creators from the cultures represented;
  responsive reporting + correction process.

### 4.3 Licensing clarity
- **Description:** Ambiguity across free-attribution, premium-standard, and
  premium-extended licenses confuses buyers and invites misuse/disputes.
- **Impact:** Medium — disputes, refunds, misuse.
- **Likelihood:** Possible.
- **Mitigation:** Plain-language license terms per `LicenseType`; license shown on
  detail + receipts; license file bundled with downloads; downloadable license
  certificate.

### 4.4 DMCA / takedown handling
- **Description:** Must process takedown/counter-notices lawfully and promptly.
- **Impact:** High — safe-harbor loss / liability if mishandled.
- **Likelihood:** Possible.
- **Mitigation:** Published DMCA agent + policy; ticketed takedown workflow with
  SLAs; counter-notice path; repeat-infringer policy; logged actions.

### 4.5 Tax & payouts across countries (Uzbekistan / Central Asia)
- **Description:** Cross-border VAT/sales-tax, withholding, invoicing, and FX for
  a creator base concentrated in emerging markets.
- **Impact:** High — compliance exposure; creators can't get paid.
- **Likelihood:** Likely.
- **Mitigation:** Use Stripe Tax + Connect for tax/KYC where supported; collect
  W-8/local tax info; clear creator tax responsibility in terms; legal/tax
  counsel for target markets; surface net-of-fees earnings clearly.

### 4.6 Stripe availability in target regions
- **Description:** Stripe (esp. Connect payouts) has limited/uncertain support in
  Uzbekistan and parts of Central Asia, blocking creator payouts to the core base.
- **Impact:** Critical — creators in the home market may be unable to receive
  earnings, directly threatening the supply side and the business model.
- **Likelihood:** Likely.
- **Mitigation:** Validate Stripe Connect country support **before** launch;
  evaluate alternative/local payout rails (Payoneer, Wise, local providers);
  abstract the payout provider behind an interface; hold escrowed balances with a
  documented withdrawal path until a working rail exists; communicate clearly to
  creators.

---

## 5. Operational

### 5.1 Moderation scale & cost
- **Description:** Human review of every upload doesn't scale to 100k+ icons /
  10k+ creators; backlog slows publishing.
- **Impact:** Medium — turnaround degrades, supply bottlenecks.
- **Likelihood:** Likely (at scale).
- **Mitigation:** Tooling (fast queue, bulk actions, reasons); trusted-creator
  fast lanes; automated pre-screening (dup/IP/NSFW/sensitivity) with human
  edge-case review (Phase 3); track turnaround SLOs.

### 5.2 Creator payouts logistics
- **Description:** Beyond tax/Stripe — reconciliation, minimum thresholds,
  disputes, FX, and timely accurate payment.
- **Impact:** High — payout errors erode creator trust fast.
- **Likelihood:** Possible.
- **Mitigation:** Auditable `payouts` ledger reconciled against `purchase_items`;
  minimum thresholds + clear schedule; statements; dispute process; alerting on
  payout failures.

### 5.3 Support
- **Description:** Two-sided support load (download issues, refunds, application
  status, payout questions, takedowns) can overwhelm a small team.
- **Impact:** Medium — slow support hurts retention on both sides.
- **Likelihood:** Likely.
- **Mitigation:** Self-serve help center/FAQ; ticketing with SLAs; automate
  common flows (re-download, receipts, application status); triage by severity.

---

## 6. Compliance

### 6.1 GDPR / PII handling
- **Description:** Processing emails, names, avatars, IPs (`download_history`),
  and user behavior triggers data-protection obligations (GDPR + analogous laws).
- **Impact:** High — fines and reputational harm for non-compliance.
- **Likelihood:** Possible.
- **Mitigation:** Documented data inventory + lawful basis; consent for
  marketing/cookies; data-subject access/erasure flows; retention limits and IP
  anonymization on history; DPA with processors; encryption in transit/at rest.

### 6.2 PCI DSS via Stripe
- **Description:** Card data scope if the platform ever touches card details.
- **Impact:** High — PCI scope/liability.
- **Likelihood:** Rare (by design).
- **Mitigation:** Keep all card handling in Stripe (Checkout/Elements); never
  store/transmit PAN; remain SAQ-A scope; webhook signature verification; least
  privilege on payment secrets.

---

## 7. Summary Risk Matrix (Likelihood × Impact)

| Risk | Category | Likelihood | Impact |
|---|---|---|---|
| 1.1 Untrusted SVG (XSS/XXE) | Security | Almost certain | Critical |
| 1.2 Payment fraud | Security | Likely | High |
| 1.3 Account takeover | Security | Likely | High |
| 2.1 Search scaling | Technical | Likely | Medium |
| 2.2 Upload pipeline reliability | Technical | Possible | High |
| 2.3 R2 / CDN cost & egress | Technical | Likely | Medium |
| 2.4 Database scaling | Technical | Possible | High |
| 2.5 Image processing cost / DoS | Technical | Possible | Medium |
| 3.1 Cold-start marketplace | Product | Likely | High |
| 3.2 Content quality / curation | Product | Likely | Medium |
| 3.3 Niche market size | Product | Possible | Medium |
| 4.1 Copyright / IP infringement | Legal | Likely | High |
| 4.2 Cultural sensitivity | Legal | Possible | High |
| 4.3 Licensing clarity | Legal | Possible | Medium |
| 4.4 DMCA / takedown | Legal | Possible | High |
| 4.5 Tax & payouts (Central Asia) | Legal | Likely | High |
| 4.6 Stripe availability in region | Legal | Likely | Critical |
| 5.1 Moderation scale & cost | Operational | Likely | Medium |
| 5.2 Creator payouts logistics | Operational | Possible | High |
| 5.3 Support | Operational | Likely | Medium |
| 6.1 GDPR / PII | Compliance | Possible | High |
| 6.2 PCI via Stripe | Compliance | Rare | High |

### Heat map (count by Likelihood × Impact)

| Likelihood ↓ / Impact → | Medium | High | Critical |
|---|---|---|---|
| **Almost certain** | — | — | 1.1 |
| **Likely** | 2.1, 2.3, 3.2, 5.1, 5.3 | 1.2, 1.3, 3.1, 4.1, 4.5 | 4.6 |
| **Possible** | 2.5, 3.3, 4.3 | 2.2, 2.4, 4.2, 4.4, 5.2, 6.1 | — |
| **Rare** | — | 6.2 | — |

---

## 8. Top 5 Risks to Address First

1. **Untrusted SVG → XSS/XXE (1.1)** — Critical + almost certain. Non-negotiable
   server-side sanitization, quarantine, separate serving origin, and a CI
   malicious-corpus test must exist before any upload goes live.
2. **Stripe availability for Central Asian payouts (4.6)** — Critical and
   business-defining for the supply side. Validate Connect country support and
   line up alternative payout rails *before* recruiting creators.
3. **Cold-start marketplace (3.1)** — High + likely. Seed quality supply and
   anchor creators pre-launch; lead with a strong free catalog to pull demand.
4. **Payment fraud (1.2)** — High + likely. Stripe Radar + 3-D Secure, idempotent
   webhooks, self-purchase/collusion detection, and delayed first payouts.
5. **Account takeover (1.3)** — High + likely. Strong hashing, rate limiting +
   lockout, refresh-token reuse detection, email verification, and 2FA for
   creators/admins.
