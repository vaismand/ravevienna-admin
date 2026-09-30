import {
  concreteLocation,
  countriesMatch,
  countryTier,
  isViennaCity,
  isVaguePlaceName,
} from "./countryNames.ts";
import {
  AUTO_ACCEPT_MARGIN,
  decideDjCandidates,
  REVIEW_MIN_SCORE,
  scoreDjCandidate,
  type CandidateDecision,
  type DjProfileCandidate,
  type MatchSignals,
  type ScoredDjCandidate,
} from "./djCandidateScore.ts";
import {
  planDjFieldUpdates,
  type DjEnrichmentRow,
  type FieldPlan,
} from "./djFieldPlan.ts";
import { djSearchNamesMatch } from "./djSearchName.ts";
import {
  canonicalSoundCloudUrl,
  sameInstagram,
  sameSoundCloud,
} from "./profileLinks.ts";

export type ProfileEvidence = {
  soundcloudUrls: string[];
  instagramUrls: string[];
};

export type ProfileMatchOutcome = FieldPlan & {
  soundcloud: CandidateDecision;
  ra: CandidateDecision;
  raMerge: "applied" | "skipped_conflict" | "not_used";
};

function eventLink(
  candidate: DjProfileCandidate,
  evidence: ProfileEvidence
): boolean {
  const soundcloudHit = evidence.soundcloudUrls.some((url) =>
    sameSoundCloud(url, candidate.soundcloudUrl ?? candidate.profileUrl)
  );
  const instagramHit = evidence.instagramUrls.some((url) =>
    sameInstagram(url, candidate.instagramUrl)
  );
  return soundcloudHit || instagramHit;
}

function signalsFor(
  candidate: DjProfileCandidate,
  others: DjProfileCandidate[],
  evidence: ProfileEvidence
): MatchSignals {
  const crossSoundcloud = others.some((other) =>
    sameSoundCloud(
      candidate.soundcloudUrl ?? candidate.profileUrl,
      other.soundcloudUrl ?? other.profileUrl
    )
  );
  const crossInstagram = others.some((other) =>
    sameInstagram(candidate.instagramUrl, other.instagramUrl)
  );
  const crossCountry = others.some(
    (other) =>
      djSearchNamesMatch(candidate.name, other.name) &&
      countriesMatch(candidate.country, other.country)
  );

  return {
    eventLink: eventLink(candidate, evidence),
    crossSoundcloud,
    crossInstagram,
    crossCountry,
  };
}

function withPlayEvidence(
  candidate: DjProfileCandidate,
  others: DjProfileCandidate[]
): DjProfileCandidate {
  const related = others.filter(
    (other) =>
      sameSoundCloud(
        candidate.soundcloudUrl ?? candidate.profileUrl,
        other.soundcloudUrl
      ) ||
      sameInstagram(candidate.instagramUrl, other.instagramUrl) ||
      (djSearchNamesMatch(candidate.name, other.name) &&
        countriesMatch(candidate.country, other.country))
  );

  return {
    ...candidate,
    playsVienna:
      candidate.playsVienna || related.some((other) => other.playsVienna),
    playsAustria:
      candidate.playsAustria || related.some((other) => other.playsAustria),
    playsNeighbour:
      candidate.playsNeighbour || related.some((other) => other.playsNeighbour),
  };
}

function scoreAll(
  djName: string,
  candidates: DjProfileCandidate[],
  others: DjProfileCandidate[],
  evidence: ProfileEvidence
): ScoredDjCandidate[] {
  return candidates.map((candidate) => {
    const enriched = withPlayEvidence(candidate, others);
    return scoreDjCandidate(
      djName,
      enriched,
      signalsFor(enriched, others, evidence)
    );
  });
}

function countriesConflict(
  soundcloud: DjProfileCandidate | null,
  ra: DjProfileCandidate | null
): boolean {
  if (!soundcloud?.country || !ra?.country) {
    return false;
  }
  return !countriesMatch(soundcloud.country, ra.country);
}

function profilesLinked(
  soundcloud: DjProfileCandidate,
  ra: DjProfileCandidate
): boolean {
  return (
    sameSoundCloud(
      soundcloud.soundcloudUrl ?? soundcloud.profileUrl,
      ra.soundcloudUrl
    ) || sameInstagram(soundcloud.instagramUrl, ra.instagramUrl)
  );
}

function asReview(decision: CandidateDecision): CandidateDecision {
  const review = decision.ranked
    .filter((item) => item.nameTier !== "none" || item.score >= REVIEW_MIN_SCORE)
    .slice(0, 3);

  return {
    ...decision,
    status: review.length > 0 ? "review" : "none",
    chosen: null,
    review,
  };
}

/** Home base only. Gigs in Vienna or Austria add score and do not unlock auto. */
function homeAustriaOrVienna(candidate: DjProfileCandidate): boolean {
  if (isVaguePlaceName(candidate.city)) {
    return false;
  }
  const place = concreteLocation(candidate.city, candidate.country);
  return countryTier(place.country, place.city) === "austria" || isViennaCity(place.city);
}

export function raOnlyAutoAllowed(
  candidate: DjProfileCandidate,
  margin: number | null
): boolean {
  if (margin != null && margin < AUTO_ACCEPT_MARGIN) {
    return false;
  }
  return homeAustriaOrVienna(candidate);
}

function savedSoundCloudUrl(dj: DjEnrichmentRow): string | null {
  return canonicalSoundCloudUrl(dj.soundcloud_url);
}

function matchesSavedSoundCloud(
  candidate: DjProfileCandidate,
  savedUrl: string
): boolean {
  return sameSoundCloud(savedUrl, candidate.soundcloudUrl ?? candidate.profileUrl);
}

type ConfirmedLinks = {
  soundcloud: string[];
  instagram: string[];
};

function confirmedLinks(
  dj: DjEnrichmentRow,
  soundcloud: DjProfileCandidate | null
): ConfirmedLinks {
  return {
    soundcloud: [dj.soundcloud_url, soundcloud?.soundcloudUrl, soundcloud?.profileUrl].filter(
      (url): url is string => Boolean(url?.trim())
    ),
    instagram: [dj.instagram_url, soundcloud?.instagramUrl].filter(
      (url): url is string => Boolean(url?.trim())
    ),
  };
}

function matchesConfirmedLinks(
  candidate: DjProfileCandidate,
  links: ConfirmedLinks
): boolean {
  const soundcloudHit = links.soundcloud.some((url) =>
    sameSoundCloud(url, candidate.soundcloudUrl)
  );
  const instagramHit = links.instagram.some((url) =>
    sameInstagram(url, candidate.instagramUrl)
  );
  return soundcloudHit || instagramHit;
}

/**
 * When the top RA scores are equal, keep the profile whose SoundCloud or
 * Instagram matches the confirmed account. Leave a real tie unchanged.
 */
function preferLinkedTie(
  scored: ScoredDjCandidate[],
  links: ConfirmedLinks
): ScoredDjCandidate[] {
  if (scored.length < 2) {
    return scored;
  }
  if (links.soundcloud.length === 0 && links.instagram.length === 0) {
    return scored;
  }

  const topScore = Math.max(...scored.map((item) => item.score));
  const tied = scored.filter((item) => item.score === topScore);
  if (tied.length < 2) {
    return scored;
  }

  const linked = tied.filter((item) => matchesConfirmedLinks(item.candidate, links));
  if (linked.length !== 1) {
    return scored;
  }

  const winner = linked[0]!;
  if (!winner.reasons.includes("confirmed_profile_link")) {
    winner.reasons.push("confirmed_profile_link");
  }
  return scored.filter((item) => item.score !== topScore || item === winner);
}

function soundcloudAccountsDisagree(
  soundcloud: DjProfileCandidate,
  ra: DjProfileCandidate
): boolean {
  if (!ra.soundcloudUrl) {
    return false;
  }
  return !sameSoundCloud(soundcloud.soundcloudUrl ?? soundcloud.profileUrl, ra.soundcloudUrl);
}

function confirmSavedSoundCloud(
  decision: CandidateDecision,
  savedUrl: string | null
): CandidateDecision {
  const chosen = decision.ranked[0];
  if (!savedUrl || !chosen || !matchesSavedSoundCloud(chosen.candidate, savedUrl)) {
    return decision;
  }
  if (!chosen.reasons.includes("saved_soundcloud_url")) {
    chosen.reasons.push("saved_soundcloud_url");
  }
  return {
    ...decision,
    status: "auto",
    chosen,
    review: [],
  };
}

function agreesWithSoundcloud(
  raCandidate: DjProfileCandidate,
  soundcloud: CandidateDecision
): boolean {
  const chosen = soundcloud.chosen?.candidate;
  if (soundcloud.status !== "auto" || !chosen) {
    return false;
  }
  if (soundcloudAccountsDisagree(chosen, raCandidate)) {
    return false;
  }
  if (profilesLinked(chosen, raCandidate)) {
    return true;
  }
  return (
    djSearchNamesMatch(chosen.name, raCandidate.name) &&
    !countriesConflict(chosen, raCandidate)
  );
}

export function matchDjProfiles(input: {
  dj: DjEnrichmentRow;
  soundcloud: DjProfileCandidate[];
  ra: DjProfileCandidate[];
  evidence: ProfileEvidence;
  force: boolean;
  columns: Set<string>;
}): ProfileMatchOutcome {
  const evidence = input.evidence;
  const savedUrl = savedSoundCloudUrl(input.dj);
  const soundcloudPool = savedUrl
    ? input.soundcloud.filter((candidate) => matchesSavedSoundCloud(candidate, savedUrl))
    : input.soundcloud;
  const soundcloud = confirmSavedSoundCloud(
    decideDjCandidates(scoreAll(input.dj.name, soundcloudPool, input.ra, evidence)),
    savedUrl
  );
  const ra = decideDjCandidates(
    preferLinkedTie(
      scoreAll(input.dj.name, input.ra, soundcloudPool, evidence),
      confirmedLinks(input.dj, soundcloud.chosen?.candidate ?? null)
    )
  );

  let soundcloudPick: DjProfileCandidate | null = null;
  let raPick: DjProfileCandidate | null = null;
  let raMerge: ProfileMatchOutcome["raMerge"] = "not_used";

  let raDecision = ra;

  if (soundcloud.status === "auto" && soundcloud.chosen) {
    soundcloudPick = soundcloud.chosen.candidate;
    if (raDecision.status === "auto" && raDecision.chosen) {
      const raCandidate = raDecision.chosen.candidate;
      if (soundcloudAccountsDisagree(soundcloudPick, raCandidate)) {
        raMerge = "skipped_conflict";
        raDecision = asReview(raDecision);
      } else if (
        countriesConflict(soundcloudPick, raCandidate) &&
        !profilesLinked(soundcloudPick, raCandidate)
      ) {
        raMerge = "skipped_conflict";
        raDecision = asReview(raDecision);
      } else if (agreesWithSoundcloud(raCandidate, soundcloud)) {
        raPick = raCandidate;
        raMerge = "applied";
      } else {
        raDecision = asReview(raDecision);
      }
    }
  } else if (raDecision.status === "auto" && raDecision.chosen) {
    const raCandidate = raDecision.chosen.candidate;
    const savedConflict =
      savedUrl != null &&
      raCandidate.soundcloudUrl != null &&
      !sameSoundCloud(savedUrl, raCandidate.soundcloudUrl);
    if (savedConflict) {
      raMerge = "skipped_conflict";
      raDecision = asReview(raDecision);
    } else if (raOnlyAutoAllowed(raCandidate, raDecision.margin)) {
      raPick = raCandidate;
      raMerge = "applied";
    } else {
      raDecision = asReview(raDecision);
    }
  }

  const plan = planDjFieldUpdates({
    dj: input.dj,
    soundcloud: soundcloudPick,
    ra: raPick,
    force: input.force,
    columns: input.columns,
  });

  return {
    ...plan,
    soundcloud,
    ra: raDecision,
    raMerge,
  };
}
