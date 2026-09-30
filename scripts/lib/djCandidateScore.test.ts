import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTO_ACCEPT_MIN_SCORE,
  decideDjCandidates,
  followerPoints,
  scoreDjCandidate,
  type DjProfileCandidate,
} from "./djCandidateScore.ts";
import { planDjFieldUpdates, type DjEnrichmentRow } from "./djFieldPlan.ts";
import { matchDjProfiles } from "./matchDjProfiles.ts";

function candidate(
  overrides: Partial<DjProfileCandidate> & Pick<DjProfileCandidate, "name">
): DjProfileCandidate {
  return {
    source: "soundcloud",
    profileUrl: "https://soundcloud.com/example",
    username: overrides.name,
    city: null,
    country: null,
    followers: null,
    genres: [],
    bio: null,
    avatarUrl: null,
    instagramUrl: null,
    soundcloudUrl: "https://soundcloud.com/example",
    websiteUrl: null,
    spotifyUrl: null,
    facebookUrl: null,
    twitterUrl: null,
    bandcampUrl: null,
    discogsUrl: null,
    playsVienna: false,
    playsAustria: false,
    playsNeighbour: false,
    ...overrides,
  };
}

function emptyDj(overrides: Partial<DjEnrichmentRow> = {}): DjEnrichmentRow {
  const { raw, ...rest } = overrides;
  const row = {
    id: "dj-1",
    name: "Stimming",
    slug: "stimming",
    bio: null,
    genres: [] as string[],
    instagram_url: null,
    soundcloud_url: null,
    spotify_url: null,
    website_url: null,
    image_url: null,
    city: null,
    country: null,
    ...rest,
  };

  return {
    ...row,
    raw: raw ?? { ...row },
  };
}

const COLUMNS = new Set([
  "bio",
  "genres",
  "instagram_url",
  "soundcloud_url",
  "spotify_url",
  "website_url",
  "image_url",
  "city",
  "country",
  "updated_at",
]);

describe("scoreDjCandidate", () => {
  it("ranks Austria above neighbours and distant countries for the same name", () => {
    const austria = scoreDjCandidate(
      "DJ Stimming (live)",
      candidate({
        name: "Stimming",
        username: "stimming",
        country: "AT",
        city: "Vienna",
        profileUrl: "https://soundcloud.com/stimming",
        soundcloudUrl: "https://soundcloud.com/stimming",
      })
    );
    const germany = scoreDjCandidate(
      "Stimming",
      candidate({
        name: "Stimming",
        country: "Germany",
        city: "Berlin",
        profileUrl: "https://soundcloud.com/stimming-de",
        soundcloudUrl: "https://soundcloud.com/stimming-de",
      })
    );
    const unitedStates = scoreDjCandidate(
      "Stimming",
      candidate({
        name: "Stimming",
        country: "US",
        city: "New York",
        profileUrl: "https://soundcloud.com/stimming-us",
        soundcloudUrl: "https://soundcloud.com/stimming-us",
      })
    );

    assert.equal(austria.nameTier, "exact");
    assert.ok(austria.reasons.includes("exact_name"));
    assert.ok(austria.reasons.includes("location_austria"));
    assert.ok(austria.reasons.includes("location_vienna"));
    assert.ok(austria.score > germany.score);
    assert.ok(germany.score > unitedStates.score);
    assert.ok(germany.reasons.includes("location_neighbour"));
    assert.ok(unitedStates.reasons.includes("location_distant"));
  });

  it("adds follower, electronic genre, event link, and RA cross-match points", () => {
    assert.equal(followerPoints(1000), 12);
    assert.equal(followerPoints(100), 8);

    const scored = scoreDjCandidate(
      "Stimming",
      candidate({
        name: "Stimming",
        country: "Austria",
        followers: 1000,
        genres: ["techno", "house"],
        profileUrl: "https://soundcloud.com/stimming",
        soundcloudUrl: "https://soundcloud.com/stimming",
      }),
      {
        eventLink: true,
        crossSoundcloud: true,
        crossInstagram: false,
        crossCountry: true,
      }
    );

    assert.ok(scored.reasons.includes("followers"));
    assert.ok(scored.reasons.includes("electronic_genre"));
    const generic = scoreDjCandidate(
      "Blawan",
      candidate({
        name: "Blawan",
        genres: ["Electronic"],
        profileUrl: "https://soundcloud.com/ternesc",
        soundcloudUrl: "https://soundcloud.com/ternesc",
      })
    );
    assert.ok(generic.reasons.includes("electronic_genre"));
    assert.ok(scored.reasons.includes("event_profile_link"));
    assert.ok(scored.reasons.includes("ra_soundcloud_crossmatch"));
    assert.ok(scored.score >= AUTO_ACCEPT_MIN_SCORE);
  });

  it("auto-picks the Austrian profile when it clears the runner-up", () => {
    const decision = decideDjCandidates([
      scoreDjCandidate(
        "Stimming",
        candidate({
          name: "Stimming",
          country: "Austria",
          profileUrl: "https://soundcloud.com/stimming",
          soundcloudUrl: "https://soundcloud.com/stimming",
        })
      ),
      scoreDjCandidate(
        "Stimming",
        candidate({
          name: "Stimming",
          country: "Germany",
          profileUrl: "https://soundcloud.com/stimming-de",
          soundcloudUrl: "https://soundcloud.com/stimming-de",
        })
      ),
    ]);

    assert.equal(decision.status, "auto");
    assert.equal(decision.chosen?.candidate.country, "Austria");
    assert.ok((decision.margin ?? 0) >= 12);
  });

  it("sends close same-country matches to review with the top candidates", () => {
    const decision = decideDjCandidates([
      scoreDjCandidate(
        "Stimming",
        candidate({
          name: "Stimming",
          country: "Austria",
          city: "Graz",
          followers: 1200,
          profileUrl: "https://soundcloud.com/stimming-graz",
          soundcloudUrl: "https://soundcloud.com/stimming-graz",
        })
      ),
      scoreDjCandidate(
        "Stimming",
        candidate({
          name: "Stimming",
          country: "Austria",
          city: "Linz",
          followers: 1100,
          profileUrl: "https://soundcloud.com/stimming-linz",
          soundcloudUrl: "https://soundcloud.com/stimming-linz",
        })
      ),
      scoreDjCandidate(
        "Stimming",
        candidate({
          name: "Stimming",
          country: "Austria",
          city: "Salzburg",
          followers: 900,
          profileUrl: "https://soundcloud.com/stimming-sbg",
          soundcloudUrl: "https://soundcloud.com/stimming-sbg",
        })
      ),
    ]);

    assert.equal(decision.status, "review");
    assert.equal(decision.chosen, null);
    assert.equal(decision.review.length, 3);
    assert.equal(decision.review[0]?.candidate.city, "Graz");
  });

  it("does not auto-pick a partial or containment name, even with a profile link", () => {
    const decision = decideDjCandidates([
      scoreDjCandidate(
        "Jukebox",
        candidate({
          name: "Pandora's Jukebox",
          username: "pandoras-jukebox",
          country: "United Kingdom",
          city: "London",
          followers: 8000,
          genres: ["house"],
          profileUrl: "https://soundcloud.com/pandoras-jukebox",
          soundcloudUrl: "https://soundcloud.com/pandoras-jukebox",
        }),
        {
          eventLink: true,
          crossSoundcloud: true,
          crossInstagram: false,
          crossCountry: false,
        }
      ),
    ]);

    assert.equal(decision.status, "review");
    assert.equal(decision.review[0]?.nameTier, "partial");
    assert.equal(decision.chosen, null);
  });

  it("keeps a 10-point lead in review when another named candidate exists", () => {
    const best = scoreDjCandidate(
      "Aras",
      candidate({
        name: "Aras",
        country: "Czechia",
        city: "Prague",
        followers: 1,
        source: "ra",
        profileUrl: "https://ra.co/dj/aras",
        soundcloudUrl: null,
      })
    );
    const runnerUp = scoreDjCandidate(
      "Aras",
      candidate({
        name: "Aras",
        country: "Germany",
        city: "Berlin",
        followers: 1,
        source: "ra",
        profileUrl: "https://ra.co/dj/aras-berlin",
        soundcloudUrl: null,
      })
    );
    runnerUp.score = best.score - 10;

    const decision = decideDjCandidates([best, runnerUp]);
    assert.equal(decision.status, "review");
    assert.equal(decision.margin, 10);
  });

  it("treats a placeholder area such as All, Slovenia as an unknown location", () => {
    const scored = scoreDjCandidate(
      "Comrade Martin",
      candidate({
        name: "Comrade Martin",
        city: "All",
        country: "Slovenia",
        followers: 2,
        source: "ra",
        profileUrl: "https://ra.co/dj/comrademartin",
        soundcloudUrl: null,
      })
    );

    assert.equal(scored.reasons.includes("location_neighbour"), false);
    assert.equal(scored.reasons.includes("location_distant"), false);
  });
});

describe("planDjFieldUpdates", () => {
  const soundcloud = candidate({
    name: "Stimming",
    country: "AT",
    city: "Vienna",
    bio: "Vienna techno.",
    avatarUrl: "https://i1.sndcdn.com/avatars-example-t500x500.jpg",
    genres: ["techno"],
    instagramUrl: "https://instagram.com/stimming",
    profileUrl: "https://soundcloud.com/stimming",
    soundcloudUrl: "https://soundcloud.com/stimming",
  });

  it("fills empty fields and keeps manually edited ones", () => {
    const plan = planDjFieldUpdates({
      dj: emptyDj({ bio: "Hand written bio", country: "AT" }),
      soundcloud,
      ra: candidate({
        source: "ra",
        name: "Stimming",
        country: "Austria",
        bio: "RA biography that should not replace the manual bio.",
        instagramUrl: "stimming-live",
        websiteUrl: "https://stimming.example",
        profileUrl: "https://ra.co/dj/stimming",
        soundcloudUrl: null,
        avatarUrl: "https://static.ra.co/should-not-be-used.jpg",
      }),
      force: false,
      columns: COLUMNS,
    });

    assert.equal(plan.updates.bio, undefined);
    assert.equal(plan.updates.country, undefined);
    assert.ok(plan.skippedNonEmpty.includes("bio"));
    assert.ok(plan.skippedNonEmpty.includes("country"));
    assert.equal(plan.updates.soundcloud_url, "https://soundcloud.com/stimming");
    assert.equal(plan.updates.image_url, soundcloud.avatarUrl);
    assert.equal(plan.updates.city, "Vienna");
    assert.equal(plan.updates.instagram_url, "https://instagram.com/stimming");
    assert.equal(plan.updates.website_url, "https://stimming.example");
    assert.deepEqual(plan.updates.genres, ["Techno"]);
    assert.equal(plan.updates.image_url === "https://static.ra.co/should-not-be-used.jpg", false);
  });

  it("overwrites non-empty fields when force is set", () => {
    const plan = planDjFieldUpdates({
      dj: emptyDj({ bio: "Old bio", country: "AT" }),
      soundcloud,
      ra: null,
      force: true,
      columns: COLUMNS,
    });

    assert.equal(plan.updates.bio, "Vienna techno.");
    assert.equal(plan.updates.country, "Austria");
  });

  it("reports columns that are not on the table", () => {
    const plan = planDjFieldUpdates({
      dj: emptyDj(),
      soundcloud: null,
      ra: candidate({
        source: "ra",
        name: "Stimming",
        profileUrl: "https://ra.co/dj/stimming",
        soundcloudUrl: "https://soundcloud.com/stimming",
        country: "Austria",
      }),
      force: false,
      columns: COLUMNS,
    });

    assert.ok(plan.skippedMissingColumn.includes("ra_url"));
    assert.ok(plan.skippedMissingColumn.includes("ra_slug"));
    assert.equal(plan.updates.ra_url, undefined);
    assert.equal(plan.updates.soundcloud_url, "https://soundcloud.com/stimming");
  });

  it("does not write a country from a placeholder RA area", () => {
    const plan = planDjFieldUpdates({
      dj: emptyDj({ name: "Comrade Martin", slug: "comrade-martin" }),
      soundcloud: null,
      ra: candidate({
        source: "ra",
        name: "Comrade Martin",
        city: "All",
        country: "Slovenia",
        followers: 2,
        profileUrl: "https://ra.co/dj/comrademartin",
        soundcloudUrl: null,
      }),
      force: false,
      columns: COLUMNS,
    });

    assert.equal(plan.updates.country, undefined);
    assert.equal(plan.updates.city, undefined);
  });
});

describe("matchDjProfiles", () => {
  it("proposes the Austrian SoundCloud profile and leaves close calls unwritten", () => {
    const dj = emptyDj();
    const confident = matchDjProfiles({
      dj,
      soundcloud: [
        candidate({
          name: "Stimming",
          country: "Austria",
          city: "Vienna",
          bio: "Techno from Vienna.",
          genres: ["techno"],
          profileUrl: "https://soundcloud.com/stimming",
          soundcloudUrl: "https://soundcloud.com/stimming",
          instagramUrl: "https://instagram.com/stimming",
        }),
        candidate({
          name: "Stimming",
          country: "Germany",
          city: "Berlin",
          profileUrl: "https://soundcloud.com/stimming-berlin",
          soundcloudUrl: "https://soundcloud.com/stimming-berlin",
        }),
      ],
      ra: [
        candidate({
          source: "ra",
          name: "Stimming",
          country: "Austria",
          profileUrl: "https://ra.co/dj/stimming",
          soundcloudUrl: "https://soundcloud.com/stimming",
          websiteUrl: "https://stimming.example",
          playsVienna: true,
        }),
      ],
      evidence: {
        soundcloudUrls: ["https://soundcloud.com/stimming"],
        instagramUrls: [],
      },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(confident.soundcloud.status, "auto");
    assert.equal(
      confident.updates.soundcloud_url,
      "https://soundcloud.com/stimming"
    );
    assert.equal(confident.updates.country, "Austria");
    assert.equal(confident.updates.website_url, "https://stimming.example");
    assert.equal(confident.raMerge, "applied");

    const ambiguous = matchDjProfiles({
      dj,
      soundcloud: [
        candidate({
          name: "Stimming",
          country: "Austria",
          city: "Graz",
          followers: 2000,
          profileUrl: "https://soundcloud.com/stimming-graz",
          soundcloudUrl: "https://soundcloud.com/stimming-graz",
        }),
        candidate({
          name: "Stimming",
          country: "Austria",
          city: "Linz",
          followers: 1900,
          profileUrl: "https://soundcloud.com/stimming-linz",
          soundcloudUrl: "https://soundcloud.com/stimming-linz",
        }),
      ],
      ra: [],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(ambiguous.soundcloud.status, "review");
    assert.equal(ambiguous.soundcloud.review.length, 2);
    assert.deepEqual(ambiguous.updates, {});
  });

  it("does not merge a review-only RA profile into an auto SoundCloud match", () => {
    const result = matchDjProfiles({
      dj: emptyDj({ name: "Jukebox", slug: "jukebox" }),
      soundcloud: [
        candidate({
          name: "Jukebox",
          country: "Austria",
          city: "Vienna",
          followers: 400,
          genres: ["techno"],
          profileUrl: "https://soundcloud.com/jukebox-vienna",
          soundcloudUrl: "https://soundcloud.com/jukebox-vienna",
        }),
      ],
      ra: [
        candidate({
          source: "ra",
          name: "Pandora's Jukebox",
          username: "pandorasjukebox-uk",
          country: "United Kingdom",
          city: "London",
          followers: 20,
          websiteUrl: "https://pandoras.example",
          profileUrl: "https://ra.co/dj/pandorasjukebox-uk",
          soundcloudUrl: "https://soundcloud.com/pandoras-jukebox",
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.soundcloud.status, "auto");
    assert.equal(result.ra.status, "review");
    assert.equal(result.raMerge, "not_used");
    assert.equal(result.updates.country, "Austria");
    assert.equal(result.updates.website_url, undefined);
    assert.equal(result.updates.soundcloud_url, "https://soundcloud.com/jukebox-vienna");
  });

  it("does not apply an RA-only match outside Austria when SoundCloud stays in review", () => {
    const result = matchDjProfiles({
      dj: emptyDj({ name: "Aras", slug: "aras" }),
      soundcloud: [
        candidate({
          name: "Aras Archive",
          country: null,
          followers: 10,
          profileUrl: "https://soundcloud.com/aras-archive",
          soundcloudUrl: "https://soundcloud.com/aras-archive",
        }),
      ],
      ra: [
        candidate({
          source: "ra",
          name: "Aras",
          country: "Czechia",
          city: "Prague",
          followers: 1,
          genres: ["techno"],
          profileUrl: "https://ra.co/dj/aras",
          soundcloudUrl: null,
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.ra.status, "review");
    assert.equal(result.raMerge, "not_used");
    assert.equal(result.updates.country, undefined);
    assert.deepEqual(result.updates, {});
  });

  it("still auto-applies an RA-only profile located in Vienna", () => {
    const result = matchDjProfiles({
      dj: emptyDj({ name: "Stimming", slug: "stimming" }),
      soundcloud: [],
      ra: [
        candidate({
          source: "ra",
          name: "Stimming",
          country: "Austria",
          city: "Vienna",
          followers: 300,
          bio: "Vienna techno.",
          profileUrl: "https://ra.co/dj/stimming",
          soundcloudUrl: "https://soundcloud.com/stimming",
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.ra.status, "auto");
    assert.equal(result.raMerge, "applied");
    assert.equal(result.updates.country, "Austria");
    assert.equal(result.soundcloud.status, "none");
  });
});
