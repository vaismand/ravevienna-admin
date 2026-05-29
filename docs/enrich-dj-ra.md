# Manual RA DJ enrichment

Admin-only helper for filling `public.djs` from **one** Resident Advisor profile URL. Not a crawler.

## Setup

1. Copy env template and fill in service role credentials:

   ```bash
   cp .env.scripts.example .env.scripts
   ```

   Required:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

2. Run the SQL migration printed by the script if `ra_*` columns are missing (see `scripts/enrich-dj-ra.ts`).

## Commands

Run from the `ravevienna-admin` repo root:

```bash
# Preview (default: dry-run)
npm run enrich:dj:ra -- --url "https://de.ra.co/dj/esti.d" --name "esti.d" --dry-run

# Match by Supabase id
npm run enrich:dj:ra -- --url "https://de.ra.co/dj/esti.d" --dj-id "<uuid>" --dry-run

# Apply updates
npm run enrich:dj:ra -- --url "https://de.ra.co/dj/esti.d" --name "esti.d" --apply

# If RA blocks server fetch (403/captcha), save page HTML in browser:
npm run enrich:dj:ra -- --url "https://de.ra.co/dj/esti.d" --name "esti.d" \
  --html-file ./esti-d.html --dry-run
```

### Flags

| Flag | Purpose |
|------|---------|
| `--apply` | Write to Supabase (default is dry-run) |
| `--overwrite-socials` | Replace existing Instagram/SoundCloud |
| `--overwrite-image` | Replace `image_url` (with `--allow-ra-image`) |
| `--overwrite-location` | Replace `country` |
| `--allow-ra-image` | Save RA profile image when `image_url` empty |
| `--copy-bio` | Copy RA bio (copyright warning) |
| `--create-if-missing` | Insert new DJ when no match |

## RA bot protection

RA often returns **403** or a captcha page to datacenter IPs. Use `--html-file` with HTML saved from your browser, or run from a residential network.
