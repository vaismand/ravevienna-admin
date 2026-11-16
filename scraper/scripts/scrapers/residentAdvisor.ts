import { postRaGraphql } from "../../../scripts/lib/raArtistSearch.ts";
import { matchVenueId, type VenueRow } from "./eventMatch.ts";
import {
  RA_EVENT_LISTINGS_QUERY,
  RA_VIENNA_AREA_ID,
  parseRaEventListings,
} from "./raParse.ts";
import type { ScrapedEvent, ScrapeSource } from "./types.ts";

const PAGE_SIZE = 50;

function viennaDay(reference = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
}

async function fetchListingsPage(
  page: number,
  fromDate: string,
): Promise<{ payload: unknown | null; error: string | null }> {
  return postRaGraphql(fetch, "GET_EVENT_LISTINGS", RA_EVENT_LISTINGS_QUERY, {
    filters: {
      areas: { eq: Number(RA_VIENNA_AREA_ID) },
      listingDate: { gte: fromDate },
    },
    pageSize: PAGE_SIZE,
    page,
  });
}

function totalResults(payload: unknown): number {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  const listings =
    data && typeof data === "object"
      ? (data as { eventListings?: { totalResults?: unknown } }).eventListings
      : null;
  const total = listings?.totalResults;
  return typeof total === "number" ? total : 0;
}

/**
 * Vienna events from RA's public GraphQL API (the same endpoint DJ enrichment uses).
 * `venues` is the `venues` table so a listing can be tied to an existing row.
 */
export async function scrapeResidentAdvisor(
  source: ScrapeSource,
  venues: VenueRow[] = [],
): Promise<ScrapedEvent[]> {
  const fromDate = viennaDay();
  const first = await fetchListingsPage(1, fromDate);
  if (!first.payload) {
    console.log(`Resident Advisor listings skipped: ${first.error ?? "no payload"}`);
    return [];
  }

  const payloads = [first.payload];
  const total = totalResults(first.payload);
  const pages = Math.min(Math.ceil(total / PAGE_SIZE), 8);

  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchListingsPage(page, fromDate);
    if (!next.payload) {
      console.log(`Resident Advisor page ${page} skipped: ${next.error ?? "no payload"}`);
      break;
    }
    payloads.push(next.payload);
  }

  const events = payloads.flatMap((payload) => parseRaEventListings(payload, venues, fromDate));
  const seen = new Set<string>();
  const unique = events.filter((event) => {
    if (seen.has(event.external_id)) return false;
    seen.add(event.external_id);
    return true;
  });

  console.log(
    `Resident Advisor: ${unique.length} relevant Vienna events` +
      (source.name ? ` for ${source.name}` : ""),
  );
  return unique.map((event) => ({
    ...event,
    raw_data: {
      ...event.raw_data,
      venue_id: matchVenueId(String(event.raw_data.venue_name ?? ""), venues),
    },
  }));
}
