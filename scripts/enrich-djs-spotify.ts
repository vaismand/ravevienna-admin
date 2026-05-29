/**
 * Local/admin script: enrich DJs from Spotify (Client Credentials).
 * Requires SUPABASE_SERVICE_ROLE_KEY — never use in the mobile app.
 *
 * Usage:
 *   npm run enrich:djs
 *   npm run enrich:djs -- --limit 20
 *   npm run enrich:djs -- --dry-run
 *   npm run enrich:djs -- --name "Mefjus"
 *   npm run enrich:djs -- --all --overwrite-images
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  AUTO_UPDATE_MIN_SCORE,
  MANUAL_REVIEW_MIN_SCORE,
  pickBestSpotifyMatch,
  type SpotifyArtistCandidate,
} from "./lib/djSpotifyMatch.ts";
import { loadScriptEnv } from "./lib/loadEnv.ts";
import { normalizeSpotifyGenres } from "./lib/normalizeSpotifyGenres.ts";

loadScriptEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const REVIEW_CSV_PATH = process.env.VERCEL
  ? join(tmpdir(), "dj-enrichment-review.csv")
  : join(__dirname, "output", "dj-enrichment-review.csv");

const MIGRATION_SQL = `-- Optional Spotify enrichment columns for public.djs
alter table public.djs
add column if not exists spotify_id text,
add column if not exists spotify_popularity integer,
add column if not exists followers integer;

create index if not exists idx_djs_spotify_id on public.djs(spotify_id);
`;

type CliOptions = {
  limit: number | null;
  all: boolean;
  dryRun: boolean;
  nameFilter: string | null;
  overwriteImages: boolean;
  overwriteSpotify: boolean;
};

type DjRow = {
  id: string;
  name: string;
  slug: string;
  genres: string[] | null;
  spotify_url: string | null;
  image_url: string | null;
  spotify_id?: string | null;
  spotify_popularity?: number | null;
  followers?: number | null;
};

type DjEnrichmentColumns = {
  spotify_id: boolean;
  spotify_popularity: boolean;
  followers: boolean;
};

type ReviewRow = {
  dj_id: string;
  dj_name: string;
  candidate_name: string;
  candidate_spotify_url: string;
  candidate_genres: string;
  candidate_popularity: number;
  confidence_score: number;
  reason: string;
};

type SpotifyTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type SpotifySearchResponse = {
  artists?: {
    items?: SpotifyApiArtist[];
  };
};

type SpotifyApiArtist = {
  id: string;
  name: string;
  genres?: string[];
  popularity?: number;
  followers?: { total?: number };
  external_urls?: { spotify?: string };
  images?: { url: string; height: number | null; width: number | null }[];
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    limit: null,
    all: false,
    dryRun: false,
    nameFilter: null,
    overwriteImages: false,
    overwriteSpotify: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--overwrite-images") {
      options.overwriteImages = true;
    } else if (arg === "--overwrite-spotify") {
      options.overwriteSpotify = true;
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
    }
  }

  return options;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isBlank(value: string | null | undefined): boolean {
  return !value?.trim();
}

function isGenresEmpty(genres: string[] | null | undefined): boolean {
  return !genres || genres.length === 0 || genres.every((g) => !g.trim());
}

function needsEnrichment(row: DjRow): boolean {
  return (
    isBlank(row.spotify_url) || isBlank(row.image_url) || isGenresEmpty(row.genres)
  );
}

function pickBestImageUrl(
  images: SpotifyApiArtist["images"] | undefined
): string | null {
  if (!images?.length) {
    return null;
  }

  const sorted = [...images].sort((a, b) => {
    const areaA = (a.height ?? 0) * (a.width ?? 0);
    const areaB = (b.height ?? 0) * (b.width ?? 0);
    return areaB - areaA;
  });

  return sorted[0]?.url?.trim() || null;
}

function mapSpotifyArtist(artist: SpotifyApiArtist): SpotifyArtistCandidate {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres ?? [],
    popularity: artist.popularity ?? 0,
    followers: artist.followers?.total ?? null,
    spotifyUrl: artist.external_urls?.spotify?.trim() ?? "",
    imageUrl: pickBestImageUrl(artist.images),
  };
}

class SpotifyClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.token;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
    });

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Spotify token error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as SpotifyTokenResponse;
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.token;
  }

  async searchArtists(query: string, limit = 5): Promise<SpotifyArtistCandidate[]> {
    const token = await this.getToken();
    const url = new URL("https://api.spotify.com/v1/search");
    url.searchParams.set("type", "artist");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Spotify search error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as SpotifySearchResponse;
    return (data.artists?.items ?? []).map(mapSpotifyArtist);
  }
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
    spotify_id: Object.prototype.hasOwnProperty.call(row, "spotify_id"),
    spotify_popularity: Object.prototype.hasOwnProperty.call(
      row,
      "spotify_popularity"
    ),
    followers: Object.prototype.hasOwnProperty.call(row, "followers"),
  };

  if (!columns.spotify_id || !columns.spotify_popularity || !columns.followers) {
    console.log("\nOptional columns missing on public.djs. Run this SQL in Supabase:\n");
    console.log(MIGRATION_SQL);
  }

  return columns;
}

async function fetchDjs(
  supabase: SupabaseClient,
  options: CliOptions
): Promise<DjRow[]> {
  let query = supabase
    .from("djs")
    .select("*")
    .eq("is_active", true)
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
  row: DjRow,
  match: SpotifyArtistCandidate,
  normalizedGenres: string[],
  columns: DjEnrichmentColumns,
  options: CliOptions
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  const canSetSpotifyUrl =
    options.overwriteSpotify || isBlank(row.spotify_url);
  if (canSetSpotifyUrl && match.spotifyUrl) {
    payload.spotify_url = match.spotifyUrl;
  }

  const canSetImage =
    options.overwriteImages || isBlank(row.image_url);
  if (canSetImage && match.imageUrl) {
    payload.image_url = match.imageUrl;
  }

  const currentGenres = row.genres ?? [];
  const currentKeys = new Set(currentGenres.map((g) => g.trim().toLowerCase()));
  const hasNewGenres = normalizedGenres.some(
    (g) => !currentKeys.has(g.trim().toLowerCase())
  );

  if ((isGenresEmpty(currentGenres) || hasNewGenres) && normalizedGenres.length > 0) {
    payload.genres = normalizedGenres;
  }

  if (columns.spotify_id && (options.overwriteSpotify || isBlank(row.spotify_id))) {
    payload.spotify_id = match.id;
  }

  if (
    columns.spotify_popularity &&
    (row.spotify_popularity == null || options.overwriteSpotify)
  ) {
    payload.spotify_popularity = match.popularity;
  }

  if (columns.followers && (row.followers == null || options.overwriteSpotify)) {
    payload.followers = match.followers;
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
    "candidate_name",
    "candidate_spotify_url",
    "candidate_genres",
    "candidate_popularity",
    "confidence_score",
    "reason",
  ];

  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        row.dj_id,
        row.dj_name,
        row.candidate_name,
        row.candidate_spotify_url,
        row.candidate_genres,
        row.candidate_popularity,
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

function printDryRunLine(params: {
  djName: string;
  matchedName: string;
  spotifyUrl: string;
  imageFound: boolean;
  spotifyGenres: string[];
  appGenres: string[];
  popularity: number;
  score: number;
  action: string;
}) {
  console.log(
    [
      `\n[${params.action}] ${params.djName}`,
      `  → Spotify: ${params.matchedName}`,
      `  → URL: ${params.spotifyUrl || "(none)"}`,
      `  → Image: ${params.imageFound ? "yes" : "no"}`,
      `  → Spotify genres: ${params.spotifyGenres.join(", ") || "(none)"}`,
      `  → App genres: ${params.appGenres.join(", ") || "(unchanged)"}`,
      `  → Popularity: ${params.popularity}`,
      `  → Confidence: ${params.score}`,
    ].join("\n")
  );
}

async function main(argv: string[] = process.argv.slice(2)) {
  const options = parseArgs(argv);

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const spotifyClientId = requireEnv("SPOTIFY_CLIENT_ID");
  const spotifyClientSecret = requireEnv("SPOTIFY_CLIENT_SECRET");

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const spotify = new SpotifyClient(spotifyClientId, spotifyClientSecret);
  const columns = await detectEnrichmentColumns(supabase);

  const djs = await fetchDjs(supabase, options);

  const summary = {
    scanned: djs.length,
    updated: 0,
    skippedComplete: 0,
    skippedNoMatch: 0,
    skippedLowConfidence: 0,
    manualReview: 0,
    errors: 0,
  };

  const reviewRows: ReviewRow[] = [];

  console.log(
    `DJ Spotify enrichment${options.dryRun ? " (dry run)" : ""} — ${djs.length} DJ(s) to process`
  );

  for (const dj of djs) {
    if (!options.all && !needsEnrichment(dj)) {
      summary.skippedComplete += 1;
      continue;
    }

    try {
      const candidates = await spotify.searchArtists(dj.name, 5);
      const match = pickBestSpotifyMatch(dj.name, candidates);

      if (!match) {
        summary.skippedNoMatch += 1;
        if (options.dryRun) {
          printDryRunLine({
            djName: dj.name,
            matchedName: "(no candidates)",
            spotifyUrl: "",
            imageFound: false,
            spotifyGenres: [],
            appGenres: dj.genres ?? [],
            popularity: 0,
            score: 0,
            action: "skip",
          });
        } else {
          console.log(`[skip] ${dj.name} — no Spotify candidates`);
        }
        continue;
      }

      const normalizedGenres = normalizeSpotifyGenres(
        match.artist.genres,
        dj.genres ?? []
      );

      if (match.score >= AUTO_UPDATE_MIN_SCORE) {
        const payload = buildUpdatePayload(
          dj,
          match.artist,
          normalizedGenres,
          columns,
          options
        );

        if (!hasWritableChanges(payload)) {
          summary.skippedComplete += 1;
          continue;
        }

        if (options.dryRun) {
          printDryRunLine({
            djName: dj.name,
            matchedName: match.artist.name,
            spotifyUrl: match.artist.spotifyUrl,
            imageFound: Boolean(match.artist.imageUrl),
            spotifyGenres: match.artist.genres,
            appGenres: normalizedGenres,
            popularity: match.artist.popularity,
            score: match.score,
            action: "update",
          });
          summary.updated += 1;
          continue;
        }

        const { error } = await supabase
          .from("djs")
          .update(payload)
          .eq("id", dj.id);

        if (error) {
          throw new Error(error.message);
        }

        summary.updated += 1;
        console.log(
          `[update] ${dj.name} → ${match.artist.name} (score ${match.score}, ${match.reason})`
        );
        continue;
      }

      if (match.score >= MANUAL_REVIEW_MIN_SCORE) {
        summary.manualReview += 1;
        reviewRows.push({
          dj_id: dj.id,
          dj_name: dj.name,
          candidate_name: match.artist.name,
          candidate_spotify_url: match.artist.spotifyUrl,
          candidate_genres: match.artist.genres.join("; "),
          candidate_popularity: match.artist.popularity,
          confidence_score: match.score,
          reason: match.reason,
        });

        if (options.dryRun) {
          printDryRunLine({
            djName: dj.name,
            matchedName: match.artist.name,
            spotifyUrl: match.artist.spotifyUrl,
            imageFound: Boolean(match.artist.imageUrl),
            spotifyGenres: match.artist.genres,
            appGenres: normalizedGenres,
            popularity: match.artist.popularity,
            score: match.score,
            action: "manual review",
          });
        } else {
          console.log(
            `[manual review] ${dj.name} → ${match.artist.name} (score ${match.score}, ${match.reason})`
          );
        }
        continue;
      }

      summary.skippedLowConfidence += 1;
      if (options.dryRun) {
        printDryRunLine({
          djName: dj.name,
          matchedName: match.artist.name,
          spotifyUrl: match.artist.spotifyUrl,
          imageFound: Boolean(match.artist.imageUrl),
          spotifyGenres: match.artist.genres,
          appGenres: normalizedGenres,
          popularity: match.artist.popularity,
          score: match.score,
          action: "skip (low confidence)",
        });
      } else {
        console.log(
          `[skip] ${dj.name} — low confidence (${match.score}) for "${match.artist.name}"`
        );
      }
    } catch (error) {
      summary.errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[error] ${dj.name}: ${message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  writeReviewCsv(reviewRows);

  console.log("\n--- Summary ---");
  console.log(`Total DJs scanned: ${summary.scanned}`);
  console.log(`Updated: ${summary.updated}`);
  console.log(`Skipped (already complete): ${summary.skippedComplete}`);
  console.log(`Skipped (no match): ${summary.skippedNoMatch}`);
  console.log(`Skipped (low confidence): ${summary.skippedLowConfidence}`);
  console.log(`Manual review: ${summary.manualReview}`);
  console.log(`Errors: ${summary.errors}`);

  if (options.dryRun) {
    console.log("\nDry run complete — no database writes performed.");
  }
}

export async function runEnrichDjsSpotify(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  await main(argv);
}

const isDirectRun =
  typeof process.argv[1] === "string" &&
  fileURLToPath(import.meta.url) === fileURLToPath(process.argv[1]);

if (isDirectRun) {
  runEnrichDjsSpotify().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
