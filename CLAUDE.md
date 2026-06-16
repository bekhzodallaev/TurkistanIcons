# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## What this is

**TurkistanIcons** — a production icon marketplace (think Flaticon) focused on
Uzbek and Central Asian cultural icons: Do'ppi, Atlas patterns, Suzani
ornaments, Registan, Bukhara architecture, traditional tea sets, Plov, Silk Road
symbols, Navruz symbols, and related cultural/historical elements.

Designers (Creators) upload, showcase, and sell SVG icons and icon packs; users
browse, search, download (free), and purchase (premium) them.

## Repository layout

This is a **monorepo** with two deployable apps and shared packages.

```
turkistan-icons/
├── apps/
│   ├── web/         # Next.js 15 (App Router) frontend
│   └── api/         # NestJS backend
├── packages/
│   ├── types/       # Shared TS types / DTOs / zod schemas
│   ├── config/      # Shared eslint/tsconfig/tailwind presets
│   └── ui/          # Shared shadcn/ui components (optional)
├── infra/
│   ├── docker/      # Dockerfiles
│   └── compose/     # docker-compose.yml for local dev
├── docs/            # Architecture, PRD, schema, roadmap (read these first)
└── prisma/          # Prisma schema + migrations (owned by api)
```

> The architecture docs in [docs/](docs/) are the source of truth for design
> decisions. Read them before making structural changes.

## Tech stack (do not substitute without updating docs)

- **Frontend:** Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query
- **Backend:** NestJS, TypeScript, PostgreSQL, Prisma ORM
- **Storage:** Cloudflare R2 (SVG + PNG previews)
- **Cache/sessions/queues:** Redis (BullMQ for the upload pipeline)
- **Auth:** Email/Password + Google OAuth, JWT access/refresh, RBAC
- **Infra:** Docker, Docker Compose; managed Postgres + Redis in prod

## Roles

`VISITOR` (unauthenticated) → `USER` → `CREATOR` → `ADMIN`. Authorization is
role-based; enforce on the API with guards, never trust the client.

## Conventions

- **Language:** TypeScript everywhere, `strict` on. No `any` without a comment.
- **Package manager:** pnpm with workspaces.
- **Validation:** zod at the edges (API DTOs and Next.js server actions). Share
  schemas via `packages/types`.
- **Errors:** API returns RFC-7807-style problem JSON; never leak stack traces.
- **DB access:** only through Prisma in the `api` app. The web app never talks to
  Postgres directly — it goes through the API.
- **Naming:** `kebab-case` files, `PascalCase` components/classes,
  `camelCase` vars/functions, `SCREAMING_SNAKE` env vars.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:` …).
- **Imports:** absolute via tsconfig path aliases (`@/…`), no deep relative `../../..`.

## Security rules (non-negotiable)

- **All uploaded SVGs are untrusted.** Sanitize server-side (DOMPurify/svgo with
  a strict allowlist), strip `<script>`, event handlers, external refs, and
  foreign objects. Serve user SVGs from a separate origin/CDN, never inline into
  the app HTML. See [docs/SECURITY.md](docs/SECURITY.md) and
  [docs/UPLOAD-PIPELINE.md](docs/UPLOAD-PIPELINE.md).
- Rate-limit auth, upload, and download endpoints.
- Validate file type/size by content, not extension.
- Parameterized queries only (Prisma handles this) — never string-build SQL.
- Secrets via env only; never commit `.env`. `.env.example` is the contract.

## Common commands

> These reflect the intended setup; wire them up as the apps are scaffolded.

```bash
pnpm install                # install workspace deps
pnpm dev                    # run web + api together (turbo)
pnpm --filter web dev       # frontend only
pnpm --filter api dev       # backend only
pnpm --filter api prisma migrate dev   # create/apply a migration
pnpm --filter api prisma studio        # inspect the DB
docker compose -f infra/compose/docker-compose.yml up -d   # postgres + redis + minio(R2)
pnpm lint && pnpm typecheck && pnpm test
```

## Working agreements for Claude

- Prefer editing existing files over creating new ones; keep the structure above.
- When you change the data model, update `prisma/schema.prisma` **and**
  [docs/DATABASE.md](docs/DATABASE.md) in the same change.
- When you add/modify an endpoint, keep [docs/API.md](docs/API.md) in sync.
- Run `pnpm lint && pnpm typecheck` before declaring a task done.
- Don't introduce a new dependency for something the stack already covers.
- Follow the development order in [docs/ROADMAP.md](docs/ROADMAP.md) for MVP work.
