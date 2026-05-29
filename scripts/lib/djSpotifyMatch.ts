export type SpotifyArtistCandidate = {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  followers: number | null;
  spotifyUrl: string;
  imageUrl: string | null;
};

export type MatchResult = {
  artist: SpotifyArtistCandidate;
  score: number;
  reason: string;
};

const ELECTRONIC_GENRE_HINT =
  /\b(techno|house|trance|drum|bass|dnb|jungle|electronic|rave|hardcore|dubstep|breakbeat|psytrance|edm)\b/;

const IRRELEVANT_GENRE_HINT =
  /\b(pop|country|christian|classical|jazz|blues|folk|singer-songwriter|latin pop|reggaeton)\b/;

export function normalizeArtistName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.'’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeArtistName(value)
      .split(" ")
      .filter((token) => token.length > 0)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function scoreSpotifyMatch(
  djName: string,
  artist: SpotifyArtistCandidate
): { score: number; reason: string } {
  const djNorm = normalizeArtistName(djName);
  const artistNorm = normalizeArtistName(artist.name);
  const djNoPrefix = djNorm.replace(/^dj\s+/, "").trim();
  const artistNoPrefix = artistNorm.replace(/^dj\s+/, "").trim();

  let score = 0;
  let reason = "partial";

  if (djNorm === artistNorm) {
    score = 100;
    reason = "exact_normalized";
  } else if (djNoPrefix === artistNorm || djNorm === artistNoPrefix) {
    score = 96;
    reason = "exact_dj_prefix_variant";
  } else if (djNoPrefix === artistNoPrefix && djNoPrefix.length > 0) {
    score = 94;
    reason = "exact_without_dj_prefix";
  } else {
    const jac = jaccard(tokenSet(djName), tokenSet(artist.name));
    score = jac * 72;

    if (
      djNoPrefix.length >= 3 &&
      (artistNorm.includes(djNoPrefix) || djNorm.includes(artistNorm))
    ) {
      const shorter = Math.min(djNoPrefix.length, artistNorm.length);
      const longer = Math.max(djNoPrefix.length, artistNorm.length);
      const ratio = shorter / longer;
      if (ratio >= 0.85) {
        score = Math.max(score, 78);
        reason = "strong_partial";
      } else if (ratio >= 0.65) {
        score = Math.max(score, 68);
        reason = "moderate_partial";
      }
    }
  }

  if (djNorm.startsWith("dj ") && djNoPrefix !== artistNorm && score < 94) {
    const djOnlyOverlap = jaccard(tokenSet(djNoPrefix), tokenSet(artist.name));
    if (djOnlyOverlap < 0.6) {
      score *= 0.75;
      reason = `${reason}_dj_prefix_penalty`;
    }
  }

  const genreBlob = artist.genres.join(" ").toLowerCase();
  if (ELECTRONIC_GENRE_HINT.test(genreBlob)) {
    score += 4;
  }
  if (IRRELEVANT_GENRE_HINT.test(genreBlob) && !ELECTRONIC_GENRE_HINT.test(genreBlob)) {
    score -= 15;
    reason = `${reason}_irrelevant_genres`;
  }

  score += Math.min(artist.popularity ?? 0, 50) * 0.25;

  return {
    score: Math.round(Math.min(100, Math.max(0, score)) * 10) / 10,
    reason,
  };
}

export const AUTO_UPDATE_MIN_SCORE = 88;
export const MANUAL_REVIEW_MIN_SCORE = 70;

export function pickBestSpotifyMatch(
  djName: string,
  candidates: SpotifyArtistCandidate[]
): MatchResult | null {
  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates
    .map((artist) => {
      const { score, reason } = scoreSpotifyMatch(djName, artist);
      return { artist, score, reason };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (!best) {
    return null;
  }

  if (second && best.score < 95 && best.score - second.score < 5) {
    return {
      ...best,
      score: best.score - 3,
      reason: `${best.reason}_ambiguous_runner_up`,
    };
  }

  return best;
}
