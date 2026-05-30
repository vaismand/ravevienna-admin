import * as cheerio from "cheerio";

export type ParsedSoundCloudProfile = {
  username: string | null;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  countryCode: string | null;
  instagramUrl: string | null;
  spotifyUrl: string | null;
  websiteUrl: string | null;
};

type SoundCloudHydrationUser = {
  username?: string;
  avatar_url?: string;
  description?: string | null;
  city?: string | null;
  country_code?: string | null;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 25_000;
const MAX_BIO_SENTENCES = 4;

const URL_IN_TEXT_RE = /https?:\/\/[^\s<>"')\]]+/gi;

export function normalizeSoundCloudProfileUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty SoundCloud URL");
  }

  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error(`Invalid SoundCloud URL: ${trimmed}`);
  }

  const host = url.hostname.replace(/^www\./, "");
  if (host !== "soundcloud.com" && host !== "m.soundcloud.com") {
    throw new Error(`Not a SoundCloud URL: ${trimmed}`);
  }

  const path = url.pathname.replace(/\/+$/, "") || url.pathname;
  return `https://soundcloud.com${path}`;
}

export function bestSoundCloudAvatarUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) {
    return null;
  }

  let url = raw.trim();

  const ogMatch = url.match(/avatars-[^/]+-t(\d+)x(\d+)\./);
  if (ogMatch) {
    return url.replace(/-t\d+x\d+\./, "-t500x500.");
  }

  if (url.includes("-large.")) {
    return url.replace("-large.", "-t500x500.");
  }

  if (/-t\d+x\d+\./.test(url)) {
    return url.replace(/-t\d+x\d+\./, "-t500x500.");
  }

  return url;
}

export function unwrapGateScUrl(href: string): string {
  try {
    const url = new URL(href);
    if (url.hostname === "gate.sc" || url.hostname.endsWith(".gate.sc")) {
      const inner = url.searchParams.get("url");
      if (inner) {
        return decodeURIComponent(inner);
      }
    }
  } catch {
    // keep original href
  }
  return href;
}

function isBlank(value: string | null | undefined): boolean {
  return !value?.trim();
}

function stripBioLeadSection(description: string): string {
  const trimmed = description.trim();
  if (!/^next:/i.test(trimmed)) {
    return trimmed;
  }

  const parts = trimmed.split(/\n\s*\n/);
  if (parts.length <= 1) {
    return trimmed;
  }

  return parts.slice(1).join("\n\n").trim();
}

function removeUrlsFromText(text: string): string {
  return text.replace(URL_IN_TEXT_RE, "").replace(/\s+/g, " ").trim();
}

export function truncateToSentenceLimit(text: string, maxSentences: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return "";
  }

  const sentences =
    cleaned.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((part) => part.trim()).filter(Boolean) ??
    [cleaned];

  return sentences.slice(0, maxSentences).join(" ").trim();
}

function extractBioFromDescription(description: string | null | undefined): string | null {
  if (isBlank(description)) {
    return null;
  }

  const withoutLead = stripBioLeadSection(description!);
  const withoutUrls = removeUrlsFromText(withoutLead.replace(/\n+/g, " "));
  const limited = truncateToSentenceLimit(withoutUrls, MAX_BIO_SENTENCES);

  return limited || null;
}

type SocialBucket = Pick<
  ParsedSoundCloudProfile,
  "instagramUrl" | "spotifyUrl" | "websiteUrl"
>;

function classifySocialUrl(url: string): keyof SocialBucket | null {
  const lower = url.toLowerCase();

  if (lower.includes("instagram.com")) {
    return "instagramUrl";
  }
  if (
    lower.includes("open.spotify.com") ||
    lower.includes("spotify.com/artist") ||
    lower.includes("spotify.com/intl-")
  ) {
    return "spotifyUrl";
  }

  if (
    lower.includes("soundcloud.com") ||
    lower.includes("facebook.com") ||
    lower.includes("twitter.com") ||
    lower.includes("x.com") ||
    lower.includes("ra.co") ||
    lower.includes("bandcamp.com") ||
    lower.includes("youtube.com") ||
    lower.includes("youtu.be") ||
    lower.includes("tiktok.com")
  ) {
    return null;
  }

  return "websiteUrl";
}

function normalizeSocialUrl(url: string): string | null {
  const unwrapped = unwrapGateScUrl(url.trim());
  try {
    const parsed = new URL(unwrapped);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function assignSocialUrl(
  bucket: SocialBucket,
  rawUrl: string,
  labelHint?: string
): void {
  const normalized = normalizeSocialUrl(rawUrl);
  if (!normalized) {
    return;
  }

  const label = labelHint?.trim().toLowerCase() ?? "";
  let field = classifySocialUrl(normalized);

  if (!field && label.includes("instagram")) {
    field = "instagramUrl";
  } else if (!field && label.includes("spotify")) {
    field = "spotifyUrl";
  } else if (
    !field &&
    (label.includes("website") ||
      label.includes("homepage") ||
      label.includes("linktree") ||
      label.includes("linktr.ee"))
  ) {
    field = "websiteUrl";
  }

  if (!field || bucket[field]) {
    return;
  }

  bucket[field] = normalized;
}

function extractSocialsFromDescription(description: string | null | undefined): SocialBucket {
  const bucket: SocialBucket = {
    instagramUrl: null,
    spotifyUrl: null,
    websiteUrl: null,
  };

  if (isBlank(description)) {
    return bucket;
  }

  const matches = description!.match(URL_IN_TEXT_RE) ?? [];
  for (const match of matches) {
    assignSocialUrl(bucket, match);
  }

  return bucket;
}

function extractSocialsFromWebProfiles(html: string): SocialBucket {
  const bucket: SocialBucket = {
    instagramUrl: null,
    spotifyUrl: null,
    websiteUrl: null,
  };

  const $ = cheerio.load(html);
  $(".web-profiles a.web-profile").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) {
      return;
    }

    const label = $(element).text().replace(/\s+/g, " ").trim();
    assignSocialUrl(bucket, href, label);
  });

  return bucket;
}

function extractAvatarFromMeta(html: string): string | null {
  const $ = cheerio.load(html);
  const ogImage =
    $('meta[property="og:image"]').attr("content") ??
    $('meta[name="twitter:image"]').attr("content") ??
    $('link[itemprop="image"]').attr("href");

  return bestSoundCloudAvatarUrl(ogImage);
}

function parseHydrationUser(html: string): SoundCloudHydrationUser | null {
  const match = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);/);
  if (!match?.[1]) {
    return null;
  }

  try {
    const hydration = JSON.parse(match[1]) as {
      hydratable?: string;
      data?: SoundCloudHydrationUser;
    }[];

    const userEntry = hydration.find((entry) => entry.hydratable === "user");
    return userEntry?.data ?? null;
  } catch {
    return null;
  }
}

export function parseSoundCloudProfileHtml(html: string): ParsedSoundCloudProfile {
  const user = parseHydrationUser(html);
  const descriptionSocials = extractSocialsFromDescription(user?.description);
  const profileSocials = extractSocialsFromWebProfiles(html);

  const avatarUrl =
    bestSoundCloudAvatarUrl(user?.avatar_url) ?? extractAvatarFromMeta(html);

  return {
    username: user?.username?.trim() ?? null,
    avatarUrl,
    bio: extractBioFromDescription(user?.description),
    city: user?.city?.trim() ?? null,
    countryCode: user?.country_code?.trim()?.toUpperCase() ?? null,
    instagramUrl: profileSocials.instagramUrl ?? descriptionSocials.instagramUrl,
    spotifyUrl: profileSocials.spotifyUrl ?? descriptionSocials.spotifyUrl,
    websiteUrl: profileSocials.websiteUrl ?? descriptionSocials.websiteUrl,
  };
}

export async function fetchSoundCloudProfileHtml(profileUrl: string): Promise<string> {
  const normalizedUrl = normalizeSoundCloudProfileUrl(profileUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`SoundCloud HTTP ${response.status} for ${normalizedUrl}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchSoundCloudProfile(
  profileUrl: string
): Promise<ParsedSoundCloudProfile> {
  const html = await fetchSoundCloudProfileHtml(profileUrl);
  return parseSoundCloudProfileHtml(html);
}
