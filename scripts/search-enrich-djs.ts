/**
 * Search SoundCloud (primary) and Resident Advisor for DJ profiles.
 *
 * Dry-run is the default: it writes a JSON report and a markdown review, not the database.
 *
 *   npm run search:enrich:djs
 *   npm run search:enrich:djs -- --dry-run --limit 10
 *   npm run search:enrich:djs -- --dry-run --active --linked --limit 20
 *   npm run search:enrich:djs -- --slug stimming --only-empty
 *   npm run search:enrich:djs -- --write --slug stimming
 *   npm run search:enrich:djs -- --write --force --slug stimming
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (.env.scripts).
 * SoundCloud uses the public API v2 client_id from the web app (no login).
 * Optional: SOUNDCLOUD_CLIENT_ID to skip that lookup.
 */

import { join } from "node:path";

import { searchEnrichDjs } from "./lib/searchEnrichDjs.ts";

type CliOptions = {
  help: boolean;
  slugs: string[];
  limit: number | null;
  onlyEmpty: boolean;
  active: boolean;
  linked: boolean;
  dryRun: boolean;
  force: boolean;
  fixDefaultLocation: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    slugs: [],
    limit: null,
    onlyEmpty: false,
    active: false,
    linked: false,
    dryRun: true,
    force: false,
    fixDefaultLocation: false,
  };
  let write = false;
  let sawDryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      sawDryRun = true;
    } else if (arg === "--write" || arg === "--apply") {
      write = true;
    } else if (arg === "--only-empty") {
      options.onlyEmpty = true;
    } else if (arg === "--active") {
      options.active = true;
    } else if (arg === "--linked") {
      options.linked = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--fix-default-location") {
      options.fixDefaultLocation = true;
    } else if (arg === "--limit") {
      const parsed = Number(argv[i + 1]);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive number");
      }
      options.limit = parsed;
      i += 1;
    } else if (arg === "--slug") {
      const slug = argv[i + 1]?.trim();
      if (!slug) {
        throw new Error("--slug requires a value");
      }
      options.slugs.push(slug);
      i += 1;
    } else if (arg?.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  if (write && sawDryRun) {
    throw new Error("Use either --write or --dry-run, not both");
  }
  if (write) {
    options.dryRun = false;
  }

  return options;
}

function printHelp() {
  console.log(`Search SoundCloud and RA, then fill empty DJ fields.

Usage:
  npm run search:enrich:djs
  npm run search:enrich:djs -- --dry-run --limit 10
  npm run search:enrich:djs -- --dry-run --active --linked --limit 20
  npm run search:enrich:djs -- --only-empty --slug some-dj
  npm run search:enrich:djs -- --write --slug some-dj
  npm run search:enrich:djs -- --write --force --slug some-dj

--dry-run     Preview only (default). Writes scripts/output/dj-search-enrich.json and .md
--write       Apply auto-confident matches. Review rows are never written.
--limit N     Process at most N DJs
--active      Only DJs with is_active = true
--linked      Only DJs linked to events, highest event count first
--only-empty  Skip complete DJs. Writes only empty fields, even with --force
--slug        Only this slug. Repeat the flag to pass several.
--force       Overwrite non-empty fields on auto-confident matches
--fix-default-location
              Replace Vienna/Austria only when the accepted profile is elsewhere
`);
}

export async function runSearchEnrichDjs(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return;
  }

  const outputDir = join(process.cwd(), "scripts/output");
  const report = await searchEnrichDjs({
    slugs: options.slugs,
    limit: options.limit,
    onlyEmpty: options.onlyEmpty,
    active: options.active,
    linked: options.linked,
    dryRun: options.dryRun,
    force: options.force,
    fixDefaultLocation: options.fixDefaultLocation,
    outputDir,
  });

  console.log("\n--- Summary ---");
  console.log(`Scanned: ${report.summary.scanned}`);
  console.log(`Auto: ${report.summary.auto}`);
  console.log(`Review: ${report.summary.review}`);
  console.log(`Skipped: ${report.summary.skipped}`);
  console.log(`Written: ${report.summary.written}`);
  console.log(`Errors: ${report.summary.errors}`);
  if (report.missingColumns.length > 0) {
    console.log(`Columns not stored (missing on djs): ${report.missingColumns.join(", ")}`);
  }
  console.log(`Report: ${join(outputDir, "dj-search-enrich.md")}`);
  if (options.dryRun) {
    console.log("Dry run: no database writes.");
  }
}

export { parseArgs };
