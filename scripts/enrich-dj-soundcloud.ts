/**
 * Enrich DJs from SoundCloud profile URLs already stored on public.djs.soundcloud_url.
 *
 * Usage:
 *   npm run enrich:dj:soundcloud
 *   npm run enrich:dj:soundcloud -- --dry-run
 *   npm run enrich:dj:soundcloud -- --limit 10
 *   npm run enrich:dj:soundcloud -- --name "saschka"
 *   npm run enrich:dj:soundcloud -- --all --overwrite-images --overwrite-bio
 *   npm run enrich:dj:soundcloud -- --inactive-only
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.scripts)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "./lib/loadEnv.ts";
import {
  fetchSoundCloudProfile,
  normalizeSoundCloudProfileUrl,
  type ParsedSoundCloudProfile,
} from "./lib/parseSoundCloudProfile.ts";

loadScriptEnv();

const REQUEST_DELAY_MS = 1_500;

type CliOptions = {
  limit: number | null;
  all: boolean;
  dryRun: boolean;
  inactiveOnly: boolean;
  nameFilter: string | null;
  overwriteImages: boolean;
  overwriteBio: boolean;
  overwriteSocials: boolean;
};

type DjRow = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  instagram_url: string | null;
  spotify_url: string | null;
  website_url: string | null;
  soundcloud_url: string | null;
  image_url: string | null;
  city: string | null;
  country: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: null,
    all: false,
    dryRun: false,
    inactiveOnly: false,
    nameFilter: null,
    overwriteImages: false,
    overwriteBio: false,
    overwriteSocials: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--inactive-only") {
      options.inactiveOnly = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--overwrite-images") {
      options.overwriteImages = true;
    } else if (arg === "--overwrite-bio") {
      options.overwriteBio = true;
    } else if (arg === "--overwrite-socials") {
      options.overwriteSocials = true;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function needsEnrichment(dj: DjRow): boolean {
  return (
    isBlank(dj.image_url) ||
    isBlank(dj.bio) ||
    isBlank(dj.instagram_url) ||
    isBlank(dj.spotify_url) ||
    isBlank(dj.website_url)
  );
}

async function fetchDjs(
  supabase: SupabaseClient,
  options: CliOptions
): Promise<DjRow[]> {
  let query = supabase
    .from("djs")
    .select("*")
    .eq("is_active", options.inactiveOnly ? false : true)
    .not("soundcloud_url", "is", null)
    .neq("soundcloud_url", "")
    .order("name", { ascending: true });

  if (options.nameFilter) {
    query = query.ilike("name", options.nameFilter);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch DJs: ${error.message}`);
  }

  let rows = (data ?? []) as DjRow[];

  if (!options.all && !options.nameFilter) {
    rows = rows.filter(needsEnrichment);
  }

  if (options.limit != null) {
    rows = rows.slice(0, options.limit);
  }

  return rows;
}

function buildUpdatePayload(
  dj: DjRow,
  parsed: ParsedSoundCloudProfile,
  options: CliOptions
): Record<string, string> {
  const payload: Record<string, string> = {
    updated_at: new Date().toISOString(),
  };

  if (
    parsed.avatarUrl &&
    (options.overwriteImages || isBlank(dj.image_url))
  ) {
    payload.image_url = parsed.avatarUrl;
  }

  if (parsed.bio && (options.overwriteBio || isBlank(dj.bio))) {
    payload.bio = parsed.bio.slice(0, 2000);
  }

  if (
    parsed.instagramUrl &&
    (options.overwriteSocials || isBlank(dj.instagram_url))
  ) {
    payload.instagram_url = parsed.instagramUrl;
  }

  if (
    parsed.spotifyUrl &&
    (options.overwriteSocials || isBlank(dj.spotify_url))
  ) {
    payload.spotify_url = parsed.spotifyUrl;
  }

  if (
    parsed.websiteUrl &&
    (options.overwriteSocials || isBlank(dj.website_url))
  ) {
    payload.website_url = parsed.websiteUrl;
  }

  if (parsed.city && isBlank(dj.city)) {
    payload.city = parsed.city;
  }

  if (parsed.countryCode && isBlank(dj.country)) {
    payload.country = parsed.countryCode;
  }

  return payload;
}

function hasWritableChanges(payload: Record<string, string>): boolean {
  return Object.keys(payload).some((key) => key !== "updated_at");
}

function printParsedPreview(dj: DjRow, parsed: ParsedSoundCloudProfile): void {
  console.log(`\n--- ${dj.name} (${dj.soundcloud_url}) ---`);
  console.log(`SC user:     ${parsed.username ?? "(unknown)"}`);
  console.log(`Avatar:      ${parsed.avatarUrl ?? "(not found)"}`);
  console.log(`Bio:         ${parsed.bio ? "yes" : "no"}`);
  if (parsed.bio) {
    const preview =
      parsed.bio.length > 220 ? `${parsed.bio.slice(0, 220)}…` : parsed.bio;
    console.log(`  ${preview}`);
  }
  console.log(`Instagram:   ${parsed.instagramUrl ?? "(not found)"}`);
  console.log(`Spotify:     ${parsed.spotifyUrl ?? "(not found)"}`);
  console.log(`Website:     ${parsed.websiteUrl ?? "(not found)"}`);
  console.log(`City:        ${parsed.city ?? "(not found)"}`);
  console.log(`Country:     ${parsed.countryCode ?? "(not found)"}`);
}

function printDryRunUpdates(
  dj: DjRow,
  payload: Record<string, string>
): void {
  const fields = Object.keys(payload).filter((key) => key !== "updated_at");
  if (fields.length === 0) {
    console.log(`[dry-run] ${dj.name} — nothing to update`);
    return;
  }

  console.log(`[dry-run] ${dj.name} — would update:`);
  for (const field of fields) {
    const value = payload[field];
    const preview =
      value.length > 120 ? `${value.slice(0, 120)}…` : value;
    console.log(`  ${field}: ${preview}`);
  }
}

export async function runEnrichDjSoundcloud(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  const options = parseArgs(argv);

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const djs = await fetchDjs(supabase, options);
  const summary = {
    scanned: djs.length,
    updated: 0,
    skippedNoChanges: 0,
    errors: 0,
  };

  const audience = options.inactiveOnly ? "inactive" : "active";
  console.log(
    `DJ SoundCloud enrichment (${audience})${options.dryRun ? " (dry run)" : ""} — ${djs.length} DJ(s) to process`
  );

  for (let index = 0; index < djs.length; index += 1) {
    const dj = djs[index]!;

    try {
      const profileUrl = normalizeSoundCloudProfileUrl(dj.soundcloud_url!);
      const parsed = await fetchSoundCloudProfile(profileUrl);
      printParsedPreview(dj, parsed);

      const payload = buildUpdatePayload(dj, parsed, options);
      if (!hasWritableChanges(payload)) {
        summary.skippedNoChanges += 1;
        console.log(`[skip] ${dj.name} — no empty fields to fill`);
      } else if (options.dryRun) {
        printDryRunUpdates(dj, payload);
        summary.updated += 1;
      } else {
        const { error } = await supabase.from("djs").update(payload).eq("id", dj.id);
        if (error) {
          throw new Error(error.message);
        }

        summary.updated += 1;
        console.log(`[updated] ${dj.name}`);
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

  console.log("\n--- Summary ---");
  console.log(`Scanned:           ${summary.scanned}`);
  console.log(`Updated/dry-run:   ${summary.updated}`);
  console.log(`Skipped (no gaps): ${summary.skippedNoChanges}`);
  console.log(`Errors:            ${summary.errors}`);
}
