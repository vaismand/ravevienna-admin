# RaveVienna Admin

Web admin panel for reviewing scraped event data before it goes live in the RaveVienna mobile app.

## What it does

- Sign in with Supabase Auth (admin role only via `profiles.role`)
- Two review queues: **Scraped drafts** (`draft_events`) and **User submissions** (`event_submissions`)
- Browse each by status: **Pending**, **Approved**, **Rejected**, **Published** (upcoming), **Passed** (past published events by date)
- Filter by venue, genre, source, and search
- Edit draft fields (title, venue, date, genres, URLs, etc.)
- **Add events manually** (not only from the scraper)
- Approve, reject, or publish to the public `events` table
- Bulk approve / reject / delete / publish

Publishing copies approved drafts into `events` (matched on `source_id` + `external_id`) and marks the draft as published.

## Tech stack

- [Vite](https://vitejs.dev/)
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Supabase](https://supabase.com/) client (anon key only — no service role in the frontend)
- Plain CSS modules (no UI framework)

## Setup

```bash
cp .env.example .env.local
```

Set in `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Create an admin user in Supabase Auth and set `profiles.role = 'admin'` for that user.

Row Level Security policies for admin access are in `supabase/admin-rls.sql` — run that in the Supabase SQL Editor if reads or writes fail.

## Deploying on Vercel

The admin UI and script buttons share one deployment. Add these in **Vercel → Project → Settings → Environment Variables** (Production and Preview):

| Variable | Required for | Notes |
|----------|--------------|-------|
| `VITE_SUPABASE_URL` | Admin UI | Browser-safe |
| `VITE_SUPABASE_ANON_KEY` | Admin UI | Browser-safe |
| `SUPABASE_URL` | Script buttons | Same project URL as above; **no** `VITE_` prefix |
| `SUPABASE_SERVICE_ROLE_KEY` | Script buttons | Server-only secret; never prefix with `VITE_` |
| `SPOTIFY_CLIENT_ID` | Spotify enrichment | Server-only |
| `SPOTIFY_CLIENT_SECRET` | Spotify enrichment | Server-only |

After adding or changing server env vars, **redeploy** the project.

Script buttons call Vercel serverless functions (`/api/scripts/run`). The venue scraper can take several minutes — on **Pro**, functions are configured for up to **300s**. Hobby plan timeouts are much shorter and may kill long scrapes early.

For local development, keep secrets in `.env.scripts` instead (see below).

## Scripts

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
npm run preview  # preview production build
```

### Server-side CLI (admin tools)

These use the **service role key** — keep them in `.env.scripts` locally (see `.env.scripts.example`). On Vercel, set the same values as project env vars (see **Deploying on Vercel** above). Never put the service role in `VITE_*` vars.

```bash
cp .env.scripts.example .env.scripts   # then fill in keys

npm run scrape                        # scrape venue sites → draft_events
npm run scrape:restore-drafts         # fix draft status after bad scrape run
npm run scrape:publish-approved       # publish approved drafts to events
npm run enrich:djs -- --dry-run       # Spotify enrichment (bulk)
npm run enrich:dj:ra -- --url "…" --name "…" --dry-run   # RA enrichment (single DJ)
```

See [docs/enrich-dj-ra.md](docs/enrich-dj-ra.md) for RA enrichment details.

## Database tables used

- `draft_events` — scraped and manual drafts for review
- `event_submissions` — events submitted by app users
- `events` — published events for the app
- `venues`, `event_sources` — reference data
- `profiles` — admin role check
