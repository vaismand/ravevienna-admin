import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyRaArtistDetail, parseRaSearchPayload } from "./raArtistSearch.ts";
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
});
