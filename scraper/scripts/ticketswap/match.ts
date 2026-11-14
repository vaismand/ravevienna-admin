/**
 * Match a Rave Vienna event to one TicketSwap event URL.
 *
 * TicketSwap HTML (city, location, search) sits behind a browser check.
 * The public event sitemap does not: each URL already carries the title,
 * city, venue, and calendar date, for example
 * `/club-tickets/paradies-garten-w-paracek-vienna-grelle-forelle-2026-11-14-<id>`.
 *
 * A link is proposed only when the date is exact, the venue sits after the
 * Vienna token, and the event-name tokens appear in order. Anything else
 * stays a review candidate.
 */

export type TicketSwapListing = {
  url: string;
  date: string;
  slug: string;
  tokens: string[];
  lastmod: string | null;
};

export type TicketSwapCandidate = {
  url: string;
  reason: string;
};

export type TicketSwapMatch = {
  status: "match" | "review" | "none";
  url: string | null;
  confidence: "high" | null;
  reason: string;
  candidates: TicketSwapCandidate[];
};

const EVENT_URL =
  /^https?:\/\/(?:[a-z0-9-]+\.)*ticketswap\.(?:[a-z]{2,}|co\.[a-z]{2})\/[a-z0-9-]+\/(.+)-(\d{4}-\d{2}-\d{2})-([a-z0-9]+)\/?$/i;

const TITLE_STOP = new Set([
  "a",
  "an",
  "the",
  "and",
  "und",
  "mit",
  "with",
  "feat",
  "featuring",
  "pres",
  "presents",
  "presented",
  "w",
  "vs",
  "vol",
  "volume",
  "on",
  "of",
  "at",
  "for",
  "from",
  "live",
  "official",
  "tickets",
  "ticket",
  "vienna",
  "wien",
  "austria",
  "edition",
  "night",
  "tour",
  "open",
  "air",
]);

const WEAK_TITLE_OVERLAP = new Set([
  "wiener",
  "vienna",
  "wien",
  "club",
  "music",
  "rave",
  "party",
]);

const VENUE_GENERIC = new Set([
  "the",
  "club",
  "music",
  "bar",
  "vienna",
  "wien",
  "austria",
  "nightclub",
  "venue",
  "and",
]);

/**
 * Extra slug phrases for venues whose TicketSwap slug is not the words in
 * the database name. Keyed by the distinctive venue tokens.
 */
const EXTRA_VENUE_PHRASES: Record<string, string[][]> = {
  flucc: [["fluc"]],
  "prater dome": [["praterdome"]],
  "einbaumobel 1bm": [["einbaumobel"]],
  "wiener wurstelstand spittelau": [["wurstelstand"], ["spittelau"]],
};

export function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function matchTokens(value: string): string[] {
  const normalized = normalizeMatchText(value);
  return normalized ? normalized.split(" ") : [];
}

export function parseTicketSwapEventUrl(
  url: string,
  lastmod: string | null = null,
): TicketSwapListing | null {
  const trimmed = url.trim();
  const match = EVENT_URL.exec(trimmed);
  if (!match) return null;

  const slug = match[1].toLowerCase();
  const date = match[2];
  if (slug.includes("/") || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const tokens = slug.split("-").filter(Boolean);
  if (tokens.length === 0) return null;

  return {
    url: trimmed.replace(/\/$/, ""),
    date,
    slug,
    tokens,
    lastmod,
  };
}

export function listingsFromSitemapXml(xml: string): TicketSwapListing[] {
  const listings: TicketSwapListing[] = [];

  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const body = block[1];
    const loc = body.match(/<loc>\s*([^<\s]+)\s*<\/loc>/);
    if (!loc) continue;
    const lastmod = body.match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/);
    const listing = parseTicketSwapEventUrl(loc[1], lastmod?.[1] ?? null);
    if (listing) listings.push(listing);
  }

  return listings;
}

export function isViennaListing(listing: TicketSwapListing): boolean {
  return listing.tokens.includes("vienna") || listing.tokens.includes("wien");
}

/** Search query in the same shape as the mobile app helper. For review logs. */
export function buildTicketSwapSearchQuery(event: {
  title: string;
  venueName?: string | null;
  date?: string | null;
}): string {
  const year = event.date?.slice(0, 4) ?? "";
  return [
    "site:ticketswap.com",
    `"${event.title}"`,
    event.venueName ? `"${event.venueName}"` : "",
    `"Vienna"`,
    year,
  ]
    .filter(Boolean)
    .join(" ");
}

function eventName(title: string): string {
  const presents = title.split(/\b(?:presents|presented by|pres\.?)\b/i);
  if (presents.length > 1) {
    const after = presents.slice(1).join(" ");
    const afterTokens = matchTokens(after).filter(
      (token) => token.length >= 4 && !TITLE_STOP.has(token),
    );
    if (afterTokens.length > 0) return after;
    return presents[0] ?? title;
  }

  const head = title.split(/\s(?:w\/|feat\.?|featuring)\s/i)[0];
  return head || title;
}

/** Event-name tokens that must appear, in order, before a link is stored. */
export function titleTokensForMatch(title: string): string[] {
  return matchTokens(eventName(title))
    .filter(
      (token) =>
        token.length >= 3 && !TITLE_STOP.has(token) && !/^\d+$/.test(token),
    )
    .slice(0, 4);
}

function titleIsStrong(tokens: string[]): boolean {
  return tokens.some((token) => token.length >= 4);
}

export function venuePhrasesForMatch(venueName: string | null | undefined): string[][] {
  if (!venueName?.trim()) return [];

  const withoutParen = venueName.replace(/\([^)]*\)/g, " ");
  const distinctive = matchTokens(withoutParen).filter(
    (token) => !VENUE_GENERIC.has(token) && token.length >= 2,
  );
  if (distinctive.length === 0) return [];

  const phrases = [distinctive];
  const extras = EXTRA_VENUE_PHRASES[distinctive.join(" ")];
  if (extras) phrases.push(...extras);
  return phrases;
}

function containsContiguous(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, index) => haystack[start + index] === token)) {
      return true;
    }
  }
  return false;
}

function containsInOrder(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  let index = 0;
  for (const token of haystack) {
    if (token === needle[index]) {
      index += 1;
      if (index === needle.length) return true;
    }
  }
  return false;
}

function venueAfterCity(tokens: string[], phrases: string[][]): boolean {
  const cityAt = tokens.findIndex(
    (token) => token === "vienna" || token === "wien",
  );
  if (cityAt < 0) return false;
  const tail = tokens.slice(cityAt + 1);
  return phrases.some((phrase) => containsContiguous(tail, phrase));
}

function listingRank(listing: TicketSwapListing): string {
  const lastmod = listing.lastmod ?? "";
  return `${lastmod}\u0000${listing.url}`;
}

function preferredListing(listings: TicketSwapListing[]): TicketSwapListing {
  return listings.reduce((best, listing) =>
    listingRank(listing) > listingRank(best) ? listing : best,
  );
}

function meaningfulTitleHits(tokens: string[], wanted: string[]): number {
  const present = new Set(tokens);
  return wanted.filter(
    (token) =>
      present.has(token) &&
      token.length >= 4 &&
      !WEAK_TITLE_OVERLAP.has(token),
  ).length;
}

export function matchTicketSwapEvent(
  event: { title: string; venueName?: string | null; date: string },
  listingsOnDate: TicketSwapListing[],
): TicketSwapMatch {
  const titleTokens = titleTokensForMatch(event.title);
  const phrases = venuePhrasesForMatch(event.venueName);
  const strongTitle = titleIsStrong(titleTokens);

  const highs = new Map<string, TicketSwapListing[]>();
  const review: { listing: TicketSwapListing; reason: string; score: number }[] =
    [];

  for (const listing of listingsOnDate) {
    if (listing.date !== event.date) continue;
    if (!isViennaListing(listing)) continue;

    const venueOk = phrases.length > 0 && venueAfterCity(listing.tokens, phrases);
    const titleOk =
      strongTitle && containsInOrder(listing.tokens, titleTokens);
    const hits = meaningfulTitleHits(listing.tokens, titleTokens);

    if (venueOk && titleOk) {
      const group = highs.get(listing.slug) ?? [];
      group.push(listing);
      highs.set(listing.slug, group);
      continue;
    }

    if (!venueOk && hits === 0) continue;

    let reason: string;
    if (venueOk && !titleOk) {
      reason = strongTitle
        ? "venue matches; title tokens are missing"
        : "venue matches; title is too short to link automatically";
    } else if (!venueOk && hits > 0) {
      reason = "title overlaps; venue does not match";
    } else {
      reason = "partial overlap";
    }

    review.push({
      listing,
      reason,
      score: (venueOk ? 10 : 0) + hits,
    });
  }

  if (highs.size === 1) {
    const [slug, group] = [...highs.entries()][0];
    const chosen = preferredListing(group);
    const duplicates = group.length - 1;
    return {
      status: "match",
      url: chosen.url,
      confidence: "high",
      reason:
        duplicates > 0
          ? `date, venue, and title match (${duplicates + 1} sitemap urls for ${slug}; kept the newest)`
          : "date, venue, and title match",
      candidates: [],
    };
  }

  if (highs.size > 1) {
    const candidates = [...highs.values()].map((group) => {
      const chosen = preferredListing(group);
      return {
        url: chosen.url,
        reason: "date, venue, and title match; another listing matches too",
      };
    });
    return {
      status: "review",
      url: null,
      confidence: null,
      reason: `${highs.size} TicketSwap listings match this date, venue, and title`,
      candidates,
    };
  }

  review.sort((a, b) => b.score - a.score || a.listing.url.localeCompare(b.listing.url));
  const candidates = review.slice(0, 5).map((item) => ({
    url: item.listing.url,
    reason: item.reason,
  }));

  if (candidates.length === 0) {
    return {
      status: "none",
      url: null,
      confidence: null,
      reason: "no Vienna TicketSwap listing on this date matched the title and venue",
      candidates: [],
    };
  }

  return {
    status: "review",
    url: null,
    confidence: null,
    reason: "no single confident listing",
    candidates,
  };
}

export function indexListingsByDate(
  listings: TicketSwapListing[],
): Map<string, TicketSwapListing[]> {
  const byDate = new Map<string, TicketSwapListing[]>();
  for (const listing of listings) {
    const group = byDate.get(listing.date);
    if (group) group.push(listing);
    else byDate.set(listing.date, [listing]);
  }
  return byDate;
}
