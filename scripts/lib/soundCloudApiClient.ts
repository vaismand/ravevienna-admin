import { bestSoundCloudAvatarUrl } from "./parseSoundCloudProfile.ts";

export type SoundCloudUserCandidate = {
  id: number;
  username: string;
  permalink: string;
  profileUrl: string;
  fullName: string | null;
  description: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
};

type SoundCloudApiUser = {
  id?: number;
  username?: string;
  permalink?: string;
  permalink_url?: string;
  full_name?: string | null;
  description?: string | null;
  city?: string | null;
  country?: string | null;
  avatar_url?: string | null;
};

type SoundCloudUsersResponse =
  | SoundCloudApiUser[]
  | { collection?: SoundCloudApiUser[] };

function mapUser(raw: SoundCloudApiUser): SoundCloudUserCandidate | null {
  const id = raw.id;
  const username = raw.username?.trim();
  const permalink = raw.permalink?.trim();

  if (id == null || !username || !permalink) {
    return null;
  }

  const profileUrl =
    raw.permalink_url?.trim() || `https://soundcloud.com/${permalink}`;

  return {
    id,
    username,
    permalink,
    profileUrl,
    fullName: raw.full_name?.trim() || null,
    description: raw.description?.trim() || null,
    city: raw.city?.trim() || null,
    country: raw.country?.trim() || null,
    avatarUrl: bestSoundCloudAvatarUrl(raw.avatar_url),
  };
}

export class SoundCloudApiClient {
  constructor(private readonly accessToken: string) {}

  async searchUsers(
    query: string,
    limit = 10
  ): Promise<SoundCloudUserCandidate[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }

    const url = new URL("https://api.soundcloud.com/users");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 50)));
    url.searchParams.set("linked_partitioning", "true");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json; charset=utf-8",
        Authorization: `OAuth ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `SoundCloud user search failed (${response.status}): ${body.slice(0, 240)}`
      );
    }

    const payload = (await response.json()) as SoundCloudUsersResponse;
    const items = Array.isArray(payload) ? payload : (payload.collection ?? []);

    return items
      .map(mapUser)
      .filter((user): user is SoundCloudUserCandidate => user != null);
  }
}
