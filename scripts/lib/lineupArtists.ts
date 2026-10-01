/**
 * Lineup artist parsing shared by the scraper and admin DJ import.
 */

const COLLABORATION_SPLIT = /\s+(?:b2b|f2f|vs\.?|&)\s*/i;

const DECORATION =
  /[\p{Extended_Pictographic}\p{Cf}\uFE00-\uFE0F\u200D\u2500-\u257F\u25A0-\u25FF\u2190-\u21FF]+/gu;

const UNAMBIGUOUS_FLOOR_PREFIX =
  /^(?:floor\s*\d+|main\s*floor|mainfloor|laster\s*floor|luster\s*floor|galaxy\s*kitchen|universe\s*mainfloor)\b\s*[:|\-–—]?\s*/i;

const LABELED_FLOOR_PREFIX = /^(?:live|kitchen|stage|b[uü]hne)\s*[:|\-–—]\s*/i;

const SEPARATORS = /\s*(?:\/\/|\|)\s*|[,;•·▪]+|\s+\/\s+/;

const NON_ARTIST_LABELS = new Set([
  "tba",
  "tbc",
  "tbd",
  "dj",
  "djs",
  "lineup",
  "line-up",
  "artist",
  "artists",
  "act",
  "acts",
  "with",
  "na",
  "moretba",
]);

const MIN_ARTIST_LENGTH = 2;
const MAX_ARTIST_LENGTH = 80;

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
 * Split "Annakonda B2B Stendhal Syndrome", "AKOV F2F MANTA",
 * "A vs B", and "A & B" into individual artists.
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
  const clean = normalizeLineupArtistName(name)
    .replace(/^[\s\-–—*•·▪►▶]+/, "")
    .replace(/[\s:|/\-–—]+$/g, "")
    .trim();
  if (!clean) return false;

  // [MAINFLOOR], [GALAXY KITCHEN (Psychedelic, …)], [KITCHEN Hosted By …]
  if (/^\[[^\]]+\]$/.test(clean)) return true;

  // LASTER FLOOR(Detroit Hardtechno Schranz) — floor + genre list, no brackets
  if (/\bfloor\b/i.test(clean) && /\([^)]+\)/.test(clean)) return true;

  // KITCHEN Hosted By Bassbussi / MAINFLOOR hosted by …
  if (/\bhosted\s+by\b/i.test(clean)) return true;

  // Standalone room labels, including "Floor 1", "Mainfloor", "Live", "Kitchen"
  if (
    /^(?:main\s?floor|mainfloor|laster\s?floor|luster\s?floor|universe\s?mainfloor|galaxy\s?kitchen|oben|unten|keller|b[uü]hne|stage|floor|floor\s*\d+|live|kitchen)$/i.test(
      clean,
    )
  ) {
    return true;
  }

  // KITCHEN by "SORRY MOM" without brackets
  if (/^kitchen\b/i.test(clean) && /\bby\b/i.test(clean)) return true;

  return false;
}

/** Drop emoji, box-drawing, and other symbols that wrap floor headers or names. */
export function stripLineupDecorations(value: string): string {
  return value.replace(DECORATION, " ");
}

export function normalizeLineupLine(value: string): string {
  return normalizeLineupArtistName(stripLineupDecorations(value));
}

function stripFloorPrefix(line: string): string {
  let current = line;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = current
      .replace(UNAMBIGUOUS_FLOOR_PREFIX, "")
      .replace(LABELED_FLOOR_PREFIX, "")
      .trim();
    if (next === current) break;
    current = next;
  }
  return current;
}

function splitLineupSeparators(value: string): string[] {
  return value
    .split(SEPARATORS)
    .map((part) => normalizeLineupArtistName(part))
    .filter(Boolean);
}

/** Split "MaurerTezibel" but keep "justUS" and "KØ:LAB" intact. */
function splitGluedCamel(value: string): string[] {
  if (!/(?<=\p{Ll}{3,})(?=\p{Lu}\p{Ll}{2,})/u.test(value)) {
    return [value];
  }

  return value
    .split(/(?<=\p{Ll}{3,})(?=\p{Lu})/u)
    .map((part) => normalizeLineupArtistName(part))
    .filter(Boolean);
}

function cleanArtistToken(value: string): string {
  return normalizeLineupArtistName(
    stripLineupDecorations(value)
      .replace(/@[A-Za-z0-9._]+/g, " ")
      .replace(/^\d{1,2}[:.]\d{2}\s*[–—-]\s*\d{1,2}[:.]\d{2}\s*/, "")
      .replace(/^[\s\-–—*•·▪►▶|:;/\\]+/, "")
      .replace(/[\s|:/\\]+$/g, ""),
  );
}

function isNonArtistLabel(name: string): boolean {
  const lowered = name.toLowerCase();
  const compact = lowered.replace(/[.\s]/g, "");
  return NON_ARTIST_LABELS.has(lowered) || NON_ARTIST_LABELS.has(compact);
}

function isAcceptableArtist(name: string): boolean {
  if (!name) return false;
  if (name.length < MIN_ARTIST_LENGTH || name.length > MAX_ARTIST_LENGTH) {
    return false;
  }
  if (!/\p{L}/u.test(name)) return false;
  if (isLineupFloorLabel(name) || isNonArtistLabel(name)) return false;
  if (/^https?:\/\//i.test(name)) return false;
  if (/^\d+$/.test(name)) return false;
  return true;
}

function preferArtistCasing(current: string, incoming: string): string {
  const caps = (value: string) => (value.match(/\p{Lu}/gu) ?? []).length;
  return caps(incoming) > caps(current) ? incoming : current;
}

/**
 * One plain DJ name per element.
 * Strips floor/stage headers, // | bullets and emoji, splits b2b / f2f / vs / &,
 * then trims, dedupes, and keeps the first-seen order.
 */
export function parseLineupNames(input: string): string[] {
  const text = input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#038;/g, "&");

  const indexByKey = new Map<string, number>();
  const names: string[] = [];

  const add = (name: string) => {
    const key = name.toLowerCase();
    const existing = indexByKey.get(key);
    if (existing == null) {
      indexByKey.set(key, names.length);
      names.push(name);
      return;
    }
    names[existing] = preferArtistCasing(names[existing] ?? name, name);
  };

  for (const rawLine of text.split(/\r?\n/)) {
    let line = normalizeLineupLine(rawLine).replace(/@[A-Za-z0-9._]+/g, " ");
    line = normalizeLineupArtistName(line).replace(
      /^\d{1,2}[:.]\d{2}\s*[–—-]\s*\d{1,2}[:.]\d{2}\s*/,
      "",
    );
    if (!line || isNonArtistLabel(line) || isLineupFloorLabel(line)) continue;

    for (const piece of splitLineupSeparators(line)) {
      const stripped = stripFloorPrefix(piece);
      if (!stripped || isLineupFloorLabel(stripped) || isNonArtistLabel(stripped)) {
        continue;
      }

      for (const glued of splitGluedCamel(stripped)) {
        for (const artist of splitLineupCollaborations(glued)) {
          const cleaned = cleanArtistToken(stripFloorPrefix(artist));
          if (isAcceptableArtist(cleaned)) add(cleaned);
        }
      }
    }
  }

  return names;
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
  return parseLineupNames(lineup.filter((name) => name?.trim()).join("\n"));
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
