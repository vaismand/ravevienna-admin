# TicketSwap links

The mobile app shows a TicketSwap button when `events.ticketswap_url` is a valid http(s) URL. This repo stores that link and can propose one. It does not call a TicketSwap API and it does not read resale prices.

`events.ticketswap_url` and `draft_events.ticketswap_url` already exist. No further SQL is required. An admin lock lives in `draft_events.raw_data.ticketswap_url_manual`, the same pattern as `sold_out_manual`.

## What was tried

TicketSwap's city, location, and search HTML (for example `/city/vienna/1487` and `/location/flex/16408`) answers with HTTP 403 or a JavaScript "Verifying" page (`x-ts-app` / Skipper). A normal browser user agent does not get past that check, so those pages are not a reliable source.

The public sitemap index is open:

- `https://www.ticketswap.com/sitemap.xml`
- `https://www.ticketswap.com/sitemap/event_<n>.xml`

Each event URL already contains the title, city, venue, and date:

```text
https://www.ticketswap.com/club-tickets/paradies-garten-w-paracek-vienna-grelle-forelle-2026-11-14-<id>
```

That is the source the discovery script uses. Web search is unnecessary: the sitemap is the full public list, and the date is in the URL rather than in a snippet.

## Matching

A link is stored only when all of these are true:

- The calendar date in the URL equals `event_date`.
- The slug contains `vienna` or `wien`, and the venue name appears as a whole token sequence after that city token. `Flex` does not match `ronnie-flex` in Amsterdam. `FLUCC` also matches TicketSwap's `fluc` slug.
- The event-name tokens appear in the slug, in order. Text after `w/` or `feat.` is the lineup and is not required. Text after `presents` / `pres.` is the event name. At least one token must be four letters or longer, so a title like `Go` stays in review.
- Exactly one slug matches. Duplicate sitemap ids for that same slug collapse to the newest URL. Two different pages (for example a hall and the whole venue) are left for review.

Sold-out events are printed and processed first. Other upcoming events are included unless you pass `--sold-out-only`.

Anything uncertain is printed as `REVIEW` with the candidate URLs and a `site:ticketswap.com` query. It is not written.

## Manual links

The draft and published-event editor (the published tab opens **Edit event**) has a TicketSwap URL field:

- View: the field, an "Open TicketSwap page" link, and a TicketSwap marker on the card.
- Edit: paste any `ticketswap.<locale>` URL (`ticketswap.com`, `ticketswap.at`, `www.ticketswap.de`, and so on).
- Clear: the Clear button, then Save. Saving or clearing sets `ticketswap_url_manual`, so discovery will not put a link back.

Publishing copies `ticketswap_url` from the draft onto `events`. Saving a draft that already has a live event updates `events.ticketswap_url` immediately, same as sold out.

Discovery never overwrites a non-empty URL. If only one of the draft and the live event has a link, `--write` copies that link to the empty side.

## Run it

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.scripts`. The script never prints those values.

```bash
npm run discover:ticketswap
npm run discover:ticketswap -- --sold-out-only
npm run discover:ticketswap -- --limit 20
npm run discover:ticketswap -- --write
```

The default is a dry run. `--write` updates rows whose `ticketswap_url` is still null. A row an admin locked is skipped.

Requests use a normal browser user agent, wait 1.5 seconds between uncached calls, and cache sitemap XML for 12 hours under `scripts/output/ticketswap-cache/` (gitignored). Re-runs on the same day do not hit TicketSwap again until the cache expires.

```bash
npm test
```

includes the matcher, the manual-lock planner, and the publish copy.
