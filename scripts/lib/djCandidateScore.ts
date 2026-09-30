import { countryTier, isViennaCity } from "./countryNames.ts";
import {
  compactDjSearchName,
  normalizeDjSearchName,
} from "./djSearchName.ts";
import { soundcloudPermalink } from "./profileLinks.ts";

export const AUTO_ACCEPT_MIN_SCORE = 80;
export const AUTO_ACCEPT_MARGIN = 12;
export const UNIQUE_EXACT_MIN_SCORE = 72;
export const REVIEW_MIN_SCORE = 40;

const ELECTRONIC_GENRE =
  /\b(?:techno|tech[\s-]?house|house|trance|dnb|drum\s*(?:and|&|n)\s*bass|jungle|dubstep|breakbeat|breaks|hardstyle|gabber|hardcore|psy(?:trance)?|electronic|electronica|electro|ebm|ambient|experimental|rave|bass(?:\s*music)?|industrial|schranz|tekno|hardtek|disco|minimal)\b/i;

const IRRELEVANT_GENRE =
  /\b(k-?pop|hip[\s-]?hop|rap|rock|metal|jazz|classical|folk|country|singer-songwriter|reggaeton)\b/i;

export type DjProfileCandidate = {
  source: "soundcloud" | "ra";
  name: string;
  profileUrl: string;
  username: string | null;
  city: string | null;
  country: string | null;
  followers: number | null;
  genres: string[];
  bio: string | null;
  avatarUrl: string | null;
  instagramUrl: string | null;
  soundcloudUrl: string | null;
  websiteUrl: string | null;
  spotifyUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  bandcampUrl: string | null;
  discogsUrl: string | null;
  playsVienna: boolean;
  playsAustria: boolean;
  playsNeighbour: boolean;
};

export type MatchSignals = {
  eventLink: boolean;
  crossSoundcloud: boolean;
  crossInstagram: boolean;
  crossCountry: boolean;
};

export type NameMatchTier = "exact" | "partial" | "none";

export type ScoredDjCandidate = {
  candidate: DjProfileCandidate;
  score: number;
  reasons: string[];
  nameTier: NameMatchTier;
  signals: MatchSignals;
};

export type CandidateDecision = {
  status: "auto" | "review" | "none";
  chosen: ScoredDjCandidate | null;
  ranked: ScoredDjCandidate[];
  review: ScoredDjCandidate[];
  margin: number | null;
};

const EMPTY_SIGNALS: MatchSignals = {
  eventLink: false,
  crossSoundcloud: false,
  crossInstagram: false,
  crossCountry: false,
};

function nameFields(
  candidate: Pick<
    DjProfileCandidate,
    "name" | "username" | "profileUrl" | "soundcloudUrl"
  >
): string[] {
  const fields = [candidate.name, candidate.username ?? ""];
  const permalink = soundcloudPermalink(
    candidate.soundcloudUrl ?? candidate.profileUrl
  );
  if (permalink) {
    fields.push(permalink.replace(/[-_]/g, " "));
  }
  return fields.filter((field) => field.trim().length > 0);
}

export function nameMatchTier(
  djName: string,
  candidate: Pick<DjProfileCandidate, "name" | "username" | "profileUrl" | "soundcloudUrl">
): NameMatchTier {
  const djNorm = normalizeDjSearchName(djName);
  if (djNorm.length < 2) {
    return "none";
  }

  const djCompact = compactDjSearchName(djName);
  const fields = nameFields(candidate);

  for (const field of fields) {
    const fieldNorm = normalizeDjSearchName(field);
    if (!fieldNorm) {
      continue;
    }
    if (fieldNorm === djNorm || compactDjSearchName(field) === djCompact) {
      return "exact";
    }
  }

  if (djNorm.length < 3) {
    return "none";
  }

  const djTokens = djNorm.split(" ").filter((token) => token.length > 1);
  for (const field of fields) {
    const fieldNorm = normalizeDjSearchName(field);
    if (fieldNorm.length < 3) {
      continue;
    }

    if (fieldNorm.includes(djNorm)) {
      return "partial";
    }

    if (djTokens.length === 0) {
      continue;
    }

    const fieldTokens = new Set(
      fieldNorm.split(" ").filter((token) => token.length > 1)
    );
    const allTokensPresent = djTokens.every((token) => fieldTokens.has(token));
    if (allTokensPresent) {
      return "partial";
    }
  }

  return "none";
}

export function followerPoints(count: number | null | undefined): number {
  if (count == null || count <= 0) {
    return 0;
  }
  return Math.min(12, Math.round(Math.log10(count) * 4));
}

function locationPoints(
  candidate: DjProfileCandidate
): { points: number; reasons: string[] } {
  const tier = countryTier(candidate.country, candidate.city);
  const reasons: string[] = [];
  let points = 0;

  const vienna =
    isViennaCity(candidate.city) || candidate.playsVienna;

  if (tier === "austria") {
    points += 30;
    reasons.push("location_austria");
    if (vienna) {
      points += 14;
      reasons.push("location_vienna");
    }
    return { points, reasons };
  }

  if (tier === "neighbour") {
    points += 16;
    reasons.push("location_neighbour");
    if (vienna) {
      points += 14;
      reasons.push("plays_vienna");
    } else if (candidate.playsAustria) {
      points += 10;
      reasons.push("plays_austria");
    }
    return { points, reasons };
  }

  if (vienna || candidate.playsAustria) {
    points += 24;
    reasons.push("plays_austria");
    return { points, reasons };
  }

  if (candidate.playsNeighbour && tier === "unknown") {
    points += 10;
    reasons.push("plays_neighbour");
    return { points, reasons };
  }

  if (tier === "other") {
    points -= 6;
    reasons.push("location_distant");
  }

  return { points, reasons };
}

function genrePoints(candidate: DjProfileCandidate): { points: number; reasons: string[] } {
  const blob = [...candidate.genres, candidate.bio ?? ""].join(" ");
  if (!blob.trim()) {
    return { points: 0, reasons: [] };
  }
  if (ELECTRONIC_GENRE.test(blob)) {
    return { points: 12, reasons: ["electronic_genre"] };
  }
  if (candidate.genres.length > 0 && IRRELEVANT_GENRE.test(blob)) {
    return { points: -8, reasons: ["irrelevant_genre"] };
  }
  return { points: 0, reasons: [] };
}

export function scoreDjCandidate(
  djName: string,
  candidate: DjProfileCandidate,
  signals: MatchSignals = EMPTY_SIGNALS
): ScoredDjCandidate {
  const reasons: string[] = [];
  let score = 0;
  const nameTier = nameMatchTier(djName, candidate);

  if (nameTier === "exact") {
    score += 52;
    reasons.push("exact_name");
  } else if (nameTier === "partial") {
    score += 26;
    reasons.push("partial_name");
  } else {
    score -= 30;
    reasons.push("name_mismatch");
  }

  const location = locationPoints(candidate);
  score += location.points;
  reasons.push(...location.reasons);

  const followers = followerPoints(candidate.followers);
  if (followers > 0) {
    score += followers;
    reasons.push("followers");
  }

  const genres = genrePoints(candidate);
  score += genres.points;
  reasons.push(...genres.reasons);

  if (signals.eventLink) {
    score += 28;
    reasons.push("event_profile_link");
  }
  if (signals.crossSoundcloud) {
    score += 22;
    reasons.push("ra_soundcloud_crossmatch");
  }
  if (signals.crossInstagram) {
    score += 10;
    reasons.push("ra_instagram_crossmatch");
  }
  if (signals.crossCountry) {
    score += 8;
    reasons.push("ra_country_crossmatch");
  }

  return {
    candidate,
    score,
    reasons,
    nameTier,
    signals,
  };
}

function hasStrongEvidence(signals: MatchSignals): boolean {
  return signals.eventLink || signals.crossSoundcloud;
}

function canAutoAccept(scored: ScoredDjCandidate): boolean {
  if (scored.nameTier === "exact") {
    return true;
  }
  return scored.nameTier === "partial" && hasStrongEvidence(scored.signals);
}

export function decideDjCandidates(
  scored: ScoredDjCandidate[]
): CandidateDecision {
  const ranked = [...scored].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return (b.candidate.followers ?? 0) - (a.candidate.followers ?? 0);
  });

  const best = ranked[0] ?? null;
  const second = ranked[1] ?? null;

  if (!best) {
    return {
      status: "none",
      chosen: null,
      ranked,
      review: [],
      margin: null,
    };
  }

  const margin = second ? best.score - second.score : null;
  const runnerUpMeaningful = Boolean(
    second && second.nameTier !== "none" && second.score >= REVIEW_MIN_SCORE
  );

  const eligible = canAutoAccept(best);
  const clearMargin =
    !runnerUpMeaningful || (margin != null && margin >= AUTO_ACCEPT_MARGIN);
  const highEnough = runnerUpMeaningful
    ? best.score >= AUTO_ACCEPT_MIN_SCORE
    : best.nameTier === "exact"
      ? best.score >= UNIQUE_EXACT_MIN_SCORE
      : best.score >= AUTO_ACCEPT_MIN_SCORE;

  if (eligible && clearMargin && highEnough) {
    return {
      status: "auto",
      chosen: best,
      ranked,
      review: [],
      margin,
    };
  }

  const review = ranked
    .filter((item) => item.nameTier !== "none" || item.score >= REVIEW_MIN_SCORE)
    .slice(0, 3);

  if (review.length === 0) {
    return {
      status: "none",
      chosen: null,
      ranked,
      review: [],
      margin,
    };
  }

  return {
    status: "review",
    chosen: null,
    ranked,
    review,
    margin,
  };
}
