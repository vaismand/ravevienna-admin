import { bestSoundCloudAvatarUrl } from "./parseSoundCloudProfile.ts";
import { RequestPacer, ResponseCache } from "./responseCache.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const ASSET_URL_RE =
  /https:\/\/a-v2\.sndcdn\.com\/assets\/[^"'\\\s>]+\.js/g;
const CLIENT_ID_RE = /client_id\s*:\s*"([0-9a-zA-Z]{32})"/;

export type SoundCloudPublicUser = {
  id: number;
  username: string;
  permalink: string;
  profileUrl: string;
  fullName: string | null;
  description: string | null;
  city: string | null;
  countryCode: string | null;
  followers: number | null;
  avatarUrl: string | null;
  genres: string[];
};

type FetchLike = typeof fetch;

export function extractSoundCloudAssetUrls(html: string): string[] {
  return [...new Set(html.match(ASSET_URL_RE) ?? [])];
}

export function extractSoundCloudClientId(scriptSource: string): string | null {
  return scriptSource.match(CLIENT_ID_RE)?.[1] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mapUser(raw: unknown): SoundCloudPublicUser | null {
  const record = asRecord(raw);
  if (!record || typeof record.id !== "number") {
    return null;
  }

  const username = asString(record.username);
  const permalink = asString(record.permalink);
  if (!username || !permalink) {
    return null;
  }

  const followers =
    typeof record.followers_count === "number" ? record.followers_count : null;

  return {
    id: record.id,
    username,
    permalink,
    profileUrl:
      asString(record.permalink_url) ?? `https://soundcloud.com/${permalink}`,
    fullName: asString(record.full_name),
    description: asString(record.description),
    city: asString(record.city),
    countryCode: asString(record.country_code)?.toUpperCase() ?? null,
    followers,
    avatarUrl: bestSoundCloudAvatarUrl(asString(record.avatar_url)),
    genres: [],
  };
}

export function genresFromSoundCloudTracks(payload: unknown): string[] {
  const record = asRecord(payload);
  const collection = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.collection)
      ? record.collection
      : [];

  const genres = new Set<string>();
  for (const item of collection) {
    const track = asRecord(item);
    if (!track) {
      continue;
    }
    const genre = asString(track.genre);
    if (genre) {
      genres.add(genre);
    }
    const tags = asString(track.tag_list);
    if (tags) {
      for (const quoted of tags.matchAll(/"([^"]+)"/g)) {
        const phrase = quoted[1]?.trim();
        if (phrase) {
          genres.add(phrase);
        }
      }
      const bare = tags.replace(/"[^"]*"/g, " ");
      for (const tag of bare.split(/[\s,]+/)) {
        const trimmed = tag.trim();
        if (trimmed) {
          genres.add(trimmed);
        }
      }
    }
  }

  return [...genres];
}

export class SoundCloudPublicClient {
  private clientId: string | null;

  constructor(
    private readonly options: {
      fetchImpl?: FetchLike;
      cache?: ResponseCache;
      pacer?: RequestPacer;
      clientId?: string | null;
    } = {}
  ) {
    this.clientId = options.clientId ?? process.env.SOUNDCLOUD_CLIENT_ID?.trim() ?? null;
  }

  private get fetchImpl(): FetchLike {
    return this.options.fetchImpl ?? fetch;
  }

  async getClientId(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.clientId) {
      return this.clientId;
    }

    const cacheKey = "soundcloud-client-id";
    if (!forceRefresh) {
      const cached = await this.options.cache?.get(cacheKey);
      if (cached) {
        this.clientId = cached;
        return cached;
      }
    }

    await this.options.pacer?.wait();
    const homepage = await this.fetchImpl("https://soundcloud.com/", {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
    });
    if (!homepage.ok) {
      throw new Error(`SoundCloud homepage failed (${homepage.status})`);
    }

    const html = await homepage.text();
    const assets = extractSoundCloudAssetUrls(html).reverse();
    if (assets.length === 0) {
      throw new Error("SoundCloud homepage had no JS asset URLs");
    }

    for (const assetUrl of assets) {
      await this.options.pacer?.wait();
      const scriptResponse = await this.fetchImpl(assetUrl, {
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      });
      if (!scriptResponse.ok) {
        continue;
      }
      const clientId = extractSoundCloudClientId(await scriptResponse.text());
      if (clientId) {
        this.clientId = clientId;
        await this.options.cache?.set(cacheKey, clientId);
        return clientId;
      }
    }

    throw new Error("Could not find a SoundCloud client_id in the public web app");
  }

  private async getJson(pathAndQuery: string): Promise<unknown> {
    let lastError = "SoundCloud request failed";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const clientId = await this.getClientId(attempt > 0);
      const url = new URL(pathAndQuery, "https://api-v2.soundcloud.com/");
      url.searchParams.set("client_id", clientId);
      const cacheKey = url.toString();
      const cached = attempt === 0 ? await this.options.cache?.get(cacheKey) : null;
      if (cached) {
        return JSON.parse(cached) as unknown;
      }

      await this.options.pacer?.wait();
      const response = await this.fetchImpl(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
          Referer: "https://soundcloud.com/",
          Origin: "https://soundcloud.com",
        },
      });

      if (response.status === 401 && attempt === 0) {
        this.clientId = null;
        lastError = "SoundCloud client_id was rejected";
        continue;
      }

      const body = await response.text();
      if (!response.ok) {
        throw new Error(
          `SoundCloud ${response.status} for ${url.pathname}: ${body.slice(0, 180)}`
        );
      }

      await this.options.cache?.set(cacheKey, body);
      return JSON.parse(body) as unknown;
    }

    throw new Error(lastError);
  }

  async searchUsers(query: string, limit = 10): Promise<SoundCloudPublicUser[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const params = new URLSearchParams({
      q: trimmed,
      limit: String(Math.min(Math.max(limit, 1), 20)),
      offset: "0",
      linked_partitioning: "1",
      app_locale: "en",
    });
    const payload = await this.getJson(`/search/users?${params.toString()}`);
    const record = asRecord(payload);
    const collection = Array.isArray(payload)
      ? payload
      : Array.isArray(record?.collection)
        ? record.collection
        : [];

    return collection
      .map(mapUser)
      .filter((user): user is SoundCloudPublicUser => user != null);
  }

  async userGenres(userId: number): Promise<string[]> {
    const params = new URLSearchParams({
      limit: "8",
      offset: "0",
      linked_partitioning: "1",
    });
    const payload = await this.getJson(`/users/${userId}/tracks?${params.toString()}`);
    return genresFromSoundCloudTracks(payload);
  }
}
