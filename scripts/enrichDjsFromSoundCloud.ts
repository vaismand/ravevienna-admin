/**
 * Search SoundCloud public people results (Playwright) and enrich DJs missing profile data.
 *
 * First run: npx playwright install chromium
 *
 * Usage:
 *   npm run enrich:djs:soundcloud
 *   npm run enrich:djs:soundcloud -- --dry-run --limit=5
 *   npm run enrich:djs:soundcloud -- --name="ESTI D" --dry-run
 *   npm run enrich:djs:soundcloud -- --force --limit 10
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.scripts)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "./lib/loadEnv.ts";
import { formatSoundCloudBioForDj } from "./lib/parseSoundCloudProfile.ts";
import {
  AUTO_UPDATE_MIN_SCORE,
  MANUAL_REVIEW_MIN_SCORE,
  pickBestSoundCloudSearchCandidate,
} from "./lib/soundcloudPlaywrightMatch.ts";
import {
  countryLabelFromCode,
  randomDelayMs,
  sleep,
  SoundCloudPlaywrightScraper,
  splitLocationToCityCountry,
  type EnrichedSoundCloudProfile,
} from "./lib/soundcloudPlaywrightScraper.ts";

loadScriptEnv();

const MIGRATION_SQL = `-- Optional SoundCloud search enrichment columns for public.djs
alter table public.djs
add column if not exists enrichment_source text,
add column if not exists enrichment_confidence numeric,
add column if not exists enriched_at timestamptz;
`;

type CliOptions = {
  limit: number | null;
  dryRun: boolean;
  force: boolean;
  nameFilter: string | null;
};

type DjRow = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  soundcloud_url: string | null;
  image_url: string | null;
  city: string | null;
  country: string | null;
  enrichment_source?: string | null;
  enrichment_confidence?: number | null;
  enriched_at?: string | null;
};

type DjEnrichmentColumns = {
  enrichment_source: boolean;
  enrichment_confidence: boolean;
  enriched_at: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: null,
    dryRun: false,
    force: false,
    nameFilter: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive number");
      }
      options.limit = parsed;
    } else if (arg === "--limit") {
      const next = argv[i + 1];
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive number");
      }
      options.limit = parsed;
      i += 1;
    } else if (arg.startsWith("--name=")) {
      const value = arg.slice("--name=".length).trim();
      if (!value) {
        throw new Error("--name requires a value");
      }
      options.nameFilter = value;
    } else if (arg === "--name") {
      const next = argv[i + 1]?.trim();
      if (!next) {
        throw new Error("--name requires a value");
      }
      options.nameFilter = next;
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return options;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env.scripts`);
  }
  return value;
}

function isBlank(value: string | null | undefined): boolean {
  return !value?.trim();
}

function isLocationMissing(dj: DjRow): boolean {
  return isBlank(dj.city) && isBlank(dj.country);
}

function needsEnrichment(dj: DjRow): boolean {
  return (
    isBlank(dj.soundcloud_url) ||
    isBlank(dj.image_url) ||
    isBlank(dj.bio) ||
    isLocationMissing(dj)
  );
}

async function detectEnrichmentColumns(
  supabase: SupabaseClient
): Promise<DjEnrichmentColumns> {
  const { data, error } = await supabase.from("djs").select("*").limit(1);

  if (error) {
    throw new Error(`Failed to inspect djs columns: ${error.message}`);
  }

  const row = (data?.[0] ?? {}) as Record<string, unknown>;
  const columns: DjEnrichmentColumns = {
    enrichment_source: Object.prototype.hasOwnProperty.call(
      row,
      "enrichment_source"
    ),
    enrichment_confidence: Object.prototype.hasOwnProperty.call(
      row,
      "enrichment_confidence"
    ),
    enriched_at: Object.prototype.hasOwnProperty.call(row, "enriched_at"),
  };

  if (
    !columns.enrichment_source ||
    !columns.enrichment_confidence ||
    !columns.enriched_at
  ) {
    console.log(
      "\nOptional enrichment columns missing on public.djs. Run this SQL in Supabase:\n"
    );
    console.log(MIGRATION_SQL);
  }

  return columns;
}

async function fetchDjs(
  supabase: SupabaseClient,
  options: CliOptions
): Promise<DjRow[]> {
  let query = supabase.from("djs").select("*").order("name", { ascending: true });

  if (options.nameFilter) {
    query = query.ilike("name", options.nameFilter);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch DJs: ${error.message}`);
  }

  let rows = (data ?? []) as DjRow[];
  rows = rows.filter(needsEnrichment);

  if (options.limit != null) {
    rows = rows.slice(0, options.limit);
  }

  return rows;
}

function canSetField(
  current: string | null | undefined,
  force: boolean
): boolean {
  return force || isBlank(current);
}

function buildUpdatePayload(
  dj: DjRow,
  profile: EnrichedSoundCloudProfile,
  score: number,
  columns: DjEnrichmentColumns,
  force: boolean
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (canSetField(dj.soundcloud_url, force) && profile.profileUrl) {
    payload.soundcloud_url = profile.profileUrl;
  }

  if (canSetField(dj.image_url, force) && profile.avatarUrl) {
    payload.image_url = profile.avatarUrl;
  }

  if (canSetField(dj.bio, force)) {
    const bio = formatSoundCloudBioForDj(profile.bio ?? null);
    if (bio) {
      payload.bio = bio;
    }
  }

  const locationFromProfile =
    profile.location ??
    [profile.city, countryLabelFromCode(profile.countryCode)]
      .filter(Boolean)
      .join(", ");

  if (isLocationMissing(dj) || force) {
    const { city, country } = splitLocationToCityCountry(locationFromProfile);
    const resolvedCountry = country ?? countryLabelFromCode(profile.countryCode);

    if (canSetField(dj.city, force) && city) {
      payload.city = city;
    }
    if (canSetField(dj.country, force) && resolvedCountry) {
      payload.country = resolvedCountry;
    }
  }

  if (columns.enrichment_source) {
    payload.enrichment_source = "soundcloud";
  }
  if (columns.enrichment_confidence) {
    payload.enrichment_confidence = score;
  }
  if (columns.enriched_at) {
    payload.enriched_at = new Date().toISOString();
  }

  return payload;
}

function hasWritableChanges(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).some(
    (key) => key !== "updated_at" && key !== "enriched_at"
  );
}

function printCandidateSummary(
  djName: string,
  action: string,
  username: string,
  profileUrl: string,
  score: number,
  reason: string
): void {
  console.log(
    [
      `\n[${action}] ${djName}`,
      `  → @${username}`,
      `  → ${profileUrl}`,
      `  → Score: ${score} (${reason})`,
    ].join("\n")
  );
}

async function main(argv: string[] = process.argv.slice(2)) {
  const options = parseArgs(argv);

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const columns = await detectEnrichmentColumns(supabase);
  const djs = await fetchDjs(supabase, options);
  const scraper = new SoundCloudPlaywrightScraper();

  const summary = {
    checked: djs.length,
    updated: 0,
    needsReview: 0,
    skipped: 0,
    failed: 0,
  };

  console.log(
    `SoundCloud people search enrichment${options.dryRun ? " (dry run)" : ""} — ${djs.length} DJ(s)`
  );

  try {
    await scraper.launch();

    for (let index = 0; index < djs.length; index += 1) {
      const dj = djs[index]!;

      try {
        console.log(`\n--- ${dj.name} ---`);

        const candidates = await scraper.searchPeople(dj.name);
        if (candidates.length === 0) {
          summary.skipped += 1;
          console.log("[skip] No search candidates found");
          continue;
        }

        const match = pickBestSoundCloudSearchCandidate(dj.name, candidates);
        if (!match) {
          summary.skipped += 1;
          console.log("[skip] Could not score candidates");
          continue;
        }

        console.log(
          `Best candidate: @${match.candidate.username} (score ${match.score}, ${match.reason})`
        );

        if (match.score < MANUAL_REVIEW_MIN_SCORE) {
          summary.skipped += 1;
          console.log(
            `[skip] Low confidence (${match.score}) for @${match.candidate.username}`
          );
          continue;
        }

        if (match.score < AUTO_UPDATE_MIN_SCORE) {
          summary.needsReview += 1;
          printCandidateSummary(
            dj.name,
            "needs manual review",
            match.candidate.username,
            match.candidate.profileUrl,
            match.score,
            match.reason
          );
          continue;
        }

        const profile = await scraper.enrichProfile(match.candidate.profileUrl);
        const payload = buildUpdatePayload(
          dj,
          profile,
          match.score,
          columns,
          options.force
        );

        if (!hasWritableChanges(payload)) {
          summary.skipped += 1;
          console.log("[skip] No missing fields to update");
          continue;
        }

        printCandidateSummary(
          dj.name,
          options.dryRun ? "would update" : "update",
          match.candidate.username,
          profile.profileUrl,
          match.score,
          match.reason
        );

        if (options.dryRun) {
          console.log("  Fields:", Object.keys(payload).filter((k) => k !== "updated_at").join(", "));
          summary.updated += 1;
        } else {
          const { error } = await supabase
            .from("djs")
            .update(payload)
            .eq("id", dj.id);

          if (error) {
            throw new Error(error.message);
          }

          summary.updated += 1;
          console.log(`[updated] ${dj.name}`);
        }
      } catch (error) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[failed] ${dj.name}: ${message}`);
      }

      if (index < djs.length - 1) {
        const delay = randomDelayMs();
        console.log(`Waiting ${delay}ms…`);
        await sleep(delay);
      }
    }
  } finally {
    await scraper.close();
  }

  console.log("\n--- Summary ---");
  console.log(`Checked: ${summary.checked}`);
  console.log(`Updated: ${summary.updated}`);
  console.log(`Needs review: ${summary.needsReview}`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`Failed: ${summary.failed}`);

  if (options.dryRun) {
    console.log("\nDry run complete — no database writes performed.");
  }
}

export async function runEnrichDjsFromSoundCloud(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  await main(argv);
}
