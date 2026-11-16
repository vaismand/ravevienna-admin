import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withoutUncollectedEventFields } from "../../src/lib/submissionEventWrite.ts";

describe("submission republish", () => {
  it("does not send null price or image_url when updating a published event", () => {
    const update = withoutUncollectedEventFields({
      title: "Night",
      description: "Keep me",
      price: null,
      image_url: null,
      ticket_url: "https://example.com/night",
    });

    assert.equal("price" in update, false);
    assert.equal("image_url" in update, false);
    assert.equal(update.title, "Night");
    assert.equal(update.description, "Keep me");
    assert.equal(update.ticket_url, "https://example.com/night");
  });
});
