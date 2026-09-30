import { countriesMatch } from "./countryNames.ts";
import {
  decideDjCandidates,
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

function selectRaCompanion(
  soundcloud: DjProfileCandidate,
  raRanked: ScoredDjCandidate[]
): DjProfileCandidate | null {
  const linked = raRanked.filter((item) => profilesLinked(soundcloud, item.candidate));
  if (linked.length === 1) {
    return linked[0]!.candidate;
  }
  if (linked.length > 1) {
    return linked[0]!.candidate;
  }

  const samePlace = raRanked.filter(
    (item) =>
      djSearchNamesMatch(soundcloud.name, item.candidate.name) &&
      countriesMatch(soundcloud.country, item.candidate.country) &&
      !countriesConflict(soundcloud, item.candidate)
  );
  if (samePlace.length === 1) {
    return samePlace[0]!.candidate;
  }

  return null;
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

  if (soundcloud.status === "auto" && soundcloud.chosen) {
    soundcloudPick = soundcloud.chosen.candidate;
    if (ra.status === "auto" && ra.chosen) {
      if (
        countriesConflict(soundcloudPick, ra.chosen.candidate) &&
        !profilesLinked(soundcloudPick, ra.chosen.candidate)
      ) {
        raMerge = "skipped_conflict";
      } else {
        raPick = ra.chosen.candidate;
        raMerge = "applied";
      }
    } else {
      const companion = selectRaCompanion(soundcloudPick, ra.ranked);
      if (companion) {
        raPick = companion;
        raMerge = "applied";
      }
    }
  } else if (ra.status === "auto" && ra.chosen) {
    raPick = ra.chosen.candidate;
    raMerge = "applied";
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
    ra,
    raMerge,
  };
}
