/**
 * Lineup artist parsing shared by the scraper and admin DJ import.
 */

const COLLABORATION_SPLIT = /\s+(?:b2b|f2f|vs\.?)\s*/i;

/** Normalize whitespace and invisible characters for matching. */
export function normalizeLineupArtistName(name: string): string {
  return name
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lineupDedupeKey(name: string): string {
  return normalizeLineupArtistName(name).toLowerCase();
}

/**
 * Split "Annakonda B2B Stendhal Syndrome" / "AKOV F2F MANTA" into individual artists.
 */
export function splitLineupCollaborations(name: string): string[] {
  const clean = normalizeLineupArtistName(name);
  if (!clean) return [];

  const parts = clean
    .split(COLLABORATION_SPLIT)
    .map((part) => normalizeLineupArtistName(part))
    .filter(Boolean);

  if (parts.length <= 1) return parts.length === 1 ? [clean] : [];

  return parts.flatMap(splitLineupCollaborations);
}

/**
 * Detect venue floor/stage headers in scraped lineups.
 * Multi-floor events often use lines like "[MAINFLOOR]" or
 * "[KITCHEN Hosted By …]" — these are room labels, not DJ names.
 */
export function isLineupFloorLabel(name: string): boolean {
  const clean = normalizeLineupArtistName(name);
  if (!clean) return false;

  // [MAINFLOOR], [GALAXY KITCHEN (Psychedelic, …)], [KITCHEN Hosted By …]
  if (/^\[[^\]]+\]$/.test(clean)) return true;

  // LASTER FLOOR(Detroit Hardtechno Schranz) — floor + genre list, no brackets
  if (/\bfloor\b/i.test(clean) && /\([^)]+\)/.test(clean)) return true;

  // KITCHEN Hosted By Bassbussi / MAINFLOOR hosted by …
  if (/\bhosted\s+by\b/i.test(clean)) return true;

  // Standalone room labels
  if (
    /^(?:main\s?floor|mainfloor|laster\s?floor|luster\s?floor|universe\s?mainfloor|galaxy\s?kitchen|oben|unten|keller|b[uü]hne|stage|floor)$/i.test(
      clean,
    )
  ) {
    return true;
  }

  // KITCHEN by "SORRY MOM" without brackets
  if (/^kitchen\b/i.test(clean) && /\bby\b/i.test(clean)) return true;

  return false;
}

/** Escape `%` / `_` for PostgREST ilike filters. */
export function escapeIlikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Prepare scraped lineup strings for DJ import:
 * drop floors/stages, split B2B/F2F sets, dedupe by normalized name.
 */
export function prepareLineupForDjImport(lineup: string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const raw of lineup) {
    if (isLineupFloorLabel(raw)) continue;

    for (const artist of splitLineupCollaborations(raw)) {
      if (isLineupFloorLabel(artist)) continue;

      const key = lineupDedupeKey(artist);
      if (!key || seen.has(key)) continue;

      seen.add(key);
      names.push(normalizeLineupArtistName(artist));
    }
  }

  return names;
}

/** Lineup names that should become DJ records (excludes floors/stages). */
export function filterLineupForDjImport(lineup: string[]): string[] {
  return prepareLineupForDjImport(lineup);
}

/**
 * When auto-creating a DJ from an event lineup, copy the event genre only if
 * the event has exactly one genre; otherwise leave the DJ's genres empty.
 */
export function genresForNewLineupDj(
  eventGenres: string[] | null | undefined,
): string[] {
  const genres = (eventGenres ?? []).map((g) => g.trim()).filter(Boolean);
  return genres.length === 1 ? [genres[0]!] : [];
}

export function lineupNamesMatch(a: string, b: string): boolean {
  return lineupDedupeKey(a) === lineupDedupeKey(b);
}
