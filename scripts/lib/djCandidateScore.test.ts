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
import { matchDjProfiles, raOnlyAutoAllowed } from "./matchDjProfiles.ts";

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

  it("auto-accepts a single exact foreign name and does not hold it back for location", () => {
    const cases = [
      {
        name: "CALYX",
        city: "South London",
        country: "United Kingdom",
        profileUrl: "https://soundcloud.com/calyx",
      },
      {
        name: "JUSTIN JAY",
        city: "Los Angeles",
        country: "United States",
        profileUrl: "https://soundcloud.com/justinjay",
      },
      {
        name: "KØ:LAB",
        displayName: "Not the display name",
        username: "kolab",
        city: "Copenhagen",
        country: "Denmark",
        profileUrl: "https://soundcloud.com/kolab",
      },
    ];

    for (const example of cases) {
      const decision = decideDjCandidates([
        scoreDjCandidate(
          example.name,
          candidate({
            name: example.displayName ?? example.name,
            username: example.username ?? example.name,
            city: example.city,
            country: example.country,
            followers: 40000,
            genres: ["techno"],
            profileUrl: example.profileUrl,
            soundcloudUrl: example.profileUrl,
          })
        ),
      ]);
      assert.equal(decision.status, "auto", example.name);
      assert.equal(decision.chosen?.nameTier, "exact", example.name);
      assert.equal(decision.chosen?.candidate.country, example.country, example.name);
    }
  });

  it("uses location only to rank two profiles that share a name", () => {
    const scored = (city: string, country: string, url: string) =>
      scoreDjCandidate(
        "Calyx",
        candidate({
          name: "Calyx",
          city,
          country,
          followers: 1000,
          profileUrl: url,
          soundcloudUrl: url,
        })
      );

    const withAustria = decideDjCandidates([
      scored("London", "United Kingdom", "https://soundcloud.com/calyx-uk"),
      scored("Vienna", "Austria", "https://soundcloud.com/calyx-vienna"),
      scored("Berlin", "Germany", "https://soundcloud.com/calyx-berlin"),
    ]);
    assert.equal(withAustria.status, "auto");
    assert.equal(withAustria.chosen?.candidate.country, "Austria");
    assert.ok(withAustria.chosen?.reasons.includes("location_austria"));

    const neighbour = decideDjCandidates([
      scored("London", "United Kingdom", "https://soundcloud.com/calyx-uk"),
      scored("Vaduz", "Liechtenstein", "https://soundcloud.com/calyx-li"),
    ]);
    assert.equal(neighbour.status, "auto");
    assert.equal(neighbour.chosen?.candidate.country, "Liechtenstein");
    assert.ok(neighbour.chosen?.reasons.includes("location_neighbour"));
  });

  it("sends generic short names to review unless a SoundCloud link confirms them", () => {
    for (const name of ["Izzy", "Soda", "Thea", "Ben", "Fra", "JOEY", "KAROLINA"]) {
      const decision = decideDjCandidates(
        [
          scoreDjCandidate(
            name,
            candidate({
              name,
              country: "Austria",
              city: "Vienna",
              followers: 5000,
              genres: ["techno"],
              profileUrl: `https://soundcloud.com/${name.toLowerCase()}`,
              soundcloudUrl: `https://soundcloud.com/${name.toLowerCase()}`,
            })
          ),
        ],
        name
      );
      assert.equal(decision.status, "review", name);
      assert.equal(decision.chosen, null, name);
    }

    const anchored = decideDjCandidates(
      [
        scoreDjCandidate(
          "Izzy",
          candidate({
            name: "Izzy",
            country: "United Kingdom",
            city: "London",
            profileUrl: "https://soundcloud.com/izzy",
            soundcloudUrl: "https://soundcloud.com/izzy",
          }),
          {
            eventLink: false,
            crossSoundcloud: true,
            crossInstagram: false,
            crossCountry: false,
          }
        ),
      ],
      "Izzy"
    );
    assert.equal(anchored.status, "auto");
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

  it("does not write a junk SoundCloud city such as Tsunami", () => {
    const plan = planDjFieldUpdates({
      dj: emptyDj({ name: "TSUKI", slug: "tsuki" }),
      soundcloud: candidate({
        name: "TSUKI",
        city: "Tsunami",
        country: "Japan",
        bio: "Tsuki.",
        profileUrl: "https://soundcloud.com/tsuki",
        soundcloudUrl: "https://soundcloud.com/tsuki",
      }),
      ra: null,
      force: false,
      columns: COLUMNS,
    });

    assert.equal(plan.updates.city, undefined);
    assert.equal(plan.updates.country, "Japan");
    assert.equal(plan.updates.bio, "Tsuki.");
  });

  it("leaves a non-empty city alone and only replaces a Vienna default when asked", () => {
    const london = candidate({
      name: "CALYX",
      city: "South London",
      country: "United Kingdom",
      bio: "Drum and bass.",
      profileUrl: "https://soundcloud.com/calyx",
      soundcloudUrl: "https://soundcloud.com/calyx",
    });
    const viennaDefault = emptyDj({
      name: "CALYX",
      slug: "calyx",
      city: "Vienna",
      country: "Austria",
      bio: "Keep this bio.",
    });

    const held = planDjFieldUpdates({
      dj: viennaDefault,
      soundcloud: london,
      ra: null,
      force: false,
      columns: COLUMNS,
    });
    assert.equal(held.updates.city, undefined);
    assert.equal(held.updates.country, undefined);
    assert.equal(held.updates.bio, undefined);
    assert.ok(held.skippedNonEmpty.includes("city"));
    assert.ok(held.skippedNonEmpty.includes("bio"));

    const replaced = planDjFieldUpdates({
      dj: viennaDefault,
      soundcloud: london,
      ra: null,
      force: false,
      fixDefaultLocation: true,
      columns: COLUMNS,
    });
    assert.equal(replaced.updates.city, "South London");
    assert.equal(replaced.updates.country, "United Kingdom");
    assert.equal(replaced.updates.bio, undefined);

    const berlin = planDjFieldUpdates({
      dj: emptyDj({
        name: "CALYX",
        slug: "calyx",
        city: "Berlin",
        country: "Germany",
      }),
      soundcloud: london,
      ra: null,
      force: false,
      fixDefaultLocation: true,
      columns: COLUMNS,
    });
    assert.equal(berlin.updates.city, undefined);
    assert.equal(berlin.updates.country, undefined);
  });

  it("does not clear the city when the replacement location is junk or missing", () => {
    const viennaDefault = emptyDj({
      name: "CALYX",
      slug: "calyx",
      city: "Vienna",
      country: "Austria",
    });

    for (const city of ["Tsunami", null]) {
      const plan = planDjFieldUpdates({
        dj: viennaDefault,
        soundcloud: candidate({
          name: "CALYX",
          city,
          country: "United Kingdom",
          profileUrl: "https://soundcloud.com/calyx",
          soundcloudUrl: "https://soundcloud.com/calyx",
        }),
        ra: null,
        force: false,
        fixDefaultLocation: true,
        columns: COLUMNS,
      });

      assert.equal(plan.updates.city, undefined);
      assert.equal(plan.updates.country, undefined);
      assert.equal(Object.values(plan.updates).includes(null), false);
      assert.ok(plan.skippedNonEmpty.includes("country"));
    }
  });

  it("does not overwrite filled fields when only-empty is set, even with force", () => {
    const plan = planDjFieldUpdates({
      dj: emptyDj({
        bio: "Hand written bio",
        image_url: null,
      }),
      soundcloud: candidate({
        name: "Stimming",
        bio: "Imported bio",
        avatarUrl: "https://i1.sndcdn.com/avatars-example-t500x500.jpg",
        profileUrl: "https://soundcloud.com/stimming",
        soundcloudUrl: "https://soundcloud.com/stimming",
      }),
      ra: null,
      force: true,
      onlyEmpty: true,
      columns: COLUMNS,
    });

    assert.equal(plan.updates.bio, undefined);
    assert.equal(plan.updates.image_url, "https://i1.sndcdn.com/avatars-example-t500x500.jpg");
    assert.ok(plan.skippedNonEmpty.includes("bio"));

    const location = planDjFieldUpdates({
      dj: emptyDj({
        name: "CALYX",
        slug: "calyx",
        city: "Vienna",
        country: "Austria",
      }),
      soundcloud: candidate({
        name: "CALYX",
        city: "South London",
        country: "United Kingdom",
        profileUrl: "https://soundcloud.com/calyx",
        soundcloudUrl: "https://soundcloud.com/calyx",
      }),
      ra: null,
      force: true,
      onlyEmpty: true,
      fixDefaultLocation: true,
      columns: COLUMNS,
    });

    assert.equal(location.updates.city, undefined);
    assert.equal(location.updates.country, undefined);
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

  it("treats the saved SoundCloud URL as a confirmed match and ignores other accounts", () => {
    const result = matchDjProfiles({
      dj: emptyDj({
        name: "ANATOL",
        slug: "anatol",
        soundcloud_url: "https://m.soundcloud.com/Anatol-Official/",
      }),
      soundcloud: [
        candidate({
          name: "Anatol Official",
          username: "anatol-official",
          followers: 40,
          bio: "Official Anatol page.",
          profileUrl: "https://soundcloud.com/anatol-official",
          soundcloudUrl: "https://soundcloud.com/anatol-official",
        }),
        candidate({
          name: "ANATOL",
          username: "anatolol",
          country: "Austria",
          city: "Vienna",
          followers: 9000,
          genres: ["techno"],
          profileUrl: "https://soundcloud.com/anatolol",
          soundcloudUrl: "https://soundcloud.com/anatolol",
        }),
      ],
      ra: [
        candidate({
          source: "ra",
          name: "ANATOL",
          country: "Austria",
          city: "Vienna",
          followers: 80,
          websiteUrl: "https://anatolol.example",
          profileUrl: "https://ra.co/dj/anatolol",
          soundcloudUrl: "https://soundcloud.com/anatolol",
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.soundcloud.status, "auto");
    assert.equal(
      result.soundcloud.chosen?.candidate.profileUrl,
      "https://soundcloud.com/anatol-official"
    );
    assert.ok(result.soundcloud.chosen?.reasons.includes("saved_soundcloud_url"));
    assert.equal(result.updates.bio, "Official Anatol page.");
    assert.equal(result.updates.website_url, undefined);
    assert.equal(result.raMerge, "skipped_conflict");
    assert.equal(result.ra.status, "review");
  });

  it("does not adopt a different SoundCloud account when the saved URL is missing from search", () => {
    const result = matchDjProfiles({
      dj: emptyDj({
        name: "Crazy Sonic",
        slug: "crazy-sonic",
        soundcloud_url: "https://soundcloud.com/crazy-sonic",
      }),
      soundcloud: [
        candidate({
          name: "Crazy Sonic",
          country: "Austria",
          city: "Vienna",
          followers: 11,
          genres: ["techno"],
          profileUrl: "https://soundcloud.com/crazysonic",
          soundcloudUrl: "https://soundcloud.com/crazysonic",
        }),
      ],
      ra: [
        candidate({
          source: "ra",
          name: "Crazy Sonic",
          country: "Austria",
          city: "Vienna",
          websiteUrl: "https://crazysonic.example",
          profileUrl: "https://ra.co/dj/crazysonic",
          soundcloudUrl: "https://soundcloud.com/crazysonic",
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.soundcloud.status, "none");
    assert.equal(result.soundcloud.chosen, null);
    assert.equal(result.updates.country, undefined);
    assert.equal(result.updates.website_url, undefined);
    assert.equal(result.ra.status, "review");
    assert.equal(result.raMerge, "skipped_conflict");
  });

  it("auto-applies a saved SoundCloud profile that would otherwise stay in review", () => {
    const result = matchDjProfiles({
      dj: emptyDj({
        name: "Tomagan",
        slug: "tomagan",
        soundcloud_url: "https://soundcloud.com/Tomagan/",
      }),
      soundcloud: [
        candidate({
          name: "Tomagan",
          followers: 30,
          bio: "Tomagan.",
          profileUrl: "https://soundcloud.com/tomagan",
          soundcloudUrl: "https://soundcloud.com/tomagan",
        }),
        candidate({
          name: "Tomagan",
          followers: 25,
          profileUrl: "https://soundcloud.com/tomagan-live",
          soundcloudUrl: "https://soundcloud.com/tomagan-live",
        }),
      ],
      ra: [],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.soundcloud.status, "auto");
    assert.equal(result.soundcloud.chosen?.candidate.profileUrl, "https://soundcloud.com/tomagan");
    assert.equal(result.updates.bio, "Tomagan.");
  });

  it("does not auto-apply an RA profile whose home is Prague just because it plays Vienna", () => {
    const prague = candidate({
      source: "ra",
      name: "Aras",
      country: "Czechia",
      city: "Prague",
      followers: 1,
      genres: ["techno"],
      playsVienna: true,
      playsAustria: true,
      profileUrl: "https://ra.co/dj/aras",
      soundcloudUrl: null,
    });
    assert.equal(raOnlyAutoAllowed(prague, 10), false);
    assert.equal(raOnlyAutoAllowed(prague, null), false);

    const result = matchDjProfiles({
      dj: emptyDj({ name: "Aras", slug: "aras" }),
      soundcloud: [],
      ra: [prague],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.ra.status, "review");
    assert.equal(result.raMerge, "not_used");
    assert.equal(result.updates.country, undefined);
  });

  it("accepts a unique RA name with no home location and does not invent a country", () => {
    const result = matchDjProfiles({
      dj: emptyDj({ name: "Comrade Martin", slug: "comrade-martin" }),
      soundcloud: [],
      ra: [
        candidate({
          source: "ra",
          name: "Comrade Martin",
          city: null,
          country: null,
          followers: 2,
          playsVienna: true,
          playsAustria: true,
          profileUrl: "https://ra.co/dj/comrademartin",
          soundcloudUrl: null,
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.ra.status, "auto");
    assert.equal(result.raMerge, "applied");
    assert.equal(result.updates.country, undefined);
    assert.equal(result.updates.city, undefined);
  });

  it("accepts a generic name when the saved SoundCloud URL is the anchor", () => {
    const result = matchDjProfiles({
      dj: emptyDj({
        name: "Izzy",
        slug: "izzy",
        soundcloud_url: "https://soundcloud.com/izzy",
      }),
      soundcloud: [
        candidate({
          name: "Izzy",
          followers: 20,
          bio: "Izzy.",
          profileUrl: "https://soundcloud.com/izzy",
          soundcloudUrl: "https://soundcloud.com/izzy",
        }),
      ],
      ra: [],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.soundcloud.status, "auto");
    assert.equal(result.updates.bio, "Izzy.");
  });

  it("keeps a Vienna RA-only profile in review when the margin is under 12", () => {
    const vienna = candidate({
      source: "ra",
      name: "Stimming",
      country: "Austria",
      city: "Vienna",
      followers: 300,
      profileUrl: "https://ra.co/dj/stimming",
      soundcloudUrl: null,
    });
    assert.equal(raOnlyAutoAllowed(vienna, 10), false);
    assert.equal(raOnlyAutoAllowed(vienna, null), true);
    assert.equal(raOnlyAutoAllowed(vienna, 12), true);

    const result = matchDjProfiles({
      dj: emptyDj({ name: "Stimming", slug: "stimming" }),
      soundcloud: [],
      ra: [
        vienna,
        candidate({
          source: "ra",
          name: "Stimming",
          country: "Austria",
          city: "Vienna",
          followers: 100,
          profileUrl: "https://ra.co/dj/stimming-other",
          soundcloudUrl: null,
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.ra.status, "review");
    assert.equal(result.updates.country, undefined);
  });

  it("still applies a foreign RA profile when it matches the confirmed SoundCloud account", () => {
    const result = matchDjProfiles({
      dj: emptyDj({
        name: "Aras",
        slug: "aras",
        soundcloud_url: "https://soundcloud.com/aras",
      }),
      soundcloud: [
        candidate({
          name: "Aras",
          country: "Austria",
          city: "Vienna",
          followers: 400,
          genres: ["techno"],
          profileUrl: "https://soundcloud.com/aras",
          soundcloudUrl: "https://soundcloud.com/aras",
        }),
      ],
      ra: [
        candidate({
          source: "ra",
          name: "Aras",
          country: "Czechia",
          city: "Prague",
          followers: 1,
          playsVienna: true,
          websiteUrl: "https://aras.example",
          profileUrl: "https://ra.co/dj/aras",
          soundcloudUrl: "https://soundcloud.com/aras",
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.soundcloud.status, "auto");
    assert.equal(result.ra.status, "auto");
    assert.equal(result.raMerge, "applied");
    assert.equal(result.updates.country, "Austria");
    assert.equal(result.updates.website_url, "https://aras.example");
  });

  it("prefers the tied RA profile whose Instagram matches the saved account", () => {
    const result = matchDjProfiles({
      dj: emptyDj({
        name: "Gerald VDH",
        slug: "gerald-vdh",
        soundcloud_url: "https://soundcloud.com/geraldvdh",
        instagram_url: "https://instagram.com/geraldvdh",
      }),
      soundcloud: [
        candidate({
          name: "Gerald VDH",
          country: "Austria",
          city: "Vienna",
          followers: 400,
          genres: ["techno"],
          instagramUrl: null,
          profileUrl: "https://soundcloud.com/geraldvdh",
          soundcloudUrl: "https://soundcloud.com/geraldvdh",
        }),
      ],
      ra: [
        candidate({
          source: "ra",
          name: "Gerald VDH",
          country: "Austria",
          city: "Vienna",
          followers: 50,
          websiteUrl: "https://other.example",
          instagramUrl: "https://instagram.com/gerald-other",
          profileUrl: "https://ra.co/dj/geraldvanderhint",
          soundcloudUrl: null,
        }),
        candidate({
          source: "ra",
          name: "Gerald VDH",
          country: "Austria",
          city: "Vienna",
          followers: 50,
          websiteUrl: "https://gerald.example",
          instagramUrl: "https://instagram.com/geraldvdh",
          profileUrl: "https://ra.co/dj/geraldvdh",
          soundcloudUrl: null,
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.ra.status, "auto");
    assert.equal(result.ra.chosen?.candidate.profileUrl, "https://ra.co/dj/geraldvdh");
    assert.equal(result.raMerge, "applied");
    assert.equal(result.updates.website_url, "https://gerald.example");
  });

  it("leaves tied RA profiles in review when neither link matches", () => {
    const result = matchDjProfiles({
      dj: emptyDj({
        name: "Gerald VDH",
        slug: "gerald-vdh",
        soundcloud_url: "https://soundcloud.com/geraldvdh",
        instagram_url: "https://instagram.com/geraldvdh",
      }),
      soundcloud: [
        candidate({
          name: "Gerald VDH",
          country: "Austria",
          city: "Vienna",
          followers: 400,
          genres: ["techno"],
          profileUrl: "https://soundcloud.com/geraldvdh",
          soundcloudUrl: "https://soundcloud.com/geraldvdh",
        }),
      ],
      ra: [
        candidate({
          source: "ra",
          name: "Gerald VDH",
          country: "Austria",
          city: "Vienna",
          followers: 50,
          websiteUrl: "https://hint.example",
          instagramUrl: "https://instagram.com/gerald-hint",
          profileUrl: "https://ra.co/dj/geraldvanderhint",
          soundcloudUrl: null,
        }),
        candidate({
          source: "ra",
          name: "Gerald VDH",
          country: "Austria",
          city: "Vienna",
          followers: 50,
          websiteUrl: "https://vdh.example",
          instagramUrl: "https://instagram.com/gerald-vdh-live",
          profileUrl: "https://ra.co/dj/geraldvdh",
          soundcloudUrl: null,
        }),
      ],
      evidence: { soundcloudUrls: [], instagramUrls: [] },
      force: false,
      columns: COLUMNS,
    });

    assert.equal(result.ra.status, "review");
    assert.equal(result.ra.chosen, null);
    assert.equal(result.raMerge, "not_used");
    assert.equal(result.updates.website_url, undefined);
  });
});
