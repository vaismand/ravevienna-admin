import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  prepareLineupForDjImport,
  splitLineupCollaborations,
} from "./lineupArtists.ts";

describe("splitLineupCollaborations", () => {
  it("splits b2b the same way as vs, preserving order", () => {
    assert.deepEqual(splitLineupCollaborations("Valenthin b2b SAYA"), [
      "Valenthin",
      "SAYA",
    ]);
    assert.deepEqual(splitLineupCollaborations("Dimitrios B2B Hagen Wings"), [
      "Dimitrios",
      "Hagen Wings",
    ]);
    assert.deepEqual(splitLineupCollaborations("AKOV F2F MANTA"), ["AKOV", "MANTA"]);
    assert.deepEqual(
      splitLineupCollaborations("DLQNT vs Pamina b2b HARDCLIP"),
      ["DLQNT", "Pamina", "HARDCLIP"],
    );
  });

  it("splits standalone vs, vs., VS, and versus into one DJ per side", () => {
    assert.deepEqual(splitLineupCollaborations("DLQNT vs Pamina"), [
      "DLQNT",
      "Pamina",
    ]);
    assert.deepEqual(splitLineupCollaborations("HARDCLIP vs Brandy"), [
      "HARDCLIP",
      "Brandy",
    ]);
    assert.deepEqual(splitLineupCollaborations("Jayback vs Delex"), [
      "Jayback",
      "Delex",
    ]);
    assert.deepEqual(splitLineupCollaborations("HARDCLIP vs. Brandy"), [
      "HARDCLIP",
      "Brandy",
    ]);
    assert.deepEqual(splitLineupCollaborations("Jayback VS Delex"), [
      "Jayback",
      "Delex",
    ]);
    assert.deepEqual(splitLineupCollaborations("Jayback VS. Delex"), [
      "Jayback",
      "Delex",
    ]);
    assert.deepEqual(splitLineupCollaborations("Alpha versus Beta"), [
      "Alpha",
      "Beta",
    ]);
    assert.deepEqual(splitLineupCollaborations("Alpha Versus Beta"), [
      "Alpha",
      "Beta",
    ]);
    assert.deepEqual(splitLineupCollaborations("Alpha VERSUS Beta"), [
      "Alpha",
      "Beta",
    ]);
    assert.deepEqual(splitLineupCollaborations("Nova versus. Pulse"), [
      "Nova",
      "Pulse",
    ]);
    assert.deepEqual(splitLineupCollaborations("  DLQNT   vs.   Pamina  "), [
      "DLQNT",
      "Pamina",
    ]);
    assert.deepEqual(
      splitLineupCollaborations("Alpha versus Beta versus Gamma"),
      ["Alpha", "Beta", "Gamma"],
    );
  });

  it("does not split a name that only contains those letters", () => {
    assert.deepEqual(splitLineupCollaborations("VSNS"), ["VSNS"]);
    assert.deepEqual(splitLineupCollaborations("Elvs"), ["Elvs"]);
    assert.deepEqual(splitLineupCollaborations("DJ VSNS"), ["DJ VSNS"]);
    assert.deepEqual(splitLineupCollaborations("AvsB"), ["AvsB"]);
    assert.deepEqual(splitLineupCollaborations("Foovs Bar"), ["Foovs Bar"]);
    assert.deepEqual(splitLineupCollaborations("Foo vs.Bar"), ["Foo vs.Bar"]);
    assert.deepEqual(splitLineupCollaborations("Foo vsBar"), ["Foo vsBar"]);
    assert.deepEqual(splitLineupCollaborations("versusly Named"), [
      "versusly Named",
    ]);
    assert.deepEqual(splitLineupCollaborations("Axel"), ["Axel"]);
    assert.deepEqual(splitLineupCollaborations("R&B"), ["R&B"]);
  });

  it("keeps a token that is not between two artist names", () => {
    assert.deepEqual(splitLineupCollaborations("vs"), ["vs"]);
    assert.deepEqual(splitLineupCollaborations("DLQNT vs"), ["DLQNT vs"]);
    assert.deepEqual(splitLineupCollaborations("vs Pamina"), ["vs Pamina"]);
    assert.deepEqual(splitLineupCollaborations("A b2b B"), ["A b2b B"]);
    assert.deepEqual(splitLineupCollaborations("A vs B"), ["A vs B"]);
  });

  it("still splits a real vs pair when one side contains vs inside the name", () => {
    assert.deepEqual(splitLineupCollaborations("Elvs vs Brandy"), [
      "Elvs",
      "Brandy",
    ]);
    assert.deepEqual(splitLineupCollaborations("VSNS versus Elvs"), [
      "VSNS",
      "Elvs",
    ]);
    assert.deepEqual(splitLineupCollaborations("Elvs b2b VSNS"), [
      "Elvs",
      "VSNS",
    ]);
  });

  it("does not let a rejected x swallow a later vs or b2b", () => {
    assert.deepEqual(
      splitLineupCollaborations("Dead End Showcase X GDN"),
      ["Dead End Showcase X GDN"],
    );
    assert.deepEqual(
      splitLineupCollaborations("Showcase X DLQNT vs Pamina"),
      ["Showcase X DLQNT", "Pamina"],
    );
    assert.deepEqual(
      splitLineupCollaborations("Showcase X Foo b2b Bar"),
      ["Showcase X Foo", "Bar"],
    );
  });

  it("keeps known duos intact when they are billed against someone", () => {
    assert.deepEqual(splitLineupCollaborations("Camo & Krooked"), [
      "Camo & Krooked",
    ]);
    assert.deepEqual(splitLineupCollaborations("Camo & Krooked vs Someone"), [
      "Camo & Krooked",
      "Someone",
    ]);
    assert.deepEqual(splitLineupCollaborations("Sub Focus x Dimension"), [
      "Sub Focus",
      "Dimension",
    ]);
  });
});

describe("prepareLineupForDjImport", () => {
  it("creates one DJ name per b2b and vs side, in order", () => {
    assert.deepEqual(
      prepareLineupForDjImport([
        "[MAINFLOOR]",
        "DLQNT vs Pamina",
        "HARDCLIP vs. Brandy",
        "Jayback VS Delex",
        "Alpha versus Beta",
        "Rantom b2b SODA",
        "VSNS",
        "Elvs",
        "KITCHEN Hosted By Bassbussi",
      ]),
      [
        "DLQNT",
        "Pamina",
        "HARDCLIP",
        "Brandy",
        "Jayback",
        "Delex",
        "Alpha",
        "Beta",
        "Rantom",
        "SODA",
        "VSNS",
        "Elvs",
      ],
    );
  });
});
