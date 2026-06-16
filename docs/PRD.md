# Product Requirements Document — TurkistanIcons

## 1. Vision

A curated icon marketplace for Uzbek and Central Asian visual culture. Designers
monetize culturally specific iconography; product teams, marketers, and
educators get high-quality, properly-attributed assets that are hard to find on
generic marketplaces.

Differentiator vs. Flaticon: deep cultural niche, curation/authenticity, and
creator revenue sharing tuned for an emerging-market creator base.

## 2. Personas

- **Visitor** — browses and searches without an account; can preview but not download premium.
- **User** — registered; downloads free icons, favorites, buys premium, manages profile.
- **Creator** — approved uploader; publishes icons/packs, prices them, sees revenue/analytics.
- **Admin** — moderates content, manages users/creators/categories, sees platform analytics.

## 3. Goals & non-goals

**Goals (MVP)**
- Browse/search/download free icons with great UX.
- Creator onboarding + SVG upload pipeline with moderation.
- Premium purchases (single icon + packs) via Stripe.
- Solid security around untrusted SVG uploads.

**Non-goals (MVP)**
- AI icon generation, in-browser SVG editing, team/enterprise seats, native mobile apps, i18n beyond English+Uzbek copy. (Revisit in later phases.)

## 4. Functional requirements

### Public
- Homepage with featured/trending/new icons and categories.
- Category and collection browsing with filters (free/premium, style, format).
- Search by name, tag, category, creator; full-text + related icons.
- Icon detail page: preview, formats, license, tags, creator, related, download/buy.
- Creator public profiles. Blog. Pricing page.

### User
- Register/login (email+password, Google). Email verification, password reset.
- Download free icons (records download history).
- Favorite icons; create/manage collections.
- Purchase premium icons/packs; view purchase + download history.
- Manage profile (name, avatar, password).

### Creator
- Apply to become a creator (application → admin review).
- Upload single SVGs and multi-icon packs.
- Edit icon metadata (name, description, tags, category, license, price).
- Set pricing (free or premium amount); bulk-price packs.
- Creator dashboard: downloads, revenue, top icons, payout status.

### Admin
- Moderation queue: approve/reject uploaded icons with reasons.
- Manage users (suspend, change role), manage creator applications.
- Manage categories and tags (taxonomy).
- Platform analytics: GMV, downloads, signups, top creators.

### Marketplace
- Free vs premium icons; icon packs; one-time purchases (no subscription in MVP, add in Phase 2).
- Revenue sharing (default 70/30 creator/platform, configurable).
- Download history and re-download of owned/free assets.

## 5. Non-functional requirements

- **Scale targets:** 100k+ icons, 10k+ creators, millions of downloads.
- **Performance:** p95 search < 300ms; icon detail TTFB < 200ms (cached); CDN-served assets.
- **Availability:** 99.9% for read/browse paths.
- **Security:** see [SECURITY.md](SECURITY.md); SVG sanitization is mandatory.
- **Accessibility:** WCAG 2.1 AA on public pages.
- **SEO:** SSR/ISR for public pages, structured data for icons.
- **Observability:** structured logs, metrics, tracing, error tracking (Sentry).

## 6. Key user flows

1. **Discover → download (free):** search → detail → download (auth required for download; records history).
2. **Discover → buy (premium):** detail → checkout (Stripe) → success → download from library.
3. **Become creator:** apply → admin approves → upload → moderation → publish.
4. **Upload:** see [UPLOAD-PIPELINE.md](UPLOAD-PIPELINE.md).

## 7. Success metrics

- Activation: % signups who download within 7 days.
- Creator supply: approved creators, icons published/week, moderation turnaround.
- Monetization: GMV, paid conversion %, ARPPU, refund rate.
- Quality: moderation reject rate, reported assets, search zero-result rate.

## 8. Pricing model (MVP)

- Free icons: free download with attribution license.
- Premium: per-icon and per-pack one-time purchase.
- Platform fee: 30% (configurable per creator tier).
- Phase 2: subscription plans (unlimited downloads / no attribution).
