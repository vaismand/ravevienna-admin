import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isTicketSwapUrl, ticketSwapUrlError } from "../../../src/lib/ticketswapUrl.ts";
import { isTicketSwapUrlManuallySet } from "../../../src/lib/ticketswapManual.ts";
import {
  buildTicketSwapSearchQuery,
  isViennaListing,
  listingsFromSitemapXml,
  matchTicketSwapEvent,
  parseTicketSwapEventUrl,
  titleTokensForMatch,
  venuePhrasesForMatch,
  type TicketSwapListing,
} from "./match.ts";
import {
  compareDiscoveryTargets,
  planTicketSwapRowUpdates,
} from "./plan.ts";
import { eventSitemapUrls } from "./sitemap.ts";

const PARADIES =
  "https://www.ticketswap.com/club-tickets/paradies-garten-w-paracek-vienna-grelle-forelle-2026-11-14-CgXLaXqyeALeQq7my9yxT";
const GURRIERS =
  "https://www.ticketswap.com/concert-tickets/gurriers-vienna-flex-2026-11-20-CbczVQko53hbus94WHu1h";
const RONNIE =
  "https://www.ticketswap.com/concert-tickets/ronnie-flex-amsterdam-ziggo-dome-2027-06-12-CgEuLP13zWU5J19RWPADd";
const STADTHALLE =
  "https://www.ticketswap.com/concert-tickets/tokio-hotel-vienna-wiener-stadthalle-2026-11-15-HcMYm89v78Ze741qhVoe7V";
const STADTHALLE_HALL =
  "https://www.ticketswap.com/concert-tickets/tokio-hotel-arena-tour-2026-vienna-wiener-stadthalle-halle-f-2026-11-15-Cfm2pThKaCbRoyssppZYg";

function listing(url: string, lastmod: string | null = null): TicketSwapListing {
  const parsed = parseTicketSwapEventUrl(url, lastmod);
  assert.ok(parsed, url);
  return parsed;
}

describe("TicketSwap URL validation", () => {
  it("accepts TicketSwap locale hosts and rejects lookalikes", () => {
    assert.equal(isTicketSwapUrl("https://www.ticketswap.com/event/abc"), true);
    assert.equal(isTicketSwapUrl("https://ticketswap.at/club-tickets/night"), true);
    assert.equal(isTicketSwapUrl("http://www.ticketswap.de/"), true);
    assert.equal(isTicketSwapUrl("https://www.ticketswap.co.uk/event/x"), true);
    assert.equal(isTicketSwapUrl("https://ticketswap.com.evil.com/event"), false);
    assert.equal(isTicketSwapUrl("https://notticketswap.com/event"), false);
    assert.equal(isTicketSwapUrl("https://user:pass@ticketswap.com/event"), false);
    assert.equal(isTicketSwapUrl("javascript:alert(1)"), false);
    assert.equal(isTicketSwapUrl(""), false);
    assert.equal(ticketSwapUrlError(""), null);
    assert.equal(ticketSwapUrlError("https://example.com"), "TicketSwap URL must be an http(s) link on a TicketSwap domain (ticketswap.com, ticketswap.at, and other TicketSwap locales).");
  });
});

describe("sitemap event URLs", () => {
  it("reads the date and slug and ignores other pages", () => {
    const parsed = parseTicketSwapEventUrl(PARADIES);
    assert.equal(parsed?.date, "2026-11-14");
    assert.equal(
      parsed?.slug,
      "paradies-garten-w-paracek-vienna-grelle-forelle",
    );
    assert.equal(isViennaListing(parsed!), true);
    assert.equal(
      parseTicketSwapEventUrl("https://www.ticketswap.com/city/vienna/1487"),
      null,
    );
    assert.equal(isViennaListing(listing(RONNIE)), false);
  });

  it("parses sitemap xml and the event sitemap index", () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>${PARADIES}</loc><lastmod>2026-11-01T00:00:00+00:00</lastmod></url>
      <url><loc>https://www.ticketswap.com/city/vienna/1487</loc></url>
    </urlset>`;
    const listings = listingsFromSitemapXml(xml);
    assert.equal(listings.length, 1);
    assert.equal(listings[0]?.lastmod, "2026-11-01T00:00:00+00:00");

    const index = `<sitemapindex><sitemap><loc>https://www.ticketswap.com/sitemap/event_0.xml</loc></sitemap><sitemap><loc>https://www.ticketswap.com/sitemap/city_0.xml</loc></sitemap><sitemap><loc>https://www.ticketswap.com/sitemap/event_12.xml</loc></sitemap></sitemapindex>`;
    assert.deepEqual(eventSitemapUrls(index), [
      "https://www.ticketswap.com/sitemap/event_0.xml",
      "https://www.ticketswap.com/sitemap/event_12.xml",
    ]);
  });
});

describe("matching rules", () => {
  it("keeps the event name ahead of a lineup and the presented name", () => {
    assert.deepEqual(titleTokensForMatch("Paradies Garten w/ Paraçek"), [
      "paradies",
      "garten",
    ]);
    assert.deepEqual(
      titleTokensForMatch("THE HIVE & COLLAPSE w/ ED RUSH, WAEYS & WINGZ"),
      ["hive", "collapse"],
    );
    assert.deepEqual(titleTokensForMatch("54Hz pres. CREEDS"), ["creeds"]);
    assert.deepEqual(venuePhrasesForMatch("SASS Music Club"), [["sass"]]);
    assert.deepEqual(venuePhrasesForMatch("FLUCC"), [["flucc"], ["fluc"]]);
    assert.deepEqual(venuePhrasesForMatch("Arena Wien"), [["arena"]]);
    assert.deepEqual(venuePhrasesForMatch("Grelle Forelle"), [
      ["grelle", "forelle"],
    ]);
  });

  it("links a sold-out night when date, venue, and title agree", () => {
    const result = matchTicketSwapEvent(
      {
        title: "Paradies Garten w/ Paraçek",
        venueName: "Grelle Forelle",
        date: "2026-11-14",
      },
      [listing(PARADIES), listing(GURRIERS)],
    );
    assert.equal(result.status, "match");
    assert.equal(result.confidence, "high");
    assert.equal(result.url, PARADIES);
  });

  it("does not link a different date or a different venue", () => {
    const wrongDate = matchTicketSwapEvent(
      {
        title: "Paradies Garten w/ Paraçek",
        venueName: "Grelle Forelle",
        date: "2026-11-15",
      },
      [listing(PARADIES)],
    );
    assert.equal(wrongDate.status, "none");

    const wrongVenue = matchTicketSwapEvent(
      {
        title: "Paradies Garten w/ Paraçek",
        venueName: "Flex",
        date: "2026-11-14",
      },
      [listing(PARADIES)],
    );
    assert.equal(wrongVenue.status, "review");
    assert.equal(wrongVenue.url, null);
  });

  it("does not treat Ronnie Flex in Amsterdam as Flex Vienna", () => {
    const result = matchTicketSwapEvent(
      { title: "Ronnie Flex", venueName: "Flex", date: "2027-06-12" },
      [listing(RONNIE), listing(GURRIERS)],
    );
    assert.equal(result.status, "none");
  });

  it("links Flex Vienna when the venue token follows the city", () => {
    const result = matchTicketSwapEvent(
      { title: "Gurriers", venueName: "Flex", date: "2026-11-20" },
      [listing(GURRIERS), listing(RONNIE)],
    );
    assert.equal(result.status, "match");
    assert.equal(result.url, GURRIERS);
  });

  it("collapses duplicate sitemap ids and refuses two different listings", () => {
    const older = PARADIES.replace(
      "CgXLaXqyeALeQq7my9yxT",
      "AAAAAAAAAAAAAAA",
    );
    const collapsed = matchTicketSwapEvent(
      {
        title: "Paradies Garten w/ Paraçek",
        venueName: "Grelle Forelle",
        date: "2026-11-14",
      },
      [
        listing(older, "2026-10-01T00:00:00+00:00"),
        listing(PARADIES, "2026-11-02T00:00:00+00:00"),
      ],
    );
    assert.equal(collapsed.status, "match");
    assert.equal(collapsed.url, PARADIES);

    const ambiguous = matchTicketSwapEvent(
      {
        title: "Tokio Hotel",
        venueName: "Wiener Stadthalle",
        date: "2026-11-15",
      },
      [listing(STADTHALLE), listing(STADTHALLE_HALL)],
    );
    assert.equal(ambiguous.status, "review");
    assert.equal(ambiguous.url, null);
    assert.equal(ambiguous.candidates.length, 2);
  });

  it("links a two-word title and keeps a short one for review", () => {
    const subZero = matchTicketSwapEvent(
      { title: "SUB ZERO", venueName: "The Loft", date: "2026-11-20" },
      [
        listing(
          "https://www.ticketswap.com/club-tickets/sub-zero-vienna-loft-2026-11-20-Abcd1234ef",
        ),
      ],
    );
    assert.equal(subZero.status, "match");

    const tooShort = matchTicketSwapEvent(
      { title: "Go", venueName: "The Loft", date: "2026-11-20" },
      [
        listing(
          "https://www.ticketswap.com/club-tickets/go-vienna-loft-2026-11-20-Abcd1234ef",
        ),
      ],
    );
    assert.equal(tooShort.status, "review");
    assert.equal(tooShort.url, null);

    const partial = matchTicketSwapEvent(
      {
        title: "OUT OF CTRL - eardrums",
        venueName: "Arena Wien",
        date: "2026-11-14",
      },
      [
        listing(
          "https://www.ticketswap.com/club-tickets/eardrums-vienna-arena-wien-2026-11-14-Abcd1234ef",
        ),
      ],
    );
    assert.equal(partial.status, "review");
    assert.equal(partial.candidates[0]?.reason.includes("title"), true);
  });

  it("does not review a listing that only shares wiener or club", () => {
    const wiener = matchTicketSwapEvent(
      {
        title: "DnB @ Wiener Würstelstand Spittelau",
        venueName: "Wiener Würstelstand Spittelau",
        date: "2026-11-21",
      },
      [
        listing(
          "https://www.ticketswap.com/concert-tickets/gregorian-vienna-wiener-stadthalle-2026-11-21-CdzuRFtKkiEWvvKAfaWt9",
        ),
      ],
    );
    assert.equal(wiener.status, "none");

    const club = matchTicketSwapEvent(
      {
        title: "CYBERTRIBE pres. CLUB GSPUSI",
        venueName: "The Loft",
        date: "2026-12-18",
      },
      [
        listing(
          "https://www.ticketswap.com/concert-tickets/ivo-der-bandit-vienna-club-lucia-2026-12-18-Cbpyp1BRVKj2CE2NyayR2",
        ),
      ],
    );
    assert.equal(club.status, "none");
  });

  it("builds the same kind of search query the app helper does", () => {
    assert.equal(
      buildTicketSwapSearchQuery({
        title: "Gurriers",
        venueName: "Flex",
        date: "2026-11-20",
      }),
      'site:ticketswap.com "Gurriers" "Flex" "Vienna" 2026',
    );
  });
});

describe("manual protection and carry-over", () => {
  it("does not overwrite a hand-set link, including a cleared one", () => {
    assert.equal(
      planTicketSwapRowUpdates({
        hasDraft: true,
        hasEvent: true,
        draftUrl: "https://www.ticketswap.at/event/hand",
        eventUrl: "https://www.ticketswap.at/event/hand",
        manual: true,
        proposedUrl: PARADIES,
      }),
      null,
    );

    assert.equal(
      planTicketSwapRowUpdates({
        hasDraft: true,
        hasEvent: true,
        draftUrl: null,
        eventUrl: null,
        manual: true,
        proposedUrl: PARADIES,
      }),
      null,
    );

    assert.equal(
      isTicketSwapUrlManuallySet({ ticketswap_url_manual: true, source: "Flex" }),
      true,
    );

    assert.deepEqual(
      planTicketSwapRowUpdates({
        hasDraft: true,
        hasEvent: true,
        draftUrl: "https://www.ticketswap.at/event/hand",
        eventUrl: null,
        manual: true,
        proposedUrl: PARADIES,
      }),
      { eventUrl: "https://www.ticketswap.at/event/hand" },
    );
  });

  it("mirrors an existing link and otherwise stores one proposal on empty rows", () => {
    assert.deepEqual(
      planTicketSwapRowUpdates({
        hasDraft: true,
        hasEvent: true,
        draftUrl: "https://www.ticketswap.com/event/kept",
        eventUrl: null,
        manual: false,
        proposedUrl: PARADIES,
      }),
      { eventUrl: "https://www.ticketswap.com/event/kept" },
    );

    assert.deepEqual(
      planTicketSwapRowUpdates({
        hasDraft: true,
        hasEvent: true,
        draftUrl: null,
        eventUrl: null,
        manual: false,
        proposedUrl: PARADIES,
      }),
      { draftUrl: PARADIES, eventUrl: PARADIES },
    );

    assert.equal(
      planTicketSwapRowUpdates({
        hasDraft: true,
        hasEvent: false,
        draftUrl: null,
        eventUrl: null,
        manual: false,
        proposedUrl: null,
      }),
      null,
    );
  });

  it("sorts sold-out events ahead of the rest", () => {
    const rows = [
      { soldOut: false, eventDate: "2026-11-14", title: "A" },
      { soldOut: true, eventDate: "2026-11-20", title: "B" },
      { soldOut: true, eventDate: "2026-11-14", title: "C" },
    ].sort(compareDiscoveryTargets);
    assert.deepEqual(
      rows.map((row) => row.title),
      ["C", "B", "A"],
    );
  });
});
