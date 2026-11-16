/**
 * Lineup artist parsing shared by the scraper and admin DJ import.
 */

/**
 * Standalone billed-pair tokens. Whitespace is required on both sides, so a
 * name that merely contains those letters (`VSNS`, `Elvs`) is not a pair.
 * `versus` is listed before `vs` so the longer word is one token, and a
 * trailing dot (`vs.`, `versus.`) belongs to that token.
 */
const VS_TOKEN_SOURCE = String.raw`versus\.?|vs\.?`;

const HARD_SEPARATOR_SOURCE =
  String.raw`b2b|f2f|back[\s-]?to[\s-]?back|${VS_TOKEN_SOURCE}`;

const COLLABORATION_SEPARATOR = new RegExp(
  String.raw`\s+(${HARD_SEPARATOR_SOURCE}|x|&)\s+`,
  "i",
);

const HARD_SEPARATOR = new RegExp(String.raw`^(?:${HARD_SEPARATOR_SOURCE})$`, "i");

const VS_SEPARATOR = new RegExp(String.raw`^(?:${VS_TOKEN_SOURCE})$`, "i");

/**
 * One act whose name contains "&" or "and". Splitting these would invent
 * two DJs. Generic "Alpha & Beta" pairs are not in this set.
 */
const COMPOUND_ARTISTS = new Set([
  "camo & krooked",
  "camo and krooked",
  "chase & status",
  "above & beyond",
  "pola & bryson",
  "joro & joabo",
  "fiio & humming people",
]);

function looksLikeArtistSide(value: string): boolean {
  const clean = value.trim();
  if (clean.length < 2 || clean.length > 60) return false;
  if (!/\p{L}/u.test(clean)) return false;
  return clean.split(/\s+/).length <= 5;
}

function isHardSeparator(separator: string): boolean {
  return HARD_SEPARATOR.test(separator);
}

function isVsSeparator(separator: string): boolean {
  return VS_SEPARATOR.test(separator);
}

/**
 * True when this separator sits inside a known duo (`Camo & Krooked`),
 * so a later `vs` does not break the duo into two stored names.
 */
function separatorCutsKnownDuo(
  value: string,
  start: number,
  end: number,
): boolean {
  const lower = value.toLowerCase();
  for (const artist of COMPOUND_ARTISTS) {
    const at = lower.indexOf(artist);
    if (at < 0) continue;
    const artistEnd = at + artist.length;
    if (start < artistEnd && end > at) return true;
  }
  return false;
}

function separatorIsTwoArtists(separator: string, left: string, right: string): boolean {
  if (/^x$/i.test(separator)) {
    if (
      /\b(?:showcase|night|presents?|pres\.?|tour|edition|open)\b/i.test(
        `${left} ${right}`,
      )
    ) {
      return false;
    }
  }
  return looksLikeArtistSide(left) && looksLikeArtistSide(right);
}

/**
 * True when a line contains a standalone b2b / f2f / vs / versus token.
 * Used to keep a billed pair from being discarded as prose. Event titles
 * are not passed through here.
 */
export function hasHardLineupSeparator(value: string): boolean {
  return new RegExp(String.raw`\b(?:${HARD_SEPARATOR_SOURCE})\b`, "i").test(value);
}

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

type CollaborationSplit = {
  left: string;
  right: string;
  separator: string;
};

function findCollaborationSplit(
  clean: string,
  options?: { skipVs?: boolean },
): CollaborationSplit | null {
  const re = new RegExp(COLLABORATION_SEPARATOR.source, "gi");
  let soft: CollaborationSplit | null = null;

  for (const match of clean.matchAll(re)) {
    if (match.index == null) continue;

    const separator = match[1] ?? "";
    const splitEnd = match.index + match[0].length;
    if (options?.skipVs && isVsSeparator(separator)) continue;
    if (options?.skipVs && separatorCutsKnownDuo(clean, match.index, splitEnd)) {
      continue;
    }

    const left = normalizeLineupArtistName(clean.slice(0, match.index));
    const right = normalizeLineupArtistName(clean.slice(splitEnd));
    if (!left || !right || !separatorIsTwoArtists(separator, left, right)) {
      continue;
    }

    const point = { left, right, separator };
    // b2b / vs / versus win over an earlier `x` or `&` that also qualifies,
    // so a pair is not left glued together behind another separator.
    if (isHardSeparator(separator)) return point;
    if (!soft) soft = point;
  }

  return soft;
}

/**
 * Rewrite a standalone `vs` / `vs.` / `versus` token to `vs`.
 * The token needs whitespace on both sides, so `VSNS`, `Elvs`, and
 * `Foo vs.Bar` stay intact. This does not split the lineup row.
 */
export function normalizeVsLineupEntry(name: string): string {
  const clean = normalizeLineupArtistName(name);
  if (!clean) return "";
  const vsToken = new RegExp(String.raw`\s+(?:${VS_TOKEN_SOURCE})\s+`, "gi");
  return clean.replace(vsToken, " vs ").replace(/\s+/g, " ").trim();
}

/**
 * Lineup rows to store. `vs` / `vs.` / `versus` stay one element, with the
 * token written as `vs`, including chains (`X vs Y vs Z`). `b2b`, `f2f`,
 * `x`, and `&` still split the way they do today. Known duos stay intact.
 * DJ linking uses `splitLineupCollaborations` on the resulting text, so
 * each side of a kept `vs` row is still its own DJ.
 */
export function lineupEntriesForStorage(name: string): string[] {
  const clean = normalizeLineupArtistName(name);
  if (!clean) return [];
  if (COMPOUND_ARTISTS.has(clean.toLowerCase())) {
    return [normalizeVsLineupEntry(clean)];
  }

  const split = findCollaborationSplit(clean, { skipVs: true });
  if (!split) return [normalizeVsLineupEntry(clean)];

  return [
    ...lineupEntriesForStorage(split.left),
    ...lineupEntriesForStorage(split.right),
  ];
}

/**
 * Individual DJ names inside one billed row, left then right.
 * Used when matching and linking DJs, not when writing `events.lineup`.
 * `b2b` / `B2B` / `f2f` / `vs` / `vs.` / `versus` split the same way: the
 * token must have whitespace on both sides, and both sides must look like
 * artist names. A chain (`X b2b Y b2b Z`, `X vs Y vs Z`) yields every
 * member. Spaced `x` and `&` split only in that artist case. A letter
 * inside a word (`Axel`, `VSNS`, `Elvs`, `R&B`) is not a separator, and
 * known duo names stay intact. Event titles are not split here.
 */
export function splitLineupCollaborations(name: string): string[] {
  const clean = normalizeLineupArtistName(name);
  if (!clean) return [];
  if (COMPOUND_ARTISTS.has(clean.toLowerCase())) return [clean];

  const split = findCollaborationSplit(clean);
  if (!split) return [clean];

  return [
    ...splitLineupCollaborations(split.left),
    ...splitLineupCollaborations(split.right),
  ];
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
 * Prepare lineup strings for DJ import and `event_djs` links:
 * drop floors/stages, split b2b / vs / versus sets into one name per DJ,
 * dedupe by normalized name. The stored lineup row can still be `X vs Y`.
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
