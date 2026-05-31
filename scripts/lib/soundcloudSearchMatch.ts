import type { SoundCloudUserCandidate } from "./soundCloudApiClient.ts";

export type SoundCloudMatchResult = {
  candidate: SoundCloudUserCandidate;
  score: number;
  reason: string;
};

export const AUTO_UPDATE_MIN_SCORE = 70;
export const MANUAL_REVIEW_MIN_SCORE = 45;

const VIENNA_HINT = /\b(vienna|wien|austria|\bat\b)\b/i;

export function normalizeSoundCloudMatchName(name: string): string {
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
    normalizeSoundCloudMatchName(value)
      .split(" ")
      .filter((token) => token.length > 1)
  );
}

function isExactNameMatch(djNorm: string, candidate: SoundCloudUserCandidate): boolean {
  const djNoPrefix = djNorm.replace(/^dj\s+/, "").trim();
  const fields = [
    normalizeSoundCloudMatchName(candidate.username),
    normalizeSoundCloudMatchName(candidate.permalink),
    normalizeSoundCloudMatchName(candidate.fullName ?? ""),
  ].filter(Boolean);

  return fields.some(
    (field) =>
      field === djNorm ||
      field === djNoPrefix ||
      (djNoPrefix.length > 0 && field === djNoPrefix)
  );
}

function nameContainsMatch(
  djNorm: string,
  candidate: SoundCloudUserCandidate
): boolean {
  if (djNorm.length < 3) {
    return false;
  }

  const djNoPrefix = djNorm.replace(/^dj\s+/, "").trim();
  const haystacks = [
    normalizeSoundCloudMatchName(candidate.username),
    normalizeSoundCloudMatchName(candidate.permalink),
    normalizeSoundCloudMatchName(candidate.fullName ?? ""),
  ].filter((value) => value.length >= 3);

  return haystacks.some(
    (value) =>
      value.includes(djNorm) ||
      djNorm.includes(value) ||
      (djNoPrefix.length >= 3 &&
        (value.includes(djNoPrefix) || djNoPrefix.includes(value)))
  );
}

function isObviousMismatch(
  djNorm: string,
  candidate: SoundCloudUserCandidate
): boolean {
  if (djNorm.length < 4) {
    return false;
  }

  const djTokens = tokenSet(djNorm);
  if (djTokens.size === 0) {
    return false;
  }

  const candidateTokens = new Set<string>();
  for (const value of [
    candidate.username,
    candidate.permalink,
    candidate.fullName ?? "",
  ]) {
    for (const token of tokenSet(value)) {
      candidateTokens.add(token);
    }
  }

  if (candidateTokens.size === 0) {
    return true;
  }

  let overlap = 0;
  for (const token of djTokens) {
    if (candidateTokens.has(token)) {
      overlap += 1;
    }
  }

  if (overlap > 0) {
    return false;
  }

  if (nameContainsMatch(djNorm, candidate)) {
    return false;
  }

  return true;
}

export function scoreSoundCloudMatch(
  djName: string,
  candidate: SoundCloudUserCandidate
): { score: number; reason: string } {
  const djNorm = normalizeSoundCloudMatchName(djName);
  let score = 0;
  const reasons: string[] = [];

  if (isExactNameMatch(djNorm, candidate)) {
    score += 50;
    reasons.push("exact_name");
  } else if (nameContainsMatch(djNorm, candidate)) {
    score += 30;
    reasons.push("name_contains");
  }

  const locationText = [candidate.city, candidate.country]
    .filter(Boolean)
    .join(" ");
  if (locationText && VIENNA_HINT.test(locationText)) {
    score += 25;
    reasons.push("location_vienna");
  }

  if (candidate.description && VIENNA_HINT.test(candidate.description)) {
    score += 15;
    reasons.push("bio_vienna");
  }

  if (candidate.avatarUrl) {
    score += 10;
    reasons.push("has_avatar");
  }

  if (isObviousMismatch(djNorm, candidate)) {
    score -= 30;
    reasons.push("obvious_mismatch");
  }

  return {
    score: Math.max(0, score),
    reason: reasons.join("+") || "none",
  };
}

export function pickBestSoundCloudMatch(
  djName: string,
  candidates: SoundCloudUserCandidate[]
): SoundCloudMatchResult | null {
  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates
    .map((candidate) => {
      const { score, reason } = scoreSoundCloudMatch(djName, candidate);
      return { candidate, score, reason };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (!best) {
    return null;
  }

  if (second && best.score < 80 && best.score - second.score < 8) {
    return {
      ...best,
      score: Math.max(0, best.score - 5),
      reason: `${best.reason}+ambiguous_runner_up`,
    };
  }

  return best;
}
