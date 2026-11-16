import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseLineupText, formatLineupArray } from "../../../src/lib/lineup.ts";
import { lineupToTextArray } from "../../../src/lib/publishDraft.ts";
import { prepareLineupForDjImport } from "../../../scripts/lib/lineupArtists.ts";
import { isDasWerkClubNight } from "./dasWerk.ts";
import { parseDasWerkProgramHtml } from "./dasWerkParse.ts";
import { parseIsoDateTimeLocal } from "./helpers.ts";
import { extractLineup, htmlToStructuredText } from "./lineup.ts";

/** Lineup block from grelleforelle.com FISH MARKET, 20/11/2026. */
const FISH_MARKET_HTML = `
<h1><strong>lineup</strong></h1>
<p>MAINFLOOR<br />
ALTINBAS<br class="html-br" />Annika Stein<br class="html-br" />Gerald VDH</p>
<p>KITCHEN hosted by LuvAffair<br class="html-br" />Lim Banda<br class="html-br" />Sabina<br class="html-br" />Ernst</p>
<h1><strong>entry</strong></h1>
<p>DOORS<br />
23:00</p>
<p>PRE SALE<br />
eventjet</p>
<p>BOX OFFICE<br />
opens doors at 23:00</p>
`;

/** Floor bill from the 54Hz pres. CREEDS description on daswerk.org/program. */
const CREEDS_DESCRIPTION = `⛓️ CREEDS kommt ins Werk. ⛓️

Bounce • Hard Dance• Hard Techno

Main Floor:
CREEDS @creeds_official
Arman Shadow @armanshadow
DJ Wolle @dj_wolle1
Rantom b2b SODA
@rantom.official @arekrolz

Luster Floor:
MUSA @thisismusa_
ADANA @adana.wav
ADRIALIN @adrialin_dj

📍Das Werk
🗓️ 21.11.26
🕚 23:00-06:00
💰AK 20€`;

/** Resident Night floor bill from the same program page. */
const RESIDENT_DESCRIPTION = `⚙️Main Floor:
DETOXX @detoxxyourmind
GOLPE @golpe_brokenrobot
DJ WIFI @dj.wifi_ w/ @moritz.amadeuz

🌌Luster Floor:
KINGSMO @kingsmo.mp3
NIKLIST @nikilist_ok
ARMAN SHADOW @armanshadow
RANTOM @rantom.official

visuals by @itscatherines`;

/** Dead End Showcase X GDN body, stored on the page as the $1a flight chunk. */
const DEAD_END_DESCRIPTION = `>>LINEUP<<
DEAD END will take over the mainfloor with a powerful lineup of their residents:
Paralich
THIRD 2HIFT
Valenthin b2b SAYA
The Second floor will be hosted by our GDN residents & friends:
catercarlo
DJ WIFI
KRISTUS
LUZZT b2b ANER
Rantom
We’re looking forward to raving with you!
Stay hard,
your Gesindel`;

/** Per-DJ floors from theloft.at BASSBUSSI ALLSTARS detail page. */
const LOFT_BASSBUSSI =
  "Oben: Andrew Ahmed b2b Sluzy, Partypauli b2b Maro, Arman Shadow b2b Leanne. Unten: Ave Maria b2b Christella, Wo.Izzy b2b DJ Parkverbot, Aschenbrenner b2b Zeq, Anatol b2b Pink Lotion";

function flightHtml(decoded: string): string {
  return `<script>self.__next_f.push([1,${JSON.stringify(decoded)}])</script>`;
}

function textChunk(id: string, text: string): string {
  return `${id}:T${Buffer.byteLength(text).toString(16)},${text}`;
}

describe("lineups are DJ names only", () => {
  it("drops Grelle FISH MARKET rooms and the door text", () => {
    const text = htmlToStructuredText(FISH_MARKET_HTML);
    assert.match(text, /MAINFLOOR\n+ALTINBAS/);
    assert.deepEqual(extractLineup(text), [
      "ALTINBAS",
      "Annika Stein",
      "Gerald VDH",
      "Lim Banda",
      "Sabina",
      "Ernst",
    ]);
  });

  it("does not glue a room onto the next DJ or leak entry DOORS", () => {
    assert.deepEqual(
      extractLineup("lineup\nMAINFLOOR\nErnst entry DOORS 23:00\nPRE SALE"),
      ["Ernst"],
    );
  });

  it("drops Das Werk floor headers and splits b2b", () => {
    assert.deepEqual(extractLineup(CREEDS_DESCRIPTION), [
      "CREEDS",
      "Arman Shadow",
      "DJ Wolle",
      "Rantom",
      "SODA",
      "MUSA",
      "ADANA",
      "ADRIALIN",
    ]);
    assert.deepEqual(extractLineup(RESIDENT_DESCRIPTION), [
      "DETOXX",
      "GOLPE",
      "DJ WIFI",
      "KINGSMO",
      "NIKLIST",
      "ARMAN SHADOW",
      "RANTOM",
    ]);
  });

  it("splits prose-floor b2b sets into separate DJs", () => {
    assert.deepEqual(extractLineup(DEAD_END_DESCRIPTION), [
      "Paralich",
      "THIRD 2HIFT",
      "Valenthin",
      "SAYA",
      "catercarlo",
      "DJ WIFI",
      "KRISTUS",
      "LUZZT",
      "ANER",
      "Rantom",
    ]);
  });

  it("splits a one-line Loft bill and drops Oben, Unten, and Wohnzimmer", () => {
    assert.deepEqual(extractLineup(`Lineup:\n${LOFT_BASSBUSSI}`), [
      "Andrew Ahmed",
      "Sluzy",
      "Partypauli",
      "Maro",
      "Arman Shadow",
      "Leanne",
      "Ave Maria",
      "Christella",
      "Wo.Izzy",
      "DJ Parkverbot",
      "Aschenbrenner",
      "Zeq",
      "Anatol",
      "Pink Lotion",
    ]);
    assert.deepEqual(extractLineup("Lineup:\nWohnzimmer: Ada, Ben b2b Cee"), [
      "Ada",
      "Ben",
      "Cee",
    ]);
  });
});

describe("Das Werk club nights", () => {
  it("keeps title-only club nights and drops concerts", () => {
    for (const title of [
      "Herzfrequenz",
      "Dystopia",
      "Dead End Showcase X GDN",
      "Nine Circles",
      "Rave am Mittwoch",
    ]) {
      assert.equal(
        isDasWerkClubNight({
          title,
          description: "",
          start_time: "23:00:00",
        }),
        true,
        title,
      );
    }

    assert.equal(
      isDasWerkClubNight({
        title: "Konzert: Florian",
        description: "",
        start_time: "19:00:00",
      }),
      false,
    );
    assert.equal(
      isDasWerkClubNight({
        title: "Konzert: TÄRA",
        description: "",
        start_time: "19:00:00",
      }),
      false,
    );
    assert.equal(
      isDasWerkClubNight({
        title: "Introduction Night W/ VANDALISBIN & POP:SCH",
        description: "Doors: 19:00\nStart: 20:00",
        start_time: "19:00:00",
      }),
      false,
    );
    assert.equal(
      isDasWerkClubNight({
        title: "Rock Night",
        description: "live band",
        start_time: "23:00:00",
      }),
      false,
    );
  });

  it("resolves a $1a description and still drafts the night when the ref is broken", () => {
    const events = [
      {
        id: "dead-end",
        documentId: "dead-end",
        title: "Dead End Showcase X GDN",
        dateIso: "2026-11-28T22:00:00.000Z",
        actsLine: "",
        description: "$1a",
        ticketUrl: "",
        flyerUrl: null,
      },
      {
        id: "nine",
        documentId: "nine",
        title: "Nine Circles",
        dateIso: "2026-12-05T22:00:00.000Z",
        actsLine: "",
        description: "$1b",
        ticketUrl: "",
        flyerUrl: null,
      },
    ];
    const decoded = [
      textChunk("1a", DEAD_END_DESCRIPTION),
      `19:["$","div",null,{"events":${JSON.stringify(events)}}]`,
    ].join("\n");

    const parsed = parseDasWerkProgramHtml(flightHtml(decoded));
    const deadEnd = parsed.find((event) => event.title === "Dead End Showcase X GDN");
    const nine = parsed.find((event) => event.title === "Nine Circles");

    assert.match(deadEnd?.description ?? "", /Valenthin b2b SAYA/);
    assert.equal(nine?.description ?? "", "");
    assert.equal(
      isDasWerkClubNight({
        title: nine?.title ?? "",
        description: nine?.description,
        start_time: parseIsoDateTimeLocal(nine?.dateIso ?? "").time,
      }),
      true,
    );
    assert.deepEqual(extractLineup(deadEnd?.description ?? ""), [
      "Paralich",
      "THIRD 2HIFT",
      "Valenthin",
      "SAYA",
      "catercarlo",
      "DJ WIFI",
      "KRISTUS",
      "LUZZT",
      "ANER",
      "Rantom",
    ]);
  });

  it("still reads the older escaped events payload", () => {
    const json = JSON.stringify([
      {
        id: "1",
        documentId: "1",
        title: "Herzfrequenz",
        dateIso: "2026-11-14T22:00:00.000Z",
        actsLine: "",
        description: "LINE-UP (A-Z):\\nCRYSTAL O\\nDJ WOLLE",
        ticketUrl: "",
        flyerUrl: null,
      },
    ]);
    const inner = json.slice(1, -1).replace(/"/g, '\\"');
    const html = `{\\"events\\":[${inner}]}]}]}`;
    const events = parseDasWerkProgramHtml(html);
    assert.equal(events[0]?.title, "Herzfrequenz");
    assert.match(events[0]?.description ?? "", /CRYSTAL O/);
    assert.deepEqual(extractLineup(events[0]?.description ?? ""), [
      "CRYSTAL O",
      "DJ WOLLE",
    ]);
  });
});

describe("stored lineup keeps stage markers", () => {
  const lineup = [
    "[MAINFLOOR]",
    "ALTINBAS",
    "Annika Stein",
    "[KITCHEN hosted by LuvAffair]",
    "Lim Banda",
    "Rantom b2b SODA",
  ];

  it("round-trips markers through review text and publish conversion", () => {
    assert.deepEqual(parseLineupText(formatLineupArray(lineup)), lineup);
    assert.deepEqual(lineupToTextArray(lineup), lineup);
    assert.deepEqual(lineupToTextArray(JSON.stringify(lineup)), lineup);
  });

  it("lets DJ import skip markers and split b2b without changing the stored array", () => {
    const stored = [...lineup];
    assert.deepEqual(prepareLineupForDjImport(stored), [
      "ALTINBAS",
      "Annika Stein",
      "Lim Banda",
      "Rantom",
      "SODA",
    ]);
    assert.deepEqual(stored, lineup);
  });
});
