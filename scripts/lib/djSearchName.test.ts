import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeCountryName } from "./countryNames.ts";
import {
  compactDjSearchName,
  djSearchNamesMatch,
  normalizeDjSearchName,
} from "./djSearchName.ts";

describe("normalizeDjSearchName", () => {
  it("ignores case, accents, DJ prefix, and live markers", () => {
    assert.equal(normalizeDjSearchName("DJ Stimming (live)"), "stimming");
    assert.equal(normalizeDjSearchName("stimming"), "stimming");
    assert.equal(normalizeDjSearchName("DJ Stimming [LIVE SET]"), "stimming");
    assert.equal(normalizeDjSearchName("Änna Körn"), "anna korn");
    assert.equal(normalizeDjSearchName("Helena Hauff Live"), "helena hauff");
  });

  it("treats dots and hyphens as separators", () => {
    assert.equal(normalizeDjSearchName("Esti.D"), "esti d");
    assert.equal(normalizeDjSearchName("esti-d"), "esti d");
    assert.equal(compactDjSearchName("Esti.D"), compactDjSearchName("esti-d"));
  });

  it("does not erase a name that is only DJ Live", () => {
    assert.equal(normalizeDjSearchName("DJ Live"), "live");
  });

  it("matches prefix and live variants as the same artist", () => {
    assert.equal(djSearchNamesMatch("DJ Stimming (live)", "Stimming"), true);
    assert.equal(djSearchNamesMatch("Helena Hauff", "Someone Else"), false);
  });
});

describe("normalizeCountryName", () => {
  it("uses one English short name for codes and local spellings", () => {
    assert.equal(normalizeCountryName("AT"), "Austria");
    assert.equal(normalizeCountryName("Austria"), "Austria");
    assert.equal(normalizeCountryName("Österreich"), "Austria");
    assert.equal(normalizeCountryName("DE"), "Germany");
    assert.equal(normalizeCountryName("UK"), "United Kingdom");
    assert.equal(normalizeCountryName("Czech Republic"), "Czechia");
    assert.equal(normalizeCountryName("CZ"), "Czechia");
  });
});
