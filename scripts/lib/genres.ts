export const RAVE_PREFERENCE_GENRES = [
  "Techno",
  "Hard Techno",
  "House",
  "Trance",
  "Psytrance",
  "Drum & Bass",
  "Jungle",
  "Bass Music",
  "Dubstep",
  "Breakbeat",
  "Hardcore",
  "Tekno",
  "Hardstyle",
  "Gabber",
  "Electro",
  "EBM",
  "Disco",
  "Ambient",
  "Experimental",
] as const;

export const EVENT_GENRES = [
  ...RAVE_PREFERENCE_GENRES,
  "Multi-Genre",
  "Afterparty",
] as const;

/** @deprecated Use EVENT_GENRES for events or RAVE_PREFERENCE_GENRES for user taste. */
export const RAVE_GENRES = EVENT_GENRES;

export type PreferenceGenre = (typeof RAVE_PREFERENCE_GENRES)[number];
export type EventGenre = (typeof EVENT_GENRES)[number];
export type RaveGenre = EventGenre;

const PREFERENCE_GENRE_SET = new Set<string>(RAVE_PREFERENCE_GENRES);
const EVENT_GENRE_SET = new Set<string>(EVENT_GENRES);

export const PRIMARY_GENRE_FILTERS = [
  { label: "All", value: "All" },
  { label: "Techno", value: "Techno" },
  { label: "House", value: "House" },
  { label: "DnB", value: "DnB" },
  { label: "Trance", value: "Trance" },
  { label: "Bass", value: "Bass" },
  { label: "Hardcore", value: "Hardcore" },
  { label: "Experimental", value: "Experimental" },
] as const;

export type PrimaryGenreFilterValue =
  (typeof PRIMARY_GENRE_FILTERS)[number]["value"];

export type PrimaryGenreFilter = Exclude<PrimaryGenreFilterValue, "All">;

const IRRELEVANT_GENRE_TERMS = [
  "pop",
  "rock",
  "metal",
  "indie",
  "jazz",
  "classical",
  "singer-songwriter",
  "singer songwriter",
  "country",
  "hip hop",
  "hip-hop",
  "rap",
  "folk",
  "blues",
  "gregor hägele",
  "gregor haegele",
  "krs-one",
  "don broco",
  "drowning pool",
];

/** Lowercase alias → canonical event genre. */
export const GENRE_ALIASES: Record<string, EventGenre> = {
  "multi-genre": "Multi-Genre",
  multigenre: "Multi-Genre",
  "multi genre": "Multi-Genre",
  electronic: "Multi-Genre",
  live: "Multi-Genre",
  afterparty: "Afterparty",
  rave: "Multi-Genre",
  alternative: "Experimental",
  "hard techno": "Hard Techno",
  hardtechno: "Hard Techno",
  "drum and bass": "Drum & Bass",
  "drum & bass": "Drum & Bass",
  "drum n bass": "Drum & Bass",
  dnb: "Drum & Bass",
  "deep drum & bass": "Drum & Bass",
  neurofunk: "Drum & Bass",
  "hard trance": "Trance",
  psytrance: "Psytrance",
  "psy trance": "Psytrance",
  psy: "Psytrance",
  goa: "Psytrance",
  "bass music": "Bass Music",
  dubstep: "Dubstep",
  breakbeat: "Breakbeat",
  breaks: "Breakbeat",
  hardstyle: "Hardstyle",
  gabber: "Gabber",
  hardcore: "Hardcore",
  tekno: "Tekno",
  tek: "Tekno",
  hardtek: "Tekno",
  freetek: "Tekno",
  freetekno: "Tekno",
  "free tekno": "Tekno",
  freeparty: "Tekno",
  "free party": "Tekno",
  tribe: "Tekno",
  tribecore: "Tekno",
  raggatek: "Tekno",
  electro: "Electro",
  ebm: "EBM",
  disco: "Disco",
  ambient: "Ambient",
  experimental: "Experimental",
  acid: "Techno",
  hardgroove: "Techno",
  bounce: "Bass Music",
  dub: "Dubstep",
  reggae: "Multi-Genre",
  dancehall: "Multi-Genre",
  afro: "Multi-Genre",
  techno: "Techno",
  house: "House",
  trance: "Trance",
  jungle: "Jungle",
  bass: "Bass Music",
};

const CANONICAL_TO_PRIMARY: Record<EventGenre, PrimaryGenreFilter | null> = {
  Techno: "Techno",
  "Hard Techno": "Techno",
  House: "House",
  Trance: "Trance",
  Psytrance: "Trance",
  "Drum & Bass": "DnB",
  Jungle: "DnB",
  "Bass Music": "Bass",
  Dubstep: "Bass",
  Breakbeat: "Bass",
  Hardcore: "Hardcore",
  Tekno: "Hardcore",
  Hardstyle: "Hardcore",
  Gabber: "Hardcore",
  Electro: "Techno",
  EBM: "Techno",
  Disco: "House",
  Ambient: "Experimental",
  Experimental: "Experimental",
  "Multi-Genre": null,
  Afterparty: null,
};

const DETECTION_RULES: { pattern: RegExp; genre: PreferenceGenre }[] = [
  { pattern: /\bfree\s*tekno\b/i, genre: "Tekno" },
  { pattern: /\bfreetekno\b/i, genre: "Tekno" },
  { pattern: /\bfree\s*party\b/i, genre: "Tekno" },
  { pattern: /\bfreeparty\b/i, genre: "Tekno" },
  { pattern: /\bfreetek\b/i, genre: "Tekno" },
  { pattern: /\bhardtek\b/i, genre: "Tekno" },
  { pattern: /\btribecore\b/i, genre: "Tekno" },
  { pattern: /\braggatek\b/i, genre: "Tekno" },
  { pattern: /\btekno\b/i, genre: "Tekno" },
  { pattern: /\btek\b/i, genre: "Tekno" },
  { pattern: /\btribe\b/i, genre: "Tekno" },
  { pattern: /\bhard\s*techno\b/i, genre: "Hard Techno" },
  { pattern: /\bhard\s*trance\b/i, genre: "Trance" },
  { pattern: /\bdrum\s*(?:&|and|n)\s*bass\b/i, genre: "Drum & Bass" },
  { pattern: /\bdnb\b/i, genre: "Drum & Bass" },
  { pattern: /\bdeep\s*drum\s*(?:&|and)\s*bass\b/i, genre: "Drum & Bass" },
  { pattern: /\bneurofunk\b/i, genre: "Drum & Bass" },
  { pattern: /\bpsy\s*trance\b/i, genre: "Psytrance" },
  { pattern: /\bpsytrance\b/i, genre: "Psytrance" },
  { pattern: /\bbass\s*music\b/i, genre: "Bass Music" },
  { pattern: /\bbreakbeat\b/i, genre: "Breakbeat" },
  { pattern: /\bhardstyle\b/i, genre: "Hardstyle" },
  { pattern: /\bhardcore\b/i, genre: "Hardcore" },
  { pattern: /\bgabber\b/i, genre: "Gabber" },
  { pattern: /\bdubstep\b/i, genre: "Dubstep" },
  { pattern: /\bexperimental\b/i, genre: "Experimental" },
  { pattern: /\bambient\b/i, genre: "Ambient" },
  { pattern: /\bhardgroove\b/i, genre: "Techno" },
  { pattern: /\bacid\b/i, genre: "Techno" },
  { pattern: /\btechno\b/i, genre: "Techno" },
  { pattern: /\btrance\b/i, genre: "Trance" },
  { pattern: /\bjungle\b/i, genre: "Jungle" },
  { pattern: /\bhouse\b/i, genre: "House" },
  { pattern: /\belectro\b/i, genre: "Electro" },
  { pattern: /\bebm\b/i, genre: "EBM" },
  { pattern: /\bdisco\b/i, genre: "Disco" },
  { pattern: /\bbounce\b/i, genre: "Bass Music" },
  { pattern: /\bbass\b/i, genre: "Bass Music" },
];

const SORTED_ALIAS_KEYS = Object.keys(GENRE_ALIASES).sort(
  (a, b) => b.length - a.length
);

function cleanGenreInput(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isIrrelevantGenre(value: string): boolean {
  const lower = value.toLowerCase();

  return IRRELEVANT_GENRE_TERMS.some((term) => lower === term);
}

function findCanonicalEventGenre(value: string): EventGenre | null {
  if (EVENT_GENRE_SET.has(value)) {
    return value as EventGenre;
  }

  const lower = value.toLowerCase();
  const exact = EVENT_GENRES.find((genre) => genre.toLowerCase() === lower);

  return exact ?? null;
}

export function isPreferenceGenre(genre: string): genre is PreferenceGenre {
  return PREFERENCE_GENRE_SET.has(genre);
}

export function isEventOnlyGenre(
  genre: EventGenre
): genre is "Multi-Genre" | "Afterparty" {
  return genre === "Multi-Genre" || genre === "Afterparty";
}

/** Club afterparties that start in the early morning (e.g. 06:00–07:00). */
export function isAfterpartyStartTime(
  startTime: string | null | undefined
): boolean {
  if (!startTime) {
    return false;
  }

  const match = startTime.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return false;
  }

  const totalMinutes = Number(match[1]) * 60 + Number(match[2]);
  return totalMinutes >= 5 * 60 && totalMinutes < 12 * 60;
}

export function withAfterpartyGenre(
  genres: EventGenre[],
  startTime: string | null | undefined
): EventGenre[] {
  if (!isAfterpartyStartTime(startTime) || genres.includes("Afterparty")) {
    return genres;
  }

  return [...genres, "Afterparty"];
}

export function getEventGenres(
  genres: string[] | null | undefined,
  startTime: string | null | undefined
): EventGenre[] {
  return withAfterpartyGenre(normalizeEventGenres(genres), startTime);
}

/**
 * Map raw text to a canonical event genre (includes Multi-Genre fallback).
 */
export function normalizeEventGenre(genre: string): EventGenre | null {
  const cleaned = cleanGenreInput(genre);
  if (!cleaned) {
    return null;
  }

  if (isIrrelevantGenre(cleaned)) {
    return null;
  }

  const canonical = findCanonicalEventGenre(cleaned);
  if (canonical) {
    return canonical;
  }

  const lower = cleaned.toLowerCase();

  if (GENRE_ALIASES[lower]) {
    return GENRE_ALIASES[lower];
  }

  for (const key of SORTED_ALIAS_KEYS) {
    if (lower === key) {
      return GENRE_ALIASES[key];
    }
  }

  return null;
}

/**
 * Map raw text to a user taste genre. Never returns Multi-Genre.
 */
export function normalizePreferenceGenre(genre: string): PreferenceGenre | null {
  const normalized = normalizeEventGenre(genre);

  if (!normalized || isEventOnlyGenre(normalized)) {
    return null;
  }

  return normalized;
}

/** @deprecated Use normalizeEventGenre or normalizePreferenceGenre explicitly. */
export function normalizeGenre(genre: string): EventGenre | null {
  return normalizeEventGenre(genre);
}

export function normalizeEventGenres(
  genres: string[] | null | undefined
): EventGenre[] {
  const seen = new Set<EventGenre>();
  const result: EventGenre[] = [];

  for (const genre of genres ?? []) {
    const normalized = normalizeEventGenre(genre);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function normalizePreferenceGenres(
  genres: string[] | null | undefined
): PreferenceGenre[] {
  const seen = new Set<PreferenceGenre>();
  const result: PreferenceGenre[] = [];

  for (const genre of genres ?? []) {
    const normalized = normalizePreferenceGenre(genre);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

/** @deprecated Use normalizeEventGenres for events/venues display data. */
export function normalizeGenres(
  genres: string[] | null | undefined
): EventGenre[] {
  return normalizeEventGenres(genres);
}

export function mapGenreToPrimaryFilter(
  genre: string | EventGenre
): PrimaryGenreFilter | null {
  const normalized = normalizeEventGenre(genre);
  if (!normalized) {
    return null;
  }

  return CANONICAL_TO_PRIMARY[normalized];
}

export function getMatchableEventGenres(
  genres: string[] | null | undefined
): PreferenceGenre[] {
  return normalizeEventGenres(genres).filter(
    (genre): genre is PreferenceGenre => !isEventOnlyGenre(genre)
  );
}

export const EVENT_GENRE_FILTER_OPTIONS = [
  ...PRIMARY_GENRE_FILTERS,
  { label: "Afterparty", value: "Afterparty" },
] as const;

export function matchesEventGenreFilter(
  genres: string[] | null | undefined,
  selectedFilter: string
): boolean {
  if (selectedFilter === "All") {
    return true;
  }

  if (selectedFilter === "Afterparty") {
    return normalizeEventGenres(genres).includes("Afterparty");
  }

  return matchesPrimaryGenreFilter(genres, selectedFilter);
}

export function matchesPrimaryGenreFilter(
  genres: string[] | null | undefined,
  selectedFilter: string
): boolean {
  if (selectedFilter === "All" || selectedFilter === "Afterparty") {
    return selectedFilter === "All";
  }

  const matchable = getMatchableEventGenres(genres);

  if (matchable.length === 0) {
    return false;
  }

  return matchable.some((genre) => {
    const primary = mapGenreToPrimaryFilter(genre);
    return primary === selectedFilter;
  });
}

function isTeknoCultureGenre(genre: PreferenceGenre): boolean {
  return genre === "Tekno";
}

export function genresMatchForRecommendations(
  userGenre: string,
  eventGenre: string
): boolean {
  const normalizedUser = normalizePreferenceGenre(userGenre);
  const normalizedEvent = normalizePreferenceGenre(eventGenre);

  if (!normalizedUser || !normalizedEvent) {
    return false;
  }

  if (normalizedUser === normalizedEvent) {
    return true;
  }

  if (
    isTeknoCultureGenre(normalizedUser) &&
    isTeknoCultureGenre(normalizedEvent)
  ) {
    return true;
  }

  const userPrimary = mapGenreToPrimaryFilter(normalizedUser);
  const eventPrimary = mapGenreToPrimaryFilter(normalizedEvent);

  if (
    isTeknoCultureGenre(normalizedUser) ||
    isTeknoCultureGenre(normalizedEvent)
  ) {
    return false;
  }

  return (
    userPrimary !== null &&
    eventPrimary !== null &&
    userPrimary === eventPrimary
  );
}

export function getDisplayGenres(
  genres: string[] | null | undefined,
  max = 3
): EventGenre[] {
  const normalized = normalizeEventGenres(genres);
  const tasteGenres = normalized.filter((genre) => !isEventOnlyGenre(genre));
  const eventOnlyTags = normalized.filter(
    (genre) => genre === "Afterparty" || genre === "Multi-Genre"
  );

  if (tasteGenres.length > 0) {
    const combined = [...tasteGenres, ...eventOnlyTags.filter((g) => g === "Afterparty")];
    return combined.slice(0, max);
  }

  if (eventOnlyTags.length > 0) {
    return eventOnlyTags.slice(0, max);
  }

  return ["Multi-Genre"];
}

export function detectGenresFromText(text: string): EventGenre[] {
  const value = text.toLowerCase();
  const found = new Set<PreferenceGenre>();

  for (const { pattern, genre } of DETECTION_RULES) {
    if (pattern.test(value)) {
      found.add(genre);
    }
  }

  if (found.size === 0) {
    return ["Multi-Genre"];
  }

  return [...found];
}

export const ONBOARDING_GENRE_OPTIONS: PreferenceGenre[] = [
  ...RAVE_PREFERENCE_GENRES,
];

export function buildOnboardingGenreOptions(): PreferenceGenre[] {
  return ONBOARDING_GENRE_OPTIONS;
}

export const PRIMARY_GENRE_FILTER_OPTIONS = PRIMARY_GENRE_FILTERS;

/** @deprecated Use PRIMARY_GENRE_FILTER_OPTIONS */
export const GENRE_FILTER_OPTIONS = PRIMARY_GENRE_FILTER_OPTIONS;

export function buildVenueGenreFilterOptions() {
  return PRIMARY_GENRE_FILTER_OPTIONS;
}

export function matchesGenreFilter(
  genres: string[] | null | undefined,
  selected: string
): boolean {
  return matchesEventGenreFilter(genres, selected);
}
