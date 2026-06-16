# NestJS Module Structure — TurkistanIcons

How the `apps/api` backend is organized. This is the source of truth for the
NestJS layout; keep it in sync with the code and with
[ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), and
[API.md](API.md).

The API is a **NestJS** application. Business logic, authN/Z, validation, Prisma
DB access, R2 signed URLs, Stripe integration, and BullMQ producers all live
here. A **second NestJS process** (the upload worker) consumes BullMQ jobs for
CPU-bound SVG sanitization and PNG rendering, sharing the same module code but a
different bootstrap entrypoint.

## 1. Design principles

- **Feature modules** own a slice of the domain (controller + service +
  DTOs + entity mappers). They depend on cross-cutting infrastructure modules,
  never on each other's internals — only on their exported services.
- **Thin controllers, fat services.** Controllers do HTTP + validation +
  authorization annotations; services hold business logic and own all Prisma
  access for their slice.
- **One Prisma client**, exposed via a global `PrismaModule`. No feature talks
  to Postgres any other way.
- **Validation at the edge** with zod schemas shared from `packages/types`
  (see §6). DTOs are zod-inferred types, not hand-written interfaces.
- **Errors as RFC-7807 problem JSON** via a single global exception filter
  (see §7). Never leak stack traces.
- **Every request carries a request id** for tracing/log correlation (§7).
- **Authorization is server-side only** — `JwtAuthGuard` + `RolesGuard` +
  ownership guards. The client is never trusted.

## 2. Folder tree (`apps/api`)

```
apps/api/
├── src/
│   ├── main.ts                     # HTTP bootstrap (api process)
│   ├── worker.ts                   # BullMQ worker bootstrap (upload worker process)
│   ├── app.module.ts               # root module: imports all feature + infra modules
│   │
│   ├── config/                     # typed configuration (env → config objects)
│   │   ├── config.module.ts        # global ConfigModule.forRoot + validation
│   │   ├── env.schema.ts           # zod schema for process.env (fail fast on boot)
│   │   ├── app.config.ts           # port, baseUrl, corsOrigins, nodeEnv
│   │   ├── auth.config.ts          # jwt secrets/ttls, google oauth, cookie opts
│   │   ├── database.config.ts      # DATABASE_URL, pool
│   │   ├── redis.config.ts         # redis url, key prefixes, ttls
│   │   ├── storage.config.ts       # R2 endpoint/keys/buckets, signed-url ttls
│   │   ├── stripe.config.ts        # secret key, webhook secret, platform fee bps
│   │   └── queue.config.ts         # BullMQ connection + per-queue defaults
│   │
│   ├── common/                     # cross-cutting, domain-agnostic building blocks
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts   # @CurrentUser() param decorator
│   │   │   ├── roles.decorator.ts          # @Roles(Role.ADMIN)
│   │   │   ├── public.decorator.ts         # @Public() bypass JwtAuthGuard
│   │   │   ├── ownership.decorator.ts      # @OwnsResource('icon','id')
│   │   │   └── idempotency-key.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts           # global, honors @Public()
│   │   │   ├── roles.guard.ts              # global, reads @Roles()
│   │   │   ├── ownership.guard.ts          # resource-owner / creator-owner
│   │   │   ├── optional-auth.guard.ts      # populates user if token present
│   │   │   └── throttler.guard.ts          # Redis-backed rate limiting
│   │   ├── interceptors/
│   │   │   ├── request-id.interceptor.ts   # X-Request-Id in/out + AsyncLocalStorage
│   │   │   ├── logging.interceptor.ts      # structured access log per request
│   │   │   ├── transform.interceptor.ts    # envelope success responses
│   │   │   ├── cache.interceptor.ts        # Redis cache-aside for hot GETs
│   │   │   └── timeout.interceptor.ts
│   │   ├── filters/
│   │   │   ├── all-exceptions.filter.ts    # RFC-7807 problem JSON (global)
│   │   │   └── prisma-exception.filter.ts  # maps Prisma errors → problem JSON
│   │   ├── pipes/
│   │   │   ├── zod-validation.pipe.ts      # validates body/query/params via zod
│   │   │   └── parse-cursor.pipe.ts        # decodes opaque pagination cursor
│   │   ├── dto/
│   │   │   ├── pagination.dto.ts           # cursor/limit query schema
│   │   │   ├── page.dto.ts                 # { data, page: { nextCursor, hasMore } }
│   │   │   ├── id-param.dto.ts             # uuid path param schema
│   │   │   └── problem.dto.ts              # RFC-7807 shape
│   │   ├── pagination/
│   │   │   ├── cursor.util.ts              # encode/decode base64url cursors
│   │   │   └── paginate.ts                 # generic keyset paginator over Prisma
│   │   ├── logger/
│   │   │   └── logger.module.ts            # pino structured logger (req-id aware)
│   │   ├── als/
│   │   │   └── request-context.ts          # AsyncLocalStorage<{ requestId, userId }>
│   │   ├── errors/
│   │   │   └── domain-errors.ts            # AppError subclasses (→ problem JSON)
│   │   └── constants.ts
│   │
│   ├── infra/                      # technical capability modules (global)
│   │   ├── prisma/
│   │   │   ├── prisma.module.ts            # @Global
│   │   │   ├── prisma.service.ts           # extends PrismaClient, onModuleInit connect
│   │   │   └── prisma-tx.ts                # withTransaction helper
│   │   ├── redis/
│   │   │   ├── redis.module.ts             # @Global; ioredis client(s)
│   │   │   ├── redis.service.ts            # get/set/del + namespaced helpers
│   │   │   └── cache.service.ts            # cache-aside getOrSet<T>
│   │   ├── storage/                        # Cloudflare R2 (S3-compatible)
│   │   │   ├── storage.module.ts           # @Global
│   │   │   ├── r2.service.ts               # S3 client, signed PUT/GET, head, delete
│   │   │   └── object-key.ts               # deterministic key builders
│   │   ├── queue/
│   │   │   ├── queue.module.ts             # BullMQ root (connection, registerQueue)
│   │   │   ├── queue.constants.ts          # queue + job names
│   │   │   └── producers/
│   │   │       ├── upload.producer.ts      # enqueue icon-processing jobs
│   │   │       ├── email.producer.ts       # enqueue transactional emails
│   │   │       └── analytics.producer.ts   # enqueue counter/aggregation jobs
│   │   ├── mailer/
│   │   │   ├── mailer.module.ts            # Resend client
│   │   │   └── mailer.service.ts
│   │   └── stripe/
│   │       ├── stripe.module.ts            # @Global; Stripe SDK client
│   │       └── stripe.service.ts           # checkout sessions, transfers, webhook verify
│   │
│   ├── modules/                    # feature modules (the domain)
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts          # register/login/refresh/logout/google/...
│   │   │   ├── auth.service.ts
│   │   │   ├── token.service.ts            # sign/verify/rotate JWTs (Redis refresh store)
│   │   │   ├── password.service.ts         # argon2 hash/verify, reset tokens
│   │   │   ├── email-verification.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   ├── jwt-refresh.strategy.ts
│   │   │   │   └── google.strategy.ts
│   │   │   └── dto/                         # zod schemas + inferred DTO types
│   │   │       ├── register.dto.ts
│   │   │       ├── login.dto.ts
│   │   │       ├── refresh.dto.ts
│   │   │       ├── forgot-password.dto.ts
│   │   │       └── reset-password.dto.ts
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts         # /me, profile updates, avatar
│   │   │   ├── users.service.ts
│   │   │   └── dto/
│   │   ├── creators/
│   │   │   ├── creators.module.ts
│   │   │   ├── creators.controller.ts      # public creator profiles
│   │   │   ├── creators.service.ts
│   │   │   └── dto/
│   │   ├── creator-dashboard/
│   │   │   ├── creator-dashboard.module.ts
│   │   │   ├── creator-dashboard.controller.ts  # apply, my-icons, analytics, payouts
│   │   │   ├── creator-dashboard.service.ts
│   │   │   ├── creator-applications.service.ts
│   │   │   └── dto/
│   │   ├── icons/
│   │   │   ├── icons.module.ts
│   │   │   ├── icons.controller.ts         # list/detail/related/download
│   │   │   ├── icons.service.ts
│   │   │   ├── icon-download.service.ts    # entitlement check + signed GET
│   │   │   ├── icon.mapper.ts              # entity → public DTO (hides R2 keys)
│   │   │   └── dto/
│   │   ├── packs/
│   │   │   ├── packs.module.ts
│   │   │   ├── packs.controller.ts
│   │   │   ├── packs.service.ts
│   │   │   └── dto/
│   │   ├── categories/
│   │   │   ├── categories.module.ts
│   │   │   ├── categories.controller.ts    # tree + by-slug
│   │   │   ├── categories.service.ts
│   │   │   └── dto/
│   │   ├── tags/
│   │   │   ├── tags.module.ts
│   │   │   ├── tags.controller.ts
│   │   │   ├── tags.service.ts
│   │   │   └── dto/
│   │   ├── search/
│   │   │   ├── search.module.ts
│   │   │   ├── search.controller.ts        # /search?q=...
│   │   │   ├── search.service.ts           # Postgres FTS + trigram (Meili Phase 2)
│   │   │   └── dto/
│   │   ├── uploads/
│   │   │   ├── uploads.module.ts
│   │   │   ├── uploads.controller.ts       # init / finalize / status
│   │   │   ├── uploads.service.ts          # creates DRAFT icon + signed PUT + enqueue
│   │   │   └── dto/
│   │   ├── purchases/
│   │   │   ├── purchases.module.ts
│   │   │   ├── purchases.controller.ts     # checkout, list, detail
│   │   │   ├── purchases.service.ts        # cart math, entitlement on PAID
│   │   │   ├── entitlement.service.ts      # owns(user, icon|pack) check
│   │   │   └── dto/
│   │   ├── payments/
│   │   │   ├── payments.module.ts
│   │   │   ├── payments.controller.ts      # POST /webhooks/stripe (raw body)
│   │   │   ├── payments.service.ts         # idempotent event handling
│   │   │   └── dto/
│   │   ├── downloads/
│   │   │   ├── downloads.module.ts
│   │   │   ├── downloads.controller.ts     # my download history
│   │   │   └── downloads.service.ts        # records download_history (partitioned)
│   │   ├── favorites/
│   │   │   ├── favorites.module.ts
│   │   │   ├── favorites.controller.ts
│   │   │   └── favorites.service.ts
│   │   ├── collections/
│   │   │   ├── collections.module.ts
│   │   │   ├── collections.controller.ts
│   │   │   ├── collections.service.ts
│   │   │   └── dto/
│   │   ├── reviews/
│   │   │   ├── reviews.module.ts
│   │   │   ├── reviews.controller.ts
│   │   │   ├── reviews.service.ts
│   │   │   └── dto/
│   │   ├── moderation/
│   │   │   ├── moderation.module.ts
│   │   │   ├── moderation.controller.ts    # queue, approve/reject (ADMIN)
│   │   │   ├── moderation.service.ts       # writes moderation_events, transitions status
│   │   │   └── dto/
│   │   ├── admin/
│   │   │   ├── admin.module.ts
│   │   │   ├── admin-users.controller.ts
│   │   │   ├── admin-creators.controller.ts
│   │   │   ├── admin-categories.controller.ts
│   │   │   ├── admin-analytics.controller.ts
│   │   │   ├── admin.service.ts
│   │   │   └── dto/
│   │   ├── notifications/
│   │   │   ├── notifications.module.ts
│   │   │   ├── notifications.controller.ts # list / mark-read
│   │   │   ├── notifications.service.ts    # in-app + triggers email producer
│   │   │   └── dto/
│   │   └── health/
│   │       ├── health.module.ts
│   │       └── health.controller.ts        # /health (liveness), /health/ready (deps)
│   │
│   └── workers/                    # BullMQ consumers (run in worker.ts process)
│       ├── upload/
│       │   ├── upload.processor.ts         # @Processor('icon-processing')
│       │   ├── svg-sanitizer.service.ts    # DOMPurify/svgo strict allowlist
│       │   ├── png-renderer.service.ts     # resvg/sharp → PNG + thumb
│       │   └── upload.steps.ts             # validate → sanitize → render → persist
│       ├── email/
│       │   └── email.processor.ts          # @Processor('email')
│       └── analytics/
│           └── analytics.processor.ts      # @Processor('analytics') counters/rollups
│
├── prisma/                         # symlinked/owned per CLAUDE.md repo layout
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
├── test/
│   ├── e2e/
│   └── fixtures/
├── .env.example
├── nest-cli.json
├── tsconfig.json
└── package.json
```

## 3. Two processes, one codebase

`apps/api` builds to two entrypoints that share modules:

- **`main.ts` (API process):** standard Nest HTTP app. Registers global pipes,
  guards, interceptors, and filters; serves all REST endpoints; acts as a BullMQ
  **producer** (never registers processors).
- **`worker.ts` (upload worker process):** a Nest application context (no HTTP
  listener) that imports `QueueModule` + the `workers/` consumers. It is the only
  place `@Processor()` classes are loaded, so CPU-bound SVG sanitization and PNG
  rendering are isolated from request handling and scale independently.

```ts
// src/worker.ts — separate process consuming BullMQ jobs
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './workers/worker.module';

async function bootstrap() {
  // No HTTP server: just wire DI + BullMQ processors and keep the process alive.
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  app.enableShutdownHooks(); // drain in-flight jobs on SIGTERM
}
bootstrap();
```

`WorkerModule` imports `ConfigModule`, `PrismaModule`, `RedisModule`,
`StorageModule`, `QueueModule`, and the `workers/*` processor modules — but **no
HTTP controllers**.

## 4. Cross-cutting infrastructure modules

All infra modules are `@Global()` so feature modules can inject their services
without re-importing.

### PrismaModule

```ts
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() { await this.$connect(); }
}
```

`PrismaService` is the single gateway to Postgres (the system of record in
[DATABASE.md](DATABASE.md)). A `withTransaction` helper wraps multi-write
operations (e.g. creating a `purchase` + `purchase_items` + denormalized counter
updates) in a single `$transaction`.

### RedisModule

One `ioredis` connection pool, exposed as `RedisService`. Provides:
- **Cache-aside** (`CacheService.getOrSet`) for hot reads — categories tree,
  trending icons, icon detail — with explicit invalidation on write.
- **Refresh-token store** for auth (rotating, TTL = refresh TTL).
- **Rate-limit counters** backing the `ThrottlerGuard`.
- Connection reused by BullMQ.

### StorageModule (Cloudflare R2)

`R2Service` wraps the S3-compatible client:
- `getSignedPutUrl(key, contentType, maxBytes)` — short-lived upload URL for the
  client to PUT the raw SVG into the quarantine bucket.
- `getSignedGetUrl(key, ttl)` — time-boxed download URL for entitled assets.
- `headObject` / `deleteObject` for finalize + cleanup.

Object keys are built deterministically (`object-key.ts`), e.g.
`raw/{creatorId}/{iconId}.svg`, `svg/{iconId}.svg`, `png/{iconId}.png`,
`thumb/{iconId}.png`, matching the `svg_raw_key` / `svg_key` / `png_key` /
`thumb_key` columns on `icons`.

### QueueModule (BullMQ)

Registers queues against the shared Redis connection:

| Queue | Producer | Consumer (worker) | Purpose |
|---|---|---|---|
| `icon-processing` | `uploads` | `upload.processor` | validate → sanitize SVG → render PNG/thumb → persist keys → set `PENDING_REVIEW` |
| `email` | `auth`, `notifications`, `payments` | `email.processor` | verification, reset, receipts, moderation notices |
| `analytics` | `downloads`, `purchases`, `favorites` | `analytics.processor` | denormalized counter updates + nightly reconcile |

Jobs are **idempotent** and keyed (job id = `iconId` for processing, Stripe
event id for payment side effects), so retries and duplicate enqueues are safe.

### ConfigModule

`ConfigModule.forRoot({ isGlobal: true })` loads env and **validates it against a
zod `env.schema.ts` at boot** — the process fails fast if a required secret is
missing. Typed config namespaces (`auth.config.ts`, `storage.config.ts`, …) are
injected via `ConfigService` so no feature reads `process.env` directly. Secrets
are env-only; `.env.example` is the contract (per CLAUDE.md).

### StripeModule, MailerModule

`StripeModule` exposes the Stripe SDK + helpers (checkout sessions, Connect
transfers, webhook signature verification). `MailerModule` wraps Resend and is
driven via the `email` queue.

## 5. AuthZ: RolesGuard + ownership guards

Three layers, applied in order, all server-side:

1. **`JwtAuthGuard` (global).** Verifies the access JWT, attaches
   `req.user = { id, role, … }`. Skipped on routes marked `@Public()`. A
   variant, `OptionalAuthGuard`, attaches the user if a token is present but does
   not reject anonymous requests (used on public icon detail to personalize
   "isFavorited").

2. **`RolesGuard` (global).** Reads the `@Roles(...)` metadata set on a handler
   or controller and checks `req.user.role` against the role hierarchy
   `VISITOR < USER < CREATOR < ADMIN`. A handler annotated `@Roles(Role.CREATOR)`
   admits `CREATOR` and `ADMIN`.

```ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true; // no @Roles → only auth required
    const { user } = ctx.switchToHttp().getRequest();
    return user && hasAtLeast(user.role, ...required); // hierarchy-aware
  }
}
```

3. **`OwnershipGuard` (per-route).** For mutations on user-owned or
   creator-owned resources, `@OwnsResource('icon', 'id')` declares which resource
   and which path param identifies it. The guard loads the row and asserts the
   caller owns it — `ADMIN` bypasses. This is what stops a `CREATOR` from editing
   another creator's icon, or a `USER` from deleting someone else's collection.

```ts
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<OwnershipRule>(OWNS_KEY, ctx.getHandler());
    if (!rule) return true;
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.role === Role.ADMIN) return true; // admins bypass ownership
    const id = req.params[rule.param];

    switch (rule.resource) {
      case 'icon': {
        const icon = await this.prisma.icon.findUnique({
          where: { id }, select: { creator: { select: { userId: true } } },
        });
        if (!icon) throw new NotFoundException();
        return icon.creator.userId === req.user.id;
      }
      case 'collection': {
        const c = await this.prisma.collection.findUnique({
          where: { id }, select: { userId: true },
        });
        if (!c) throw new NotFoundException();
        return c.userId === req.user.id;
      }
      // ...favorite, review, pack similarly
      default:
        return false;
    }
  }
}
```

Guards are registered globally in `main.ts` (Jwt → Roles), with `OwnershipGuard`
applied at the route via `@UseGuards`.

## 6. Validation: global zod pipe

Per CLAUDE.md, validation is **zod at the edges**, with schemas shared via
`packages/types`. DTOs are inferred from zod schemas rather than written by hand.

```ts
// common/pipes/zod-validation.pipe.ts
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}
  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // Thrown as a domain error → rendered as RFC-7807 with field details (§7)
      throw new ValidationError(result.error.flatten());
    }
    return result.data;
  }
}
```

```ts
// modules/icons/dto/list-icons.dto.ts
import { z } from 'zod';

export const listIconsQuery = z.object({
  q: z.string().trim().min(1).optional(),
  categoryId: z.string().uuid().optional(),
  priceType: z.enum(['FREE', 'PREMIUM']).optional(),
  sort: z.enum(['trending', 'newest', 'downloads', 'name']).default('trending'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type ListIconsQuery = z.infer<typeof listIconsQuery>;
```

Each schema is attached with `@UsePipes(new ZodValidationPipe(schema))` (or a
`@ZodBody(schema)` helper decorator) so the controller receives a fully typed,
validated object.

## 7. Errors, request id, logging

### RFC-7807 exception filter (global)

A single `AllExceptionsFilter` maps everything — Nest `HttpException`s, Prisma
errors (via `PrismaExceptionFilter`), and domain `AppError`s — into a stable
problem-JSON envelope. Stack traces are never serialized to clients.

```ts
// common/filters/all-exceptions.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const { status, problem } = toProblem(exception); // maps to RFC-7807

    res.status(status).type('application/problem+json').json({
      type: problem.type,           // e.g. https://turkistanicons.com/errors/validation
      title: problem.title,         // "Validation failed"
      status,                       // 422
      detail: problem.detail,       // human-readable
      instance: req.originalUrl,    // the path that failed
      requestId: req.requestId,     // correlation id (also in X-Request-Id header)
      errors: problem.errors,       // optional field-level zod errors
    });
  }
}
```

Example body returned to clients:

```json
{
  "type": "https://turkistanicons.com/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/api/v1/icons",
  "requestId": "req_8f3c2a1b",
  "errors": {
    "fieldErrors": { "limit": ["Number must be less than or equal to 100"] }
  }
}
```

### Request-id interceptor

`RequestIdInterceptor` reads an inbound `X-Request-Id` (or generates one), stores
it in `AsyncLocalStorage` so every log line and the exception filter can attach
it, and echoes it back on the response `X-Request-Id` header. This is the
correlation id surfaced in problem JSON and tied to OpenTelemetry traces
(ARCHITECTURE.md §4).

### Logging interceptor

`LoggingInterceptor` emits one structured (pino) access log per request —
method, path, status, latency, `userId`, `requestId` — and never logs request
bodies that may contain secrets.

## 8. Bootstrap (`main.ts`)

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' }); // /api/v1
  app.use(helmet());
  app.enableCors({ origin: config.get('app.corsOrigins'), credentials: true });

  // Stripe webhooks need the raw body for signature verification (see §10).
  app.use('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }));

  // Order matters: request-id first so it's available to everything downstream.
  app.useGlobalInterceptors(
    new RequestIdInterceptor(),
    new LoggingInterceptor(),
    new TransformInterceptor(),
  );
  app.useGlobalGuards(
    app.get(JwtAuthGuard),   // honors @Public()
    app.get(RolesGuard),     // honors @Roles()
    app.get(ThrottlerGuard), // Redis-backed rate limits
  );
  app.useGlobalFilters(new AllExceptionsFilter(), new PrismaExceptionFilter());

  app.enableShutdownHooks();
  await app.listen(config.get('app.port'));
}
```

## 9. Sample module skeleton

A representative feature module — `icons` — showing controller / service / module
wiring, the guards/pipes in use, and the entity → DTO boundary that hides R2
object keys from clients.

### `icons.module.ts`

```ts
import { Module } from '@nestjs/common';
import { IconsController } from './icons.controller';
import { IconsService } from './icons.service';
import { IconDownloadService } from './icon-download.service';
import { EntitlementService } from '../purchases/entitlement.service';
import { DownloadsModule } from '../downloads/downloads.module';

@Module({
  imports: [DownloadsModule],            // for recording download_history
  controllers: [IconsController],
  providers: [IconsService, IconDownloadService, EntitlementService],
  exports: [IconsService],               // search/packs reuse the mapper/service
})
export class IconsModule {}
```

### `icons.controller.ts`

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { OptionalAuthGuard } from '@/common/guards/optional-auth.guard';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Public } from '@/common/decorators/public.decorator';
import { ZodValidationPipe } from '@/common/pipes/zod-validation.pipe';
import { listIconsQuery, ListIconsQuery } from './dto/list-icons.dto';
import { IconsService } from './icons.service';
import { IconDownloadService } from './icon-download.service';

@Controller({ path: 'icons', version: '1' })
export class IconsController {
  constructor(
    private readonly icons: IconsService,
    private readonly downloads: IconDownloadService,
  ) {}

  // GET /api/v1/icons — public, cursor-paginated, filterable/sortable.
  @Public()
  @UseGuards(OptionalAuthGuard) // populate user (if any) to flag isFavorited
  @Get()
  list(
    @Query(new ZodValidationPipe(listIconsQuery)) query: ListIconsQuery,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.icons.list(query, user?.id);
  }

  // GET /api/v1/icons/:slug — public detail (only PUBLISHED icons).
  @Public()
  @UseGuards(OptionalAuthGuard)
  @Get(':slug')
  detail(@Param('slug') slug: string, @CurrentUser() user?: AuthUser) {
    return this.icons.getPublicBySlug(slug, user?.id);
  }

  // GET /api/v1/icons/:id/related — public.
  @Public()
  @Get(':id/related')
  related(@Param('id') id: string) {
    return this.icons.related(id);
  }

  // GET /api/v1/icons/:id/download — auth required; entitlement-checked signed URL.
  @UseGuards(JwtAuthGuard)
  @Get(':id/download')
  download(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.downloads.issueSignedDownload(id, user);
  }
}
```

### `icons.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/infra/prisma/prisma.service';
import { CacheService } from '@/infra/redis/cache.service';
import { paginate } from '@/common/pagination/paginate';
import { toPublicIcon } from './icon.mapper';
import { ListIconsQuery } from './dto/list-icons.dto';

@Injectable()
export class IconsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async list(q: ListIconsQuery, userId?: string) {
    const where = {
      status: 'PUBLISHED' as const,
      deletedAt: null,
      ...(q.categoryId && { categoryId: q.categoryId }),
      ...(q.priceType && { priceType: q.priceType }),
      ...(q.q && { name: { contains: q.q, mode: 'insensitive' as const } }),
    };
    const page = await paginate(this.prisma.icon, {
      where,
      orderBy: orderFor(q.sort), // trending|newest|downloads|name → keyset order
      cursor: q.cursor,
      limit: q.limit,
    });
    return {
      data: page.data.map((i) => toPublicIcon(i, userId)),
      page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
    };
  }

  async getPublicBySlug(slug: string, userId?: string) {
    // Cache-aside: hot read, invalidated when the icon is re-published/edited.
    const icon = await this.cache.getOrSet(
      `icon:slug:${slug}`,
      60,
      () =>
        this.prisma.icon.findFirst({
          where: { slug, status: 'PUBLISHED', deletedAt: null },
          include: { creator: true, category: true, tags: { include: { tag: true } } },
        }),
    );
    if (!icon) throw new NotFoundException();
    return toPublicIcon(icon, userId);
  }

  async related(id: string) {
    // same category + overlapping tags, PUBLISHED, excluding self.
    const base = await this.prisma.icon.findUnique({ where: { id } });
    if (!base) throw new NotFoundException();
    const items = await this.prisma.icon.findMany({
      where: {
        id: { not: id },
        status: 'PUBLISHED',
        deletedAt: null,
        categoryId: base.categoryId,
      },
      orderBy: { downloadCount: 'desc' },
      take: 12,
    });
    return { data: items.map((i) => toPublicIcon(i)) };
  }
}
```

### `icon.mapper.ts` (entity → public DTO)

```ts
// Never expose R2 keys (svg_key / svg_raw_key / png_key) directly. The client
// gets CDN/asset URLs for previews and obtains a download via the signed
// /download endpoint after the entitlement check.
export function toPublicIcon(icon: IconWithRelations, userId?: string) {
  return {
    id: icon.id,
    slug: icon.slug,
    name: icon.name,
    description: icon.description,
    priceType: icon.priceType,
    priceCents: icon.priceCents,
    currency: icon.currency,
    license: icon.license,
    previewUrl: assetUrl(icon.pngKey),     // CDN URL, not the raw key
    thumbUrl: assetUrl(icon.thumbKey),
    width: icon.width,
    height: icon.height,
    downloadCount: icon.downloadCount,
    favoriteCount: icon.favoriteCount,
    isFavorited: userId ? icon.favorites?.some((f) => f.userId === userId) : false,
    category: icon.category && { id: icon.category.id, name: icon.category.name, slug: icon.category.slug },
    creator: icon.creator && { id: icon.creator.id, displayName: icon.creator.displayName, slug: icon.creator.slug },
    tags: icon.tags?.map((t) => ({ name: t.tag.name, slug: t.tag.slug })),
    createdAt: icon.createdAt,
  };
}
```

## 10. Upload worker process (BullMQ consumer)

The upload pipeline is split between the API (producer) and the worker
(consumer), matching ARCHITECTURE.md §3:

1. **API — `uploads.service.ts`** creates an `icon` row in `DRAFT`, returns a
   short-lived **signed PUT** to R2 (raw/quarantine bucket), and — on finalize —
   verifies the object exists (`headObject`), sets status `PROCESSING`, and
   enqueues an `icon-processing` job keyed by `iconId`.

2. **Worker — `upload.processor.ts`** consumes the job and runs `upload.steps.ts`:
   validate (content-sniffed type + size + viewBox) → **sanitize** the SVG with a
   strict DOMPurify/svgo allowlist (strip `<script>`, event handlers, external
   refs, foreign objects per CLAUDE.md security rules) → render PNG + thumbnail →
   write sanitized `svg_key` / `png_key` / `thumb_key` + `checksum` + dims +
   `file_size` to the `icon` row → transition status to `PENDING_REVIEW`.

3. An admin then approves via the `moderation` module → status `PUBLISHED`.

```ts
// workers/upload/upload.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUE } from '@/infra/queue/queue.constants';

@Processor(QUEUE.ICON_PROCESSING, { concurrency: 4 })
export class UploadProcessor extends WorkerHost {
  constructor(private readonly steps: UploadSteps) { super(); }

  // Idempotent: job id === iconId, so a retry re-runs deterministically and
  // overwrites the same R2 keys / row fields.
  async process(job: Job<{ iconId: string }>): Promise<void> {
    const { iconId } = job.data;
    await this.steps.validate(iconId);
    await this.steps.sanitizeSvg(iconId);   // DOMPurify/svgo strict allowlist
    await this.steps.renderPreviews(iconId); // PNG + thumb
    await this.steps.persistAndMarkPendingReview(iconId);
  }
}
```

Workers scale horizontally and independently of the API. On `SIGTERM` the worker
drains in-flight jobs (`enableShutdownHooks`). Failed jobs use BullMQ
backoff/retry; permanent failures move the icon to `REJECTED` with a
`rejection_reason` and notify the creator via the `email` queue.

## 11. Module dependency rules (summary)

- Feature modules import **infra modules** (Prisma/Redis/Storage/Queue/Stripe/
  Mailer) and `common`.
- Feature → feature dependencies go through **exported services** only
  (e.g. `icons` imports `DownloadsModule`; `purchases` exports
  `EntitlementService` consumed by `icons`/`downloads`).
- The **worker** imports only infra + `workers/*`, never HTTP controllers.
- Nothing outside `infra/prisma` touches `PrismaClient`; nothing outside
  `apps/api` touches Postgres at all (CLAUDE.md).
