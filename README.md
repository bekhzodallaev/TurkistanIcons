# TurkistanIcons

A production icon marketplace for **Uzbek and Central Asian cultural icons** —
Do'ppi, Atlas patterns, Suzani ornaments, Registan, Bukhara architecture,
traditional tea sets, Plov, Silk Road symbols, Navruz, and more.

Designers upload, showcase, and sell SVG icons and packs; users browse, search,
download free icons, and purchase premium ones.

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui, TanStack Query |
| Backend  | NestJS, TypeScript, PostgreSQL, Prisma |
| Storage  | Cloudflare R2 (SVG + PNG) |
| Cache    | Redis (sessions, caching, BullMQ queues) |
| Auth     | Email/Password, Google OAuth, JWT, RBAC |
| Infra    | Docker, Docker Compose |

## Monorepo layout

```
apps/web      Next.js frontend
apps/api      NestJS backend
packages/*    shared types, config, ui
prisma/       schema + migrations
infra/        docker + compose
docs/         architecture & design docs  ← start here
```

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in secrets
docker compose -f infra/compose/docker-compose.yml up -d   # postgres, redis, minio
pnpm --filter api prisma migrate dev
pnpm dev                        # web on :3000, api on :4000
```

## Documentation

Design is documented under [docs/](docs/):

1. [PRD.md](docs/PRD.md) — product requirements
2. [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture
3. [DATABASE.md](docs/DATABASE.md) — PostgreSQL schema
4. [BACKEND.md](docs/BACKEND.md) — NestJS module structure
5. [FRONTEND.md](docs/FRONTEND.md) — Next.js folder/route structure
6. [API.md](docs/API.md) — REST API design
7. [UPLOAD-PIPELINE.md](docs/UPLOAD-PIPELINE.md) — SVG upload & moderation pipeline
8. [SEARCH.md](docs/SEARCH.md) — search architecture
9. [SECURITY.md](docs/SECURITY.md) — security model
10. [DEPLOYMENT.md](docs/DEPLOYMENT.md) — deployment architecture
11. [ROADMAP.md](docs/ROADMAP.md) — MVP / Phase 2 / Phase 3 + dev order
12. [RISKS.md](docs/RISKS.md) — risks and challenges

See [CLAUDE.md](CLAUDE.md) for contributor/AI working agreements.

## License

TBD.
