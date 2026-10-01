import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyRaArtistDetail, parseRaSearchPayload } from "./raArtistSearch.ts";
import {
  DJ_PAGE_SIZE,
  fetchAllPages,
  selectDjsForEnrichment,
  soundCloudLookupPlan,
} from "./searchEnrichDjs.ts";
import { SoundCloudPublicClient } from "./soundcloudPublicClient.ts";
import type { DjEnrichmentRow } from "./djFieldPlan.ts";
import {
  extractSoundCloudAssetUrls,
  extractSoundCloudClientId,
  genresFromSoundCloudTracks,
} from "./soundcloudPublicClient.ts";

describe("SoundCloud public client parsing", () => {
  it("reads asset URLs and the web app client_id", () => {
    const html = `
      <script src="https://a-v2.sndcdn.com/assets/0-aaaa.js"></script>
      <script src="https://a-v2.sndcdn.com/assets/55-bbbb.js"></script>
    `;
    assert.deepEqual(extractSoundCloudAssetUrls(html), [
      "https://a-v2.sndcdn.com/assets/0-aaaa.js",
      "https://a-v2.sndcdn.com/assets/55-bbbb.js",
    ]);
    assert.equal(
      extractSoundCloudClientId(
        'config={client_application_id:46941,client_id:"Wq8jpsB4RfUsrezgEFDFfBGhkClF0sUN",ok:1}'
      ),
      "Wq8jpsB4RfUsrezgEFDFfBGhkClF0sUN"
    );
  });

  it("collects track genre tags", () => {
    assert.deepEqual(
      genresFromSoundCloudTracks({
        collection: [
          { genre: "Techno", tag_list: '"peak time" house' },
          { genre: "Techno" },
        ],
      }),
      ["Techno", "peak time", "house"]
    );
  });
});

describe("RA artist search parsing", () => {
  it("reads artist search hits and detail socials", () => {
    const hits = parseRaSearchPayload({
      data: {
        search: [
          {
            id: "15979",
            value: "Blawan",
            areaName: null,
            countryName: "United Kingdom",
            countryCode: "UK",
            contentUrl: "/dj/blawan",
            imageUrl: null,
          },
        ],
      },
    });

    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.profileUrl, "https://ra.co/dj/blawan");
    assert.equal(hits[0]?.country, "United Kingdom");

    const detailed = applyRaArtistDetail(hits[0]!, {
      data: {
        artist: {
          id: "15979",
          name: "Blawan",
          contentUrl: "/dj/blawan",
          instagram: "blawan",
          soundcloud: "https://soundcloud.com/ternesc",
          website: null,
          facebook: "https://www.facebook.com/BlawanUK",
          followerCount: 26127,
          biography: { blurb: "", content: "<p>Techno producer from the UK.</p>" },
          country: { name: "United Kingdom", urlCode: "UK", isoCode: "GBR" },
          venuesMostPlayed: [
            {
              name: "Flex",
              area: { name: "Vienna" },
              country: { name: "Austria", urlCode: "AT", isoCode: "AUT" },
            },
          ],
        },
      },
    });

    assert.equal(detailed.instagram, "blawan");
    assert.equal(detailed.soundcloud, "https://soundcloud.com/ternesc");
    assert.equal(detailed.followers, 26127);
    assert.equal(detailed.playsVienna, true);
    assert.equal(detailed.playsAustria, true);
    assert.match(detailed.bio ?? "", /Techno producer/);
  });

  it("treats an All area as an unknown location", () => {
    const hits = parseRaSearchPayload({
      data: {
        search: [
          {
            id: "1",
            value: "Comrade Martin",
            areaName: "All",
            countryName: "Slovenia",
            countryCode: "SI",
            contentUrl: "/dj/comrademartin",
            imageUrl: null,
          },
        ],
      },
    });

    assert.equal(hits[0]?.city, null);
    assert.equal(hits[0]?.country, null);
  });
});

function djRow(
  id: string,
  name: string,
  active: boolean
): DjEnrichmentRow {
  const row = {
    id,
    name,
    slug: name.toLowerCase(),
    bio: null,
    genres: [] as string[],
    instagram_url: null,
    soundcloud_url: null,
    spotify_url: null,
    website_url: null,
    image_url: null,
    city: null,
    country: null,
    is_active: active,
  };
  return { ...row, raw: row };
}

describe("soundCloudLookupPlan", () => {
  it("fetches a saved profile URL and does not search", () => {
    assert.deepEqual(soundCloudLookupPlan(null), { mode: "search" });
    assert.deepEqual(soundCloudLookupPlan("  "), { mode: "search" });
    assert.deepEqual(soundCloudLookupPlan("https://m.soundcloud.com/Fourtex/"), {
      mode: "saved",
      url: "https://soundcloud.com/fourtex",
    });
    assert.deepEqual(soundCloudLookupPlan("not a url"), { mode: "invalid" });
  });
});

describe("SoundCloud resolve", () => {
  it("resolves the saved profile URL instead of searching users", async () => {
    const calls: string[] = [];
    const client = new SoundCloudPublicClient({
      clientId: "a".repeat(32),
      fetchImpl: async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push(url);
        if (url.includes("/resolve")) {
          return new Response(
            JSON.stringify({
              kind: "user",
              id: 42,
              username: "Tomagan",
              permalink: "tomagan",
              permalink_url: "https://soundcloud.com/tomagan",
              full_name: "Tomagan",
              followers_count: 100,
              city: "Vienna",
              country_code: "AT",
            }),
            { status: 200 }
          );
        }
        return new Response("missing", { status: 404 });
      },
    });

    const user = await client.resolveUser("https://m.soundcloud.com/Tomagan/");
    assert.equal(user?.permalink, "tomagan");
    assert.equal(user?.profileUrl, "https://soundcloud.com/tomagan");
    assert.equal(user?.followers, 100);
    assert.equal(calls.some((url) => url.includes("/search/")), false);
    assert.equal(calls.some((url) => url.includes("/resolve")), true);
    assert.match(calls[0] ?? "", /soundcloud\.com%2Ftomagan|soundcloud\.com\/tomagan/);
  });

  it("ignores a resolve payload that is not a user", async () => {
    const client = new SoundCloudPublicClient({
      clientId: "b".repeat(32),
      fetchImpl: async () =>
        new Response(JSON.stringify({ kind: "track", id: 7, title: "Set" }), { status: 200 }),
    });
    assert.equal(await client.resolveUser("https://soundcloud.com/tomagan"), null);
  });
});

describe("fetchAllPages", () => {
  it("reads every page before active, linked, and only-empty filters", async () => {
    assert.equal(DJ_PAGE_SIZE, 1000);

    const filled = djRow("early", "Early", true);
    filled.raw.bio = "kept";
    filled.raw.image_url = "https://img.example/a.jpg";
    filled.raw.city = "Vienna";
    filled.raw.country = "Austria";
    filled.raw.genres = ["techno"];
    filled.raw.instagram_url = "https://instagram.com/early";
    filled.raw.soundcloud_url = "https://soundcloud.com/early";
    filled.raw.website_url = "https://early.example";
    filled.raw.spotify_url = "https://open.spotify.com/artist/early";
    filled.bio = "kept";

    const inactive = djRow("inactive", "Inactive", false);
    const late = djRow("late", "Late", true);

    const ranges: Array<[number, number]> = [];
    const pages = [
      [filled, inactive],
      [late],
    ];
    const rows = await fetchAllPages(async (from, to) => {
      ranges.push([from, to]);
      return pages.shift() ?? [];
    }, 2);

    const selected = selectDjsForEnrichment(rows, new Map([["late", 4], ["early", 9]]), {
      active: true,
      linked: true,
      onlyEmpty: true,
    });

    assert.deepEqual(ranges, [
      [0, 1],
      [2, 3],
    ]);
    assert.deepEqual(
      selected.map((dj) => dj.id),
      ["late"]
    );
  });
});

describe("selectDjsForEnrichment", () => {
  it("keeps active DJs that are linked to events, highest count first", () => {
    const djs = [
      djRow("a", "Ada", true),
      djRow("b", "Bea", false),
      djRow("c", "Cid", true),
      djRow("d", "Dee", true),
    ];
    const counts = new Map([
      ["a", 1],
      ["b", 9],
      ["c", 4],
    ]);

    const selected = selectDjsForEnrichment(djs, counts, {
      active: true,
      linked: true,
      limit: 20,
    });

    assert.deepEqual(
      selected.map((dj) => dj.id),
      ["c", "a"]
    );
  });
});
