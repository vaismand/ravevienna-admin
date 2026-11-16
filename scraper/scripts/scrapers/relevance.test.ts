import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  hasGenreRejectContext,
  hasHardRejectKeywords,
  isRelevantRaveEvent,
} from "./helpers.ts";
import { isRelevantRaEvent } from "./raParse.ts";
import type { ScrapedEvent } from "./types.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

function event(text: string, title = "Night"): ScrapedEvent {
  return {
    title,
    event_date: "2026-11-27",
    start_time: "23:00:00",
    price: null,
    genres: [],
    description: text,
    ticket_url: null,
    image_url: null,
    external_url: "https://example.test/event",
    external_id: "event",
    raw_data: {},
  };
}

describe("genre reject context", () => {
  it("ignores rock inside a quoted track title and keeps FLASHBACK", () => {
    const text = fixture("grelle-flashback.txt");
    assert.equal(hasGenreRejectContext(text), false);
    assert.equal(hasHardRejectKeywords(text), false);
    assert.equal(isRelevantRaveEvent(event(text, "FLASHBACK w/ THOMAS SCHUMACHER")), true);
  });

  it("rejects a real rock concert and a genre phrase, not a longer word", () => {
    const haematom = fixture("arena-haematom.txt");
    assert.equal(isRelevantRaveEvent(event(haematom, "HÄMATOM")), false);
    assert.equal(hasHardRejectKeywords(haematom), true);

    assert.equal(hasGenreRejectContext("Indie Rock night at the club"), true);
    assert.equal(hasHardRejectKeywords("Rock/Pop concert"), true);
    assert.equal(hasHardRejectKeywords("rock night with a live band"), true);
    assert.equal(isRelevantRaveEvent(event("Indie Rock night at the club. DJs all night.")), false);

    assert.equal(hasGenreRejectContext("When I Rock"), false);
    assert.equal(hasGenreRejectContext("rocking the floor"), false);
    assert.equal(hasHardRejectKeywords("Rockford"), false);
  });

  it("lets a known techno credit outweigh a stray genre phrase", () => {
    const text =
      "Thomas Schumacher. A review called it an indie rock night, but the floor is techno.";
    assert.equal(hasGenreRejectContext(text), true);
    assert.equal(hasHardRejectKeywords(text), false);
    assert.equal(isRelevantRaveEvent(event(text)), true);
  });
});

describe("Resident Advisor non-club filter", () => {
  function ra(partial: {
    title: string;
    venueName: string;
    raGenres: string[];
  }) {
    return isRelevantRaEvent({
      title: partial.title,
      venueName: partial.venueName,
      genres: [],
      raGenres: partial.raGenres,
      artists: [],
      promoters: [],
    });
  }

  it("drops concert halls, skybars, rooftops, O-Club, and disco-only Funkhaus", () => {
    assert.equal(
      ra({
        title: "Mavi Phoenix (live)",
        venueName: "Wiener Konzerthaus",
        raGenres: ["Techno"],
      }),
      false,
    );
    assert.equal(
      ra({
        title: "AWSM. SKYSCRAPER EDITION",
        venueName: "Altia Skybar - DC Tower",
        raGenres: ["House"],
      }),
      false,
    );
    assert.equal(
      ra({
        title: "Rooftop Series at Mariatrink",
        venueName: "Jaz in the City",
        raGenres: ["House"],
      }),
      false,
    );
    assert.equal(
      ra({
        title: "AWSM. NYE SKYLINE EDITION",
        venueName: "Oktogon am Himmel",
        raGenres: ["Techno"],
      }),
      false,
    );
    assert.equal(
      ra({
        title: "Techno at O-Club",
        venueName: "O der Klub",
        raGenres: ["Techno"],
      }),
      false,
    );
    assert.equal(
      ra({
        title: "Volksgarten closing",
        venueName: "Volksgarten",
        raGenres: ["House"],
      }),
      false,
    );
    assert.equal(
      ra({
        title: "The House of Funk presents Ricky Chong",
        venueName: "Funkhaus Wien",
        raGenres: ["Disco", "Funk / Soul"],
      }),
      false,
    );
  });

  it("keeps techno and DnB at known rave venues", () => {
    for (const venueName of [
      "Das Werk",
      "Grelle Forelle",
      "The Loft",
      "SASS Music Club",
      "FLUCC",
      "Flex",
      "Arena Wien",
      "Rhiz",
      "Loop",
    ]) {
      assert.equal(
        ra({ title: "Club night", venueName, raGenres: ["Techno"] }),
        true,
        venueName,
      );
    }
    assert.equal(
      ra({
        title: "COLLAPSE - EATBRAIN NIGHT",
        venueName: "Arena Wien",
        raGenres: ["Drum & Bass"],
      }),
      true,
    );
  });
});
