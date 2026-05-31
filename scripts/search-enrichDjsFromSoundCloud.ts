/**
 * Search SoundCloud users via the official API and enrich DJs missing profile data.
 *
 * Usage:
 *   npm run search:enrich:dj:soundcloud
 *   npm run search:enrich:dj:soundcloud -- --dry-run
 *   npm run search:enrich:dj:soundcloud -- --limit 20
 *   npm run search:enrich:dj:soundcloud -- --name "saschka"
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SOUNDCLOUD_ACCESS_TOKEN (.env.scripts)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "./lib/loadEnv.ts";
import { formatSoundCloudBioForDj } from "./lib/parseSoundCloudProfile.ts";
import { SoundCloudApiClient } from "./lib/soundCloudApiClient.ts";
import {
  AUTO_UPDATE_MIN_SCORE,
  MANUAL_REVIEW_MIN_SCORE,
  pickBestSoundCloudMatch,
} from "./lib/soundcloudSearchMatch.ts";

loadScriptEnv();

const REQUEST_DELAY_MS = 1_500;

const REVIEW_CSV_PATH = process.env.VERCEL
  ? join(tmpdir(), "dj-soundcloud-search-review.csv")
  : join(process.cwd(), "scripts/output", "dj-soundcloud-search-review.csv");

const MIGRATION_SQL = `-- Optional SoundCloud search enrichment columns for public.djs
alter table public.djs
add column if not exists enrichment_source text,
add column if not exists enrichment_confidence numeric;
`;

type CliOptions = {
  limit: number | null;
  all: boolean;
  dryRun: boolean;
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
};

type DjEnrichmentColumns = {
  enrichment_source: boolean;
  enrichment_confidence: boolean;
};

type ReviewRow = {
  dj_id: string;
  dj_name: string;
  candidate_username: string;
  candidate_name: string;
  candidate_soundcloud_url: string;
  candidate_city: string;
  candidate_country: string;
  confidence_score: number;
  reason: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: null,
    all: false,
    dryRun: false,
    nameFilter: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--limit") {
      const next = argv[i + 1];
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--limit requires a positive number");
      }
      options.limit = parsed;
      i += 1;
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

function needsEnrichment(dj: DjRow): boolean {
  return (
    isBlank(dj.soundcloud_url) || isBlank(dj.image_url) || isBlank(dj.bio)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  };

  if (!columns.enrichment_source || !columns.enrichment_confidence) {
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

  if (!options.all) {
    rows = rows.filter(needsEnrichment);
  }

  if (options.limit != null) {
    rows = rows.slice(0, options.limit);
  }

  return rows;
}

function buildUpdatePayload(
  dj: DjRow,
  match: ReturnType<typeof pickBestSoundCloudMatch>,
  columns: DjEnrichmentColumns
): Record<string, unknown> {
  if (!match) {
    return {};
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (isBlank(dj.soundcloud_url)) {
    payload.soundcloud_url = match.candidate.profileUrl;
  }

  if (isBlank(dj.image_url) && match.candidate.avatarUrl) {
    payload.image_url = match.candidate.avatarUrl;
  }

  if (isBlank(dj.bio)) {
    const bio = formatSoundCloudBioForDj(match.candidate.description);
    if (bio) {
      payload.bio = bio;
    }
  }

  if (isBlank(dj.city) && match.candidate.city) {
    payload.city = match.candidate.city;
  }

  if (isBlank(dj.country) && match.candidate.country) {
    payload.country = match.candidate.country;
  }

  if (columns.enrichment_source) {
    payload.enrichment_source = "soundcloud";
  }

  if (columns.enrichment_confidence) {
    payload.enrichment_confidence = match.score;
  }

  return payload;
}

function hasWritableChanges(payload: Record<string, unknown>): boolean {
  return Object.keys(payload).some((key) => key !== "updated_at");
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeReviewCsv(rows: ReviewRow[]) {
  if (rows.length === 0) {
    return;
  }

  mkdirSync(dirname(REVIEW_CSV_PATH), { recursive: true });

  const header = [
    "dj_id",
    "dj_name",
    "candidate_username",
    "candidate_name",
    "candidate_soundcloud_url",
    "candidate_city",
    "candidate_country",
    "confidence_score",
    "reason",
  ];

  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.dj_id,
        row.dj_name,
        row.candidate_username,
        row.candidate_name,
        row.candidate_soundcloud_url,
        row.candidate_city,
        row.candidate_country,
        row.confidence_score,
        row.reason,
      ]
        .map(escapeCsv)
        .join(",")
    ),
  ];

  writeFileSync(REVIEW_CSV_PATH, `${lines.join("\n")}\n`, "utf8");
  console.log(`\nManual review CSV written: ${REVIEW_CSV_PATH}`);
}

function printActionLine(params: {
  action: string;
  djName: string;
  candidateUsername: string;
  profileUrl: string;
  score: number;
  reason: string;
  hasAvatar: boolean;
  hasBio: boolean;
  location: string;
}) {
  console.log(
    [
      `\n[${params.action}] ${params.djName}`,
      `  → SoundCloud: @${params.candidateUsername}`,
      `  → URL: ${params.profileUrl}`,
      `  → Score: ${params.score} (${params.reason})`,
      `  → Avatar: ${params.hasAvatar ? "yes" : "no"}`,
      `  → Bio: ${params.hasBio ? "yes" : "no"}`,
      `  → Location: ${params.location || "(none)"}`,
    ].join("\n")
  );
}

async function main(argv: string[] = process.argv.slice(2)) {
  const options = parseArgs(argv);

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = requireEnv("SOUNDCLOUD_ACCESS_TOKEN");

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const soundcloud = new SoundCloudApiClient(accessToken);
  const columns = await detectEnrichmentColumns(supabase);
  const djs = await fetchDjs(supabase, options);

  const summary = {
    scanned: djs.length,
    updated: 0,
    manualReview: 0,
    skippedComplete: 0,
    skippedNoMatch: 0,
    skippedLowConfidence: 0,
    errors: 0,
  };

  const reviewRows: ReviewRow[] = [];

  console.log(
    `SoundCloud DJ search enrichment${options.dryRun ? " (dry run)" : ""} — ${djs.length} DJ(s) to process`
  );

  for (let index = 0; index < djs.length; index += 1) {
    const dj = djs[index]!;

    if (!options.all && !needsEnrichment(dj)) {
      summary.skippedComplete += 1;
      continue;
    }

    try {
      const candidates = await soundcloud.searchUsers(dj.name, 10);
      const match = pickBestSoundCloudMatch(dj.name, candidates);

      if (!match) {
        summary.skippedNoMatch += 1;
        console.log(`[skip] ${dj.name} — no SoundCloud candidates`);
        continue;
      }

      const location = [match.candidate.city, match.candidate.country]
        .filter(Boolean)
        .join(", ");
      const hasBio = Boolean(formatSoundCloudBioForDj(match.candidate.description));

      if (match.score >= AUTO_UPDATE_MIN_SCORE) {
        const payload = buildUpdatePayload(dj, match, columns);

        if (!hasWritableChanges(payload)) {
          summary.skippedComplete += 1;
          console.log(`[skip] ${dj.name} — nothing missing to fill`);
          continue;
        }

        if (options.dryRun) {
          printActionLine({
            action: "update",
            djName: dj.name,
            candidateUsername: match.candidate.username,
            profileUrl: match.candidate.profileUrl,
            score: match.score,
            reason: match.reason,
            hasAvatar: Boolean(match.candidate.avatarUrl),
            hasBio,
            location,
          });
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
          console.log(
            `[update] ${dj.name} → @${match.candidate.username} (score ${match.score}, ${match.reason})`
          );
        }
      } else if (match.score >= MANUAL_REVIEW_MIN_SCORE) {
        summary.manualReview += 1;
        reviewRows.push({
          dj_id: dj.id,
          dj_name: dj.name,
          candidate_username: match.candidate.username,
          candidate_name: match.candidate.fullName ?? match.candidate.username,
          candidate_soundcloud_url: match.candidate.profileUrl,
          candidate_city: match.candidate.city ?? "",
          candidate_country: match.candidate.country ?? "",
          confidence_score: match.score,
          reason: match.reason,
        });

        printActionLine({
          action: options.dryRun ? "manual review" : "review",
          djName: dj.name,
          candidateUsername: match.candidate.username,
          profileUrl: match.candidate.profileUrl,
          score: match.score,
          reason: match.reason,
          hasAvatar: Boolean(match.candidate.avatarUrl),
          hasBio,
          location,
        });
      } else {
        summary.skippedLowConfidence += 1;
        console.log(
          `[skip] ${dj.name} — low confidence (${match.score}) for @${match.candidate.username}`
        );
      }
    } catch (error) {
      summary.errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[error] ${dj.name}: ${message}`);
    }

    if (index < djs.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  writeReviewCsv(reviewRows);

  console.log("\n--- Summary ---");
  console.log(`Total DJs scanned: ${summary.scanned}`);
  console.log(`Updated: ${summary.updated}`);
  console.log(`Manual review: ${summary.manualReview}`);
  console.log(`Skipped (already complete): ${summary.skippedComplete}`);
  console.log(`Skipped (no match): ${summary.skippedNoMatch}`);
  console.log(`Skipped (low confidence): ${summary.skippedLowConfidence}`);
  console.log(`Errors: ${summary.errors}`);

  if (options.dryRun) {
    console.log("\nDry run complete — no database writes performed.");
  }
}

export async function runSearchEnrichDjsFromSoundCloud(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  await main(argv);
}
