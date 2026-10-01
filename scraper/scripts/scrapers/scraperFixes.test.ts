import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseLineupNames, prepareLineupForDjImport } from "../../../scripts/lib/lineupArtists.ts";
import {
  collectDasWerkProgram,
  parseDasWerkProgramHtml,
} from "./dasWerkParse.ts";
import {
  classifyEdmEvent,
  confidenceForEdmDecision,
  draftStatusForEdmDecision,
  EDM_KEYWORDS,
  NON_EDM_KEYWORDS,
} from "./edmFilter.ts";
import { parseGrelleDateFromTitle } from "./eventYear.ts";
import { isRelevantRaveEvent } from "./helpers.ts";
import { extractLineup } from "./lineup.ts";

const HUEBL_ACTS = "HUEBL // JustUS // JORIS TURENHOUT // ALBIN BREZLAN // TOMAGAN";
const HUEBL_WITH_SPACES =
  "HUEBL // Just US // JORIS TURENHOUT // ALBIN BREZLAN // TOMAGAN";

const TECHNO_OBSCENE_DESCRIPTION = `RAVE REQUIREMENT: COMMITMENT. Sweat is optional at the door.
╪ LINE UP ╪
╱LASTER FLOOR╲ RAVE (Detroit, Hardtechno, Rave,…)
▶︎ HUEBL
▶︎ justUS
▶︎ JORIS TURENHOUT
╱LUSTER FLOOR╲ GROOVE (Dub, Hypnotic, Groove,..)
▶︎ ALBIN BREZLAN
▶︎ TOMAGAN
▶︎ T.B.A.
Come as you are - we don’t make a difference. We won’t tell you what to wear.`;

const GDN_DESCRIPTION = `Wir laden euch ein zur KLUBNACHT.
Am Mainfloor erwartet euch Hard Bounce und Acid Techno.

LINEUP:
GOLPE @golpe_brokenrobot
ANATOL @anatol_musik
AUDIO303 @audio303_
CASTRO @castro.aiff
COMRADE MARTIN @comrade_martin
DJ WIFI @dj.wifi_
FRANKË @toobefrankee
KRISTUS b2b pinklotion
@kristusmitk @p1nklotion

graphics by @philippmachtdiesen
AWARENESS
Our trained awareness team will be on site to ensure your safety tonight.`;

const GRELLE_DESCRIPTION = `F*CKEN PLUS
FACEBOOK
lineup
MAINFLOOR
JERM
Gerald VDH
DJ Deadlift
KITCHEN
Philipp Eicher & Friends
entry
DOORS
23:00`;

function textChunk(id: string, text: string): string {
  return `${id}:T${Buffer.byteLength(text).toString(16)},${text}`;
}

function flightHtml(decoded: string, links: string[] = []): string {
  const anchors = links.map((href) => `<a href="${href}">page</a>`).join("");
  return `<script>self.__next_f.push([1,${JSON.stringify(decoded)}])</script>${anchors}`;
}

function eventsPayload(
  events: Array<Record<string, unknown>>,
  chunks: string[] = [],
): string {
  const grid = `19:["$","div",null,{"events":${JSON.stringify(events)}}]`;
  return [...chunks, grid].join("\n");
}

describe("lineup parser", () => {
  it("splits // into one DJ name per element and keeps order", () => {
    assert.deepEqual(parseLineupNames(HUEBL_ACTS), [
      "HUEBL",
      "JustUS",
      "JORIS TURENHOUT",
      "ALBIN BREZLAN",
      "TOMAGAN",
    ]);
    assert.deepEqual(parseLineupNames(HUEBL_WITH_SPACES), [
      "HUEBL",
      "Just US",
      "JORIS TURENHOUT",
      "ALBIN BREZLAN",
      "TOMAGAN",
    ]);
  });

  it("strips floor headers, bullets, emoji, and splits b2b / f2f / vs / &", () => {
    assert.deepEqual(
      parseLineupNames(
        "Floor 1: Charlotte de Witte | Mainfloor: Amelie Lens // Live: FJAAK",
      ),
      ["Charlotte de Witte", "Amelie Lens", "FJAAK"],
    );
    assert.deepEqual(
      parseLineupNames("▶︎ HUEBL 😈\nMainfloor\nKitchen\nLive:\nAKOV f2f MANTA"),
      ["HUEBL", "AKOV", "MANTA"],
    );
    assert.deepEqual(
      parseLineupNames("Annakonda B2B Stendhal Syndrome\nLeft vs Right\nAlpha & Beta"),
      ["Annakonda", "Stendhal Syndrome", "Left", "Right", "Alpha", "Beta"],
    );
  });

  it("trims, dedupes case-insensitively, and keeps the richer spelling", () => {
    assert.deepEqual(parseLineupNames("justUS // HUEBL // JustUS // HUEBL"), [
      "JustUS",
      "HUEBL",
    ]);
    assert.deepEqual(parseLineupNames("KØ:LAB"), ["KØ:LAB"]);
    assert.deepEqual(parseLineupNames("MaurerTezibel"), ["Maurer", "Tezibel"]);
  });

  it("drops tba and floor labels that used to be stored as artists", () => {
    assert.deepEqual(
      prepareLineupForDjImport([
        "[MAINFLOOR]",
        "Floor 1:",
        "Live:",
        "KITCHEN Hosted By Bassbussi",
        "T.B.A.",
        "HUEBL // JustUS",
      ]),
      ["HUEBL", "JustUS"],
    );
  });

  it("extracts DJ names that only appear in the description", () => {
    assert.deepEqual(extractLineup(GDN_DESCRIPTION), [
      "GOLPE",
      "ANATOL",
      "AUDIO303",
      "CASTRO",
      "COMRADE MARTIN",
      "DJ WIFI",
      "FRANKË",
      "KRISTUS",
      "pinklotion",
    ]);

    assert.deepEqual(extractLineup(TECHNO_OBSCENE_DESCRIPTION), [
      "HUEBL",
      "justUS",
      "JORIS TURENHOUT",
      "ALBIN BREZLAN",
      "TOMAGAN",
    ]);

    assert.deepEqual(extractLineup(GRELLE_DESCRIPTION), [
      "JERM",
      "Gerald VDH",
      "DJ Deadlift",
      "Philipp Eicher",
      "Friends",
    ]);

    assert.deepEqual(extractLineup(HUEBL_WITH_SPACES), [
      "HUEBL",
      "Just US",
      "JORIS TURENHOUT",
      "ALBIN BREZLAN",
      "TOMAGAN",
    ]);
  });

  it("prefers the acts-line spelling when the description repeats a name", () => {
    const lineup = parseLineupNames(
      [...parseLineupNames(HUEBL_ACTS), ...extractLineup(TECHNO_OBSCENE_DESCRIPTION)].join(
        "\n",
      ),
    );
    assert.deepEqual(lineup, [
      "HUEBL",
      "JustUS",
      "JORIS TURENHOUT",
      "ALBIN BREZLAN",
      "TOMAGAN",
    ]);
  });
});

describe("non-EDM filter", () => {
  it("keeps the keyword lists editable as plain arrays", () => {
    assert.ok(EDM_KEYWORDS.includes("techno"));
    assert.ok(EDM_KEYWORDS.includes("hardstyle"));
    assert.ok(EDM_KEYWORDS.includes("dubstep"));
    assert.ok(NON_EDM_KEYWORDS.includes("schlager"));
    assert.ok(NON_EDM_KEYWORDS.includes("karaoke"));
    assert.ok(NON_EDM_KEYWORDS.includes("reggaeton"));
  });

  it("keeps electronic nights and rejects clear non-EDM nights", () => {
    for (const title of [
      "Techno Obsence",
      "House night",
      "Drum and Bass",
      "Trance classics",
      "Hardstyle",
      "Minimal House",
      "Electro",
      "Breaks",
      "Dubstep",
    ]) {
      assert.equal(classifyEdmEvent({ title, description: "", genres: [] }).decision, "keep", title);
    }

    for (const title of [
      "80er Party",
      "90s Night",
      "2000s Party",
      "Pop Night",
      "Schlagerfest",
      "Austropop Abend",
      "Karaoke",
      "Hip-Hop Night",
      "RnB only",
      "Reggaeton Night",
      "Indie Rock",
    ]) {
      assert.equal(
        classifyEdmEvent({ title, description: "", genres: [] }).decision,
        "reject",
        title,
      );
    }
  });

  it("uses title, description, and genres, and reviews borderline bills", () => {
    assert.equal(
      classifyEdmEvent({
        title: "Friday",
        description: "doors at 23:00",
        genres: ["Techno"],
      }).decision,
      "keep",
    );
    assert.equal(
      classifyEdmEvent({
        title: "Friday",
        description: "",
        genres: ["Schlager"],
      }).decision,
      "reject",
    );
    assert.equal(
      classifyEdmEvent({
        title: "90s Techno",
        description: "warehouse rave",
        genres: [],
      }).decision,
      "review",
    );
    assert.equal(
      classifyEdmEvent({
        title: "Hip-Hop x Techno",
        description: "",
        genres: ["Hip-Hop", "Techno"],
      }).decision,
      "review",
    );
    assert.equal(
      classifyEdmEvent({
        title: "The Tunegirl Live",
        description: "club night",
        genres: [],
      }).decision,
      "review",
    );
    assert.equal(
      classifyEdmEvent({ title: "Disco", description: "", genres: [] }).decision,
      "review",
    );
    assert.equal(
      classifyEdmEvent({ title: "Mystery Session", description: "", genres: [] }).decision,
      "review",
    );

    const borderline = classifyEdmEvent({ title: "90s Techno", description: "", genres: [] });
    assert.equal(draftStatusForEdmDecision(borderline.decision), "pending");
    assert.equal(confidenceForEdmDecision(borderline.decision, "2026-10-03"), 0.45);

    const rejected = classifyEdmEvent({ title: "Schlagerfest", description: "", genres: [] });
    assert.equal(draftStatusForEdmDecision(rejected.decision), "rejected");
    assert.equal(isRelevantRaveEvent({
      title: "Schlagerfest",
      description: null,
      genres: [],
      event_date: null,
      start_time: null,
      price: null,
      ticket_url: null,
      image_url: null,
      external_url: "https://example.test",
      external_id: "1",
      raw_data: {},
    }), false);
  });
});

describe("Grelle Forelle dates", () => {
  const october2026 = new Date(2026, 9, 1);

  it("uses the next occurrence instead of a hardcoded year", () => {
    assert.equal(parseGrelleDateFromTitle("02/10 Purradox w/ Øtta", october2026), "2026-10-02");
    assert.equal(parseGrelleDateFromTitle("24/10 RAM", october2026), "2026-10-24");
    assert.equal(parseGrelleDateFromTitle("10/02 Dagny", october2026), "2027-02-10");
    assert.equal(parseGrelleDateFromTitle("03/03 Boondawg", october2026), "2027-03-03");
    assert.equal(
      parseGrelleDateFromTitle("05/01 Something", new Date(2026, 11, 20)),
      "2027-01-05",
    );
  });

  it("keeps a date that is only slightly in the past", () => {
    assert.equal(
      parseGrelleDateFromTitle("31/12 NYE", new Date(2027, 0, 3)),
      "2026-12-31",
    );
    assert.equal(
      parseGrelleDateFromTitle("31/12 NYE", new Date(2027, 0, 20)),
      "2027-12-31",
    );
    assert.equal(parseGrelleDateFromTitle("16/10/2028 Explicit", october2026), "2028-10-16");
    assert.equal(parseGrelleDateFromTitle("No date here", october2026), null);
  });
});

describe("Das Werk pagination", () => {
  const pageOneEvents = [
    {
      id: "a",
      documentId: "a",
      title: "Techno Obsence",
      dateIso: "2026-10-03T21:00:00.000Z",
      actsLine: HUEBL_ACTS,
      description: TECHNO_OBSCENE_DESCRIPTION,
      ticketUrl: "",
      flyerUrl: null,
    },
    {
      id: "b",
      documentId: "b",
      title: "GDN Klubnacht",
      dateIso: "2026-10-02T21:00:00.000Z",
      actsLine: "GOLPE",
      description: "$1a",
      ticketUrl: "",
      flyerUrl: null,
    },
  ];

  const pageTwoEvents = [
    {
      id: "c",
      documentId: "c",
      title: "Halloween",
      dateIso: "2026-10-31T22:00:00.000Z",
      actsLine: "",
      description: "",
      ticketUrl: "",
      flyerUrl: null,
    },
  ];

  const gdnBody = "LINEUP:\nGOLPE @golpe\nANATOL @anatol\nKRISTUS b2b pinklotion\n";

  const pageOneHtml = flightHtml(
    eventsPayload(pageOneEvents, [textChunk("1a", gdnBody)]),
    ["/program?page=2"],
  );
  const pageTwoHtml = flightHtml(eventsPayload(pageTwoEvents), ["/program?page=2"]);

  it("parses the flight payload and resolves description references", () => {
    const events = parseDasWerkProgramHtml(pageOneHtml);
    assert.equal(events.length, 2);
    assert.equal(events[0]?.actsLine, HUEBL_ACTS);
    assert.match(events[1]?.description ?? "", /ANATOL/);
    assert.equal(extractLineup(events[1]?.description ?? "").includes("ANATOL"), true);
  });

  it("loads later program pages and does not walk past the last linked page", async () => {
    const fetched: string[] = [];
    const pages = new Map<string, string>([
      ["https://www.daswerk.org/program", pageOneHtml],
      ["https://www.daswerk.org/program?page=2", pageTwoHtml],
      ["https://www.daswerk.org/program?page=3", pageTwoHtml],
    ]);

    const events = await collectDasWerkProgram(
      "https://www.daswerk.org/program",
      async (url) => {
        fetched.push(url);
        const html = pages.get(url);
        if (!html) throw new Error(`unexpected url ${url}`);
        return html;
      },
    );

    assert.deepEqual(
      events.map((event) => event.title),
      ["Techno Obsence", "GDN Klubnacht", "Halloween"],
    );
    assert.deepEqual(fetched, [
      "https://www.daswerk.org/program",
      "https://www.daswerk.org/program?page=2",
    ]);
  });

  it("still reads the older escaped events payload", () => {
    const json = JSON.stringify([
      {
        id: "1",
        documentId: "1",
        title: "Techno Obsence",
        dateIso: "2026-10-03T21:00:00.000Z",
        actsLine: HUEBL_ACTS,
        description: "",
        ticketUrl: "",
        flyerUrl: null,
      },
    ]);
    const inner = json.slice(1, -1).replace(/"/g, '\\"');
    const html = `{\\"events\\":[${inner}]}]}]}`;
    const events = parseDasWerkProgramHtml(html);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.title, "Techno Obsence");
    assert.equal(events[0]?.actsLine, HUEBL_ACTS);
  });
});
