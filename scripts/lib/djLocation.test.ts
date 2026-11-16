import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMPTY_DJ_FORM } from "../../src/lib/djForm.ts";
import { djFormToPayload, djToFormData } from "../../src/lib/djUtils.ts";
import type { Dj, DjFormData } from "../../src/types/database.ts";

function dj(overrides: Partial<Dj> = {}): Dj {
  return {
    id: "dj-1",
    name: "Unknown",
    slug: "unknown",
    genres: [],
    is_active: false,
    ...overrides,
  };
}

function form(overrides: Partial<DjFormData> = {}): DjFormData {
  return { ...EMPTY_DJ_FORM, name: "Unknown", slug: "unknown", ...overrides };
}

describe("DJ location defaults", () => {
  it("starts a new DJ form with empty city and country", () => {
    assert.equal(EMPTY_DJ_FORM.city, "");
    assert.equal(EMPTY_DJ_FORM.country, "");
  });

  it("stores a blank location as null and keeps a typed location", () => {
    const blank = djFormToPayload(form({ city: "  ", country: "" }));
    assert.equal(blank.city, null);
    assert.equal(blank.country, null);

    const typed = djFormToPayload(
      form({ city: "  Berlin ", country: "Germany" }),
    );
    assert.equal(typed.city, "Berlin");
    assert.equal(typed.country, "Germany");

    const cityOnly = djFormToPayload(form({ city: "Graz", country: " " }));
    assert.equal(cityOnly.city, "Graz");
    assert.equal(cityOnly.country, null);
  });

  it("shows empty fields for a null location and keeps a stored location", () => {
    const unknown = djToFormData(dj({ city: null, country: null }));
    assert.equal(unknown.city, "");
    assert.equal(unknown.country, "");

    const omitted = djToFormData(dj());
    assert.equal(omitted.city, "");
    assert.equal(omitted.country, "");

    const stored = djToFormData(
      dj({ city: "Vienna", country: "Austria", is_active: true }),
    );
    assert.equal(stored.city, "Vienna");
    assert.equal(stored.country, "Austria");
  });

  it("does not write Vienna or Austria back when a null location is saved", () => {
    const payload = djFormToPayload(djToFormData(dj({ city: null, country: null })));
    assert.equal(payload.city, null);
    assert.equal(payload.country, null);

    const kept = djFormToPayload(
      djToFormData(dj({ city: "Vienna", country: "Austria" })),
    );
    assert.equal(kept.city, "Vienna");
    assert.equal(kept.country, "Austria");
  });
});
