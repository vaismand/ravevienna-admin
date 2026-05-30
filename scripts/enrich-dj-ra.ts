/**
 * Manual/admin-only: enrich a single DJ from one Resident Advisor artist URL.
 * Does NOT crawl RA. Fetches only the URL you pass.
 *
 * Usage:
 *   npm run enrich:dj:ra -- --url "https://de.ra.co/dj/esti.d" --name "esti.d" --dry-run
 *   npm run enrich:dj:ra -- --url "https://de.ra.co/dj/esti.d" --dj-id "<uuid>" --apply
 *   npm run enrich:dj:ra -- --url "https://de.ra.co/dj/esti.d" --name "esti.d" --html-file ./saved.html --dry-run
 *
 * Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.scripts at repo root)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadScriptEnv } from "./lib/loadEnv.ts";
import {
  isRaBotChallengeHtml,
  normalizeRaDjUrl,
  parseRaDjPage,
  type ParsedRaDj,
} from "./lib/parseRaDjPage.ts";

loadScriptEnv();

const MIGRATION_SQL = `-- RA enrichment columns for public.djs (run in Supabase SQL editor)
alter table public.djs
add column if not exists ra_url text,
add column if not exists ra_slug text,
add column if not exists ra_followers integer,
add column if not exists ra_location text,
add column if not exists ra_enriched_at timestamptz;

create index if not exists idx_djs_ra_slug on public.djs(ra_slug);
`;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 25_000;
const REQUEST_DELAY_MS = 1_500;

type CliOptions = {
  url: string;
  htmlFile: string | null;
  djId: string | null;
  name: string | null;
  dryRun: boolean;
  apply: boolean;
  overwriteSocials: boolean;
  overwriteImage: boolean;
  overwriteLocation: boolean;
  copyBio: boolean;
  allowRaImage: boolean;
  createIfMissing: boolean;
};

type DjRow = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  instagram_url: string | null;
  soundcloud_url: string | null;
  image_url: string | null;
  country: string | null;
  city: string | null;
  ra_url?: string | null;
  ra_slug?: string | null;
  ra_followers?: number | null;
  ra_location?: string | null;
  ra_enriched_at?: string | null;
};

type RaColumns = {
  ra_url: boolean;
  ra_slug: boolean;
  ra_followers: boolean;
  ra_location: boolean;
  ra_enriched_at: boolean;
};

type FieldUpdate = {
  field: string;
  value: string | number;
  reason: string;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    url: "",
    htmlFile: null,
    djId: null,
    name: null,
    dryRun: false,
    apply: false,
    overwriteSocials: false,
    overwriteImage: false,
    overwriteLocation: false,
    copyBio: false,
    allowRaImage: false,
    createIfMissing: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--apply") {
      options.apply = true;
    } else if (arg === "--overwrite-socials") {
      options.overwriteSocials = true;
    } else if (arg === "--overwrite-image") {
      options.overwriteImage = true;
    } else if (arg === "--overwrite-location") {
      options.overwriteLocation = true;
    } else if (arg === "--copy-bio") {
      options.copyBio = true;
    } else if (arg === "--allow-ra-image") {
      options.allowRaImage = true;
    } else if (arg === "--create-if-missing") {
      options.createIfMissing = true;
    } else if (arg === "--url") {
      const next = argv[i + 1]?.trim();
      if (!next) {
        throw new Error("--url requires a value");
      }
      options.url = next;
      i += 1;
    } else if (arg === "--dj-id") {
      const next = argv[i + 1]?.trim();
      if (!next) {
        throw new Error("--dj-id requires a value");
      }
      options.djId = next;
      i += 1;
    } else if (arg === "--name") {
      const next = argv[i + 1]?.trim();
      if (!next) {
        throw new Error("--name requires a value");
      }
      options.name = next;
      i += 1;
    } else if (arg === "--html-file") {
      const next = argv[i + 1]?.trim();
      if (!next) {
        throw new Error("--html-file requires a path");
      }
      options.htmlFile = next;
      i += 1;
    }
  }

  if (!options.url) {
    throw new Error("--url is required (single RA DJ profile URL)");
  }

  if (!options.djId && !options.name && !options.createIfMissing) {
    throw new Error("Provide --dj-id or --name (or --create-if-missing with parsed name)");
  }

  if (options.apply && options.dryRun) {
    throw new Error("Use either --apply or --dry-run, not both");
  }

  if (!options.apply) {
    options.dryRun = true;
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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRaPage(url: string): Promise<string> {
  await sleep(REQUEST_DELAY_MS);

  const normalized = normalizeRaDjUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(normalized, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
      },
      redirect: "follow",
    });

    if (response.status === 403) {
      throw new Error(
        "RA returned 403 Forbidden — bot protection. Save the page in a browser and re-run with --html-file <path>."
      );
    }
    if (response.status === 429) {
      throw new Error("RA returned 429 Too Many Requests — wait before retrying.");
    }
    if (!response.ok) {
      throw new Error(`RA fetch failed (${response.status} ${response.statusText})`);
    }

    const html = await response.text();
    if (isRaBotChallengeHtml(html)) {
      throw new Error(
        "RA returned a bot-check page (no __NEXT_DATA__). Open the URL in a browser, or retry later. This script only fetches one URL and does not bypass captchas."
      );
    }

    return html;
  } finally {
    clearTimeout(timeout);
  }
}

async function detectRaColumns(supabase: SupabaseClient): Promise<RaColumns> {
  const { data, error } = await supabase.from("djs").select("*").limit(1);
  if (error) {
    throw new Error(`Failed to inspect djs columns: ${error.message}`);
  }

  const row = (data?.[0] ?? {}) as Record<string, unknown>;
  const columns: RaColumns = {
    ra_url: Object.prototype.hasOwnProperty.call(row, "ra_url"),
    ra_slug: Object.prototype.hasOwnProperty.call(row, "ra_slug"),
    ra_followers: Object.prototype.hasOwnProperty.call(row, "ra_followers"),
    ra_location: Object.prototype.hasOwnProperty.call(row, "ra_location"),
    ra_enriched_at: Object.prototype.hasOwnProperty.call(row, "ra_enriched_at"),
  };

  if (
    !columns.ra_url ||
    !columns.ra_slug ||
    !columns.ra_followers ||
    !columns.ra_location ||
    !columns.ra_enriched_at
  ) {
    console.log("\nRA columns missing on public.djs. Run this SQL in Supabase:\n");
    console.log(MIGRATION_SQL);
  }

  return columns;
}

async function findDj(
  supabase: SupabaseClient,
  options: CliOptions
): Promise<DjRow | null> {
  if (options.djId) {
    const { data, error } = await supabase
      .from("djs")
      .select("*")
      .eq("id", options.djId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch DJ by id: ${error.message}`);
    }
    return (data as DjRow | null) ?? null;
  }

  if (!options.name) {
    return null;
  }

  const { data, error } = await supabase
    .from("djs")
    .select("*")
    .ilike("name", options.name);

  if (error) {
    throw new Error(`Failed to fetch DJ by name: ${error.message}`);
  }

  const rows = (data ?? []) as DjRow[];
  if (rows.length === 0) {
    return null;
  }
  if (rows.length > 1) {
    console.error(`Multiple DJs match name "${options.name}":`);
    for (const row of rows) {
      console.error(`  - ${row.id}  ${row.name}  (${row.slug})`);
    }
    throw new Error("Multiple matches — re-run with --dj-id <uuid>");
  }
  return rows[0] ?? null;
}

function buildUpdates(
  dj: DjRow | null,
  parsed: ParsedRaDj,
  columns: RaColumns,
  options: CliOptions
): { updates: Record<string, string | number | boolean>; planned: FieldUpdate[] } {
  const updates: Record<string, string | number | boolean> = {};
  const planned: FieldUpdate[] = [];
  const now = new Date().toISOString();

  const set = (field: string, value: string | number, reason: string) => {
    updates[field] = value;
    planned.push({ field, value, reason });
  };

  if (columns.ra_url && parsed.raUrl) {
    set("ra_url", parsed.raUrl, "RA profile URL");
  }
  if (columns.ra_slug && parsed.raSlug) {
    set("ra_slug", parsed.raSlug, "RA slug from URL");
  }
  if (columns.ra_followers && parsed.followers !== null) {
    set("ra_followers", parsed.followers, "RA follower count");
  }
  if (columns.ra_location && parsed.location) {
    set("ra_location", parsed.location, "RA location label");
  }
  if (columns.ra_enriched_at) {
    set("ra_enriched_at", now, "enrichment timestamp");
  }

  if (parsed.instagramUrl) {
    const canWrite =
      !dj || isBlank(dj.instagram_url) || options.overwriteSocials;
    if (canWrite) {
      set(
        "instagram_url",
        parsed.instagramUrl,
        options.overwriteSocials ? "overwrite instagram" : "fill empty instagram"
      );
    }
  }

  if (parsed.soundcloudUrl) {
    const canWrite =
      !dj || isBlank(dj.soundcloud_url) || options.overwriteSocials;
    if (canWrite) {
      set(
        "soundcloud_url",
        parsed.soundcloudUrl,
        options.overwriteSocials ? "overwrite soundcloud" : "fill empty soundcloud"
      );
    }
  }

  if (parsed.country) {
    const canWrite = !dj || isBlank(dj.country) || options.overwriteLocation;
    if (canWrite) {
      set(
        "country",
        parsed.country,
        options.overwriteLocation ? "overwrite country" : "fill empty country"
      );
    }
  }

  if (parsed.imageUrl && options.allowRaImage) {
    const canWrite = !dj || isBlank(dj.image_url) || options.overwriteImage;
    if (canWrite) {
      set(
        "image_url",
        parsed.imageUrl,
        options.overwriteImage ? "overwrite image (RA)" : "fill empty image (RA)"
      );
    }
  }

  if (options.copyBio && parsed.bioPreview) {
    const canWrite = !dj || isBlank(dj.bio);
    if (canWrite) {
      set("bio", parsed.bioPreview.slice(0, 2000), "copy RA bio (--copy-bio)");
    }
  }

  return { updates, planned };
}

function printParsedPreview(parsed: ParsedRaDj, options: CliOptions): void {
  console.log("\n--- Parsed from RA ---");
  console.log(`RA name:        ${parsed.name ?? "(not found)"}`);
  console.log(`RA slug:        ${parsed.raSlug ?? "(not found)"}`);
  console.log(`RA URL:         ${parsed.raUrl ?? "(not found)"}`);
  console.log(`Location:       ${parsed.location ?? "(not found)"}`);
  console.log(`Country:        ${parsed.country ?? "(not inferred)"}`);
  console.log(`Instagram:      ${parsed.instagramUrl ?? "(not found)"}`);
  console.log(`SoundCloud:     ${parsed.soundcloudUrl ?? "(not found)"}`);
  console.log(`Image:          ${parsed.imageUrl ? "yes" : "no"}`);
  if (parsed.imageUrl) {
    console.log(`  URL: ${parsed.imageUrl}`);
  }
  console.log(`Followers:      ${parsed.followers ?? "(not found)"}`);
  console.log(`Bio preview:    ${parsed.bioPreview ? "yes" : "no"}`);
  if (parsed.bioPreview) {
    const preview =
      parsed.bioPreview.length > 280
        ? `${parsed.bioPreview.slice(0, 280)}…`
        : parsed.bioPreview;
    console.log(`  ${preview}`);
  }
  if (parsed.upcomingEventLinks.length > 0) {
    console.log(`Upcoming events: ${parsed.upcomingEventLinks.length} link(s) (not stored)`);
    parsed.upcomingEventLinks.slice(0, 3).forEach((link) => console.log(`  - ${link}`));
  }

  if (parsed.imageUrl && !options.allowRaImage) {
    console.log(
      "\nNote: image URL found but not saved (use --allow-ra-image; RA images may be copyrighted)."
    );
  }
  if (parsed.bioPreview && !options.copyBio) {
    console.log(
      "\nNote: bio text shown for review only (use --copy-bio to write; may be copyrighted)."
    );
  }
  if (options.copyBio) {
    console.warn(
      "\n⚠ --copy-bio: writing RA biography may copy copyrighted text. Prefer manual editing."
    );
  }
}

function printDryRun(dj: DjRow | null, planned: FieldUpdate[], options: CliOptions): void {
  console.log("\n--- Dry run ---");
  if (dj) {
    console.log(`Matched DJ: ${dj.name} (${dj.id})`);
    console.log(`  slug: ${dj.slug}`);
  } else {
    console.log("Matched DJ: (none — would create if --create-if-missing)");
  }

  if (planned.length === 0) {
    console.log("Fields to update: (none)");
    return;
  }

  console.log("Fields to update:");
  for (const item of planned) {
    const display =
      typeof item.value === "string" && item.value.length > 80
        ? `${item.value.slice(0, 80)}…`
        : item.value;
    console.log(`  - ${item.field}: ${display}  (${item.reason})`);
  }

  if (!options.apply) {
    console.log("\nNo database writes (dry run). Pass --apply to save.");
  }
}

async function ensureUniqueSlug(
  supabase: SupabaseClient,
  baseSlug: string
): Promise<string> {
  let candidate = baseSlug;
  let suffix = 2;
  while (true) {
    const { data, error } = await supabase
      .from("djs")
      .select("id")
      .eq("slug", candidate)
      .limit(1);
    if (error) {
      throw new Error(`Slug check failed: ${error.message}`);
    }
    if (!data?.length) {
      return candidate;
    }
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
}

async function createDj(
  supabase: SupabaseClient,
  parsed: ParsedRaDj,
  columns: RaColumns,
  options: CliOptions
): Promise<DjRow> {
  if (!parsed.name?.trim()) {
    throw new Error("Cannot create DJ — RA name not parsed");
  }

  const baseSlug = slugify(parsed.raSlug ?? parsed.name);
  if (!baseSlug) {
    throw new Error("Cannot create DJ — invalid slug");
  }

  const slug = await ensureUniqueSlug(supabase, baseSlug);
  const { updates } = buildUpdates(null, parsed, columns, options);

  const insert: Record<string, unknown> = {
    name: parsed.name.trim(),
    slug,
    bio: updates.bio ?? "",
    genres: [],
    instagram_url: updates.instagram_url ?? null,
    soundcloud_url: updates.soundcloud_url ?? null,
    spotify_url: null,
    website_url: null,
    image_url: updates.image_url ?? null,
    city: "",
    country: updates.country ?? "",
    is_active: true,
    ...updates,
  };

  const { data, error } = await supabase
    .from("djs")
    .insert(insert)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Create DJ failed: ${error.message}`);
  }

  return data as DjRow;
}

async function main(argv: string[] = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const columns = await detectRaColumns(supabase);

  let html: string;
  if (options.htmlFile) {
    const path = join(process.cwd(), options.htmlFile);
    if (!existsSync(path)) {
      throw new Error(`--html-file not found: ${path}`);
    }
    console.log(`Reading local HTML: ${path}`);
    html = readFileSync(path, "utf8");
  } else {
    console.log(`Fetching RA page (single URL, ${REQUEST_DELAY_MS}ms delay)…`);
    html = await fetchRaPage(options.url);
  }
  const parsed = parseRaDjPage(html, options.url);

  printParsedPreview(parsed, options);

  if (!parsed.name && !parsed.raSlug) {
    throw new Error("Could not parse meaningful data from RA page");
  }

  let dj = await findDj(supabase, options);

  if (!dj && options.createIfMissing) {
    if (!options.apply) {
      const { planned } = buildUpdates(null, parsed, columns, options);
      printDryRun(null, planned, options);
      console.log(
        `\nWould create DJ "${parsed.name ?? parsed.raSlug}" with slug "${slugify(parsed.raSlug ?? parsed.name ?? "")}" — pass --apply`
      );
      return;
    }

    dj = await createDj(supabase, parsed, columns, options);
    console.log(`\n[created] ${dj.name} (${dj.id})`);
    return;
  }

  if (!dj) {
    throw new Error(
      `No DJ found${options.name ? ` for name "${options.name}"` : ""}. Use --dj-id or --create-if-missing`
    );
  }

  const { updates, planned } = buildUpdates(dj, parsed, columns, options);

  printDryRun(dj, planned, options);

  if (!options.apply) {
    return;
  }

  if (Object.keys(updates).length === 0) {
    console.log("\nNothing to update.");
    return;
  }

  const { error } = await supabase.from("djs").update(updates).eq("id", dj.id);
  if (error) {
    throw new Error(`Update failed: ${error.message}`);
  }

  console.log(`\n[updated] ${dj.name} (${dj.id}) — ${Object.keys(updates).length} field(s)`);
}

export async function runEnrichDjRa(
  argv: string[] = process.argv.slice(2)
): Promise<void> {
  await main(argv);
}
