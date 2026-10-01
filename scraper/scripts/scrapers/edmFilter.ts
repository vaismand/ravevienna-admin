/**
 * Electronic vs non-electronic event filter.
 *
 * Edit the keyword arrays below. Matching is case-insensitive and uses
 * word boundaries, so "pop" does not match "popular" or "Austropop".
 *
 * Decisions:
 * - keep: clear EDM signal and no non-EDM signal → draft stays pending
 * - reject: clear non-EDM signal and no EDM signal → draft is auto-rejected
 * - review: mixed signals, only borderline signals, or no signal → pending,
 *   flagged for a person to check instead of being rejected outright
 */

/** Techno, house, DnB, trance, hardstyle, minimal, electro, breaks, dubstep, and similar. */
export const EDM_KEYWORDS: readonly string[] = [
  "techno",
  "hard techno",
  "schranz",
  "hardgroove",
  "industrial techno",
  "house",
  "tech house",
  "deep house",
  "progressive house",
  "drum and bass",
  "drum & bass",
  "dnb",
  "d&b",
  "jungle",
  "trance",
  "psytrance",
  "psy trance",
  "goa",
  "hardstyle",
  "hard dance",
  "minimal",
  "electro",
  "electronic",
  "ebm",
  "breaks",
  "breakbeat",
  "dubstep",
  "garage",
  "uk garage",
  "bass music",
  "acid",
  "rave",
  "tekno",
  "gabber",
  "hardcore",
  "frenchcore",
  "speedcore",
];

/**
 * 80s/90s/2000s parties, pop, schlager, Austropop, karaoke,
 * hip-hop/RnB, Latin/reggaeton, rock/indie, and known non-EDM bills.
 */
export const NON_EDM_KEYWORDS: readonly string[] = [
  "80s",
  "80's",
  "80er",
  "eighties",
  "1980s",
  "achtziger",
  "90s",
  "90's",
  "90er",
  "nineties",
  "1990s",
  "neunziger",
  "2000s",
  "2000er",
  "noughties",
  "nullerjahre",
  "pop",
  "schlager",
  "austropop",
  "volksmusik",
  "volkstümlich",
  "karaoke",
  "après ski",
  "apres ski",
  "apres-ski",
  "hip-hop",
  "hip hop",
  "hiphop",
  "r&b",
  "rnb",
  "r'n'b",
  "rap",
  "reggaeton",
  "latin",
  "latino",
  "salsa",
  "bachata",
  "cumbia",
  "dembow",
  "rock",
  "indie",
  "metal",
  "punk",
  "grunge",
  "singer-songwriter",
  "concert",
  "tour",
];

/** Ambiguous on their own. They keep a clear reject from being automatic. */
export const BORDERLINE_KEYWORDS: readonly string[] = [
  "disco",
  "funk",
  "ambient",
  "experimental",
  "live",
  "band",
  "dj set",
];

/** Named bills that are not electronic nights. Kept separate so the genre list stays short. */
export const NON_EDM_ARTISTS: readonly string[] = [
  "gregor hägele",
  "gregor haegele",
  "nervy",
  "krs-one",
  "set it off",
  "audio88",
  "yassin",
  "i killed the prom queen",
  "touché amor",
  "touche amor",
  "immortal disfigurement",
  "gutrectomy",
  "don broco",
  "hands like houses",
  "broadside",
  "destroy boys",
  "drowning pool",
  "don west",
  "lance butters",
  "sampagne",
  "yami safdie",
  "neunundneunzig",
];

export type EdmDecision = "keep" | "review" | "reject";

export type EdmClassification = {
  decision: EdmDecision;
  edmMatches: string[];
  nonEdmMatches: string[];
  borderlineMatches: string[];
};

export type EdmFilterInput = {
  title?: string | null;
  description?: string | null;
  genres?: readonly string[] | null;
};

const patternCache = new Map<string, RegExp>();

function keywordPattern(keyword: string): RegExp {
  const cached = patternCache.get(keyword);
  if (cached) return cached;

  const escaped = keyword
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  // Longer words may start a German compound (Schlagerfest, Karaokeabend).
  // Short words keep a boundary so "pop" does not match "popular".
  const end =
    keyword.trim().length >= 7 ? "" : "(?=$|[^\\p{L}\\p{N}])";
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escaped}${end}`,
    "iu",
  );
  patternCache.set(keyword, pattern);
  return pattern;
}

function matchingKeywords(text: string, keywords: readonly string[]): string[] {
  const hits: string[] = [];
  for (const keyword of keywords) {
    if (keywordPattern(keyword).test(text)) hits.push(keyword);
  }
  return hits;
}

export function classifyEdmEvent(input: EdmFilterInput): EdmClassification {
  const text = [input.title, input.description, ...(input.genres ?? [])]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" \n ");

  const edmMatches = matchingKeywords(text, EDM_KEYWORDS);
  const nonEdmMatches = matchingKeywords(text, [
    ...NON_EDM_KEYWORDS,
    ...NON_EDM_ARTISTS,
  ]);
  const borderlineMatches = matchingKeywords(text, BORDERLINE_KEYWORDS);

  let decision: EdmDecision;
  if (edmMatches.length > 0 && nonEdmMatches.length === 0) {
    decision = "keep";
  } else if (
    nonEdmMatches.length > 0 &&
    edmMatches.length === 0 &&
    borderlineMatches.length === 0
  ) {
    decision = "reject";
  } else {
    decision = "review";
  }

  return { decision, edmMatches, nonEdmMatches, borderlineMatches };
}

/** Clear non-EDM is rejected. Borderline stays pending so a person can review it. */
export function draftStatusForEdmDecision(
  decision: EdmDecision,
): "pending" | "rejected" {
  return decision === "reject" ? "rejected" : "pending";
}

export function confidenceForEdmDecision(
  decision: EdmDecision,
  eventDate: string | null,
): number {
  if (decision === "reject") return 0.2;
  if (decision === "review") return 0.45;
  return eventDate ? 0.8 : 0.35;
}
