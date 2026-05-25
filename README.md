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

## Scripts

```bash
npm install
npm run dev      # local dev server
npm run build    # production build
npm run preview  # preview production build
```

## Database tables used

- `draft_events` — scraped and manual drafts for review
- `event_submissions` — events submitted by app users
- `events` — published events for the app
- `venues`, `event_sources` — reference data
- `profiles` — admin role check
