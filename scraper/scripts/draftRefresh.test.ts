import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDraftRow,
  type ExistingDraftRow,
} from "./draftRefresh.ts";
import type { ScrapedEvent, ScrapeSource } from "./scrapers/types.ts";

const source: ScrapeSource = {
  id: "source-das-werk",
  name: "Das Werk",
  url: "https://daswerk.org/program",
  venue_id: "venue-das-werk",
};

function scraped(overrides: Partial<ScrapedEvent> = {}): ScrapedEvent {
  return {
    title: "Synergy",
    event_date: "2026-11-20",
    start_time: "23:00:00",
    price: 16,
    genres: ["Techno"],
    description: "Club night at Das Werk.",
    ticket_url: "https://tickets.example/synergy",
    image_url: "https://cdn.daswerk.org/flyers/synergy.jpg",
    external_url: "https://daswerk.org/program",
    external_id: "synergy-2026-11-20",
    raw_data: { venue: "Das Werk" },
    ...overrides,
  };
}

function existing(overrides: Partial<ExistingDraftRow> = {}): ExistingDraftRow {
  return {
    external_id: "synergy-2026-11-20",
    title: "Synergy",
    event_date: "2026-11-20",
    start_time: "23:30:00",
    price: 14,
    genres: ["Techno", "Hard Techno"],
    description: "Filled from Resident Advisor.",
    lineup: ["DJ One", "DJ Two"],
    ticket_url: "https://ra.co/events/synergy",
    image_url: "https://img.ra.co/synergy-flyer.jpg",
    external_url: "https://ra.co/events/synergy",
    status: "pending",
    raw_data: { ticketswap_url_manual: true },
    sold_out: false,
    ...overrides,
  };
}

describe("pending draft refresh", () => {
  it("keeps existing values when the scrape leaves those fields empty", () => {
    const row = buildDraftRow(
      source,
      scraped({
        title: "   ",
        event_date: null,
        start_time: null,
        price: null,
        genres: [],
        description: null,
        ticket_url: null,
        image_url: null,
        external_url: "",
        raw_data: { flyerUrl: null },
      }),
      existing(),
    );

    assert.equal(row.title, "Synergy");
    assert.equal(row.event_date, "2026-11-20");
    assert.equal(row.start_time, "23:30:00");
    assert.equal(row.price, 14);
    assert.deepEqual(row.genres, ["Techno", "Hard Techno"]);
    assert.equal(row.description, "Filled from Resident Advisor.");
    assert.deepEqual(row.lineup, ["DJ One", "DJ Two"]);
    assert.equal(row.ticket_url, "https://ra.co/events/synergy");
    assert.equal(row.image_url, "https://img.ra.co/synergy-flyer.jpg");
    assert.equal(row.external_url, "https://ra.co/events/synergy");
    assert.equal(row.confidence, 0.8);
    assert.equal(row.raw_data.ticketswap_url_manual, true);
    assert.equal("ticketswap_url" in row, false);
    assert.equal(Object.hasOwn(row, "price"), true);
    assert.equal(Object.hasOwn(row, "image_url"), true);
  });

  it("keeps a Das Werk price and flyer the venue page did not return", () => {
    const deadEnd = buildDraftRow(
      source,
      scraped({
        title: "Dead End Showcase X GDN",
        event_date: "2026-11-28",
        price: null,
        image_url: null,
        external_id: "dead-end-2026-11-28",
      }),
      existing({
        external_id: "dead-end-2026-11-28",
        title: "Dead End Showcase X GDN",
        event_date: "2026-11-28",
        price: 14,
        image_url: "https://img.ra.co/dead-end-flyer.jpg",
      }),
    );

    assert.equal(deadEnd.price, 14);
    assert.equal(deadEnd.image_url, "https://img.ra.co/dead-end-flyer.jpg");

    const synergy = buildDraftRow(
      source,
      scraped({
        title: "Synergy",
        event_date: "2026-11-20",
        price: null,
        image_url: null,
      }),
      existing({
        image_url: "https://img.ra.co/synergy-flyer.jpg",
        price: 14,
      }),
    );

    assert.equal(synergy.image_url, "https://img.ra.co/synergy-flyer.jpg");
    assert.equal(synergy.price, 14);
  });

  it("replaces a favicon placeholder when the scrape finds a real flyer", () => {
    const row = buildDraftRow(
      source,
      scraped({
        image_url: "https://cdn.daswerk.org/flyers/synergy.jpg",
        price: null,
      }),
      existing({
        image_url: "https://daswerk.org/favicon.ico",
        price: 14,
      }),
    );

    assert.equal(row.image_url, "https://cdn.daswerk.org/flyers/synergy.jpg");
    assert.equal(row.price, 14);
  });

  it("does not replace a real flyer with a favicon", () => {
    const row = buildDraftRow(
      source,
      scraped({
        image_url: "https://daswerk.org/wp-content/uploads/cropped-favicon-32x32.png",
      }),
      existing({
        image_url: "https://img.ra.co/synergy-flyer.jpg",
      }),
    );

    assert.equal(row.image_url, "https://img.ra.co/synergy-flyer.jpg");
  });

  it("updates fields the scrape actually filled in", () => {
    const row = buildDraftRow(
      source,
      scraped({
        title: "Synergy (late show)",
        price: 18,
        start_time: "00:30:00",
        genres: ["Hard Techno"],
        description: "Lineup:\nDJ Three",
        ticket_url: "https://tickets.example/synergy-late",
      }),
      existing(),
    );

    assert.equal(row.title, "Synergy (late show)");
    assert.equal(row.price, 18);
    assert.equal(row.start_time, "00:30:00");
    assert.deepEqual(row.genres, ["Hard Techno"]);
    assert.deepEqual(row.lineup, ["DJ Three"]);
    assert.equal(row.ticket_url, "https://tickets.example/synergy-late");
    assert.match(row.description ?? "", /DJ Three/);
  });

  it("stores a free price of 0 and does not treat it as missing", () => {
    const written = buildDraftRow(
      source,
      scraped({ price: 0 }),
      existing({ price: 14 }),
    );
    assert.equal(written.price, 0);

    const kept = buildDraftRow(
      source,
      scraped({ price: null }),
      existing({ price: 0 }),
    );
    assert.equal(kept.price, 0);
  });

  it("still stores nulls when the draft is new", () => {
    const row = buildDraftRow(
      source,
      scraped({
        event_date: null,
        start_time: null,
        price: null,
        genres: [],
        description: null,
        ticket_url: null,
        image_url: null,
      }),
      undefined,
    );

    assert.equal(row.event_date, null);
    assert.equal(row.start_time, null);
    assert.equal(row.price, null);
    assert.deepEqual(row.genres, []);
    assert.equal(row.description, null);
    assert.deepEqual(row.lineup, []);
    assert.equal(row.ticket_url, null);
    assert.equal(row.image_url, null);
    assert.equal(row.confidence, 0.35);
  });

  it("keeps a manual sold-out lock and its raw_data flag", () => {
    const row = buildDraftRow(
      source,
      scraped({ sold_out: false, raw_data: { venue: "Das Werk" } }),
      existing({
        sold_out: true,
        raw_data: { sold_out_manual: true, ticketswap_url_manual: true },
      }),
    );

    assert.equal(row.sold_out, true);
    assert.equal(row.raw_data.sold_out_manual, true);
    assert.equal(row.raw_data.ticketswap_url_manual, true);
    assert.equal(row.raw_data.venue, "Das Werk");
  });

  it("never sends is_promoted, even when a scrape mentions it", () => {
    const row = buildDraftRow(
      source,
      scraped({ raw_data: { is_promoted: true, venue: "Das Werk" } }),
      existing(),
    );

    assert.equal("is_promoted" in row, false);
    assert.equal(row.raw_data.is_promoted, true);
  });
});
