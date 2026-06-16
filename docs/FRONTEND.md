# Next.js Folder Structure & Frontend Architecture — TurkistanIcons

The `web` app is the public marketplace **and** the authenticated dashboards
(user / creator / admin). It is built on **Next.js 15 (App Router)**,
**TypeScript** (`strict`), **Tailwind CSS**, **shadcn/ui**, and **TanStack
Query**.

> **Golden rule:** the web app talks **only** to the NestJS API over REST/JSON.
> It never touches Postgres, Redis, Stripe, or R2 control planes directly. Asset
> bytes (SVG/PNG) are fetched by the browser straight from the R2/CDN origin —
> never proxied through the Next.js server and never inlined into app HTML.
> See [SECURITY.md](SECURITY.md) and [UPLOAD-PIPELINE.md](UPLOAD-PIPELINE.md).

This doc covers the folder tree, the App Router route map, the Server vs Client
Component split, state management, data fetching/auth, component architecture,
and styling/SEO conventions.

---

## 1. `apps/web` folder tree

```
apps/web/
├── src/
│   ├── app/                              # App Router (routes only — thin)
│   │   ├── layout.tsx                    # root layout: <html>, fonts, <Providers>
│   │   ├── globals.css                   # Tailwind base + design tokens (CSS vars)
│   │   ├── not-found.tsx                 # global 404
│   │   ├── error.tsx                     # global error boundary (client)
│   │   ├── sitemap.ts                    # dynamic sitemap (public routes)
│   │   ├── robots.ts
│   │   ├── manifest.ts
│   │   │
│   │   ├── (marketing)/                  # public, marketing/content pages
│   │   │   ├── layout.tsx                # marketing chrome (header/footer)
│   │   │   ├── page.tsx                  # /                (homepage)
│   │   │   ├── pricing/page.tsx          # /pricing
│   │   │   └── blog/
│   │   │       ├── page.tsx              # /blog
│   │   │       └── [slug]/page.tsx       # /blog/[slug]
│   │   │
│   │   ├── (shop)/                       # public, catalog/discovery pages
│   │   │   ├── layout.tsx                # shop chrome (header w/ search, footer)
│   │   │   ├── categories/page.tsx       # /categories
│   │   │   ├── category/[slug]/
│   │   │   │   ├── page.tsx              # /category/[slug]
│   │   │   │   ├── loading.tsx
│   │   │   │   └── error.tsx
│   │   │   ├── icon/[slug]/
│   │   │   │   ├── page.tsx              # /icon/[slug]   (detail, SEO-critical)
│   │   │   │   ├── opengraph-image.tsx   # dynamic OG image
│   │   │   │   └── loading.tsx
│   │   │   ├── creator/[slug]/page.tsx   # /creator/[slug] (public profile)
│   │   │   ├── collections/page.tsx      # /collections
│   │   │   ├── collection/[slug]/page.tsx# /collection/[slug]
│   │   │   └── search/
│   │   │       ├── page.tsx              # /search  (reads URL search params)
│   │   │       └── loading.tsx
│   │   │
│   │   ├── (auth)/                       # unauthenticated auth flows
│   │   │   ├── layout.tsx                # centered, minimal (no app chrome)
│   │   │   ├── login/page.tsx            # /login
│   │   │   ├── register/page.tsx         # /register
│   │   │   └── forgot-password/page.tsx  # /forgot-password
│   │   │
│   │   ├── (app)/                        # authenticated USER area (role >= USER)
│   │   │   ├── layout.tsx                # app chrome + auth gate (server check)
│   │   │   └── account/
│   │   │       ├── page.tsx              # /account            (profile)
│   │   │       ├── favorites/page.tsx    # /account/favorites
│   │   │       ├── collections/page.tsx  # /account/collections
│   │   │       ├── purchases/page.tsx    # /account/purchases
│   │   │       └── downloads/page.tsx    # /account/downloads
│   │   │
│   │   ├── creator/                      # CREATOR dashboard (role >= CREATOR)
│   │   │   ├── layout.tsx                # creator shell (sidebar nav) + role gate
│   │   │   ├── page.tsx                  # /creator           (dashboard home)
│   │   │   ├── upload/page.tsx           # /creator/upload
│   │   │   ├── icons/page.tsx            # /creator/icons
│   │   │   ├── packs/page.tsx            # /creator/packs
│   │   │   ├── analytics/page.tsx        # /creator/analytics
│   │   │   ├── payouts/page.tsx          # /creator/payouts
│   │   │   └── apply/page.tsx            # /creator/apply (role USER -> apply)
│   │   │
│   │   └── admin/                        # ADMIN console (role === ADMIN)
│   │       ├── layout.tsx                # admin shell (sidebar nav) + role gate
│   │       ├── page.tsx                  # /admin (redirect -> /admin/moderation)
│   │       ├── moderation/page.tsx       # /admin/moderation
│   │       ├── users/page.tsx            # /admin/users
│   │       ├── creators/page.tsx         # /admin/creators
│   │       ├── categories/page.tsx       # /admin/categories
│   │       └── analytics/page.tsx        # /admin/analytics
│   │
│   ├── components/
│   │   ├── ui/                           # shadcn/ui primitives (generated)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── select.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── toast.tsx
│   │   │   ├── skeleton.tsx
│   │   │   └── ...                       # do not hand-edit; re-generate
│   │   │
│   │   ├── layout/                       # shared chrome
│   │   │   ├── site-header.tsx
│   │   │   ├── site-footer.tsx
│   │   │   ├── main-nav.tsx
│   │   │   ├── user-menu.tsx             # client (reads auth store)
│   │   │   └── dashboard-sidebar.tsx
│   │   │
│   │   ├── icons/                        # icon-catalog feature components
│   │   │   ├── icon-grid.tsx             # RSC: renders list of icon-card
│   │   │   ├── icon-card.tsx             # mostly server; favorite btn is client
│   │   │   ├── icon-preview.tsx          # safe SVG/PNG render (see §7)
│   │   │   ├── icon-detail.tsx
│   │   │   ├── related-icons.tsx
│   │   │   └── format-badges.tsx
│   │   │
│   │   ├── search/                       # discovery/filter feature components
│   │   │   ├── search-box.tsx            # client: input + debounce -> URL
│   │   │   ├── search-results.tsx        # RSC: reads params, renders grid
│   │   │   ├── filter-bar.tsx            # client: writes filters to URL
│   │   │   ├── active-filters.tsx        # client
│   │   │   └── sort-select.tsx           # client
│   │   │
│   │   ├── favorites/
│   │   │   └── favorite-button.tsx       # client: optimistic toggle
│   │   │
│   │   ├── cart/
│   │   │   ├── cart-sheet.tsx            # client (Zustand cart store)
│   │   │   ├── add-to-cart-button.tsx    # client: optimistic add
│   │   │   └── cart-badge.tsx            # client
│   │   │
│   │   ├── collections/
│   │   │   ├── collection-grid.tsx       # RSC
│   │   │   └── add-to-collection.tsx     # client (dialog + mutation)
│   │   │
│   │   ├── creator/                      # creator-dashboard feature components
│   │   │   ├── upload-form.tsx           # client: rhf + zod + signed PUT
│   │   │   ├── upload-dropzone.tsx       # client
│   │   │   ├── icon-table.tsx            # client (TanStack Query table)
│   │   │   ├── pack-editor.tsx           # client
│   │   │   ├── revenue-chart.tsx         # client (recharts)
│   │   │   └── payout-status.tsx         # client
│   │   │
│   │   ├── admin/                        # admin-console feature components
│   │   │   ├── moderation-queue.tsx      # client
│   │   │   ├── moderation-card.tsx       # client (approve/reject mutation)
│   │   │   ├── users-table.tsx           # client
│   │   │   └── analytics-dashboard.tsx   # client (charts)
│   │   │
│   │   └── shared/                       # cross-feature presentational helpers
│   │       ├── empty-state.tsx
│   │       ├── error-state.tsx
│   │       ├── page-header.tsx
│   │       ├── pagination.tsx
│   │       └── data-table.tsx            # generic TanStack Table wrapper
│   │
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts                 # browser fetch wrapper (client comps)
│   │   │   ├── server.ts                 # server fetch wrapper (RSC, cookies)
│   │   │   ├── endpoints.ts              # typed endpoint path builders
│   │   │   └── problem.ts                # RFC-7807 error parsing
│   │   ├── query/
│   │   │   ├── keys.ts                   # query-key factory (see §5)
│   │   │   └── get-query-client.ts       # per-request QueryClient (RSC prefetch)
│   │   ├── auth/
│   │   │   ├── session.ts                # server: read session from cookie
│   │   │   └── roles.ts                  # role hierarchy helpers
│   │   ├── tokens.ts                     # design-token TS mirror (optional)
│   │   ├── utils.ts                      # cn() + small helpers
│   │   └── env.ts                        # zod-validated public env
│   │
│   ├── hooks/                            # client hooks (server-state + UI)
│   │   ├── use-icons.ts                  # useQuery wrappers
│   │   ├── use-icon.ts
│   │   ├── use-search.ts
│   │   ├── use-favorite.ts               # mutation + optimistic update
│   │   ├── use-cart.ts                   # selects from Zustand cart store
│   │   ├── use-create-collection.ts
│   │   ├── use-upload.ts
│   │   ├── use-moderation.ts
│   │   ├── use-debounced-value.ts
│   │   └── use-url-filters.ts            # read/write filter state in URL
│   │
│   ├── stores/                           # Zustand client stores (minimal)
│   │   ├── auth-store.ts                 # current user snapshot + role
│   │   ├── cart-store.ts                 # cart line items (persisted)
│   │   └── ui-store.ts                   # transient UI (sheets/modals/theme)
│   │
│   ├── providers/
│   │   ├── index.tsx                     # <Providers> composes all (client)
│   │   ├── query-provider.tsx            # TanStack QueryClientProvider
│   │   ├── auth-provider.tsx             # hydrates auth-store from server
│   │   └── theme-provider.tsx            # next-themes
│   │
│   ├── types/                            # web-only view types (re-export pkg)
│   │   └── index.ts                      # re-exports from @turkistan/types
│   │
│   └── middleware.ts                     # edge middleware: auth + role gating
│
├── public/                              # static, app-owned assets only (logo)
├── components.json                      # shadcn/ui config
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json                        # extends @turkistan/config
└── package.json
```

Conventions (from [CLAUDE.md](../CLAUDE.md)): `kebab-case` files,
`PascalCase` components, absolute imports via `@/…`. Shared DTOs/zod schemas come
from `packages/types` (imported as `@turkistan/types`) so the client and the API
agree on shapes.

---

## 2. Route map (App Router route groups)

Route groups (`(name)`) organize routes and attach distinct layouts **without
affecting the URL**. Five groups:

| Group        | Layout chrome                | Access            | URLs |
|--------------|------------------------------|-------------------|------|
| `(marketing)`| header + footer              | VISITOR+          | `/`, `/pricing`, `/blog`, `/blog/[slug]` |
| `(shop)`     | header w/ search + footer    | VISITOR+          | `/categories`, `/category/[slug]`, `/icon/[slug]`, `/creator/[slug]`, `/collections`, `/collection/[slug]`, `/search` |
| `(auth)`     | minimal centered card        | VISITOR only      | `/login`, `/register`, `/forgot-password` |
| `(app)`      | app chrome + auth gate       | USER+             | `/account`, `/account/favorites`, `/account/collections`, `/account/purchases`, `/account/downloads` |
| `creator/`   | dashboard shell + role gate  | CREATOR+ (apply: USER) | `/creator`, `/creator/upload`, `/creator/icons`, `/creator/packs`, `/creator/analytics`, `/creator/payouts`, `/creator/apply` |
| `admin/`     | admin shell + role gate      | ADMIN             | `/admin`, `/admin/moderation`, `/admin/users`, `/admin/creators`, `/admin/categories`, `/admin/analytics` |

Notes:

- `creator/` and `admin/` are **real path segments** (they appear in the URL), so
  they are plain folders, not route groups. `(marketing)`, `(shop)`, `(auth)`,
  `(app)` are grouping-only and contribute nothing to the URL.
- The public **creator profile** lives at `/creator/[slug]` under `(shop)` —
  distinct from the authenticated `/creator` **dashboard**. Next.js resolves
  `/creator` (dashboard index) and `/creator/[slug]` (public profile) from
  different folders; keep the dashboard folder static-segment-only so there is no
  collision (`/creator/upload` etc. are reserved dashboard routes, never slugs).
- `/admin` redirects to `/admin/moderation`. `/creator` is the dashboard home.
- Each dynamic public route ships `loading.tsx` and, where it fetches,
  `error.tsx` (see §8).

---

## 3. Server Components vs Client Components

**Default to Server Components (RSC).** Add `"use client"` only at the leaf where
interactivity actually starts. Keep the boundary as low in the tree as possible
so data-heavy parents stay on the server and the client bundle stays small.

### Decision rules

A component is a **Server Component** when it:
- Fetches and renders catalog/data (lists, detail pages, profiles, dashboards' read views).
- Needs to read cookies/session on the server (auth gate, personalized SSR).
- Is SEO-relevant and should render fully on the server (public pages).
- Has no event handlers, browser APIs, state, or effects.

A component is a **Client Component** (`"use client"`) when it needs any of:
- Event handlers / form interaction (`onClick`, `onSubmit`, controlled inputs).
- React state/effects, `useRouter`, `useSearchParams`, `usePathname`.
- Browser APIs (drag/drop, clipboard, IntersectionObserver, localStorage).
- TanStack Query hooks, Zustand store access, charts, optimistic UI.

### Concrete classification

| Surface | Kind | Why |
|---|---|---|
| `/`, `/categories`, `/category/[slug]` | **RSC** | data-heavy listings, SEO |
| `/icon/[slug]`, `/creator/[slug]` | **RSC** | detail/profile, SEO, server fetch |
| `/collections`, `/collection/[slug]`, `/blog`, `/blog/[slug]`, `/pricing` | **RSC** | content/listing, SEO |
| `/search` page shell + `search-results` | **RSC** | reads `searchParams`, server-fetches results |
| `search-box`, `filter-bar`, `sort-select` | **client** | typed input, debounce, write URL |
| `icon-grid`, `icon-card` (shell) | **RSC** | renders many items cheaply |
| `favorite-button`, `add-to-cart-button` | **client** | optimistic mutation, store |
| `cart-sheet`, `cart-badge`, `user-menu` | **client** | global store, interactivity |
| `login/register/forgot-password` forms | **client** | rhf + zod, submit |
| `creator/upload-form`, `pack-editor` | **client** | file upload, validation |
| `creator/revenue-chart`, `admin/analytics-dashboard` | **client** | charts (recharts) |
| `admin/moderation-card`, `users-table` | **client** | mutations, tables |
| dashboard read views (account history, creator icon list) | **RSC shell + client island** | server-prefetch then hydrate interactive table |

Pattern for dashboards: the route's `page.tsx` (RSC) **prefetches** data into a
dehydrated TanStack Query cache and renders an interactive client island. This
gives a fast first paint plus live client-side refetch/mutation. See §5.

---

## 4. State management strategy

Four kinds of state, four homes. Do not mix them.

1. **Server state (the canonical truth from the API)** → **TanStack Query**
   (client comps) and **server `fetch` with cache tags** (RSC). This is the
   overwhelming majority of state: icons, categories, collections, purchases,
   moderation queue, analytics, etc. Never copy server data into Zustand.

2. **URL state (shareable, navigable)** → **search params / route params.**
   Search query `q`, filters (`free`/`premium`, `style`, `format`), `sort`, and
   `page` live in the URL, not React state. This makes results linkable,
   back/forward-correct, and SEO-friendly, and lets RSC read them server-side.
   `use-url-filters` reads/writes them via `useRouter` + `useSearchParams`.

3. **Global client state (minimal)** → **Zustand.** Only three stores:
   - `auth-store` — current-user snapshot + role, hydrated once from the server
     (see §6). Used for conditional UI (show "Upload" for CREATOR, etc.). The
     server is still the source of authorization.
   - `cart-store` — cart line items (premium icons/packs), `persist`ed to
     `localStorage`; reconciled with the API at checkout.
   - `ui-store` — transient UI: open sheets/dialogs, command palette, theme
     fallback. Never put server data here.

4. **Form state** → **react-hook-form + zod** with `@hookform/resolvers`. The
   zod schema is shared from `@turkistan/types` so the form validates with the
   exact contract the API enforces. Used for login/register, upload, metadata
   edit, pricing, collection create, creator application.

Why this split: server data already has a great cache (TanStack Query / RSC
cache), URL state is free persistence + sharing, and global client state is kept
tiny to avoid duplicating server truth and the bugs that come with it.

---

## 5. TanStack Query vs RSC fetch

### When to use which

- **RSC `fetch` (server):** initial render of public/SEO pages and dashboard
  shells. Reads cookies for personalized/authenticated data. Cached at the edge
  (ISR) for public pages and tagged for invalidation. This is the default for
  `page.tsx`.
- **TanStack Query (client):** anything interactive after hydration —
  infinite-scroll grids, filterable tables, mutations (favorite, cart, upload,
  moderation), polling (moderation queue, payout status), and optimistic UI.

### Hybrid pattern (prefetch + hydrate)

RSC prefetches with the **same query key** the client hook uses, then dehydrates
so the client mounts already-warm (no fetch waterfall, no spinner flash):

```tsx
// app/(shop)/category/[slug]/page.tsx  (RSC)
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/lib/query/get-query-client";
import { queryKeys } from "@/lib/query/keys";
import { serverApi } from "@/lib/api/server";
import { IconGrid } from "@/components/icons/icon-grid";

export default async function CategoryPage({ params, searchParams }) {
  const { slug } = await params;
  const sp = await searchParams;
  const qc = getQueryClient();

  await qc.prefetchQuery({
    queryKey: queryKeys.icons.list({ category: slug, ...sp }),
    queryFn: () => serverApi.icons.list({ category: slug, ...sp }),
  });

  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <IconGrid filter={{ category: slug, ...sp }} />
    </HydrationBoundary>
  );
}
```

```tsx
// hooks/use-icons.ts  (client)
"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";

export function useIcons(filter: IconListFilter) {
  return useQuery({
    queryKey: queryKeys.icons.list(filter),
    queryFn: () => api.icons.list(filter),
  });
}
```

### Query-key conventions

A single factory in `lib/query/keys.ts` is the only source of keys — keys are
arrays, structured coarse→fine, so partial keys can invalidate whole subtrees:

```ts
export const queryKeys = {
  icons: {
    all: ["icons"] as const,
    lists: () => [...queryKeys.icons.all, "list"] as const,
    list: (filter: IconListFilter) => [...queryKeys.icons.lists(), filter] as const,
    detail: (slug: string) => [...queryKeys.icons.all, "detail", slug] as const,
  },
  categories: { all: ["categories"] as const },
  collections: {
    all: ["collections"] as const,
    detail: (slug: string) => ["collections", "detail", slug] as const,
  },
  favorites: { all: ["favorites"] as const },
  cart: { all: ["cart"] as const },
  account: {
    purchases: ["account", "purchases"] as const,
    downloads: ["account", "downloads"] as const,
  },
  creator: {
    icons: ["creator", "icons"] as const,
    analytics: (range: string) => ["creator", "analytics", range] as const,
    payouts: ["creator", "payouts"] as const,
  },
  admin: {
    moderation: (status: string) => ["admin", "moderation", status] as const,
    users: (filter: UsersFilter) => ["admin", "users", filter] as const,
  },
} as const;
```

### Cache invalidation

- **Mutations** invalidate the narrowest relevant key on success:
  `qc.invalidateQueries({ queryKey: queryKeys.favorites.all })` after favoriting;
  `queryKeys.admin.moderation(...)` after approve/reject.
- **RSC writes** (rare — most writes go through API mutations) use
  `revalidateTag()` / `revalidatePath()` so the next server render refetches.
  Server `fetch` calls pass `{ next: { tags: ["icon:"+slug] } }` so a publish/
  edit can `revalidateTag("icon:"+slug)`.
- Defaults: `staleTime` ~60s for catalog reads, longer for categories
  (semi-static); `retry` only for idempotent GETs.

### Optimistic updates

**Favorite** and **cart** must feel instant. Use the standard
cancel → snapshot → optimistic write → rollback-on-error → settle flow:

```ts
// hooks/use-favorite.ts (client)
useMutation({
  mutationFn: ({ iconId, on }) =>
    on ? api.favorites.add(iconId) : api.favorites.remove(iconId),
  onMutate: async ({ iconId, on }) => {
    await qc.cancelQueries({ queryKey: queryKeys.favorites.all });
    const prev = qc.getQueryData(queryKeys.favorites.all);
    qc.setQueryData(queryKeys.favorites.all, (old) => toggle(old, iconId, on));
    return { prev };
  },
  onError: (_e, _v, ctx) =>
    qc.setQueryData(queryKeys.favorites.all, ctx?.prev),
  onSettled: () =>
    qc.invalidateQueries({ queryKey: queryKeys.favorites.all }),
});
```

The cart store applies the same idea locally (Zustand is instant by nature);
checkout reconciles with the API and surfaces any drift (price/availability).

---

## 6. Data fetching, auth, and middleware

### API client wrappers

Two thin wrappers around `fetch`, both typed against `@turkistan/types`, both
parsing RFC-7807 problem JSON into a normalized `ApiError`:

- `lib/api/client.ts` — **browser** side. Calls the API with
  `credentials: "include"` so the httpOnly cookie rides along; used by TanStack
  Query hooks. On `401`, it triggers a silent refresh once, then bounces to
  `/login` if that fails.
- `lib/api/server.ts` — **server** side (RSC, route handlers, middleware-adjacent
  helpers). Forwards the request cookies to the API via `next/headers`, and sets
  `next: { tags, revalidate }` for caching. Never exposes tokens to the client.

```ts
// lib/api/server.ts
import { cookies } from "next/headers";
export async function serverFetch(path: string, init?: RequestInit & { tags?: string[] }) {
  const cookie = (await cookies()).toString();
  const res = await fetch(`${process.env.API_INTERNAL_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, cookie },
    next: { tags: init?.tags },
  });
  if (!res.ok) throw await parseProblem(res);
  return res.json();
}
```

### Auth token handling (httpOnly cookies)

- The API issues a **short-lived JWT access token** and a **rotating refresh
  token**, both set as **httpOnly, Secure, SameSite=Lax cookies** (set by the
  API on `/auth/login`, `/auth/refresh`, OAuth callback). The browser JS never
  reads tokens — XSS can't exfiltrate them, and we never inline tokens into HTML.
- Refresh tokens are stored/rotated/revocable server-side in Redis (see
  [ARCHITECTURE.md](ARCHITECTURE.md) §4). Logout clears cookies and revokes.
- The client's `auth-store` holds only a **non-sensitive user snapshot** (id,
  name, avatar, role) used for conditional UI. It is hydrated by `auth-provider`
  from a server-rendered value (`session.ts` reads the cookie and calls
  `/auth/me` during SSR). UI gating from this store is convenience only — the
  API enforces real authorization.

### Next.js middleware (protected routes + role gating)

`src/middleware.ts` runs at the edge and is the **first** gate. It checks for the
session cookie and, for role-restricted areas, decodes the role claim
(verifying signature against the API's JWKS / shared secret) for a fast redirect
— it does **not** replace API authorization (defense in depth):

```ts
// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasRole } from "@/lib/auth/roles";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await readSession(req); // verify JWT from cookie

  // unauthenticated -> auth-only areas
  const needsUser = pathname.startsWith("/account");
  const needsCreator = pathname.startsWith("/creator")
    && !isPublicCreatorProfile(pathname) // /creator/[slug] is public
    && pathname !== "/creator/apply";    // apply is USER-accessible
  const needsAdmin = pathname.startsWith("/admin");

  if ((needsUser || needsCreator || needsAdmin) && !session) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (needsCreator && !hasRole(session, "CREATOR")) {
    return NextResponse.redirect(new URL("/creator/apply", req.url));
  }
  if (needsAdmin && !hasRole(session, "ADMIN")) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  // signed-in users shouldn't see auth pages
  if (session && pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/account", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/account/:path*", "/creator/:path*", "/admin/:path*", "/login", "/register"],
};
```

Role hierarchy lives in `lib/auth/roles.ts`:
`VISITOR < USER < CREATOR < ADMIN`; `hasRole(session, min)` does a `>=` check.

---

## 7. Component architecture

### shadcn/ui as the primitive layer

- `components/ui/` holds **generated** shadcn/ui primitives (Button, Input,
  Dialog, Select, Tabs, Toast, Skeleton, DropdownMenu, …). Configure via
  `components.json`. Treat these as owned-but-generated: re-run the generator to
  update; don't fork their internals. Variants via `cva`.
- Everything composes upward from primitives: **primitives** (`ui/`) →
  **shared presentational** (`shared/`) → **feature components**
  (`icons/`, `search/`, `creator/`, `admin/`, …) → **route `page.tsx`**.

### Feature-based folders

Components are grouped by **feature**, not by type. A feature folder owns its
RSC shells and its client islands (e.g. `icons/icon-grid.tsx` RSC +
`favorites/favorite-button.tsx` client). Generic, feature-agnostic pieces live
in `shared/`. Hooks for a feature live in `hooks/`, stores in `stores/`.

### The icon grid / card

- `icon-grid.tsx` (RSC) lays out a responsive CSS grid and maps over icons to
  `icon-card.tsx`. The grid stays on the server so rendering thousands of cards
  doesn't bloat the bundle; client-side infinite scroll is added by wrapping with
  a client loader that uses `useInfiniteQuery` when needed (e.g. `/search`).
- `icon-card.tsx` is mostly server-rendered (preview + name + creator + price
  badge) with a single client island: `favorite-button` (and `add-to-cart` for
  premium). This keeps interactivity surgical.

### Safe SVG preview rendering (security-critical)

Uploaded SVGs are **untrusted** (see [SECURITY.md](SECURITY.md) and
[CLAUDE.md](../CLAUDE.md)). Rules enforced in `icon-preview.tsx`:

- **Never** inline untrusted SVG markup into app HTML (no
  `dangerouslySetInnerHTML`, no `<svg>{raw}</svg>`). Inlining would execute any
  embedded script/handler in the app's origin.
- Render previews as an `<img>` whose `src` points at the **R2/CDN origin**
  (separate from the app origin). A browser loading SVG via `<img src>` runs it
  in image context — scripts don't execute. Prefer the server-generated **PNG**
  preview for grids/cards (smaller, zero SVG risk); reserve the sanitized SVG for
  the detail page where vector fidelity matters.

```tsx
// components/icons/icon-preview.tsx (RSC)
export function IconPreview({ icon, size = "md" }: IconPreviewProps) {
  const src = icon.previewPng ?? icon.svgUrl; // both on the CDN origin
  return (
    <img
      src={src}
      alt={icon.name}
      width={dimensions[size]}
      height={dimensions[size]}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}
```

- A strict **Content-Security-Policy** (set in `next.config.ts` headers / edge)
  backstops this: `img-src` allows the CDN origin; `script-src` excludes it; no
  `unsafe-inline` for scripts. The SVG bytes themselves are sanitized server-side
  in the upload pipeline (DOMPurify/svgo allowlist) before ever reaching R2.

---

## 8. Styling, states, and SEO/caching

### Tailwind + design tokens

- Tailwind is the only styling system; no CSS Modules / styled-components.
- **Design tokens** are CSS variables defined in `globals.css` (HSL channels for
  shadcn theming) and mapped in `tailwind.config.ts`:
  `--background`, `--foreground`, `--primary`, `--muted`, `--accent`,
  `--destructive`, `--radius`, plus a culturally-themed palette (Atlas/Suzani
  accents). Light/dark via `next-themes` and `.dark` variable overrides.
- Compose classes with `cn()` (`clsx` + `tailwind-merge`); component variants via
  `cva`. No magic color/spacing literals — use tokens/scale.

### Loading / error / empty states (every data surface)

- **Loading:** route-level `loading.tsx` renders skeletons (Suspense fallback);
  client queries show `shared/skeleton`/grid skeletons while fetching.
- **Error:** route-level `error.tsx` (client boundary) with retry; query errors
  render `shared/error-state` with a retry that calls `refetch()`.
- **Empty:** `shared/empty-state` for zero-result search, empty favorites/
  collections/purchases, empty moderation queue — with a clear next action.

### Caching for SEO (public pages)

- Public catalog/content pages (`/`, `/categories`, `/category/[slug]`,
  `/icon/[slug]`, `/creator/[slug]`, `/collections`, `/collection/[slug]`,
  `/blog/*`, `/pricing`) are **statically rendered with ISR**: `revalidate`
  windows tuned per page (homepage shorter, blog longer), and **on-demand
  `revalidateTag`** when the API publishes/edits content. This meets the PRD's
  TTFB/SEO targets (icon detail TTFB < 200ms cached; SSR/ISR + structured data).
- `/search` is **dynamic SSR** (depends on `searchParams`) but server-fetches the
  first page so results are crawlable and fast.
- Authenticated areas (`/account/*`, `/creator/*`, `/admin/*`) are
  **never cached / `no-store`** and excluded from indexing (`robots`,
  per-route `metadata.robots = { index: false }`).
- **SEO metadata:** each public route exports `generateMetadata` (title,
  description, canonical, OpenGraph) and emits **JSON-LD** structured data for
  icons (`schema.org` ImageObject/Product) per PRD §5. `sitemap.ts`/`robots.ts`
  are generated; dynamic `opengraph-image.tsx` produces per-icon share images.

---

## 9. Summary of guarantees

- Web app calls **only** the NestJS API; asset bytes come from R2/CDN.
- **RSC by default**, client components only at interactive leaves.
- **Server state** in TanStack Query / RSC fetch; **URL state** for
  search/filters; **minimal Zustand** for auth/cart/ui; **rhf + zod** for forms.
- **httpOnly cookies** for tokens; **edge middleware** for fast route/role gating
  backed by API-side authorization (defense in depth).
- **Untrusted SVGs are never inlined** — served from a separate CDN origin via
  `<img>`, behind a strict CSP, sanitized in the upload pipeline.
- **ISR + on-demand revalidation + JSON-LD** for SEO on public pages; private
  dashboards are uncached and noindex.
