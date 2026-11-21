# AGENTS.md

Agent notes for `alexanderzwerner.com`: Next.js 16 App Router, React 19, TypeScript, Vercel Blob posts, PostHog. Human docs: [README.md](README.md).

## Commands (npm, Node 22+)

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server at `http://localhost:3000` |
| `npm run lint` | `tsc --noEmit` + ESLint |
| `npm test` | Vitest (serial; suites mutate/restore `lib/posts.json`) |
| `npm run build` | Production build |
| `npx next typegen` | After adding, renaming, or deleting routes |

Run `npm run lint && npm test` before finishing.

## Where things live

- `app/`: routes and pages; Better Auth handler in `app/api/auth/[...all]/route.ts`, studio posts API in `app/api/studio/posts/route.ts`.
- `components/`: `FreewriteAdmin.tsx` (studio), `PageLayout.tsx` (shell), `PostAside.tsx`, `SectionList.tsx`, `LocalTime.tsx`.
- `lib/`: `posts.ts` (storage), `auth.ts` / `auth-client.ts` (Better Auth sessions/CSRF), `format.ts` (pure helpers), `site.ts` (metadata), `portfolio.ts` (portfolio page data), `posthog-server.ts`.
- `__tests__/`: Vitest suites. `next.config.js`: static CSP (public routes), security headers, `/ingest` proxy. `proxy.ts`: per-request nonce CSP for `/studio`.
- `assets/fonts/`: TTF fonts for `next/og` image routes (Satori can't read WOFF2).

## Rules

- New public pages: use `createPageMetadata()` from `lib/site.ts`.
- Post mutations: revalidate `/`, `/writing`, `/writing/<id>` (and the old id on rename), `/sitemap.xml`, `/feed.xml`.
- Mutating `/api/studio/*` routes keep `verifySameOrigin()` + `isAdminAuthenticated()`, checked before parsing input.
- PostHog stays off on localhost unless `NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL=true`. New env vars go in `.env.example`.

## Boundaries

- ✅ **Always**: run lint + tests; add tests when changing auth or API validation.
- ⚠️ **Ask first**: new dependencies, auth/session changes, `next.config.js` headers.
- 🚫 **Never**: commit secrets or `.env.local`; weaken CSRF, session, or email allowlist checks.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
