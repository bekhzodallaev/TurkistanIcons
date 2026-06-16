# Upload Pipeline Design — TurkistanIcons

How an uploaded SVG (or pack of SVGs) goes from a Creator's browser to a
`PUBLISHED` icon. Treats **every uploaded byte as hostile** until proven
otherwise (see [SECURITY.md](SECURITY.md)). The pipeline is split between the
`api` (orchestration, signed URLs, DB writes) and a **separate NestJS upload
worker** that does the CPU-bound, security-sensitive work in isolation.

Related: [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md).

---

## 1. Goals & constraints

- **Direct-to-R2 uploads.** The API never proxies file bytes; the browser PUTs
  straight to R2 via a short-lived signed URL. Keeps the API stateless and cheap.
- **Untrusted until sanitized.** Raw uploads land in a `quarantine/` prefix that
  is **never** publicly readable. Only sanitized output reaches the `public/`
  prefix served by the CDN.
- **Async + isolated.** Validation/sanitization/rendering run in a worker pool,
  not in the request path. CPU-bound and a blast-radius concern.
- **Idempotent & retryable.** Jobs are keyed by `icon.id`; safe to retry.
- **Auditable.** Every status transition and moderation action is recorded.

---

## 2. End-to-end flow

```
CREATOR (browser)                 api (NestJS)                  R2                 worker (NestJS)             ADMIN
      │                               │                          │                       │                      │
 1.   │ POST /uploads/init ─────────► │                          │                       │                      │
      │  (auth: CREATOR)              │ create icon (DRAFT)       │                       │                      │
      │                               │ sign PUT → quarantine/    │                       │                      │
      │ ◄── { iconId, uploadUrl, key }│                          │                       │                      │
      │                               │                          │                       │                      │
 2.   │ PUT uploadUrl (SVG bytes) ───────────────────────────►  │ (quarantine/raw)      │                      │
      │ ◄── 200                       │                          │                       │                      │
      │                               │                          │                       │                      │
 3.   │ POST /uploads/:id/finalize ─► │ HEAD object (exists?)     │                       │                      │
      │                               │ status → PROCESSING       │                       │                      │
      │                               │ enqueue job (jobId=iconId)│ ─────────────────────►│ process(iconId)      │
      │ ◄── 202 { status:PROCESSING } │                          │                       │                      │
      │                               │                          │  4. GET quarantine ◄──│ download raw          │
      │                               │                          │                       │ sniff/validate       │
      │                               │                          │                       │ SANITIZE (allowlist) │
      │                               │                          │                       │ svgo optimize        │
      │                               │                          │                       │ sha256 + viewBox     │
      │                               │                          │  5. (resvg/sharp)     │ render PNG + thumb    │
      │                               │                          │  6. PUT public/ ◄─────│ upload sanitized     │
      │                               │ update icon keys/dims     │ ◄─────────────────────│ writeback (DB)       │
      │                               │ status → PENDING_REVIEW   │                       │                      │
      │                               │ 7. notify admins ─────────────────────────────────────────────────────►│
      │                               │                          │                       │   review             │
      │                               │ 8. PATCH moderation ◄─────────────────────────────────────────────────  │
      │                               │ status → PUBLISHED/REJECTED                                              │
      │                               │ (published_at, search_vector, counters)                                 │
```

### Step 1 — Upload init (api, auth: `CREATOR`)

`POST /uploads/init`

- Guarded by `JwtAuthGuard` + `RolesGuard(CREATOR)`.
- Validate the request body with zod (declared name, category, declared
  `contentType` = `image/svg+xml`, declared `size` within caps).
- **Rate-limit** per creator (see [SECURITY.md](SECURITY.md) §rate limiting).
- Create the `icons` row with `status = DRAFT`, generate the quarantine key:
  `quarantine/{creatorId}/{iconId}/{uuid}.svg`.
- Issue a **short-lived (≤5 min) signed R2 PUT URL** constrained to:
  - exact object key,
  - `Content-Type: image/svg+xml`,
  - `Content-Length` range (e.g. 1 B – 2 MiB),
  - optionally `Content-MD5` if the client computes it.
- Return `{ iconId, uploadUrl, key, expiresAt, maxBytes }`.

> The signed URL pins the key and size so a client can't write elsewhere or
> upload a 2 GB file. The bucket policy denies public reads on `quarantine/`.

### Step 2 — Direct PUT to R2 (client)

The browser `PUT`s the SVG bytes to `uploadUrl`. No API involvement. If R2
rejects (size/expiry/content-type mismatch) the client retries init.

### Step 3 — Finalize (api)

`POST /uploads/:iconId/finalize`

- Re-auth + **ownership check**: the icon's `creator_id` must match the caller.
- Reject unless current `status = DRAFT` (idempotency guard — see §7).
- `HEAD` the quarantine object to confirm it exists and read R2's reported size.
  If missing → `409 upload_not_found`.
- Set `status = PROCESSING`, store `svg_raw_key` + `file_size`.
- **Enqueue** a BullMQ job on the `icon-processing` queue with
  `jobId = iconId` (dedupe key) and payload `{ iconId, rawKey }`.
- Return `202 { status: PROCESSING }`. The client polls `GET /icons/:id` or
  subscribes to a status channel.

### Step 4 — Worker: validate & sanitize (the hot zone)

The worker pulls the job and:

1. **Download** the raw object from `quarantine/` to a temp buffer (streamed,
   hard byte cap enforced again — never trust the signed-URL cap alone).
2. **Content sniff:** verify it is genuinely SVG/XML, not a renamed binary or
   HTML. Check magic/leading bytes, reject if it parses as a non-SVG type, and
   confirm an `<svg>` root after XML parse.
3. **Size & complexity limits:** byte size, element count, nesting depth, total
   path-point count (defends against decompression/parse-blowup and
   billion-laughs). Reject on overflow.
4. **XML parse** with a hardened parser: **DTD disabled, external entities
   disabled, no network resolution** (XXE mitigation).
5. **SANITIZE** with a strict **allowlist** (deny-by-default). Strip / reject:
   - `<script>` and any scripting elements,
   - `on*` event-handler attributes (`onload`, `onclick`, …),
   - `<foreignObject>` (HTML smuggling),
   - external entity / DTD references (XXE), `<!ENTITY>`, `<!DOCTYPE … SYSTEM>`,
   - external `href`/`xlink:href`/`url()` to remote origins (SSRF / tracking),
   - `javascript:` / `data:` (non-image) / `vbscript:` URIs,
   - CSS `@import`, remote `url(...)` in `<style>`,
   - unknown elements/attributes not on the allowlist.
   Implementation: **DOMPurify (jsdom, `USE_PROFILES: { svg: true }`)** for
   structural sanitization **and** **svgo** with a curated plugin set; treat
   svgo as optimization, DOMPurify/allowlist as the security boundary.
6. **Malicious-pattern scan:** regex/heuristic pass for `<script`, `on\w+=`,
   `javascript:`, entity declarations, suspiciously large `repeat`/`use` chains.
7. **Normalize/optimize** with svgo (remove metadata, collapse groups, fix
   precision) — producing the canonical sanitized SVG.
8. **Compute** `width`/`height` from the (sanitized) `viewBox` and
   `checksum = sha256(sanitizedSvg)`.
   - **Dedupe:** look up `icons.checksum`. On collision with a `PUBLISHED` icon
     by the same creator, fail the job with `duplicate` (transition to
     `REJECTED` with reason), or surface to the creator depending on policy.

### Step 5 — Render previews

Render PNGs from the **sanitized** SVG (never the raw one) using **resvg**
(preferred for safety/perf) with **sharp** for resizing/compression:

- `thumb`  — e.g. 128×128,
- `png`    — e.g. 512×512 (primary preview),
- additional sizes (256, 1024) as needed, transparent background, retina @2x.

Rendering uses the sanitized SVG only and runs with no network/font fetch.

### Step 6 — Promote to public

- `PUT` sanitized SVG + PNGs to the `public/` prefix:
  - `public/icons/{iconId}/icon.svg`   → `svg_key`
  - `public/icons/{iconId}/preview.png`→ `png_key`
  - `public/icons/{iconId}/thumb.png`  → `thumb_key`
- **Writeback (DB, single transaction):** set `svg_key`, `png_key`, `thumb_key`,
  `width`, `height`, `file_size`, `checksum`.
- **Quarantine retention:** keep `svg_raw_key` for a forensic window (e.g. 30
  days) via lifecycle rule, then auto-delete; or delete immediately per policy.
  `svg_raw_key` stays recorded for audit.

### Step 7 — Pending review

Set `status = PENDING_REVIEW` and **notify admins** (email + admin queue badge).
The icon is processed and safe but not yet publicly listed.

### Step 8 — Moderation

`PATCH /admin/icons/:id/moderate` (auth: `ADMIN`), writes a `moderation_events`
row and an `audit_log` entry:

- **APPROVE → `PUBLISHED`:** set `published_at = now()`, populate
  `search_vector`, bump denormalized counters (`category.icon_count`,
  `creator` totals), invalidate relevant caches.
- **REJECT → `REJECTED`:** set `rejection_reason`; notify creator. Public assets
  are removed/kept-private depending on policy.
- **REQUEST_CHANGES:** keep `PENDING_REVIEW`, notify creator with notes.

---

## 3. State machine (`IconStatus`)

Matches the `IconStatus` enum in [DATABASE.md](DATABASE.md):
`DRAFT · PROCESSING · PENDING_REVIEW · PUBLISHED · REJECTED · ARCHIVED`.

```
                 finalize()                worker ok
   ┌─────────┐   (object exists)  ┌────────────┐   (sanitized,   ┌────────────────┐
   │  DRAFT  │ ─────────────────► │ PROCESSING │ ─ rendered) ──► │ PENDING_REVIEW │
   └─────────┘                    └────────────┘                 └────────────────┘
        ▲                              │   │                          │       │
        │ (none — terminal init)       │   │ worker fail              │ APPROVE
        │                              │   │ (after retries / DLQ)    ▼       │ REJECT
        │                              │   ▼                     ┌───────────┐│
        │                              │  REJECTED ◄─────────────┤ PUBLISHED ││
        │                              │  (duplicate /            └─────┬─────┘│
        │                              │   invalid /                    │      ▼
        │                              │   unsafe)               archive│   REJECTED
        │                              │                                ▼   (reason)
        │                              └──────────────────────►  ┌──────────┐
        │   REQUEST_CHANGES keeps PENDING_REVIEW                  │ ARCHIVED │
        └─────────────────────────────────────────────────────► └──────────┘
                                                          (creator/admin retire)
```

### Allowed transitions

| From            | To              | Trigger                                      |
|-----------------|-----------------|----------------------------------------------|
| `DRAFT`         | `PROCESSING`    | `finalize()` + object confirmed in R2        |
| `DRAFT`         | `REJECTED`      | finalize timeout / object never uploaded     |
| `PROCESSING`    | `PENDING_REVIEW`| worker success                               |
| `PROCESSING`    | `REJECTED`      | validation/sanitize fail or duplicate (DLQ)  |
| `PENDING_REVIEW`| `PUBLISHED`     | admin APPROVE                                |
| `PENDING_REVIEW`| `REJECTED`      | admin REJECT (with reason)                   |
| `PENDING_REVIEW`| `PENDING_REVIEW`| admin REQUEST_CHANGES                        |
| `PUBLISHED`     | `ARCHIVED`      | creator/admin retire                         |
| `REJECTED`      | `ARCHIVED`      | cleanup                                      |
| `PUBLISHED`     | `REJECTED`      | post-hoc takedown (admin)                    |

Transitions are enforced in a single `IconStateService.transition(from, to)`
guard; illegal transitions throw and are never persisted.

---

## 4. Pack uploads (zip of SVGs)

A pack is a `.zip` containing multiple SVGs, mapped to `icon_packs` +
`pack_items` ([DATABASE.md](DATABASE.md)).

- **Init/finalize** identical, but the parent job is `pack-processing`; it
  fans out one `icon-processing` child job per extracted SVG.
- **Zip-bomb protection** (see [SECURITY.md](SECURITY.md)): cap entry count,
  total **uncompressed** size, per-entry size, and compression ratio; reject
  path traversal (`../`), absolute paths, and non-`.svg` entries. Stream-extract;
  never trust the zip's declared sizes.
- **Per-file processing:** each child SVG runs the full §4–§6 pipeline. A child
  gets its own `icons` row; the pack aggregates via `pack_items`.
- **Partial failures:** packs are **not** all-or-nothing. Successful children →
  `PENDING_REVIEW`; failed children → `REJECTED` with per-file reason. The pack
  surfaces a manifest: `{ total, succeeded, failed[] }`. A pack reaches
  `PENDING_REVIEW` only if ≥1 child succeeded; the admin sees the failure list.
- **Idempotency:** child `jobId = childIconId`; the parent job records which
  children it already spawned so a retried parent doesn't duplicate them.

---

## 5. Retries, idempotency & failure handling

### Idempotency

- `jobId = iconId` → BullMQ deduplicates; a re-`finalize` won't enqueue twice.
- Worker steps are **write-once by key**: re-uploading the same `public/` keys
  and re-running the DB writeback yields the same result.
- DB writeback uses `WHERE status = 'PROCESSING'` so a duplicate completion is a
  no-op.

### Retries & backoff

```ts
defaultJobOptions: {
  attempts: 4,
  backoff: { type: 'exponential', delay: 5_000 }, // 5s, 10s, 20s, 40s
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: false, // keep for DLQ inspection
}
```

- **Transient** failures (R2 5xx, timeouts) → retry with backoff.
- **Permanent** failures (invalid SVG, unsafe content, duplicate, zip bomb) are
  thrown as `UnrecoverableError` → **no retry**, straight to terminal handling.

### Failure states + DLQ

- After exhausting attempts (or on `UnrecoverableError`), the job lands in the
  **failed set / dead-letter queue** and the worker transitions the icon to
  `REJECTED` with a machine-readable `rejection_reason`
  (`invalid_svg`, `unsafe_content`, `duplicate`, `render_failed`,
  `r2_error`, `zip_bomb`, …).
- A `upload-pipeline-dlq` consumer alerts on-call, and an admin tool can
  re-drive a DLQ job after investigation (`jobId` preserved).
- Orphaned `DRAFT`/`PROCESSING` icons older than a TTL are swept by a cron and
  set to `REJECTED` (`finalize_timeout` / `worker_lost`).

---

## 6. Observability & metrics

- **Traces:** OpenTelemetry span per job covering download → sanitize → render →
  upload → writeback; correlate via `iconId` and request ID.
- **Metrics (Prometheus):**
  - `upload_jobs_total{result=success|rejected|failed}`
  - `upload_stage_duration_seconds{stage=download|sanitize|render|upload}`
  - `upload_rejections_total{reason}` (track `unsafe_content` closely)
  - `upload_queue_depth`, `upload_dlq_depth`, `upload_retries_total`
  - `svg_sanitize_stripped_total{element}` (what we're removing — security signal)
- **Logs:** structured JSON with `iconId`, `creatorId`, `jobId`, stage, outcome;
  never log raw SVG bodies, only hashes/sizes.
- **Errors:** Sentry on worker exceptions; alert on DLQ depth > 0 and on any
  spike in `unsafe_content` rejections (possible attack campaign).

---

## 7. BullMQ skeleton (TypeScript)

### Producer (api)

```ts
// apps/api/src/uploads/uploads.service.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface IconProcessingJob {
  iconId: string;
  rawKey: string;       // quarantine/{creatorId}/{iconId}/{uuid}.svg
  creatorId: string;
}

@Injectable()
export class UploadsService {
  constructor(
    @InjectQueue('icon-processing') private readonly queue: Queue<IconProcessingJob>,
    private readonly icons: IconStateService,
    private readonly r2: R2Service,
  ) {}

  async finalize(iconId: string, userId: string): Promise<void> {
    const icon = await this.icons.findOwned(iconId, userId); // ownership check
    if (icon.status !== 'DRAFT') return; // idempotent: already finalized

    const head = await this.r2.head(icon.svgRawKey!);
    if (!head) throw new ConflictException('upload_not_found');

    await this.icons.transition(iconId, 'DRAFT', 'PROCESSING', {
      fileSize: head.size,
    });

    await this.queue.add(
      'process',
      { iconId, rawKey: icon.svgRawKey!, creatorId: icon.creatorId },
      {
        jobId: iconId, // idempotency / dedupe key
        attempts: 4,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: false,
      },
    );
  }
}
```

### Processor (worker)

```ts
// apps/api/src/worker/icon-processing.processor.ts  (separate worker process)
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, UnrecoverableError } from 'bullmq';

@Processor('icon-processing', { concurrency: 4 })
export class IconProcessingProcessor extends WorkerHost {
  constructor(
    private readonly r2: R2Service,
    private readonly sanitizer: SvgSanitizerService, // DOMPurify(jsdom)+svgo allowlist
    private readonly renderer: PreviewRendererService, // resvg + sharp
    private readonly icons: IconStateService,
    private readonly metrics: MetricsService,
  ) {
    super();
  }

  async process(job: Job<IconProcessingJob>): Promise<void> {
    const { iconId, rawKey, creatorId } = job.data;
    const end = this.metrics.startTimer('upload', { iconId });

    // 1. download (hard byte cap)
    const raw = await this.r2.getCapped(rawKey, MAX_SVG_BYTES);

    // 2-7. validate + sanitize (throws UnrecoverableError on unsafe/invalid)
    let clean: SanitizedSvg;
    try {
      clean = await this.sanitizer.sanitize(raw); // sniff, XML parse, allowlist, svgo
    } catch (e) {
      this.metrics.inc('upload_rejections_total', { reason: e.code ?? 'invalid_svg' });
      throw new UnrecoverableError(e.message); // no retry → REJECTED
    }

    // 8. dedupe by checksum
    const dup = await this.icons.findPublishedByChecksum(creatorId, clean.checksum);
    if (dup) throw new UnrecoverableError('duplicate');

    // 5. render previews from SANITIZED svg only
    const { png, thumb } = await this.renderer.render(clean.svg);

    // 6. promote to public
    const keys = await this.r2.putPublicSet(iconId, { svg: clean.svg, png, thumb });

    // writeback (no-op unless still PROCESSING)
    await this.icons.completeProcessing(iconId, {
      ...keys,
      width: clean.width,
      height: clean.height,
      fileSize: clean.svg.byteLength,
      checksum: clean.checksum,
      nextStatus: 'PENDING_REVIEW',
    });

    end({ result: 'success' });
  }

  // terminal failure → REJECTED + notify
  @OnWorkerEvent('failed')
  async onFailed(job: Job<IconProcessingJob>, err: Error): Promise<void> {
    if (job.attemptsMade < (job.opts.attempts ?? 1) && !(err instanceof UnrecoverableError)) return;
    await this.icons.failProcessing(job.data.iconId, reasonCode(err)); // → REJECTED + DLQ
  }
}
```

### Sanitizer contract

```ts
export interface SanitizedSvg {
  svg: Buffer;       // canonical, optimized, safe
  checksum: string;  // sha256(svg)
  width: number;     // from viewBox
  height: number;
}

export class SvgSanitizerService {
  // 1. sniff (magic bytes / not-binary / not-html)
  // 2. complexity limits (size, depth, element & point counts)
  // 3. XML parse: DTD off, external entities off, no network
  // 4. DOMPurify(jsdom) USE_PROFILES:{svg:true} + explicit allowlist
  // 5. malicious-pattern scan
  // 6. svgo optimize
  // 7. compute viewBox dims + sha256
  // throws { code } on any failure -> UnrecoverableError upstream
  sanitize(raw: Buffer): Promise<SanitizedSvg>;
}
```

---

## 8. Security cross-references

The "what and why" of SVG sanitization, separate-origin serving, CSP, and
file-validation limits live in [SECURITY.md](SECURITY.md). This document covers
the **pipeline mechanics**; that one covers the **threat model**.
