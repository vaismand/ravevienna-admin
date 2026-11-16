import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EMPTY_DJ_FORM } from "../../src/lib/djForm.ts";
import {
  isDjLocationLocked,
  isMissingLocationLockedColumn,
  rowWithoutMissingLocationLock,
  withoutLockedLocationFields,
} from "../../src/lib/djLocationLock.ts";
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
    assert.equal("location_locked" in blank, false);

    const typed = djFormToPayload(
      form({ city: "  Berlin ", country: "Germany" }),
    );
    assert.equal(typed.city, "Berlin");
    assert.equal(typed.country, "Germany");
    assert.equal(typed.location_locked, true);

    const cityOnly = djFormToPayload(form({ city: "Graz", country: " " }));
    assert.equal(cityOnly.city, "Graz");
    assert.equal(cityOnly.country, null);
    assert.equal(cityOnly.location_locked, true);
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
    assert.equal(kept.location_locked, true);
  });
});

describe("location_locked", () => {
  it("treats a missing column as unlocked", () => {
    assert.equal(isDjLocationLocked(undefined), false);
    assert.equal(isDjLocationLocked({}), false);
    assert.equal(isDjLocationLocked({ location_locked: null }), false);
    assert.equal(isDjLocationLocked({ location_locked: false }), false);
    assert.equal(isDjLocationLocked({ location_locked: true }), true);
  });

  it("locks a saved city or country and retries when the column is not there yet", () => {
    const saved = djFormToPayload(form({ city: "Vienna", country: "Austria" }));
    assert.equal(saved.location_locked, true);

    const missing = {
      code: "PGRST204",
      message: "Could not find the 'location_locked' column of 'djs' in the schema cache",
    };
    const retry = rowWithoutMissingLocationLock(saved, missing);
    assert.equal(retry?.city, "Vienna");
    assert.equal(retry?.country, "Austria");
    assert.equal(retry && "location_locked" in retry, false);

    const other = { code: "23505", message: "duplicate key" };
    assert.equal(rowWithoutMissingLocationLock(saved, other), null);
  });

  it("drops city and country from an enrichment write when the location is locked", () => {
    const locked = withoutLockedLocationFields(
      { location_locked: true },
      {
        city: "San Diego",
        country: "United States",
        bio: "Keep this",
        updated_at: "2026-11-16T00:00:00.000Z",
      },
    );
    assert.equal(locked.city, undefined);
    assert.equal(locked.country, undefined);
    assert.equal("city" in locked, false);
    assert.equal(locked.bio, "Keep this");

    const unlocked = withoutLockedLocationFields(
      {},
      { city: "San Diego", country: "United States", bio: "Keep this" },
    );
    assert.equal(unlocked.city, "San Diego");
    assert.equal(unlocked.country, "United States");
  });

  it("recognises the Postgres missing-column error", () => {
    assert.equal(
      isMissingLocationLockedColumn({
        code: "42703",
        message: 'column "location_locked" of relation "djs" does not exist',
      }),
      true,
    );
    assert.equal(
      isMissingLocationLockedColumn({
        code: "PGRST204",
        message: "Could not find the 'image_url' column of 'djs' in the schema cache",
      }),
      false,
    );
  });
});
