import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadDjProfileEvidence } from "./djEvidence.ts";
import {
  nameMatchTier,
  type CandidateDecision,
  type DjProfileCandidate,
  type ScoredDjCandidate,
} from "./djCandidateScore.ts";
import {
  OPTIONAL_DJ_COLUMNS,
  type DjEnrichmentRow,
} from "./djFieldPlan.ts";
import { loadScriptEnv } from "./loadEnv.ts";
import { matchDjProfiles, type ProfileMatchOutcome } from "./matchDjProfiles.ts";
import {
  fetchSoundCloudProfile,
  formatSoundCloudBioForDj,
} from "./parseSoundCloudProfile.ts";
import { canonicalSoundCloudUrl, extractProfileLinks } from "./profileLinks.ts";
import { normalizeCountryName } from "./countryNames.ts";
import {
  RaArtistClient,
  type RaArtistHit,
} from "./raArtistSearch.ts";
import { RequestPacer, ResponseCache } from "./responseCache.ts";
import {
  SoundCloudPublicClient,
  type SoundCloudPublicUser,
} from "./soundcloudPublicClient.ts";

const DEFAULT_COLUMNS = [
  "bio",
  "genres",
  "instagram_url",
  "soundcloud_url",
  "spotify_url",
  "website_url",
  "image_url",
  "city",
  "country",
  "updated_at",
];

const EMPTY_TARGETS = [
  "bio",
  "image_url",
  "country",
  "city",
  "instagram_url",
  "soundcloud_url",
  "website_url",
  "spotify_url",
  "genres",
];

export type CandidateSummary = {
  source: "soundcloud" | "ra";
  name: string;
  url: string;
  username: string | null;
  city: string | null;
  country: string | null;
  followers: number | null;
  score: number;
  reasons: string[];
};

export type DjSearchReportItem = {
  id: string;
  name: string;
  slug: string;
  status: "auto" | "review" | "skipped" | "error";
  soundcloudStatus: string;
  raStatus: string;
  raError: string | null;
  raMerge: string;
  margin: number | null;
  chosen: CandidateSummary | null;
  soundcloudReview: CandidateSummary[];
  raReview: CandidateSummary[];
  updates: Record<string, unknown>;
  skippedNonEmpty: string[];
  warnings: string[];
  error: string | null;
};

export type SearchEnrichReport = {
  dryRun: boolean;
  generatedAt: string;
  summary: {
    scanned: number;
    auto: number;
    review: number;
    skipped: number;
    written: number;
    errors: number;
  };
  missingColumns: string[];
  missingSlugs: string[];
  items: DjSearchReportItem[];
};

export type SearchEnrichDjsOptions = {
  slugs?: string[];
  limit?: number | null;
  onlyEmpty?: boolean;
  /** `djs.is_active = true` */
  active?: boolean;
  /** DJs with at least one `event_djs` row, highest event count first */
  linked?: boolean;
  dryRun?: boolean;
  force?: boolean;
  /** Replace a stored Vienna/Austria default when the accepted profile is elsewhere. */
  fixDefaultLocation?: boolean;
  outputDir?: string | null;
  cacheDir?: string;
  minIntervalMs?: number;
  cacheTtlMs?: number;
  supabase?: SupabaseClient;
};

function isEmptyValue(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === "string") {
    return !value.trim();
  }
  if (Array.isArray(value)) {
    return value.every((item) => typeof item !== "string" || !item.trim());
  }
  return false;
}

function toDj(row: Record<string, unknown>): DjEnrichmentRow {
  const genres = Array.isArray(row.genres)
    ? row.genres.filter((item): item is string => typeof item === "string")
    : [];

  return {
    id: String(row.id ?? ""),
    name: typeof row.name === "string" ? row.name : "",
    slug: typeof row.slug === "string" ? row.slug : "",
    bio: typeof row.bio === "string" ? row.bio : null,
    genres,
    instagram_url: typeof row.instagram_url === "string" ? row.instagram_url : null,
    soundcloud_url:
      typeof row.soundcloud_url === "string" ? row.soundcloud_url : null,
    spotify_url: typeof row.spotify_url === "string" ? row.spotify_url : null,
    website_url: typeof row.website_url === "string" ? row.website_url : null,
    image_url: typeof row.image_url === "string" ? row.image_url : null,
    city: typeof row.city === "string" ? row.city : null,
    country: typeof row.country === "string" ? row.country : null,
    raw: row,
  };
}

function hasEmptyTarget(dj: DjEnrichmentRow): boolean {
  return EMPTY_TARGETS.some((column) => isEmptyValue(dj.raw[column]));
}

function summarize(scored: ScoredDjCandidate): CandidateSummary {
  return {
    source: scored.candidate.source,
    name: scored.candidate.name,
    url: scored.candidate.profileUrl,
    username: scored.candidate.username,
    city: scored.candidate.city,
    country: scored.candidate.country,
    followers: scored.candidate.followers,
    score: scored.score,
    reasons: scored.reasons,
  };
}

function soundcloudCandidate(
  user: SoundCloudPublicUser,
  socials?: {
    bio: string | null;
    city: string | null;
    countryCode: string | null;
    avatarUrl: string | null;
    instagramUrl: string | null;
    websiteUrl: string | null;
    spotifyUrl: string | null;
  } | null
): DjProfileCandidate {
  const descriptionLinks = extractProfileLinks(user.description);
  return {
    source: "soundcloud",
    name: user.fullName || user.username,
    profileUrl: user.profileUrl,
    username: user.username,
    city: socials?.city ?? user.city,
    country: normalizeCountryName(socials?.countryCode ?? user.countryCode),
    followers: user.followers,
    genres: user.genres,
    bio: formatSoundCloudBioForDj(user.description) ?? socials?.bio ?? null,
    avatarUrl: user.avatarUrl ?? socials?.avatarUrl ?? null,
    instagramUrl:
      descriptionLinks.instagramUrls[0] ?? socials?.instagramUrl ?? null,
    soundcloudUrl: user.profileUrl,
    websiteUrl: socials?.websiteUrl ?? null,
    spotifyUrl: socials?.spotifyUrl ?? null,
    facebookUrl: null,
    twitterUrl: null,
    bandcampUrl: null,
    discogsUrl: null,
    playsVienna: false,
    playsAustria: false,
    playsNeighbour: false,
  };
}

function raCandidate(hit: RaArtistHit): DjProfileCandidate {
  return {
    source: "ra",
    name: hit.name,
    profileUrl: hit.profileUrl,
    username: null,
    city: hit.city,
    country: hit.country,
    followers: hit.followers,
    genres: [],
    bio: hit.bio,
    avatarUrl: null,
    instagramUrl: hit.instagram,
    soundcloudUrl: hit.soundcloud,
    websiteUrl: hit.website,
    spotifyUrl: null,
    facebookUrl: hit.facebook,
    twitterUrl: hit.twitter,
    bandcampUrl: hit.bandcamp,
    discogsUrl: hit.discogs,
    playsVienna: hit.playsVienna,
    playsAustria: hit.playsAustria,
    playsNeighbour: hit.playsNeighbour,
  };
}

function tierRank(djName: string, user: SoundCloudPublicUser): number {
  const tier = nameMatchTier(djName, {
    name: user.fullName || user.username,
    username: user.username,
    profileUrl: user.profileUrl,
    soundcloudUrl: user.profileUrl,
  });
  if (tier === "exact") {
    return 0;
  }
  if (tier === "partial") {
    return 1;
  }
  return 2;
}

function itemStatus(
  outcome: ProfileMatchOutcome
): DjSearchReportItem["status"] {
  const hasUpdates = Object.keys(outcome.updates).some((key) => key !== "updated_at");
  if (hasUpdates) {
    return "auto";
  }
  if (
    outcome.soundcloud.status === "review" ||
    outcome.ra.status === "review"
  ) {
    return "review";
  }
  return "skipped";
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Add it to .env.scripts`);
  }
  return value;
}

async function detectColumns(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from("djs").select("*").limit(1);
  if (error) {
    throw new Error(`Failed to inspect djs columns: ${error.message}`);
  }
  const row = data?.[0] as Record<string, unknown> | undefined;
  if (!row) {
    return new Set(DEFAULT_COLUMNS);
  }
  return new Set(Object.keys(row));
}

export function selectDjsForEnrichment(
  djs: DjEnrichmentRow[],
  eventCounts: Map<string, number>,
  options: Pick<SearchEnrichDjsOptions, "active" | "linked" | "onlyEmpty" | "limit">
): DjEnrichmentRow[] {
  let rows = djs;

  if (options.active) {
    rows = rows.filter((dj) => dj.raw.is_active === true);
  }

  if (options.linked) {
    rows = rows
      .filter((dj) => (eventCounts.get(dj.id) ?? 0) > 0)
      .sort((a, b) => {
        const byCount = (eventCounts.get(b.id) ?? 0) - (eventCounts.get(a.id) ?? 0);
        if (byCount !== 0) {
          return byCount;
        }
        return a.name.localeCompare(b.name);
      });
  }

  if (options.onlyEmpty) {
    rows = rows.filter(hasEmptyTarget);
  }
  if (options.limit != null) {
    rows = rows.slice(0, options.limit);
  }

  return rows;
}

async function loadEventCounts(supabase: SupabaseClient): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("event_djs")
      .select("dj_id")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to load event links: ${error.message}`);
    }

    const rows = data ?? [];
    for (const row of rows) {
      const id = typeof row.dj_id === "string" ? row.dj_id : "";
      if (!id) {
        continue;
      }
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    if (rows.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return counts;
}

async function fetchDjs(
  supabase: SupabaseClient,
  options: SearchEnrichDjsOptions
): Promise<{ djs: DjEnrichmentRow[]; missingSlugs: string[] }> {
  let query = supabase.from("djs").select("*").order("name", { ascending: true });
  const slugs = (options.slugs ?? []).map((slug) => slug.trim()).filter(Boolean);

  if (slugs.length === 1) {
    query = query.eq("slug", slugs[0]!);
  } else if (slugs.length > 1) {
    query = query.in("slug", slugs);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch DJs: ${error.message}`);
  }

  const djs = ((data ?? []) as Record<string, unknown>[]).map(toDj);
  const found = new Set(djs.map((dj) => dj.slug));
  const missingSlugs = slugs.filter((slug) => !found.has(slug));
  const eventCounts = options.linked ? await loadEventCounts(supabase) : new Map<string, number>();

  return {
    djs: selectDjsForEnrichment(djs, eventCounts, options),
    missingSlugs,
  };
}

function renderReport(report: SearchEnrichReport): string {
  const lines: string[] = [
    `# DJ search enrichment${report.dryRun ? " (dry run)" : ""}`,
    "",
    `Generated ${report.generatedAt}.`,
    "",
    `Scanned ${report.summary.scanned} · auto ${report.summary.auto} · review ${report.summary.review} · skipped ${report.summary.skipped} · written ${report.summary.written} · errors ${report.summary.errors}`,
    "",
  ];

  if (report.missingColumns.length > 0) {
    lines.push(
      `Columns not on \`public.djs\` (links were not stored): ${report.missingColumns.join(", ")}`,
      ""
    );
  }
  if (report.missingSlugs.length > 0) {
    lines.push(`Slugs not found: ${report.missingSlugs.join(", ")}`, "");
  }

  const proposed = report.items.filter((item) => item.status === "auto");
  const review = report.items.filter(
    (item) => item.soundcloudReview.length > 0 || item.raReview.length > 0
  );
  const errors = report.items.filter((item) => item.status === "error");

  lines.push("## Proposed updates", "");
  if (proposed.length === 0) {
    lines.push("None.", "");
  }
  for (const item of proposed) {
    lines.push(`### ${item.name} (\`${item.slug}\`)`, "");
    if (item.chosen) {
      const place = [item.chosen.city, item.chosen.country].filter(Boolean).join(", ");
      lines.push(
        `- Match: ${item.chosen.name} — ${place || "location unknown"} — ${item.chosen.followers ?? 0} followers — score ${item.chosen.score} (${item.chosen.reasons.join(", ")})`,
        `- URL: ${item.chosen.url}`
      );
    }
    for (const [key, value] of Object.entries(item.updates)) {
      if (key === "updated_at") {
        continue;
      }
      const rendered = Array.isArray(value) ? value.join(", ") : String(value);
      lines.push(`- ${key}: ${rendered}`);
    }
    if (item.skippedNonEmpty.length > 0) {
      lines.push(`- kept existing: ${item.skippedNonEmpty.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Needs review", "");
  if (review.length === 0) {
    lines.push("None.", "");
  }
  for (const item of review) {
    lines.push(`### ${item.name} (\`${item.slug}\`)`, "");
    const groups: Array<[string, CandidateSummary[]]> = [
      ["SoundCloud", item.soundcloudReview],
      ["RA", item.raReview],
    ];
    for (const [label, candidates] of groups) {
      if (candidates.length === 0) {
        continue;
      }
      lines.push(`${label}:`);
      candidates.forEach((candidate, index) => {
        const place = [candidate.city, candidate.country].filter(Boolean).join(", ");
        lines.push(
          `${index + 1}. ${candidate.name} — ${place || "location unknown"} — ${candidate.followers ?? 0} followers — ${candidate.url} — score ${candidate.score} (${candidate.reasons.join(", ")})`
        );
      });
    }
    if (item.raError) {
      lines.push(`RA note: ${item.raError}`);
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push("## Errors", "");
    for (const item of errors) {
      lines.push(`- ${item.name} (\`${item.slug}\`): ${item.error}`);
    }
    lines.push("");
  }

  if (report.dryRun) {
    lines.push("Dry run: no database writes.", "");
  }

  return `${lines.join("\n")}\n`;
}

async function cachedText(
  cache: ResponseCache,
  pacer: RequestPacer,
  url: string
): Promise<string | null> {
  const key = `page:${url}`;
  const cached = await cache.get(key);
  if (cached) {
    return cached;
  }

  await pacer.wait();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html",
      },
    });
    if (!response.ok) {
      return null;
    }
    const text = (await response.text()).slice(0, 400_000);
    await cache.set(key, text);
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Search SoundCloud and RA for DJ profiles and fill empty `djs` fields.
 * Dry-run unless `dryRun` is false. Safe for a later publish hook:
 * pass `slugs` of newly created DJs and `onlyEmpty: true`.
 */
export async function searchEnrichDjs(
  options: SearchEnrichDjsOptions = {}
): Promise<SearchEnrichReport> {
  loadScriptEnv();

  const dryRun = options.dryRun !== false;
  const supabase =
    options.supabase ??
    createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  const cache = new ResponseCache(
    options.cacheDir ?? join(process.cwd(), "scripts/output/cache/dj-search"),
    options.cacheTtlMs ?? 12 * 60 * 60 * 1000
  );
  const pacer = new RequestPacer(options.minIntervalMs ?? 900);
  const soundcloud = new SoundCloudPublicClient({ cache, pacer });
  const ra = new RaArtistClient({ cache, pacer });

  const columns = await detectColumns(supabase);
  const missingColumns = OPTIONAL_DJ_COLUMNS.filter((column) => !columns.has(column));
  const { djs, missingSlugs } = await fetchDjs(supabase, options);

  const items: DjSearchReportItem[] = [];
  const summary = {
    scanned: djs.length,
    auto: 0,
    review: 0,
    skipped: 0,
    written: 0,
    errors: 0,
  };

  for (const dj of djs) {
    const warnings: string[] = [];
    try {
      if (!dj.name.trim()) {
        summary.skipped += 1;
        items.push(emptyItem(dj, "skipped", "DJ has no name"));
        continue;
      }

      const users = await loadSoundCloudUsers(
        soundcloud,
        cache,
        pacer,
        dj.name,
        dj.soundcloud_url,
        warnings
      );
      const raResult = await ra.searchArtists(dj.name, 5);
      if (raResult.error) {
        warnings.push(raResult.error);
      }

      const evidenceResult = await loadDjProfileEvidence(supabase, dj, (url) =>
        cachedText(cache, pacer, url)
      );
      warnings.push(...evidenceResult.warnings);

      const outcome = matchDjProfiles({
        dj,
        soundcloud: users,
        ra: raResult.artists.map(raCandidate),
        evidence: evidenceResult.evidence,
        force: options.force === true,
        fixDefaultLocation: options.fixDefaultLocation === true,
        columns,
      });

      const status = itemStatus(outcome);
      const hasUpdates = Object.keys(outcome.updates).some((key) => key !== "updated_at");

      if (!dryRun && hasUpdates) {
        const { error } = await supabase.from("djs").update(outcome.updates).eq("id", dj.id);
        if (error) {
          throw new Error(error.message);
        }
        summary.written += 1;
      }

      if (status === "auto") {
        summary.auto += 1;
      } else if (status === "review") {
        summary.review += 1;
      } else {
        summary.skipped += 1;
      }

      items.push(toItem(dj, outcome, status, raResult.error, warnings));
      console.log(formatConsoleLine(dj, status, outcome, raResult.error));
    } catch (error) {
      summary.errors += 1;
      const message = error instanceof Error ? error.message : String(error);
      items.push({
        ...emptyItem(dj, "error", message),
        warnings,
      });
      console.error(`[error] ${dj.name}: ${message}`);
    }
  }

  const report: SearchEnrichReport = {
    dryRun,
    generatedAt: new Date().toISOString(),
    summary,
    missingColumns: [...missingColumns],
    missingSlugs,
    items,
  };

  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });
    await writeFile(
      join(options.outputDir, "dj-search-enrich.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      join(options.outputDir, "dj-search-enrich.md"),
      renderReport(report),
      "utf8"
    );
  }

  return report;
}

function emptyItem(
  dj: DjEnrichmentRow,
  status: DjSearchReportItem["status"],
  error: string | null
): DjSearchReportItem {
  return {
    id: dj.id,
    name: dj.name,
    slug: dj.slug,
    status,
    soundcloudStatus: "none",
    raStatus: "none",
    raError: null,
    raMerge: "not_used",
    margin: null,
    chosen: null,
    soundcloudReview: [],
    raReview: [],
    updates: {},
    skippedNonEmpty: [],
    warnings: [],
    error,
  };
}

function reviewOf(decision: CandidateDecision): CandidateSummary[] {
  const pool = decision.status === "review" ? decision.review : [];
  return pool.slice(0, 3).map(summarize);
}

function toItem(
  dj: DjEnrichmentRow,
  outcome: ProfileMatchOutcome,
  status: DjSearchReportItem["status"],
  raError: string | null,
  warnings: string[]
): DjSearchReportItem {
  const chosen = outcome.soundcloud.chosen ?? outcome.ra.chosen;
  return {
    id: dj.id,
    name: dj.name,
    slug: dj.slug,
    status,
    soundcloudStatus: outcome.soundcloud.status,
    raStatus: outcome.ra.status,
    raError,
    raMerge: outcome.raMerge,
    margin: outcome.soundcloud.margin ?? outcome.ra.margin,
    chosen: chosen ? summarize(chosen) : null,
    soundcloudReview: reviewOf(outcome.soundcloud),
    raReview: reviewOf(outcome.ra),
    updates: outcome.updates,
    skippedNonEmpty: outcome.skippedNonEmpty,
    warnings,
    error: null,
  };
}

function formatConsoleLine(
  dj: DjEnrichmentRow,
  status: DjSearchReportItem["status"],
  outcome: ProfileMatchOutcome,
  raError: string | null
): string {
  if (status === "auto") {
    const fields = Object.keys(outcome.updates).filter((key) => key !== "updated_at");
    const who = outcome.soundcloud.chosen?.candidate.profileUrl ?? outcome.ra.chosen?.candidate.profileUrl;
    return `[auto] ${dj.name} → ${who ?? "profile"} (${fields.join(", ")})`;
  }
  if (status === "review") {
    const top = outcome.soundcloud.review[0] ?? outcome.ra.review[0];
    const place = top
      ? [top.candidate.city, top.candidate.country].filter(Boolean).join(", ")
      : "";
    return `[review] ${dj.name} — top: ${top?.candidate.profileUrl ?? "none"}${place ? ` (${place})` : ""}${raError ? ` — ${raError}` : ""}`;
  }
  return `[skip] ${dj.name}${raError ? ` — ${raError}` : ""}`;
}

/** Saved profile URLs are fetched directly. Search is only for DJs with no URL. */
export function soundCloudLookupPlan(
  savedUrl: string | null | undefined
): { mode: "search" } | { mode: "saved"; url: string } | { mode: "invalid" } {
  if (!savedUrl?.trim()) {
    return { mode: "search" };
  }
  const url = canonicalSoundCloudUrl(savedUrl);
  if (!url) {
    return { mode: "invalid" };
  }
  return { mode: "saved", url };
}

async function readSoundCloudSocials(
  cache: ResponseCache,
  pacer: RequestPacer,
  profileUrl: string,
  warnings: string[],
  label: string
): Promise<Awaited<ReturnType<typeof fetchSoundCloudProfile>> | null> {
  const key = `sc-profile:${profileUrl}`;
  try {
    const cached = await cache.get(key);
    if (cached) {
      return JSON.parse(cached) as Awaited<ReturnType<typeof fetchSoundCloudProfile>>;
    }
    await pacer.wait();
    const parsed = await fetchSoundCloudProfile(profileUrl);
    await cache.set(key, JSON.stringify(parsed));
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`SoundCloud profile ${label}: ${message}`);
    return null;
  }
}

async function withSoundCloudDetails(
  client: SoundCloudPublicClient,
  cache: ResponseCache,
  pacer: RequestPacer,
  user: SoundCloudPublicUser,
  warnings: string[]
): Promise<DjProfileCandidate> {
  try {
    user.genres = await client.userGenres(user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`SoundCloud genres for @${user.permalink}: ${message}`);
  }
  const socials = await readSoundCloudSocials(
    cache,
    pacer,
    user.profileUrl,
    warnings,
    `@${user.permalink}`
  );
  return soundcloudCandidate(user, socials);
}

async function loadAnchoredSoundCloudUser(
  client: SoundCloudPublicClient,
  cache: ResponseCache,
  pacer: RequestPacer,
  savedUrl: string,
  warnings: string[]
): Promise<DjProfileCandidate[]> {
  const plan = soundCloudLookupPlan(savedUrl);
  if (plan.mode === "invalid") {
    warnings.push(`Saved SoundCloud URL is not a profile: ${savedUrl}`);
    return [];
  }
  if (plan.mode !== "saved") {
    return [];
  }

  let user: SoundCloudPublicUser | null;
  try {
    user = await client.resolveUser(plan.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`SoundCloud resolve failed for ${plan.url}: ${message}`);
    return [];
  }
  if (!user) {
    warnings.push(`Saved SoundCloud URL did not resolve to a user: ${plan.url}`);
    return [];
  }

  return [await withSoundCloudDetails(client, cache, pacer, user, warnings)];
}

async function loadSoundCloudUsers(
  client: SoundCloudPublicClient,
  cache: ResponseCache,
  pacer: RequestPacer,
  djName: string,
  savedSoundcloudUrl: string | null,
  warnings: string[]
): Promise<DjProfileCandidate[]> {
  const plan = soundCloudLookupPlan(savedSoundcloudUrl);
  if (plan.mode === "saved" || plan.mode === "invalid") {
    return loadAnchoredSoundCloudUser(
      client,
      cache,
      pacer,
      savedSoundcloudUrl ?? "",
      warnings
    );
  }

  let users: SoundCloudPublicUser[];
  try {
    users = await client.searchUsers(djName, 8);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`SoundCloud search failed: ${message}`);
    return [];
  }

  const ranked = [...users].sort(
    (a, b) => tierRank(djName, a) - tierRank(djName, b) || (b.followers ?? 0) - (a.followers ?? 0)
  );
  const interesting = ranked
    .filter((user) => tierRank(djName, user) < 2)
    .slice(0, 8);

  const socialsById = new Map<number, Awaited<ReturnType<typeof fetchSoundCloudProfile>> | null>();
  for (const user of interesting) {
    try {
      user.genres = await client.userGenres(user.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`SoundCloud genres for @${user.permalink}: ${message}`);
    }
  }
  for (const user of interesting.slice(0, 2)) {
    socialsById.set(
      user.id,
      await readSoundCloudSocials(cache, pacer, user.profileUrl, warnings, `@${user.permalink}`)
    );
  }

  return users.map((user) => soundcloudCandidate(user, socialsById.get(user.id) ?? null));
}

export function renderSearchEnrichmentMarkdown(report: SearchEnrichReport): string {
  return renderReport(report);
}
