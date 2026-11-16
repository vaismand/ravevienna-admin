import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isMissingPromotedColumn,
  matchesPromotedFilter,
  withoutPromotedFlag,
} from "../../src/lib/eventPromoted.ts";
import { withoutUncollectedEventFields } from "../../src/lib/submissionEventWrite.ts";

describe("is_promoted", () => {
  it("filters the events list by the manual flag", () => {
    assert.equal(matchesPromotedFilter(true, "all"), true);
    assert.equal(matchesPromotedFilter(false, "all"), true);
    assert.equal(matchesPromotedFilter(true, "promoted"), true);
    assert.equal(matchesPromotedFilter(false, "promoted"), false);
    assert.equal(matchesPromotedFilter(false, "not"), true);
    assert.equal(matchesPromotedFilter(true, "not"), false);
  });

  it("strips is_promoted from scraper and republish payloads", () => {
    const row = withoutPromotedFlag({
      title: "Night",
      sold_out: true,
      is_promoted: false,
    });

    assert.equal("is_promoted" in row, false);
    assert.equal(row.title, "Night");
    assert.equal(row.sold_out, true);

    const alreadyClean = withoutPromotedFlag({ sold_out: false });
    assert.deepEqual(alreadyClean, { sold_out: false });
  });

  it("keeps a pin when a submission republish omits uncollected fields", () => {
    const update = withoutPromotedFlag(
      withoutUncollectedEventFields({
        title: "Friend's night",
        price: null,
        image_url: null,
        is_promoted: false,
        ticket_url: "https://example.com/night",
      }),
    );

    assert.equal("is_promoted" in update, false);
    assert.equal("price" in update, false);
    assert.equal("image_url" in update, false);
    assert.equal(update.title, "Friend's night");
  });

  it("recognizes a missing is_promoted column", () => {
    assert.equal(
      isMissingPromotedColumn({
        code: "PGRST204",
        message: "Could not find the 'is_promoted' column of 'events' in the schema cache",
      }),
      true,
    );
    assert.equal(
      isMissingPromotedColumn({
        code: "42703",
        message: 'column "is_promoted" of relation "events" does not exist',
      }),
      true,
    );
    assert.equal(
      isMissingPromotedColumn({
        code: "42501",
        message: "permission denied for table events",
      }),
      false,
    );
  });
});
