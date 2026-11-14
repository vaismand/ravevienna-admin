import { RequestPacer, ResponseCache } from "../../../scripts/lib/responseCache.ts";
import {
  isViennaListing,
  listingsFromSitemapXml,
  type TicketSwapListing,
} from "./match.ts";

const SITEMAP_INDEX = "https://www.ticketswap.com/sitemap.xml";

/** Same browser identity the venue scrapers send. */
export const TICKETSWAP_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const MIN_INTERVAL_MS = 1500;

export function eventSitemapUrls(indexXml: string): string[] {
  const locs = [...indexXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(
    (match) => match[1],
  );
  return locs.filter((loc) => /\/sitemap\/event_\d+\.xml$/i.test(loc));
}

function looksLikeBrowserCheck(body: string): boolean {
  const head = body.slice(0, 800);
  return (
    head.includes("__tswac") ||
    /<title>\s*Verifying\s*<\/title>/i.test(head) ||
    /"_(?:r|s|t)":/.test(head)
  );
}

async function fetchXml(
  url: string,
  cache: ResponseCache,
  pacer: RequestPacer,
  fetchImpl: typeof fetch,
): Promise<{ body: string; cached: boolean }> {
  const cached = await cache.get(url);
  if (cached != null) return { body: cached, cached: true };

  await pacer.wait();
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": TICKETSWAP_USER_AGENT,
      Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.text();

  if (
    response.status === 403 ||
    response.status === 202 ||
    looksLikeBrowserCheck(body)
  ) {
    throw new Error(
      `TicketSwap blocked ${url} (HTTP ${response.status}). Event HTML is behind a browser check; the sitemap is the path this script uses.`,
    );
  }

  if (!response.ok || !body.includes("<loc>")) {
    throw new Error(
      `Unexpected TicketSwap response for ${url} (HTTP ${response.status}).`,
    );
  }

  await cache.set(url, body);
  return { body, cached: false };
}

export async function loadViennaTicketSwapListings(options?: {
  cacheDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<{
  listings: TicketSwapListing[];
  sitemapCount: number;
  fetched: number;
  cached: number;
}> {
  const cache = new ResponseCache(
    options?.cacheDir ?? "scripts/output/ticketswap-cache",
    CACHE_TTL_MS,
  );
  const pacer = new RequestPacer(MIN_INTERVAL_MS);
  const fetchImpl = options?.fetchImpl ?? fetch;

  const index = await fetchXml(SITEMAP_INDEX, cache, pacer, fetchImpl);
  const eventSitemaps = eventSitemapUrls(index.body);
  if (eventSitemaps.length === 0) {
    throw new Error("TicketSwap sitemap index did not list any event sitemaps.");
  }

  const listings: TicketSwapListing[] = [];
  let fetched = index.cached ? 0 : 1;
  let cached = index.cached ? 1 : 0;

  for (const url of eventSitemaps) {
    const file = await fetchXml(url, cache, pacer, fetchImpl);
    if (file.cached) cached += 1;
    else fetched += 1;
    for (const listing of listingsFromSitemapXml(file.body)) {
      if (isViennaListing(listing)) listings.push(listing);
    }
  }

  return {
    listings,
    sitemapCount: eventSitemaps.length,
    fetched,
    cached,
  };
}
