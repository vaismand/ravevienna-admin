import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isSoldOutManuallySet } from "../../../src/lib/soldOutManual.ts";
import {
  planPublishedSoldOutUpdate,
  scrapedSoldOutForDraft,
} from "../soldOutSync.ts";
import { mentionsSoldOut, parsePrice, priceTextMarksSoldOut } from "./helpers.ts";
import { normalizeLoftPrice } from "./theLoft.ts";
import {
  readEventjetShop,
  readJsonLdOfferSummary,
  readPaylogicProducts,
  readStructuredPrice,
} from "./ticketOffers.ts";

const fixtures = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(join(fixtures, "fixtures", name), "utf8"),
  ) as unknown;
}

const PARADIES_COPY =
  "Tickets are available now, but if our previous nights at Grelle Forelle are anything to go by, you know it won't take long before we need to pull up the sold-out sign. Think fast!";

describe("Paylogic products", () => {
  it("treats every is_sold_out product as sold out and has no on-sale price", () => {
    const reading = readPaylogicProducts(fixture("paylogic-all-sold-out.json"));
    assert.equal(reading.soldOut, true);
    assert.equal(reading.price, null);
  });

  it("uses the lowest tier that is still on sale", () => {
    const reading = readPaylogicProducts({
      categories: [
        {
          items: [
            { is_sold_out: true, unit_price: { amount: "12.00", currency: "EUR" } },
            { is_sold_out: false, unit_price: { amount: "26.00", currency: "EUR" } },
            { is_sold_out: false, unit_price: { amount: "28.00", currency: "EUR" } },
          ],
        },
      ],
    });
    assert.equal(reading.soldOut, false);
    assert.equal(reading.price, 26);
  });
});

describe("Eventjet tiers", () => {
  it("ignores one Ausverkauft tier and prices the cheapest available tier", () => {
    const reading = readEventjetShop(fixture("eventjet-mixed-tiers.json"));
    assert.equal(reading.soldOut, false);
    assert.equal(reading.price, 20);
  });

  it("is sold out only when every tier is Ausverkauft", () => {
    const reading = readEventjetShop({
      items: [
        { name: "Early", unavailabilityReason: "Ausverkauft", price: { amount: 14 } },
        { name: "Regular", unavailabilityReason: "Ausverkauft", price: { amount: 20 } },
      ],
    });
    assert.equal(reading.soldOut, true);
    assert.equal(reading.price, null);
  });

  it("reads Ausverkauft from the shop HTML payload", () => {
    const escaped = String.raw`\"serverSideItems\":[{\"name\":\"Early\",\"unavailabilityReason\":\"Ausverkauft\",\"price\":{\"amount\":14}},{\"name\":\"Door\",\"unavailabilityReason\":null,\"price\":{\"amount\":18}}]`;
    const reading = readEventjetShop(`<script>${escaped}</script>`);
    assert.equal(reading.soldOut, false);
    assert.equal(reading.price, 18);
  });
});

describe("JSON-LD price", () => {
  it("keeps a missing price null instead of turning it into 0", () => {
    const parsed = fixture("jsonld-missing-price.json") as {
      offers?: { price?: unknown };
    };

    assert.equal(Number(parsed.offers?.price ?? null), 0);
    assert.equal(readStructuredPrice(parsed.offers?.price ?? null), null);
    assert.deepEqual(readJsonLdOfferSummary(parsed.offers), {
      price: null,
      soldOut: false,
    });
    assert.equal(readJsonLdOfferSummary(undefined).price, null);
    assert.equal(readJsonLdOfferSummary(null).soldOut, false);
    assert.equal(readStructuredPrice(0), 0);
  });

  it("marks the event sold out when every offer is SoldOut", () => {
    const reading = readJsonLdOfferSummary([
      {
        "@type": "Offer",
        price: 14,
        availability: "https://schema.org/SoldOut",
      },
      {
        "@type": "Offer",
        price: 20,
        availability: "https://schema.org/OutOfStock",
      },
    ]);
    assert.equal(reading.soldOut, true);
    assert.equal(reading.price, null);
  });

  it("prices the cheapest offer that is still in stock", () => {
    const reading = readJsonLdOfferSummary([
      { price: 14, availability: "https://schema.org/OutOfStock" },
      { price: 22, availability: "https://schema.org/InStock" },
      { price: 20, availability: "http://schema.org/InStock" },
    ]);
    assert.equal(reading.soldOut, false);
    assert.equal(reading.price, 20);
  });
});

describe("page copy and price labels", () => {
  it("does not treat the Paradies Garten sold-out sign sentence as a status", () => {
    assert.equal(priceTextMarksSoldOut(PARADIES_COPY), false);
    assert.equal(mentionsSoldOut(PARADIES_COPY), true);
    assert.equal(parsePrice(PARADIES_COPY), null);
    assert.equal(normalizeLoftPrice(PARADIES_COPY), null);
  });

  it("never turns sold out or ausverkauft into a free price", () => {
    assert.equal(parsePrice("sold out"), null);
    assert.equal(parsePrice("Ausverkauft"), null);
    assert.equal(parsePrice("0 € ausverkauft"), null);
    assert.equal(parsePrice("0€ sold out"), null);
    assert.equal(normalizeLoftPrice("sold out"), null);
    assert.equal(normalizeLoftPrice("ausverkauft"), null);
    assert.equal(normalizeLoftPrice("0 € ausverkauft"), null);
    assert.equal(normalizeLoftPrice("ausverkauft - Eintritt frei"), null);
    assert.equal(parsePrice("15 €"), 15);
  });

  it("stores freie Spende as free", () => {
    assert.equal(normalizeLoftPrice("freie Spende"), "0 €");
    assert.equal(normalizeLoftPrice("Freiwillige Spende"), "0 €");
    assert.equal(parsePrice(normalizeLoftPrice("freie Spende")), 0);
    assert.equal(normalizeLoftPrice("Eintritt frei"), "0 €");
    assert.equal(parsePrice("0 €"), 0);
  });
});

describe("published event sold_out", () => {
  it("does not overwrite a sold_out an admin set manually", () => {
    const raw = { sold_out_manual: true, source: "Grelle Forelle" };
    assert.equal(isSoldOutManuallySet(raw), true);
    assert.equal(
      planPublishedSoldOutUpdate({
        eventId: "event-1",
        scrapedSoldOut: false,
        currentSoldOut: true,
        draftRawData: raw,
      }),
      null,
    );
    assert.deepEqual(
      scrapedSoldOutForDraft({
        scrapedSoldOut: false,
        existingRawData: raw,
        existingSoldOut: true,
      }),
      { soldOut: true, preserveManual: true },
    );
  });

  it("updates a published event when sold_out was not set manually", () => {
    assert.deepEqual(
      planPublishedSoldOutUpdate({
        eventId: "event-1",
        scrapedSoldOut: true,
        currentSoldOut: false,
        draftRawData: { source: "Grelle Forelle" },
      }),
      { id: "event-1", sold_out: true },
    );
    const patch = planPublishedSoldOutUpdate({
      eventId: "event-1",
      scrapedSoldOut: true,
      currentSoldOut: false,
      draftRawData: { source: "Grelle Forelle" },
    });
    assert.deepEqual(Object.keys(patch ?? {}).sort(), ["id", "sold_out"]);
    assert.equal(patch != null && "is_promoted" in patch, false);
    assert.equal(
      planPublishedSoldOutUpdate({
        eventId: "event-1",
        scrapedSoldOut: true,
        currentSoldOut: true,
        draftRawData: null,
      }),
      null,
    );
  });
});
