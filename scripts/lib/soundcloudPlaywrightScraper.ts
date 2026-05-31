import { chromium, type Browser, type Page } from "playwright";

import {
  bestSoundCloudAvatarUrl,
  normalizeSoundCloudProfileUrl,
  parseSoundCloudProfileHtml,
  type ParsedSoundCloudProfile,
} from "./parseSoundCloudProfile.ts";
import type { SoundCloudSearchCandidate } from "./soundcloudPlaywrightMatch.ts";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const NAV_TIMEOUT_MS = 30_000;
const SEARCH_RESULT_LIMIT = 8;

const BLOCKED_PROFILE_SEGMENTS = new Set([
  "search",
  "discover",
  "stream",
  "you",
  "signin",
  "upload",
  "charts",
  "feed",
  "pages",
  "tags",
  "stations",
  "messages",
  "settings",
  "logout",
  "terms-of-use",
  "privacy",
]);

type HydrationEntry = {
  hydratable?: string;
  data?: unknown;
};

function isBlank(value: string | null | undefined): boolean {
  return !value?.trim();
}

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

function isProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "soundcloud.com" && host !== "m.soundcloud.com") {
      return false;
    }

    const segment = parsed.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
    if (!segment || BLOCKED_PROFILE_SEGMENTS.has(segment)) {
      return false;
    }

    return parsed.pathname.split("/").filter(Boolean).length === 1;
  } catch {
    return false;
  }
}

function profileUrlFromUsername(username: string): string {
  const clean = username.trim().replace(/^@/, "");
  return `https://soundcloud.com/${encodeURIComponent(clean)}`;
}

function mapHydrationUser(raw: Record<string, unknown>): SoundCloudSearchCandidate | null {
  const username = cleanText(String(raw.username ?? raw.permalink ?? ""));
  if (!username) {
    return null;
  }

  const fullName = cleanText(String(raw.full_name ?? raw.fullName ?? raw.name ?? ""));
  const permalinkUrl = cleanText(String(raw.permalink_url ?? raw.permalinkUrl ?? ""));
  const profileUrl = permalinkUrl && isProfileUrl(permalinkUrl)
    ? normalizeSoundCloudProfileUrl(permalinkUrl)
    : profileUrlFromUsername(username);

  const city = cleanText(String(raw.city ?? ""));
  const country = cleanText(String(raw.country ?? raw.country_code ?? ""));
  const location = [city, country].filter(Boolean).join(", ") || null;

  return {
    name: fullName ?? username,
    username,
    profileUrl,
    avatarUrl: bestSoundCloudAvatarUrl(String(raw.avatar_url ?? raw.avatarUrl ?? "")),
    location,
    bio: cleanText(String(raw.description ?? raw.bio ?? "")),
  };
}

function extractUsersFromUnknown(value: unknown, out: SoundCloudSearchCandidate[]): void {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractUsersFromUnknown(item, out);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const kind = cleanText(String(record.kind ?? ""))?.toLowerCase();

  if (
    kind === "user" ||
    record.username != null ||
    (record.permalink != null && record.uri != null)
  ) {
    const mapped = mapHydrationUser(record);
    if (mapped) {
      out.push(mapped);
    }
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") {
      extractUsersFromUnknown(nested, out);
    }
  }
}

function parseHydrationCandidates(html: string): SoundCloudSearchCandidate[] {
  const match = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);/);
  if (!match?.[1]) {
    return [];
  }

  try {
    const hydration = JSON.parse(match[1]) as HydrationEntry[];
    const collected: SoundCloudSearchCandidate[] = [];

    for (const entry of hydration) {
      extractUsersFromUnknown(entry.data, collected);
    }

    return dedupeCandidates(collected).slice(0, SEARCH_RESULT_LIMIT);
  } catch {
    return [];
  }
}

function dedupeCandidates(candidates: SoundCloudSearchCandidate[]): SoundCloudSearchCandidate[] {
  const seen = new Set<string>();
  const result: SoundCloudSearchCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.profileUrl.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

async function extractDomCandidates(page: Page): Promise<SoundCloudSearchCandidate[]> {
  const raw = await page.evaluate(() => {
    const blocked = new Set([
      "search",
      "discover",
      "stream",
      "you",
      "signin",
      "upload",
      "charts",
      "feed",
      "pages",
      "tags",
      "stations",
    ]);

    const results: Array<{
      name: string;
      username: string;
      profileUrl: string;
      avatarUrl: string | null;
      location: string | null;
      bio: string | null;
    }> = [];

    const anchors = Array.from(document.querySelectorAll('a[href*="soundcloud.com/"]'));

    for (const anchor of anchors) {
      const href = anchor.getAttribute("href")?.trim();
      if (!href) continue;

      let url: URL;
      try {
        url = new URL(href, window.location.origin);
      } catch {
        continue;
      }

      const segment = url.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
      if (!segment || blocked.has(segment) || url.pathname.split("/").filter(Boolean).length !== 1) {
        continue;
      }

      const profileUrl = `https://soundcloud.com/${segment}`;
      if (results.some((item) => item.profileUrl === profileUrl)) {
        continue;
      }

      const card =
        anchor.closest("li") ??
        anchor.closest("article") ??
        anchor.closest('[class*="search"]') ??
        anchor.parentElement;

      const cardText = card?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const img = card?.querySelector("img");
      const avatarUrl = img?.getAttribute("src") ?? img?.getAttribute("data-src") ?? null;

      results.push({
        name: anchor.textContent?.replace(/\s+/g, " ").trim() || segment,
        username: segment,
        profileUrl,
        avatarUrl,
        location: null,
        bio: cardText.length > 120 ? cardText.slice(0, 120) : cardText || null,
      });

      if (results.length >= 8) {
        break;
      }
    }

    return results;
  });

  return dedupeCandidates(
    raw.map((item) => ({
      ...item,
      avatarUrl: bestSoundCloudAvatarUrl(item.avatarUrl),
      name: item.name.trim(),
      bio: cleanText(item.bio),
      location: cleanText(item.location),
    }))
  );
}

export type EnrichedSoundCloudProfile = ParsedSoundCloudProfile & {
  profileUrl: string;
  displayName: string | null;
  location: string | null;
};

export class SoundCloudPlaywrightScraper {
  private browser: Browser | null = null;

  async launch(): Promise<void> {
    if (this.browser) {
      return;
    }

    this.browser = await chromium.launch({ headless: true });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  private async newPage(): Promise<Page> {
    if (!this.browser) {
      await this.launch();
    }

    const page = await this.browser!.newPage({
      userAgent: USER_AGENT,
      viewport: { width: 1365, height: 900 },
    });

    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    return page;
  }

  async searchPeople(djName: string): Promise<SoundCloudSearchCandidate[]> {
    const page = await this.newPage();

    try {
      const searchUrl = `https://soundcloud.com/search/people?q=${encodeURIComponent(djName.trim())}`;
      await page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      await page.waitForTimeout(2_000);

      const html = await page.content();
      const hydrationCandidates = parseHydrationCandidates(html);
      if (hydrationCandidates.length > 0) {
        return hydrationCandidates;
      }

      return extractDomCandidates(page);
    } finally {
      await page.close();
    }
  }

  async enrichProfile(profileUrl: string): Promise<EnrichedSoundCloudProfile> {
    const page = await this.newPage();

    try {
      const normalized = normalizeSoundCloudProfileUrl(profileUrl);
      await page.goto(normalized, {
        waitUntil: "domcontentloaded",
        timeout: NAV_TIMEOUT_MS,
      });

      await page.waitForTimeout(1_500);

      const html = await page.content();
      const parsed = parseSoundCloudProfileHtml(html);

      const canonical =
        cleanText(
          await page
            .locator('meta[property="og:url"]')
            .getAttribute("content")
            .catch(() => null)
        ) ?? normalized;

      const city = parsed.city;
      const country = parsed.countryCode;
      const location = [city, country].filter(Boolean).join(", ") || null;

      return {
        ...parsed,
        profileUrl: isProfileUrl(canonical) ? normalizeSoundCloudProfileUrl(canonical) : normalized,
        displayName: parsed.username,
        location,
      };
    } finally {
      await page.close();
    }
  }
}

export function randomDelayMs(min = 1_500, max = 3_500): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function countryLabelFromCode(code: string | null | undefined): string | null {
  if (isBlank(code)) {
    return null;
  }

  const upper = code!.trim().toUpperCase();
  if (upper === "AT") {
    return "Austria";
  }

  return upper;
}

export function splitLocationToCityCountry(location: string | null): {
  city: string | null;
  country: string | null;
} {
  if (isBlank(location)) {
    return { city: null, country: null };
  }

  const parts = location!
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    return {
      city: parts[0] ?? null,
      country: parts.slice(1).join(", ") || null,
    };
  }

  return { city: location!.trim(), country: null };
}
