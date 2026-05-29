/**
 * Maps Spotify artist genre tags into Rave Vienna DJ genre labels.
 * Preserves existing manual genres; only adds deduplicated matches.
 */

const SPOTIFY_GENRE_RULES: { pattern: RegExp; genre: string }[] = [
  { pattern: /\bindustrial\s+techno\b/, genre: "Industrial Techno" },
  { pattern: /\bacid\s+techno\b/, genre: "Acid Techno" },
  { pattern: /\bhypnotic\s+techno\b/, genre: "Hypnotic Techno" },
  { pattern: /\bhard\s+techno\b/, genre: "Hard Techno" },
  { pattern: /\bhardgroove\b|\bhard\s+groove\b/, genre: "Hardgroove" },
  { pattern: /\bliquid\s+(?:funk|dnb|drum and bass)\b/, genre: "Liquid DnB" },
  { pattern: /\bneurofunk\b/, genre: "Neurofunk" },
  { pattern: /\bjump[\s-]?up\b/, genre: "Jump Up" },
  { pattern: /\bdrum and bass\b|\bdrum\s*&\s*bass\b|\bdnb\b/, genre: "Drum & Bass" },
  { pattern: /\bjungle\b/, genre: "Jungle" },
  { pattern: /\btechno\b/, genre: "Techno" },
  { pattern: /\btrance\b/, genre: "Trance" },
  { pattern: /\bhouse\b/, genre: "House" },
  { pattern: /\bbass\s+music\b/, genre: "Bass Music" },
  { pattern: /\bdubstep\b/, genre: "Dubstep" },
  { pattern: /\bbreakbeat\b|\bbreaks\b/, genre: "Breakbeat" },
  { pattern: /\bhardcore\b/, genre: "Hardcore" },
  { pattern: /\bhardstyle\b/, genre: "Hardstyle" },
  { pattern: /\bgabber\b/, genre: "Gabber" },
  { pattern: /\bpsytrance\b|\bpsy\s+trance\b/, genre: "Psytrance" },
  { pattern: /\belectro\b/, genre: "Electro" },
  { pattern: /\bebm\b/, genre: "EBM" },
  { pattern: /\bambient\b/, genre: "Ambient" },
  { pattern: /\bexperimental\b/, genre: "Experimental" },
];

const IRRELEVANT_SPOTIFY_GENRES =
  /\b(k-pop|kpop|country|christian|classical|jazz|blues|folk|latin pop|reggaeton|children's)\b/;

function normalizeGenreKey(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeSpotifyGenres(
  spotifyGenres: string[],
  currentGenres: string[]
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const genre of currentGenres) {
    const trimmed = genre.trim();
    if (!trimmed) {
      continue;
    }
    const key = normalizeGenreKey(trimmed);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  }

  const spotifyBlob = spotifyGenres.join(" ").toLowerCase();
  if (IRRELEVANT_SPOTIFY_GENRES.test(spotifyBlob) && result.length > 0) {
    return result;
  }

  for (const rule of SPOTIFY_GENRE_RULES) {
    const matched = spotifyGenres.some((g) => rule.pattern.test(g.toLowerCase()));
    if (!matched) {
      continue;
    }

    const key = normalizeGenreKey(rule.genre);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(rule.genre);
    }
  }

  return result;
}
