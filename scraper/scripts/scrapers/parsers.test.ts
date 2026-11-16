import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as cheerio from "cheerio";

import { splitLineupCollaborations } from "../../../scripts/lib/lineupArtists.ts";
import { isPastViennaDate } from "../../../scripts/lib/dates.ts";
import { readArenaRelevanceFromHtml } from "./arena.ts";
import { isSameEvent, matchVenueId } from "./eventMatch.ts";
import { readFluccDescription } from "./flucc.ts";
import { extractLineup, htmlToStructuredText, normalizeLineupNames } from "./lineup.ts";
import { chooseLoftImage, loftLineupText } from "./theLoft.ts";
import { parseRaEventListings } from "./raParse.ts";
import { parseSassLineupHtml } from "./sass.ts";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixture(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("shared lineup normalization", () => {
  it("splits b2b, B2B, vs and a clear x, and keeps real names", () => {
    assert.deepEqual(splitLineupCollaborations("Valenthin b2b SAYA"), [
      "Valenthin",
      "SAYA",
    ]);
    assert.deepEqual(splitLineupCollaborations("Dimitrios B2B Hagen Wings"), [
      "Dimitrios",
      "Hagen Wings",
    ]);
    assert.deepEqual(splitLineupCollaborations("Left vs Right"), ["Left", "Right"]);
    assert.deepEqual(splitLineupCollaborations("Sub Focus x Dimension"), [
      "Sub Focus",
      "Dimension",
    ]);
    assert.deepEqual(splitLineupCollaborations("Camo & Krooked"), ["Camo & Krooked"]);
    assert.deepEqual(splitLineupCollaborations("Pola & Bryson"), ["Pola & Bryson"]);
    assert.deepEqual(splitLineupCollaborations("Axel"), ["Axel"]);
    assert.deepEqual(splitLineupCollaborations("R&B"), ["R&B"]);
    assert.deepEqual(splitLineupCollaborations("Dead End Showcase X GDN"), [
      "Dead End Showcase X GDN",
    ]);
    assert.deepEqual(normalizeLineupNames(["LaLa"]), ["LaLa"]);
  });

  it("splits a floor that sits in the middle of a one-line bill", () => {
    assert.deepEqual(
      extractLineup(
        "Lineup: Oben: WHO IS ELA B2B MARØ, DIZZYDRAY B2B WHO IS ELA¿ Unten: AVO2X B2B ENJA, GOLDI",
      ),
      ["WHO IS ELA", "MARØ", "DIZZYDRAY", "AVO2X", "ENJA", "GOLDI"],
    );
  });

  it("drops a Das Werk floor header that names the genre and promoter", () => {
    assert.deepEqual(
      extractLineup(
        "lineup\n[LASTERFLOOR – HARD TECHNO BY HEKTISCH]\nHektisch\nDimitrios b2b Hagen Wings",
      ),
      ["Hektisch", "Dimitrios", "Hagen Wings"],
    );
  });
});

describe("Grelle Forelle lineup fixture", () => {
  it("keeps DJ names and drops rooms, the block header, and label trails", () => {
    const text = htmlToStructuredText(fixture("grelle-flash-lineup.html"));
    assert.deepEqual(extractLineup(text), [
      "THOMAS SCHUMACHER aka ELEKTROCHEMIE LK",
      "JORO & JOABO",
      "ROKIS",
      "TOM SNOW",
      "MC MARS",
      "MC SPOT",
      "MARTIN OELZ",
      "ROMEN EST OMEN",
      "HANNEKEN",
    ]);
  });
});

describe("FLUCC lineup fixture", () => {
  it("does not glue separate paragraphs into one name", () => {
    const $ = cheerio.load(fixture("flucc-lineup.html"));
    const description = readFluccDescription($);
    assert.match(description, /ALET\nARAS/);
    assert.notEqual(description.replace(/\s/g, ""), "ALETARASLaLa");
    assert.deepEqual(extractLineup(description), [
      "ALET",
      "ARAS",
      "LaLa",
      "WAL_HALLA",
      "DJ PARKVERBOT",
    ]);
  });
});

describe("SASS lineup fixture", () => {
  it("keeps LaLa when only the first syllable is in strong", () => {
    const $ = cheerio.load(fixture("sass-lala.html"));
    const names = parseSassLineupHtml($(".lineup").html() ?? "");
    assert.deepEqual(names, ["Tim Kern", "LaLa", "LaLa"]);
    assert.equal(names.includes("La"), false);
  });
});

describe("The Loft fixture", () => {
  it("splits a one-line bill, strips country tags, and skips the favicon", () => {
    const $ = cheerio.load(fixture("loft-event.html"));
    const lineup = loftLineupText($);
    assert.ok(lineup);
    assert.deepEqual(extractLineup(`Lineup:\n${lineup}`), [
      "Stef Davidse",
      "Kjaer",
      "LaLa",
      "Dimitrios",
      "Hagen Wings",
    ]);

    const image = chooseLoftImage(
      "https://www.theloft.at/wp-content/uploads/2022/08/cropped-loft_logo_favicon.png",
      $("script[type='application/ld+json']").text().includes("subzero-flyer")
        ? "https://www.theloft.at/wp-content/uploads/2026/10/subzero-flyer.jpg"
        : null,
    );
    assert.equal(
      image,
      "https://www.theloft.at/wp-content/uploads/2026/10/subzero-flyer.jpg",
    );
    assert.equal(isPastViennaDate("2020-01-01", "2026-11-16"), true);
    assert.equal(isPastViennaDate("2026-11-16", "2026-11-16"), false);
  });
});

describe("Arena Wien fixtures", () => {
  it("keeps Eatbrain and a 19:00 Camo & Krooked open air, and drops a pop open air", () => {
    const collapse = readArenaRelevanceFromHtml(fixture("arena-collapse.html"));
    const camo = readArenaRelevanceFromHtml(fixture("arena-camo.html"));
    const wanda = readArenaRelevanceFromHtml(fixture("arena-wanda.html"));

    assert.equal(collapse.startTime, "22:00:00");
    assert.equal(collapse.relevant, true);
    assert.equal(camo.startTime, "19:00:00");
    assert.equal(camo.relevant, true);
    assert.equal(wanda.relevant, false);
  });
});

describe("Resident Advisor fixture", () => {
  it("maps lineup, time, venue, price and flyer, and skips concerts, fancy clubs and past dates", () => {
    const payload = JSON.parse(fixture("ra-vienna.json")) as unknown;
    const venues = [
      { id: "venue-werk", name: "Das Werk" },
      { id: "venue-arena", name: "Arena Wien" },
      { id: "venue-flex", name: "Flex" },
    ];
    const events = parseRaEventListings(payload, venues, "2026-11-16");
    const titles = events.map((event) => event.title);
    assert.deepEqual(titles, [
      "SYNERGY RAVE x Trance + Hard Techno",
      "COLLAPSE - EATBRAIN NIGHT",
    ]);

    const synergy = events[0];
    assert.ok(synergy);
    assert.equal(synergy.event_date, "2026-11-20");
    assert.equal(synergy.start_time, "23:00:00");
    assert.equal(synergy.raw_data.end_time, "06:00:00");
    assert.equal(synergy.price, 10);
    assert.equal(synergy.image_url, "https://images.ra.co/synergy.jpg");
    assert.equal(synergy.raw_data.venue_id, "venue-werk");
    assert.deepEqual(synergy.lineup, [
      "Dimitrios",
      "Valenthin",
      "SAYA",
      "Camo & Krooked",
    ]);
    assert.equal(
      matchVenueId("SASS Music Club", [{ id: "venue-sass", name: "SASS" }]),
      "venue-sass",
    );

    assert.equal(
      isSameEvent(
        {
          title: "Synergy",
          event_date: "2026-11-20",
          venue_id: "venue-werk",
          venue_name: "Das Werk",
        },
        {
          title: synergy.title,
          event_date: synergy.event_date,
          venue_id: "venue-werk",
          venue_name: "Das Werk",
        },
      ),
      true,
    );
    assert.equal(
      isSameEvent(
        {
          title: "SUB ZERO",
          event_date: "2026-11-20",
          venue_id: "venue-loft",
          venue_name: "The Loft",
        },
        {
          title: "SUBZERO",
          event_date: "2026-11-20",
          venue_id: "venue-loft",
          venue_name: "The Loft",
        },
      ),
      true,
    );
    assert.equal(
      isSameEvent(
        {
          title: "SUB ZERO",
          event_date: "2026-11-20",
          venue_id: "venue-loft",
          venue_name: "The Loft",
        },
        {
          title: "Männer im Loft",
          event_date: "2026-11-20",
          venue_id: "venue-loft",
          venue_name: "The Loft",
        },
      ),
      false,
    );
    assert.equal(
      isSameEvent(
        {
          title: "FISH MARKET feat. Altinbas, Annika Stein, Gerald VDH, LuvAffair Floor",
          event_date: "2026-11-20",
          venue_id: "venue-grelle",
          venue_name: "Grelle Forelle",
        },
        {
          title: "FISH MARKET - Altinbas",
          event_date: "2026-11-20",
          venue_id: "venue-grelle",
          venue_name: "Grelle Forelle",
        },
      ),
      true,
    );
  });
});
