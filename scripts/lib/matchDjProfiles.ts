import {
  concreteLocation,
  countriesMatch,
  countryTier,
  isViennaCity,
  isVaguePlaceName,
} from "./countryNames.ts";
import {
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
import { sameInstagram, sameSoundCloud } from "./profileLinks.ts";

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

function realAustriaOrVienna(candidate: DjProfileCandidate): boolean {
  if (candidate.playsVienna) {
    return true;
  }
  if (isVaguePlaceName(candidate.city)) {
    return false;
  }
  const place = concreteLocation(candidate.city, candidate.country);
  return countryTier(place.country, place.city) === "austria" || isViennaCity(place.city);
}

function agreesWithSoundcloud(
  raCandidate: DjProfileCandidate,
  soundcloud: CandidateDecision
): boolean {
  const chosen = soundcloud.chosen?.candidate;
  if (soundcloud.status !== "auto" || !chosen) {
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
  const soundcloud = decideDjCandidates(
    scoreAll(input.dj.name, input.soundcloud, input.ra, evidence)
  );
  const ra = decideDjCandidates(
    scoreAll(input.dj.name, input.ra, input.soundcloud, evidence)
  );

  let soundcloudPick: DjProfileCandidate | null = null;
  let raPick: DjProfileCandidate | null = null;
  let raMerge: ProfileMatchOutcome["raMerge"] = "not_used";

  let raDecision = ra;

  if (soundcloud.status === "auto" && soundcloud.chosen) {
    soundcloudPick = soundcloud.chosen.candidate;
    if (raDecision.status === "auto" && raDecision.chosen) {
      const raCandidate = raDecision.chosen.candidate;
      if (
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
    if (realAustriaOrVienna(raCandidate)) {
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
