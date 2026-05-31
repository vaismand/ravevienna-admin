export type SoundCloudSearchCandidate = {
  name: string;
  username: string;
  profileUrl: string;
  avatarUrl: string | null;
  location: string | null;
  bio: string | null;
};

export type ScoredCandidate = {
  candidate: SoundCloudSearchCandidate;
  score: number;
  reason: string;
};

export const AUTO_UPDATE_MIN_SCORE = 75;
export const MANUAL_REVIEW_MIN_SCORE = 50;

const VIENNA_HINT =
  /\b(vienna|wien|austria|österreich|osterreich|\bat\b)\b/i;

const FOREIGN_LOCATION_HINT =
  /\b(berlin|germany|deutschland|london|uk|united kingdom|paris|france|amsterdam|netherlands|nyc|new york|los angeles|usa|united states|miami|barcelona|spain|italy|rome|milan|tokyo|japan|sydney|australia|toronto|canada|mexico|brazil|são paulo|sao paulo)\b/i;

const EMOJI_RE =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu;

export function normalizeSoundCloudSearchName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(EMOJI_RE, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeSoundCloudSearchName(value)
      .split(" ")
      .filter((token) => token.length > 1)
  );
}

function permalinkFromUrl(profileUrl: string): string {
  try {
    const path = new URL(profileUrl).pathname.replace(/\/+$/, "");
    const segment = path.split("/").filter(Boolean)[0];
    return segment ? normalizeSoundCloudSearchName(segment) : "";
  } catch {
    return "";
  }
}

function isExactMatch(djNorm: string, candidate: SoundCloudSearchCandidate): boolean {
  const djNoPrefix = djNorm.replace(/^dj\s+/, "").trim();
  const fields = [
    normalizeSoundCloudSearchName(candidate.name),
    normalizeSoundCloudSearchName(candidate.username),
    permalinkFromUrl(candidate.profileUrl),
  ].filter(Boolean);

  return fields.some(
    (field) =>
      field === djNorm ||
      field === djNoPrefix ||
      (djNoPrefix.length > 0 && field === djNoPrefix)
  );
}

function isContainsMatch(
  djNorm: string,
  candidate: SoundCloudSearchCandidate
): boolean {
  if (djNorm.length < 3) {
    return false;
  }

  const djNoPrefix = djNorm.replace(/^dj\s+/, "").trim();
  const haystacks = [
    normalizeSoundCloudSearchName(candidate.name),
    normalizeSoundCloudSearchName(candidate.username),
    permalinkFromUrl(candidate.profileUrl),
  ].filter((value) => value.length >= 3);

  return haystacks.some(
    (value) =>
      value.includes(djNorm) ||
      djNorm.includes(value) ||
      (djNoPrefix.length >= 3 &&
        (value.includes(djNoPrefix) || djNoPrefix.includes(value)))
  );
}

function permalinkContainsDjName(
  djNorm: string,
  candidate: SoundCloudSearchCandidate
): boolean {
  const djNoPrefix = djNorm.replace(/^dj\s+/, "").trim();
  const permalink = permalinkFromUrl(candidate.profileUrl);
  if (!permalink || permalink.length < 3) {
    return false;
  }

  return (
    permalink.includes(djNorm) ||
    djNorm.includes(permalink) ||
    (djNoPrefix.length >= 3 &&
      (permalink.includes(djNoPrefix) || djNoPrefix.includes(permalink)))
  );
}

function isClearlyUnrelated(
  djNorm: string,
  candidate: SoundCloudSearchCandidate
): boolean {
  if (djNorm.length < 4) {
    return false;
  }

  if (isExactMatch(djNorm, candidate) || isContainsMatch(djNorm, candidate)) {
    return false;
  }

  const djTokens = tokenSet(djNorm);
  const candidateTokens = tokenSet(
    [candidate.name, candidate.username, permalinkFromUrl(candidate.profileUrl)]
      .filter(Boolean)
      .join(" ")
  );

  if (djTokens.size === 0 || candidateTokens.size === 0) {
    return true;
  }

  for (const token of djTokens) {
    if (candidateTokens.has(token)) {
      return false;
    }
  }

  return true;
}

function hasForeignLocationWithoutAustriaSignal(
  candidate: SoundCloudSearchCandidate
): boolean {
  const location = candidate.location ?? "";
  const bio = candidate.bio ?? "";
  const hasAustria = VIENNA_HINT.test(location) || VIENNA_HINT.test(bio);

  if (hasAustria || !location.trim()) {
    return false;
  }

  return FOREIGN_LOCATION_HINT.test(location);
}

export function scoreSoundCloudSearchCandidate(
  djName: string,
  candidate: SoundCloudSearchCandidate
): { score: number; reason: string } {
  const djNorm = normalizeSoundCloudSearchName(djName);
  let score = 0;
  const reasons: string[] = [];

  if (isExactMatch(djNorm, candidate)) {
    score += 60;
    reasons.push("exact_name");
  } else if (isContainsMatch(djNorm, candidate)) {
    score += 40;
    reasons.push("name_contains");
  }

  if (permalinkContainsDjName(djNorm, candidate)) {
    score += 25;
    reasons.push("permalink_match");
  }

  const location = candidate.location ?? "";
  if (location && VIENNA_HINT.test(location)) {
    score += 25;
    reasons.push("location_vienna");
  }

  const bio = candidate.bio ?? "";
  if (bio && VIENNA_HINT.test(bio)) {
    score += 20;
    reasons.push("bio_vienna");
  }

  if (candidate.avatarUrl) {
    score += 10;
    reasons.push("has_avatar");
  }

  if (isClearlyUnrelated(djNorm, candidate)) {
    score -= 40;
    reasons.push("clearly_unrelated");
  }

  if (hasForeignLocationWithoutAustriaSignal(candidate)) {
    score -= 25;
    reasons.push("foreign_location");
  }

  return {
    score: Math.max(0, score),
    reason: reasons.join("+") || "none",
  };
}

export function pickBestSoundCloudSearchCandidate(
  djName: string,
  candidates: SoundCloudSearchCandidate[]
): ScoredCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  const scored = candidates
    .map((candidate) => {
      const { score, reason } = scoreSoundCloudSearchCandidate(djName, candidate);
      return { candidate, score, reason };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (!best) {
    return null;
  }

  if (second && best.score < 90 && best.score - second.score < 10) {
    return {
      ...best,
      score: Math.max(0, best.score - 5),
      reason: `${best.reason}+ambiguous_runner_up`,
    };
  }

  return best;
}
