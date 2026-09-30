import type { DjProfileCandidate } from "./djCandidateScore.ts";
import { normalizeCountryName } from "./countryNames.ts";
import { canonicalInstagramUrl, canonicalSoundCloudUrl } from "./profileLinks.ts";
import { normalizeSpotifyGenres } from "./normalizeSpotifyGenres.ts";

export type DjEnrichmentRow = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  genres: string[] | null;
  instagram_url: string | null;
  soundcloud_url: string | null;
  spotify_url: string | null;
  website_url: string | null;
  image_url: string | null;
  city: string | null;
  country: string | null;
  /** Original column values, including optional columns not on the typed row. */
  raw: Record<string, unknown>;
};

export const OPTIONAL_DJ_COLUMNS = [
  "ra_url",
  "ra_slug",
  "facebook_url",
  "twitter_url",
  "bandcamp_url",
  "discogs_url",
] as const;

export type FieldPlan = {
  updates: Record<string, unknown>;
  filled: string[];
  skippedNonEmpty: string[];
  skippedMissingColumn: string[];
};

function isGenresEmpty(genres: string[] | null | undefined): boolean {
  return !genres || genres.every((genre) => !genre.trim());
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === "string") {
    return !value.trim();
  }
  if (Array.isArray(value)) {
    return value.every((item) => typeof item !== "string" || !item.trim());
  }
  return false;
}

function cleanText(value: string | null | undefined, max = 2000): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, max);
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

export function planDjFieldUpdates(input: {
  dj: DjEnrichmentRow;
  soundcloud: DjProfileCandidate | null;
  ra: DjProfileCandidate | null;
  force: boolean;
  columns: Set<string>;
}): FieldPlan {
  const { dj, soundcloud, ra, force, columns } = input;
  const updates: Record<string, unknown> = {};
  const filled: string[] = [];
  const skippedNonEmpty: string[] = [];
  const skippedMissingColumn: string[] = [];

  const proposed = new Map<string, string | string[]>();

  const soundcloudUrl =
    canonicalSoundCloudUrl(soundcloud?.soundcloudUrl) ??
    canonicalSoundCloudUrl(soundcloud?.profileUrl) ??
    canonicalSoundCloudUrl(ra?.soundcloudUrl);
  if (soundcloudUrl) {
    proposed.set("soundcloud_url", soundcloudUrl);
  }

  const image = cleanText(soundcloud?.avatarUrl, 1000);
  if (image) {
    proposed.set("image_url", image);
  }

  const bio = cleanText(soundcloud?.bio) ?? cleanText(ra?.bio);
  if (bio) {
    proposed.set("bio", bio);
  }

  const city = cleanText(soundcloud?.city, 120);
  if (city) {
    proposed.set("city", city);
  }

  const country =
    normalizeCountryName(soundcloud?.country) ?? normalizeCountryName(ra?.country);
  if (country) {
    proposed.set("country", country);
  }

  const instagram =
    canonicalInstagramUrl(soundcloud?.instagramUrl) ??
    canonicalInstagramUrl(ra?.instagramUrl);
  if (instagram) {
    proposed.set("instagram_url", instagram);
  }

  const website = cleanText(soundcloud?.websiteUrl, 500) ?? cleanText(ra?.websiteUrl, 500);
  if (website) {
    proposed.set("website_url", website);
  }

  const spotify = cleanText(soundcloud?.spotifyUrl, 500) ?? cleanText(ra?.spotifyUrl, 500);
  if (spotify) {
    proposed.set("spotify_url", spotify);
  }

  const facebook = cleanText(ra?.facebookUrl, 500) ?? cleanText(soundcloud?.facebookUrl, 500);
  if (facebook) {
    proposed.set("facebook_url", facebook);
  }

  const twitter = cleanText(ra?.twitterUrl, 500) ?? cleanText(soundcloud?.twitterUrl, 500);
  if (twitter) {
    proposed.set("twitter_url", twitter);
  }

  const bandcamp = cleanText(ra?.bandcampUrl, 500) ?? cleanText(soundcloud?.bandcampUrl, 500);
  if (bandcamp) {
    proposed.set("bandcamp_url", bandcamp);
  }

  const discogs = cleanText(ra?.discogsUrl, 500) ?? cleanText(soundcloud?.discogsUrl, 500);
  if (discogs) {
    proposed.set("discogs_url", discogs);
  }

  const genreTags = [
    ...(soundcloud?.genres ?? []),
    ...(ra?.genres ?? []),
  ];
  const mappedGenres = normalizeSpotifyGenres(
    genreTags,
    force || isGenresEmpty(dj.genres) ? [] : (dj.genres ?? [])
  );
  if (isGenresEmpty(dj.genres) || force) {
    const nextGenres = force
      ? normalizeSpotifyGenres(genreTags, [])
      : mappedGenres;
    if (nextGenres.length > 0) {
      proposed.set("genres", nextGenres);
    }
  }

  if (ra?.profileUrl && /\/dj\//i.test(ra.profileUrl)) {
    proposed.set("ra_url", ra.profileUrl);
    const slug = ra.profileUrl.match(/\/dj\/([^/?#]+)/i)?.[1];
    if (slug) {
      proposed.set("ra_slug", slug);
    }
  }

  for (const [column, value] of proposed) {
    if (!columns.has(column)) {
      pushUnique(skippedMissingColumn, column);
      continue;
    }

    if (!isEmptyValue(dj.raw[column]) && !force) {
      pushUnique(skippedNonEmpty, column);
      continue;
    }

    updates[column] = value;
    filled.push(column);
  }

  if (Object.keys(updates).length > 0 && columns.has("updated_at")) {
    updates.updated_at = new Date().toISOString();
  }

  return { updates, filled, skippedNonEmpty, skippedMissingColumn };
}
