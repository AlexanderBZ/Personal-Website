# Alexander Zwerner (`alexanderzwerner.com`)

Personal site: bio, angel investments, writing archive, and a GitHub-authenticated writing studio. Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind, Vercel Blob, and PostHog.

**Live:** [www.alexanderzwerner.com](https://www.alexanderzwerner.com)

## Quickstart

Requires Node 22+.

```bash
npm install
cp .env.example .env.local   # required for /studio; public routes work without it
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Routes: `/` · `/portfolio` · `/writing` · `/studio` · `/feed.xml` · `/sitemap.xml` · `/robots.txt`.

## Scripts

`npm run dev`, `build`, `start`, `lint` (typecheck + ESLint), `test` (Vitest), `test:watch`.

## Configuration

Copy [`.env.example`](.env.example) to `.env.local` (or `.env.development`):

- **Admin auth (Better Auth + GitHub OAuth, stateless JWE cookies):** Set `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (local dev and Production; omit on Vercel previews), `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `ADMIN_ALLOWED_EMAILS` (comma-separated verified GitHub emails; fails closed if empty). Configure GitHub OAuth callback URLs as `http://localhost:3000/api/auth/callback/github` (dev) and `https://www.alexanderzwerner.com/api/auth/callback/github` (prod).
- **Post storage:** Set `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` (with Vercel OIDC) for a private Vercel Blob store. Without them (or with `USE_LOCAL_BLOB=true`), posts persist locally in [`lib/posts.json`](lib/posts.json) or `LOCAL_BLOB_PATH`.
- **Analytics:** `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` enable PostHog (off on localhost unless `NEXT_PUBLIC_POSTHOG_ENABLE_LOCAL=true`).

## Publishing

Sign in with an allowlisted GitHub account at `/studio`. Write plain text, use `## Heading` for sections, and separate paragraphs with blank lines. Drafts auto-save after 1.5s; edits to published posts stay local until you click **Update** or press `⌘S`. Publishing, updating, or deleting revalidates the affected pages, sitemap, and RSS feed so changes go live without a redeploy.

## Testing & Deployment

`npm run lint && npm test` locally; CI runs both on PRs and `main`. Deployed on Vercel — set env vars and connect a Blob store. Security: Better Auth encrypted JWE cookies, GitHub OAuth with verified-email allowlist enforced at sign-in and per-request, same-origin CSRF checks, and CSP/HSTS/`no-store` admin headers.

## Contact

[alexander@alexanderzwerner.com](mailto:alexander@alexanderzwerner.com) · [LinkedIn](https://www.linkedin.com/in/alexander-zwerner/) · [X](https://x.com/hey_zwerner)

Licensed under the [MIT License](LICENSE).
