# Search Architecture — TurkistanIcons

How users find icons. The MVP runs entirely on **PostgreSQL full-text search
(FTS) + `pg_trgm`** — no extra infrastructure. Phase 2 migrates to a dedicated
search engine (**Meilisearch**, with Typesense/OpenSearch as alternatives) once
FTS is outgrown.

Search features required (all available from MVP):

- by **name**
- by **tags**
- by **categories**
- by **creator**
- **full-text** (name + description + tags, weighted)
- **related icons**
- plus: fuzzy/typo tolerance, prefix **autocomplete/suggestions**, faceted
  filtering, relevance/popularity/newest sorting, pagination.

Search is **read-only** and runs against published icons (`status = 'PUBLISHED'`,
`deleted_at IS NULL`). Like all DB access, it goes through the `api` (Prisma); the
`web` app never touches Postgres directly. Read replicas serve search at scale
(see [ARCHITECTURE.md](ARCHITECTURE.md) §5).

---

## 1. MVP: PostgreSQL full-text search

### 1.1 Why Postgres first

- **Zero new infra.** We already run Postgres; no extra service to operate,
  secure, or pay for during MVP.
- **One source of truth.** No sync lag, no consistency bugs between the DB and a
  separate index. Filters (price, license, creator, category) and search live in
  the same `WHERE` clause and the same transaction.
- **Good enough to ~100k–500k icons** for sub-100ms queries with the right
  indexes. We migrate when the data says so, not preemptively (§4).

### 1.2 The `search_vector` column

`icons.search_vector` is a `tsvector` (see [DATABASE.md](DATABASE.md) `icons`).
It concatenates the icon **name**, **tags**, and **description** with **weights**
so name matches outrank tag matches, which outrank description matches.

Postgres `tsvector` weight labels and their default rank multipliers:

| Weight | Field       | Default `{D,C,B,A}` weight |
|--------|-------------|----------------------------|
| `A`    | name        | 1.0                        |
| `B`    | tags        | 0.4                        |
| `C`    | description | 0.2                        |
| `D`    | (unused)    | 0.1                        |

> Tags live in `icon_tags` → `tags`, so the vector can't be a pure generated
> column over a single row. We maintain it with a **trigger** that denormalizes
> tag text into the vector (§1.4). Name+description alone could be a generated
> column, but keeping all three in one trigger keeps ranking coherent.

```sql
-- Migration: add the FTS column + indexes (Prisma migration SQL)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;   -- for combining FTS + scalar in one index path

ALTER TABLE icons ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Primary FTS index
CREATE INDEX IF NOT EXISTS icons_search_vector_gin
  ON icons USING gin (search_vector);

-- Trigram indexes for fuzzy + prefix/autocomplete on name
CREATE INDEX IF NOT EXISTS icons_name_trgm
  ON icons USING gin (name gin_trgm_ops);

-- Partial index: search only ever touches published, non-deleted rows
CREATE INDEX IF NOT EXISTS icons_published_search
  ON icons USING gin (search_vector)
  WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
```

We use the `'simple'` config (no stemming) by default because icon names are
short proper nouns and transliterated terms ("Do'ppi", "Suzani", "Navruz") that
English/Russian stemmers mangle. A `'simple'` dictionary plus `pg_trgm` typo
tolerance fits cultural/transliterated vocabulary better than aggressive
stemming. Optionally maintain an `unaccent`-normalized variant for diacritics.

### 1.3 Building the vector value

```sql
-- Helper expression used by the trigger
setweight(to_tsvector('simple', unaccent(coalesce(NEW.name, ''))),        'A') ||
setweight(to_tsvector('simple', unaccent(coalesce(tag_text, ''))),        'B') ||
setweight(to_tsvector('simple', unaccent(coalesce(NEW.description, ''))), 'C')
```

`unaccent` makes "Doppi" match "Do'ppi"/"Dóppi". Install with
`CREATE EXTENSION IF NOT EXISTS unaccent;`.

### 1.4 Maintaining `search_vector` (trigger)

The vector must be rebuilt when:

1. an icon's `name` / `description` changes,
2. an icon's **tags** change (`icon_tags` insert/delete),
3. an icon is **published** (the only state search reads, but we keep the vector
   fresh in every state so publishing is a cheap status flip).

```sql
-- 1) Recompute from the icon row + its current tags
CREATE OR REPLACE FUNCTION icons_build_search_vector(p_icon_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE icons i
  SET search_vector =
        setweight(to_tsvector('simple', unaccent(coalesce(i.name, ''))),        'A') ||
        setweight(to_tsvector('simple', unaccent(coalesce(t.tag_text, ''))),    'B') ||
        setweight(to_tsvector('simple', unaccent(coalesce(i.description, ''))), 'C')
  FROM (
        SELECT it.icon_id, string_agg(tg.name, ' ') AS tag_text
        FROM icon_tags it
        JOIN tags tg ON tg.id = it.tag_id
        WHERE it.icon_id = p_icon_id
        GROUP BY it.icon_id
  ) t
  WHERE i.id = p_icon_id AND (t.icon_id = i.id OR t.icon_id IS NULL);
$$;

-- 2) Fire on icon name/description change
CREATE OR REPLACE FUNCTION trg_icons_search_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM icons_build_search_vector(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER icons_search_vector_upd
  AFTER INSERT OR UPDATE OF name, description ON icons
  FOR EACH ROW EXECUTE FUNCTION trg_icons_search_vector();

-- 3) Fire on tag membership change
CREATE OR REPLACE FUNCTION trg_icon_tags_search_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM icons_build_search_vector(COALESCE(NEW.icon_id, OLD.icon_id));
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER icon_tags_search_vector_aiud
  AFTER INSERT OR DELETE ON icon_tags
  FOR EACH ROW EXECUTE FUNCTION trg_icon_tags_search_vector();
```

> **Why a trigger, not application code:** it survives bulk imports, admin
> backfills, and seed scripts that bypass the service layer. Prisma has no native
> `tsvector` type, so the column is managed in SQL migrations and queried via raw
> SQL anyway.

Backfill once after the migration:

```sql
SELECT icons_build_search_vector(id) FROM icons;
```

### 1.5 The ranking function

We score with `ts_rank_cd` (cover-density rank, rewards proximity), then blend in
popularity and recency so a wildly popular exact-name match beats an obscure one.

```text
final_score =
      w_text  * ts_rank_cd(search_vector, query)          -- relevance (0..~1)
    + w_pop   * ln(1 + download_count) / ln(1 + max_dl)   -- normalized popularity
    + w_fresh * recency_decay(published_at)               -- newer gets a nudge
```

A pragmatic blend: `w_text = 1.0`, `w_pop = 0.3`, `w_fresh = 0.1`. Tune from
click-through logs.

### 1.6 The full-text query (Prisma raw SQL)

We accept user text, build a `websearch_to_tsquery` (handles quotes, `OR`, `-`),
fall back to trigram similarity for zero-result/typo cases, and apply facets.

```ts
// apps/api/src/search/search.repository.ts
import { Prisma } from '@prisma/client';

type SearchParams = {
  q?: string;
  categoryId?: string;
  creatorId?: string;
  tagSlugs?: string[];
  priceType?: 'FREE' | 'PREMIUM';
  license?: string;
  sort?: 'relevance' | 'popularity' | 'newest';
  limit: number;
  offset: number;
};

async function searchIcons(prisma: Prisma.TransactionClient, p: SearchParams) {
  const q = p.q?.trim();

  // Build the WHERE fragments dynamically but parameterized.
  const where: Prisma.Sql[] = [
    Prisma.sql`i.status = 'PUBLISHED'`,
    Prisma.sql`i.deleted_at IS NULL`,
  ];
  if (p.categoryId) where.push(Prisma.sql`i.category_id = ${p.categoryId}::uuid`);
  if (p.creatorId) where.push(Prisma.sql`i.creator_id = ${p.creatorId}::uuid`);
  if (p.priceType) where.push(Prisma.sql`i.price_type = ${p.priceType}::"PriceType"`);
  if (p.license) where.push(Prisma.sql`i.license = ${p.license}::"LicenseType"`);

  // Tag filter: icon must carry ALL requested tags (AND semantics).
  if (p.tagSlugs?.length) {
    where.push(Prisma.sql`
      (SELECT count(*) FROM icon_tags it
         JOIN tags tg ON tg.id = it.tag_id
        WHERE it.icon_id = i.id AND tg.slug = ANY(${p.tagSlugs}))
        = ${p.tagSlugs.length}`);
  }

  // Text predicate + rank expression
  const rank = q
    ? Prisma.sql`ts_rank_cd(i.search_vector, websearch_to_tsquery('simple', unaccent(${q})))`
    : Prisma.sql`0`;

  if (q) {
    where.push(Prisma.sql`(
      i.search_vector @@ websearch_to_tsquery('simple', unaccent(${q}))
      OR i.name % unaccent(${q})            -- pg_trgm fuzzy fallback for typos
    )`);
  }

  const orderBy =
    p.sort === 'popularity'
      ? Prisma.sql`i.download_count DESC, i.published_at DESC`
      : p.sort === 'newest'
      ? Prisma.sql`i.published_at DESC`
      : // relevance (default): blended score
        Prisma.sql`
          (${rank} * 1.0
           + ln(1 + i.download_count) * 0.05
           + (1.0 / (1 + EXTRACT(EPOCH FROM (now() - i.published_at)) / 86400 / 30)) * 0.1
          ) DESC,
          i.download_count DESC`;

  const rows = await prisma.$queryRaw<Array<any>>(Prisma.sql`
    SELECT
      i.id, i.name, i.slug, i.price_type, i.price_cents, i.currency,
      i.thumb_key, i.download_count, i.published_at,
      ${rank} AS relevance,
      count(*) OVER () AS total_count          -- total for pagination, one round trip
    FROM icons i
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY ${orderBy}
    LIMIT ${p.limit} OFFSET ${p.offset};
  `);

  const total = rows.length ? Number(rows[0].total_count) : 0;
  return { rows, total };
}
```

Key points:

- **`websearch_to_tsquery`** gives users Google-style syntax for free
  (`"silk road" -tea`, `plov OR osh`).
- **`i.name % unaccent(...)`** (the `pg_trgm` `%` operator, backed by
  `icons_name_trgm`) catches typos like "suzni" → "suzani" even when the tsquery
  matches nothing. Set the threshold with `SET pg_trgm.similarity_threshold`.
- **`count(*) OVER ()`** returns the total alongside the page so pagination needs
  one query, not two.
- All user input flows through `Prisma.sql` parameters — **no string-built SQL**
  (CLAUDE.md security rule).

### 1.7 Field-scoped searches

The required "by name / by tags / by category / by creator" searches are the same
query with specific facets:

- **by name** — `q` set, sort `relevance`; name weight `A` dominates.
- **by tags** — `tagSlugs` set, `q` empty → pure filter, sort `popularity`.
- **by category** — `categoryId` set (optionally include descendant categories via
  the self-referential tree; expand the subtree in the service and pass
  `category_id = ANY($ids)`).
- **by creator** — `creatorId` set; powers the creator profile/portfolio page.

### 1.8 Faceted filtering

Filters compose in the same `WHERE` as FTS (already shown). To render facet
counts in the sidebar (e.g. "Free (1,204) / Premium (88)"), run a parallel
aggregate against the **same predicate minus the facet being counted**:

```sql
-- Category facet counts for the current query (excluding the category filter)
SELECT c.id, c.name, count(*) AS n
FROM icons i
JOIN categories c ON c.id = i.category_id
WHERE i.status = 'PUBLISHED' AND i.deleted_at IS NULL
  AND (${q_predicate})
  /* all active filters EXCEPT category */
GROUP BY c.id, c.name
ORDER BY n DESC
LIMIT 30;
```

At MVP scale, compute facets on demand and **cache them in Redis** (§1.11). When
facet aggregation becomes the bottleneck, that's a strong signal to move to
Meilisearch, whose facet engine is purpose-built for this (§3).

### 1.9 Sorting

| Sort        | `ORDER BY`                                  | Use |
|-------------|---------------------------------------------|-----|
| Relevance   | blended score (text+pop+recency) DESC       | default when `q` present |
| Popularity  | `download_count DESC, published_at DESC`    | default when browsing |
| Newest      | `published_at DESC`                         | "New arrivals" |

`download_count` is the denormalized counter from [DATABASE.md](DATABASE.md);
keep a btree index on `(status, download_count)` and `(status, published_at)` so
non-relevance sorts stay index-ordered.

### 1.10 Pagination

Offset pagination via `LIMIT/OFFSET` is fine for the first few thousand rows.
For deep pagination (rare in search, common in creator portfolios), switch to
**keyset/seek pagination** on a stable sort:

```sql
-- newest, keyset
WHERE ... AND (i.published_at, i.id) < (${lastPublishedAt}, ${lastId})
ORDER BY i.published_at DESC, i.id DESC
LIMIT 24;
```

Cap `offset` (e.g. ≤ 10,000) and steer users to refine filters beyond that.

### 1.11 Caching popular queries in Redis

Search reads are cache-aside (consistent with ARCHITECTURE.md §4):

- **Key:** `search:v1:{sha1(normalized_params)}` where params include `q`
  (lowercased, trimmed), filters, sort, page.
- **Value:** the serialized result page (ids + minimal card fields) + total.
- **TTL:** 60–300s for general queries; longer (e.g. 1h) for empty-`q` browse
  pages and facet counts.
- **Invalidation:** time-based TTL is enough (search results are not
  transactional); on publish/unpublish we can additionally bump a global
  `search:epoch` counter folded into the key to flush instantly.
- **Autocomplete** results are cached separately and aggressively (§5).

Track query frequency (`ZINCRBY search:popular {q}`) to (a) prewarm the cache for
top queries and (b) seed the autocomplete suggestion list.

---

## 2. Related icons

"Related icons" appears on every icon detail page. Three strategies, in
increasing cost/quality. MVP ships #1+#2; #3 is an optional upgrade.

### 2.1 Shared tags + same category (MVP default)

Rank candidates by overlapping tags, boosted when in the same category. Cheap,
explainable, no new infra.

```sql
-- Related to icon :id
WITH base AS (
  SELECT category_id, array_agg(it.tag_id) AS tag_ids
  FROM icons i
  LEFT JOIN icon_tags it ON it.icon_id = i.id
  WHERE i.id = ${id}::uuid
  GROUP BY category_id
)
SELECT r.id, r.name, r.slug, r.thumb_key,
       count(rt.tag_id) AS shared_tags,
       (r.category_id = b.category_id) AS same_category
FROM base b
JOIN icon_tags rt ON rt.tag_id = ANY(b.tag_ids)
JOIN icons r ON r.id = rt.icon_id
WHERE r.id <> ${id}::uuid
  AND r.status = 'PUBLISHED' AND r.deleted_at IS NULL
GROUP BY r.id, r.name, r.slug, r.thumb_key, r.category_id, b.category_id
ORDER BY (count(rt.tag_id) + CASE WHEN r.category_id = b.category_id THEN 2 ELSE 0 END) DESC,
         r.download_count DESC
LIMIT 12;
```

Cache the result per icon (`related:v1:{iconId}`, TTL ~6h, invalidate on the
source icon's tag/category edits).

### 2.2 Trigram name similarity (fallback / "more like this name")

For sparsely tagged icons, fall back to `pg_trgm` similarity on `name`:

```sql
SELECT id, name, slug, thumb_key, similarity(name, ${name}) AS sim
FROM icons
WHERE id <> ${id}::uuid AND status = 'PUBLISHED' AND deleted_at IS NULL
  AND name % ${name}
ORDER BY sim DESC, download_count DESC
LIMIT 12;
```

### 2.3 Vector embeddings via `pgvector` (optional, best quality)

For true visual/semantic "more like this", embed each icon (text of
name+tags+description, and/or an image embedding of the rendered PNG) and store
the vector in Postgres with **`pgvector`** — no separate vector DB needed for our
scale.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE icons ADD COLUMN embedding vector(768);   -- model-dependent dim
CREATE INDEX icons_embedding_hnsw
  ON icons USING hnsw (embedding vector_cosine_ops);

-- nearest neighbors
SELECT id, name, slug, thumb_key
FROM icons
WHERE id <> ${id}::uuid AND status = 'PUBLISHED' AND deleted_at IS NULL
ORDER BY embedding <=> (SELECT embedding FROM icons WHERE id = ${id}::uuid)
LIMIT 12;
```

Embeddings are generated in the **upload worker** (BullMQ) after sanitize/preview
(it already has the PNG; see [UPLOAD-PIPELINE.md](UPLOAD-PIPELINE.md)) and stored
on publish. This also enables **semantic search** ("warm festive pattern") later.
Treat `pgvector` as a Phase 2 enhancement; it does not block MVP.

---

## 3. Phase 2: dedicated search engine (Meilisearch)

### 3.1 When to migrate

Migrate when one or more of these holds — measure, don't guess:

- **Latency:** p95 search query > ~150–200ms after indexing/caching tuning, or
  facet aggregation queries become the top DB time sink.
- **Relevance:** users complain about ranking; we want typo tolerance,
  synonyms, and weighted/customizable ranking that's painful to express in SQL.
- **Facets at scale:** computing facet counts on every query strains the DB.
- **Instant/typeahead search** UX (sub-50ms keystroke results) is required
  product-wide, not just simple prefix autocomplete.
- **Catalog size:** comfortably past ~100k–250k published icons with growing
  query volume from read replicas not keeping up.

**Recommended default: Meilisearch** — minimal ops, excellent typo tolerance and
instant-search out of the box, self-hostable as one container, good fit for a
single-tenant icon catalog. Alternatives:

| Engine      | Pros | Cons / when |
|-------------|------|-------------|
| **Meilisearch** (default) | Dead-simple ops, instant-search, typo tolerance, facets, synonyms | Single-node by default; HA story weaker than ES |
| **Typesense** | Similar simplicity, built-in clustering/HA, fast | Smaller ecosystem |
| **OpenSearch/Elasticsearch** | Most powerful (aggregations, analyzers, scale-out), vector search | Heavy to operate; overkill until very large |

Keep Postgres as the **system of record**; the engine is a derived, rebuildable
index.

### 3.2 Index schema (Meilisearch document)

One document per published icon:

```json
{
  "id": "uuid",
  "name": "Do'ppi (Skullcap)",
  "description": "Traditional Uzbek embroidered cap...",
  "tags": ["doppi", "headwear", "atlas", "embroidery"],
  "category": { "id": "uuid", "name": "Clothing", "slug": "clothing" },
  "category_path": ["Culture", "Clothing"],
  "creator": { "id": "uuid", "name": "Aziza Karimova", "slug": "aziza" },
  "price_type": "PREMIUM",
  "price_cents": 299,
  "license": "PREMIUM_STANDARD",
  "thumb_url": "https://cdn.../thumb.png",
  "download_count": 1840,
  "favorite_count": 92,
  "published_at": 1718500000
}
```

Meilisearch settings:

```jsonc
{
  "searchableAttributes": ["name", "tags", "description"],   // order = importance
  "filterableAttributes": ["category.id", "tags", "creator.id", "price_type", "license"],
  "sortableAttributes": ["download_count", "published_at", "price_cents"],
  "rankingRules": [
    "words", "typo", "proximity", "attribute", "exactness",
    "download_count:desc"                                    // popularity tie-break
  ],
  "synonyms": {
    "doppi":   ["duppi", "skullcap", "tubeteika"],
    "plov":    ["osh", "pilaf"],
    "suzani":  ["suzane", "embroidery"]
  },
  "typoTolerance": { "minWordSizeForTypos": { "oneTypo": 4, "twoTypos": 8 } }
}
```

`searchableAttributes` order encodes the same name > tags > description weighting
we had in `tsvector`. Synonyms handle transliteration variance natively.

### 3.3 Sync strategy: outbox + BullMQ (CDC-style)

Keep the index eventually consistent with Postgres via a **transactional outbox**
drained by a BullMQ worker — never dual-write directly in request handlers.

```
┌──────────────┐   same TX    ┌────────────────────┐
│  api write   │─────────────▶│ icons row +        │
│ (publish/    │              │ search_outbox row  │  (INSERT, status='PENDING')
│  edit/etc.)  │              └─────────┬──────────┘
└──────────────┘                        │  poll / LISTEN-NOTIFY
                                  ┌──────▼───────────┐
                                  │ search-sync      │  BullMQ worker
                                  │ worker (BullMQ)  │  reads outbox → upserts/deletes
                                  └──────┬───────────┘  in Meilisearch (batched)
                                         │
                                  ┌──────▼───────────┐
                                  │   Meilisearch    │
                                  └──────────────────┘
```

- **Outbox table:** `search_outbox(id, icon_id, op ENUM('UPSERT','DELETE'),
  status, created_at, processed_at)`. Triggers on `icons`/`icon_tags` enqueue an
  `UPSERT` (or `DELETE` on unpublish/soft-delete) **in the same transaction** as
  the write, so the index can never miss an event.
- **Worker:** the existing BullMQ worker fleet (a dedicated `search-sync` queue)
  polls/`LISTEN`s, batches outbox rows, builds full documents (joining tags,
  category path, creator, CDN thumb URL), and calls Meilisearch
  `addDocuments`/`deleteDocuments`. Idempotent by `icon_id` (keyed like upload
  jobs, ARCHITECTURE.md §4).
- **Reindex/bootstrap:** a `reindex` job streams all published icons → fresh index
  → atomic **index swap** (Meilisearch index aliasing) for zero-downtime
  rebuilds and settings changes.
- **Reconciliation:** nightly job diffs Postgres published-icon ids vs index ids
  and repairs drift (mirrors the counter-reconciliation pattern in DATABASE.md).

CDC via Postgres logical replication / Debezium is an alternative to the outbox
trigger, but the outbox keeps everything inside our BullMQ stack with no new
infra and is the recommended default.

### 3.4 Querying Meilisearch from the API

The `api` keeps the same `/search` contract; only the repository implementation
swaps. The web app and DTOs are unchanged.

```ts
const res = await meili.index('icons').search(q, {
  filter: [
    'price_type = FREE',
    `category.id = "${categoryId}"`,
    `tags IN [${tagSlugs.map(s => `"${s}"`).join(',')}]`,
  ],
  facets: ['category.id', 'tags', 'price_type', 'license'],
  sort: sort === 'newest' ? ['published_at:desc']
       : sort === 'popularity' ? ['download_count:desc'] : undefined, // relevance = engine default
  limit, offset,
});
// res.hits, res.estimatedTotalHits, res.facetDistribution
```

Facet counts come back **with the results** in one call (`facetDistribution`),
removing the parallel-aggregate problem from §1.8.

### 3.5 Instant search

With Meilisearch, the web app can drive **instant search** (results update per
keystroke) via the official client / InstantSearch adapter, with debounce
(~120ms) and request cancellation. Sub-50ms responses make typeahead-as-search
viable, subsuming the separate autocomplete endpoint below into one experience.

---

## 4. Scaling to 100k+ icons

- **MVP (≤ ~100k icons):** Postgres FTS + `pg_trgm`, GIN + partial indexes,
  Redis-cached popular queries and facets, search served from **read replicas**.
  Expect sub-100ms p95 with warm cache.
- **Growth (100k–500k):** keep Postgres but lean harder on Redis (cache hit rate
  on the long tail of repeated queries), keyset pagination, precomputed facet
  counts, and `(status, download_count)` / `(status, published_at)` covering
  indexes. Watch p95 and DB CPU.
- **Scale (≥ ~250k–1M):** Meilisearch becomes the primary search/facet path
  (§3); Postgres remains source of truth and serves exact-filter queries (e.g.
  creator portfolio). Embeddings (`pgvector` or the engine's vector search) power
  semantic + related.
- **Read path stays cheap regardless:** asset bytes never flow through search;
  search returns ids + card metadata, and the CDN/R2 serves the SVG/PNG
  (ARCHITECTURE.md §3, §5).

---

## 5. Autocomplete / suggestions design

Two-tier design; tier 1 ships at MVP on Postgres, tier 2 arrives with the search
engine.

### 5.1 What to suggest

A keystroke returns a blend of:

1. **Term suggestions** — popular queries and tag/category names matching the
   prefix.
2. **Entity suggestions** — top matching **icons** (name + thumb), **creators**,
   **categories** for direct navigation.

### 5.2 MVP autocomplete (Postgres + Redis)

**Prefix on names** via trigram + `ILIKE` anchored, ordered by popularity:

```sql
SELECT id, name, slug, thumb_key
FROM icons
WHERE status = 'PUBLISHED' AND deleted_at IS NULL
  AND name ILIKE ${prefix} || '%'          -- prefix; uses icons_name_trgm
ORDER BY download_count DESC
LIMIT 8;
```

For mid-word/fuzzy prefix tolerance, add the `%` similarity operator as a
fallback when `ILIKE` returns few rows. **Tag/category suggestions:**

```sql
SELECT 'tag' AS kind, name, slug FROM tags
WHERE name ILIKE ${prefix} || '%' ORDER BY usage_count DESC LIMIT 5;
```

**Popular-query suggestions** come from the `search:popular` sorted set (§1.11):
`ZREVRANGEBYLEX` / a prefix match over logged queries.

**Caching & latency:** autocomplete must feel instant.

- Cache each prefix response in Redis: `ac:v1:{prefix}` (lowercased), TTL ~10min.
- Precompute the top N prefixes (1–3 chars) into Redis on a schedule so the
  common case is a pure cache hit.
- Debounce on the client (~120ms) and require ≥ 2 chars before querying.
- Endpoint is rate-limited like other public reads (CLAUDE.md).

### 5.3 Phase 2 autocomplete (Meilisearch)

Meilisearch's prefix search + typo tolerance gives high-quality suggestions
directly: query the `icons` index with a small `limit`, optionally a dedicated
lightweight `suggestions` index of distinct popular query terms. This converges
with **instant search** (§3.5) — the same engine powers both typeahead and full
results, so the autocomplete endpoint becomes a thin `limit=5` query rather than
bespoke SQL.

### 5.4 API surface (stable across phases)

```
GET /search/autocomplete?q=su
→ {
    "terms":     ["suzani", "suzani pattern"],
    "icons":     [{ "id", "name", "slug", "thumbUrl" }, ...],
    "creators":  [{ "id", "name", "slug" }, ...],
    "categories":[{ "id", "name", "slug" }, ...]
  }
```

The DTO is engine-agnostic so the Postgres→Meilisearch migration is invisible to
the `web` app (zod schema shared via `packages/types`).
