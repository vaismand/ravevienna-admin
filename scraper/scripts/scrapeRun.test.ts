import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatScrapeSummary, runScrapersIsolated } from "./scrapeRun.ts";
import type { ScrapeSource, ScrapedEvent } from "./scrapers/types.ts";

function source(name: string): ScrapeSource {
  return {
    id: name,
    name,
    url: "https://example.test",
    venue_id: "venue",
  };
}

function event(title: string): ScrapedEvent {
  return {
    title,
    event_date: "2026-10-03",
    start_time: "23:00:00",
    price: null,
    genres: ["Techno"],
    description: null,
    ticket_url: null,
    image_url: null,
    external_url: "https://example.test/event",
    external_id: title,
    raw_data: {},
  };
}

describe("per-source error isolation", () => {
  it("continues after a source throws and prints a summary", async () => {
    const invoked: string[] = [];
    const saved: string[] = [];
    const logs: string[] = [];
    const errors: string[] = [];

    const results = await runScrapersIsolated(
      [source("Arena Wien"), source("Das Werk"), source("Flex"), source("Unknown")],
      {
        "Arena Wien": async (item) => {
          invoked.push(item.name);
          return [event("Arena night")];
        },
        "Das Werk": async (item) => {
          invoked.push(item.name);
          throw new Error("program page timed out");
        },
        Flex: async (item) => {
          invoked.push(item.name);
          return [event("Flex night"), event("Flex late")];
        },
      },
      {
        afterScrape: async (item) => {
          saved.push(item.name);
        },
        log: (line) => logs.push(line),
        errorLog: (line) => errors.push(line),
      },
    );

    assert.deepEqual(invoked, ["Arena Wien", "Das Werk", "Flex"]);
    assert.deepEqual(saved, ["Arena Wien", "Flex"]);
    assert.deepEqual(
      results.map((result) => [result.sourceName, result.status, result.eventCount]),
      [
        ["Arena Wien", "ok", 1],
        ["Das Werk", "failed", 0],
        ["Flex", "ok", 2],
        ["Unknown", "skipped", 0],
      ],
    );
    assert.equal(results[1]?.error, "program page timed out");
    assert.ok(errors.some((line) => line.includes("Das Werk")));

    const summary = logs.at(-1) ?? "";
    assert.match(summary, /Scrape summary: 2 ok, 1 failed, 1 skipped/);
    assert.match(summary, /FAILED\s+Das Werk — program page timed out/);
    assert.equal(summary, formatScrapeSummary(results));
  });

  it("isolates a failure while saving events and still runs the next source", async () => {
    const saved: string[] = [];

    const results = await runScrapersIsolated(
      [source("Das Werk"), source("Flex")],
      {
        "Das Werk": async () => {
          throw new Error("bad json");
        },
        Flex: async () => [event("Flex night")],
      },
      {
        afterScrape: async (item, events) => {
          saved.push(`${item.name}:${events.length}`);
        },
        log: () => undefined,
        errorLog: () => undefined,
      },
    );

    assert.deepEqual(saved, ["Flex:1"]);
    assert.equal(results[0]?.status, "failed");
    assert.equal(results[1]?.status, "ok");
  });
});
