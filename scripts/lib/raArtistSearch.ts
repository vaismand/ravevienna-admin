import {
  concreteLocation,
  isViennaCity,
  isVaguePlaceName,
  normalizeCountryName,
} from "./countryNames.ts";
import { nameMatchTier } from "./djCandidateScore.ts";
import { truncateToSentenceLimit } from "./parseSoundCloudProfile.ts";
import { RequestPacer, ResponseCache } from "./responseCache.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const ENDPOINT = "https://ra.co/graphql";

const SEARCH_QUERY = `query SearchArtists($searchTerm: String, $limit: Int, $indices: [IndexType!]) {
  search(searchTerm: $searchTerm, limit: $limit, indices: $indices) {
    id
    value
    areaName
    countryName
    countryCode
    contentUrl
    imageUrl
  }
}`;

const ARTIST_QUERY = `query ArtistDetail($id: ID) {
  artist(id: $id) {
    id
    name
    contentUrl
    instagram
    soundcloud
    website
    facebook
    twitter
    bandcamp
    discogs
    followerCount
    biography { blurb content }
    country { name urlCode isoCode }
    residentCountry { name urlCode isoCode }
    area { name country { name urlCode isoCode } }
    regionsMostPlayed { name country { name urlCode isoCode } }
    venuesMostPlayed { name area { name } country { name urlCode isoCode } }
  }
}`;

export type RaArtistHit = {
  id: string;
  name: string;
  profileUrl: string;
  city: string | null;
  country: string | null;
  followers: number | null;
  bio: string | null;
  imageUrl: string | null;
  instagram: string | null;
  soundcloud: string | null;
  website: string | null;
  facebook: string | null;
  twitter: string | null;
  bandcamp: string | null;
  discogs: string | null;
  playsVienna: boolean;
  playsAustria: boolean;
  playsNeighbour: boolean;
};

export type RaSearchResult = {
  artists: RaArtistHit[];
  error: string | null;
};

type FetchLike = typeof fetch;

type CountryRef = {
  name?: string | null;
  urlCode?: string | null;
  isoCode?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function plainText(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const text = value
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return null;
  }
  return truncateToSentenceLimit(text, 4) || null;
}

export function raProfileUrl(contentUrl: string | null | undefined): string | null {
  if (!contentUrl?.trim()) {
    return null;
  }
  const slug = contentUrl.match(/\/dj\/([^/?#]+)/i)?.[1];
  if (!slug) {
    return null;
  }
  return `https://ra.co/dj/${slug}`;
}

function countryFromRef(ref: unknown): string | null {
  const record = asRecord(ref) as CountryRef | null;
  if (!record) {
    return null;
  }
  return (
    normalizeCountryName(record.name) ??
    normalizeCountryName(record.urlCode) ??
    normalizeCountryName(record.isoCode)
  );
}

function playSignals(areas: Array<{ name: string | null; country: string | null }>): {
  playsVienna: boolean;
  playsAustria: boolean;
  playsNeighbour: boolean;
} {
  let playsVienna = false;
  let playsAustria = false;
  let playsNeighbour = false;

  for (const area of areas) {
    if (isViennaCity(area.name)) {
      playsVienna = true;
      playsAustria = true;
    }
    const country = area.country;
    if (country === "Austria") {
      playsAustria = true;
    } else if (
      country === "Germany" ||
      country === "Switzerland" ||
      country === "Czechia" ||
      country === "Slovakia" ||
      country === "Hungary" ||
      country === "Slovenia" ||
      country === "Italy"
    ) {
      playsNeighbour = true;
    }
  }

  return { playsVienna, playsAustria, playsNeighbour };
}

export function parseRaSearchPayload(payload: unknown): RaArtistHit[] {
  const data = asRecord(asRecord(payload)?.data);
  const search = data?.search;
  if (!Array.isArray(search)) {
    return [];
  }

  const artists: RaArtistHit[] = [];
  for (const item of search) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const id = asString(record.id);
    const name = asString(record.value);
    const profileUrl = raProfileUrl(asString(record.contentUrl));
    if (!id || !name || !profileUrl) {
      continue;
    }
    const areaName = asString(record.areaName);
    const place = concreteLocation(
      areaName,
      normalizeCountryName(asString(record.countryName)) ??
        normalizeCountryName(asString(record.countryCode))
    );
    artists.push({
      id,
      name,
      profileUrl,
      city: place.city,
      country: place.country,
      followers: null,
      bio: null,
      imageUrl: asString(record.imageUrl),
      instagram: null,
      soundcloud: null,
      website: null,
      facebook: null,
      twitter: null,
      bandcamp: null,
      discogs: null,
      playsVienna: isViennaCity(place.city),
      playsAustria: place.country === "Austria" || isViennaCity(place.city),
      playsNeighbour: false,
    });
  }

  return artists;
}

export function applyRaArtistDetail(hit: RaArtistHit, payload: unknown): RaArtistHit {
  const artist = asRecord(asRecord(asRecord(payload)?.data)?.artist);
  if (!artist) {
    return hit;
  }

  const biography = asRecord(artist.biography);
  const bio =
    plainText(asString(biography?.blurb)) ?? plainText(asString(biography?.content));
  const area = asRecord(artist.area);
  const areaName = asString(area?.name);
  const resolvedCountry =
    countryFromRef(artist.country) ??
    countryFromRef(artist.residentCountry) ??
    hit.country;
  const place = isVaguePlaceName(areaName)
    ? { city: null, country: null }
    : concreteLocation(
        areaName && areaName !== resolvedCountry ? areaName : hit.city,
        resolvedCountry
      );
  const city = place.city;
  const country = place.country;

  const areas: Array<{ name: string | null; country: string | null }> = [];
  for (const key of ["regionsMostPlayed", "venuesMostPlayed"] as const) {
    const list = artist[key];
    if (!Array.isArray(list)) {
      continue;
    }
    for (const item of list) {
      const record = asRecord(item);
      if (!record) {
        continue;
      }
      const nestedArea = asRecord(record.area);
      areas.push({
        name: asString(nestedArea?.name) ?? asString(record.name),
        country: countryFromRef(record.country) ?? countryFromRef(nestedArea?.country),
      });
    }
  }

  const plays = playSignals(areas);
  const followers =
    typeof artist.followerCount === "number" ? artist.followerCount : hit.followers;

  return {
    ...hit,
    name: asString(artist.name) ?? hit.name,
    profileUrl: raProfileUrl(asString(artist.contentUrl)) ?? hit.profileUrl,
    city,
    country,
    followers,
    bio: bio ?? hit.bio,
    instagram: asString(artist.instagram),
    soundcloud: asString(artist.soundcloud),
    website: asString(artist.website),
    facebook: asString(artist.facebook),
    twitter: asString(artist.twitter),
    bandcamp: asString(artist.bandcamp),
    discogs: asString(artist.discogs),
    playsVienna: plays.playsVienna || hit.playsVienna,
    playsAustria: plays.playsAustria || country === "Austria" || hit.playsAustria,
    playsNeighbour: plays.playsNeighbour || hit.playsNeighbour,
  };
}

export class RaArtistClient {
  constructor(
    private readonly options: {
      fetchImpl?: FetchLike;
      cache?: ResponseCache;
      pacer?: RequestPacer;
    } = {}
  ) {}

  private get fetchImpl(): FetchLike {
    return this.options.fetchImpl ?? fetch;
  }

  private async graphql(
    operationName: string,
    query: string,
    variables: Record<string, unknown>
  ): Promise<{ payload: unknown | null; error: string | null }> {
    const body = JSON.stringify({ operationName, query, variables });
    const cacheKey = `ra:${body}`;
    const cached = await this.options.cache?.get(cacheKey);
    if (cached) {
      return { payload: JSON.parse(cached) as unknown, error: null };
    }

    await this.options.pacer?.wait();

    let response: Response;
    try {
      response = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          "Content-Type": "application/json",
          Origin: "https://ra.co",
          Referer: "https://ra.co/",
          "ra-content-language": "en",
        },
        body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { payload: null, error: `RA request failed: ${message}` };
    }

    if (response.status === 403 || response.status === 429) {
      return {
        payload: null,
        error: `RA returned ${response.status}. Artist search was skipped for this DJ.`,
      };
    }

    const text = await response.text();
    if (!response.ok) {
      return {
        payload: null,
        error: `RA returned ${response.status}. Artist search was skipped for this DJ.`,
      };
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return { payload: null, error: "RA returned invalid JSON" };
    }

    const record = asRecord(payload);
    const data = record?.data;
    const errors = record?.errors;
    if (!data && Array.isArray(errors) && errors.length > 0) {
      const message = asString(asRecord(errors[0])?.message) ?? "RA GraphQL error";
      return { payload: null, error: message };
    }

    await this.options.cache?.set(cacheKey, text);
    return { payload, error: null };
  }

  async searchArtists(name: string, limit = 5): Promise<RaSearchResult> {
    const trimmed = name.trim();
    if (!trimmed) {
      return { artists: [], error: null };
    }

    const searched = await this.graphql("SearchArtists", SEARCH_QUERY, {
      searchTerm: trimmed,
      limit,
      indices: ["ARTIST"],
    });
    if (!searched.payload) {
      return { artists: [], error: searched.error };
    }

    const hits = parseRaSearchPayload(searched.payload).slice(0, limit);
    const matched = hits.filter(
      (hit) =>
        nameMatchTier(trimmed, {
          name: hit.name,
          username: null,
          profileUrl: hit.profileUrl,
          soundcloudUrl: null,
        }) !== "none"
    );
    const toDetail = (matched.length > 0 ? matched : hits.slice(0, 1)).slice(0, 5);
    const artists: RaArtistHit[] = [];
    let detailError: string | null = null;

    for (const hit of toDetail) {
      const detail = await this.graphql("ArtistDetail", ARTIST_QUERY, { id: hit.id });
      if (!detail.payload) {
        detailError = detail.error;
        artists.push(hit);
        if (detail.error?.includes("403") || detail.error?.includes("429")) {
          break;
        }
        continue;
      }
      artists.push(applyRaArtistDetail(hit, detail.payload));
    }

    return { artists, error: detailError };
  }
}
