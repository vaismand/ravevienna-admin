/**
 * Normalize DJ names for search matching.
 * Case, accents, a leading "DJ ", and live-set markers do not change the match.
 * Ø/ø fold to o, Æ/æ to ae, ß to ss, and Ł/ł to l before other marks are stripped.
 */

const LIVE_GROUP =
  /\s*[([｛【]\s*(?:live(?:\s*set)?|dj\s*set|liveset)\s*[)\]｝】]\s*/gi;

function foldLatinLetters(value: string): string {
  return value
    .replace(/ß/g, "ss")
    .replace(/ẞ/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/Æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/Ø/g, "o")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "l");
}

export function normalizeDjSearchName(name: string): string {
  const folded = foldLatinLetters(name);
  const withoutMarks = folded.normalize("NFD").replace(/\p{M}/gu, "");
  const withoutLiveGroups = withoutMarks.replace(LIVE_GROUP, " ");

  let normalized = withoutLiveGroups
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  normalized = normalized.replace(/^dj\s+/, "").trim();

  if (/\s+live$/.test(normalized)) {
    normalized = normalized.replace(/\s+live$/, "").trim();
  }

  return normalized;
}

export function compactDjSearchName(name: string): string {
  return normalizeDjSearchName(name).replace(/\s+/g, "");
}

const COMMON_FIRST_NAMES = new Set([
  "karolina",
  "carolina",
  "katharina",
  "katherine",
  "kathrin",
  "alexander",
  "alexandra",
  "sebastian",
  "christina",
  "stefanie",
  "stephanie",
  "benjamin",
  "dominik",
  "franziska",
  "veronika",
  "vanessa",
  "natalie",
  "natalia",
  "daniela",
  "jennifer",
  "jessica",
  "samantha",
  "victoria",
  "valentina",
  "anastasia",
  "maximilian",
  "andreas",
  "stefan",
  "thomas",
  "martin",
  "markus",
  "michael",
  "florian",
  "matthias",
  "christoph",
  "patrick",
  "philipp",
  "marcel",
  "marvin",
  "marina",
  "melanie",
  "sabrina",
  "sandra",
  "sarah",
  "laura",
  "julia",
  "hannah",
  "emilia",
  "sophia",
  "sofia",
  "olivia",
  "isabella",
  "charlotte",
  "nicole",
  "claudia",
  "barbara",
  "daniel",
  "david",
  "peter",
  "frank",
  "franz",
  "georg",
  "lukas",
  "lucas",
  "felix",
  "simon",
  "tobias",
  "julian",
  "fabian",
  "roman",
  "robert",
  "richard",
  "oliver",
  "henry",
  "james",
  "john",
  "matthew",
  "andrew",
  "joseph",
  "joshua",
  "christian",
  "christopher",
  "nicolas",
  "nicholas",
  "elisabeth",
  "elizabeth",
  "francesca",
  "francesco",
  "giovanni",
  "alessandro",
  "alessandra",
  "lorenzo",
  "martina",
  "beatrice",
  "joey",
  "izzy",
  "thea",
]);

const COMMON_WORDS = new Set([
  "house",
  "music",
  "sound",
  "black",
  "white",
  "green",
  "dream",
  "night",
  "light",
  "power",
  "magic",
  "super",
  "happy",
  "angel",
  "devil",
  "ghost",
  "tiger",
  "dragon",
  "phoenix",
  "crystal",
  "diamond",
  "silver",
  "golden",
  "shadow",
  "spirit",
  "energy",
  "cosmic",
  "future",
  "planet",
  "orange",
  "apple",
  "sugar",
  "honey",
  "cherry",
  "storm",
  "cloud",
  "river",
  "ocean",
  "stone",
  "metal",
  "glass",
  "smoke",
  "flame",
  "blaze",
  "spark",
  "pulse",
  "water",
  "fire",
  "world",
  "soda",
  "bread",
]);

/**
 * Short names, common first names, and ordinary dictionary words are not
 * unique enough to auto-match on the name alone.
 */
export function isGenericDjName(name: string): boolean {
  const normalized = normalizeDjSearchName(name);
  if (!normalized || normalized.includes(" ")) {
    return !normalized;
  }
  if (normalized.length <= 4) {
    return true;
  }
  return COMMON_FIRST_NAMES.has(normalized) || COMMON_WORDS.has(normalized);
}

export function djSearchNamesMatch(a: string, b: string): boolean {
  const left = normalizeDjSearchName(a);
  const right = normalizeDjSearchName(b);
  if (!left || !right) {
    return false;
  }
  return left === right || compactDjSearchName(a) === compactDjSearchName(b);
}
