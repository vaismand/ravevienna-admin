import { normalizeEventGenres } from "../../scripts/lib/genres.ts";
import { enrichEventText, normalizeLineupNames } from "./scrapers/lineup.ts";
import type { ScrapedEvent, ScrapeSource } from "./scrapers/types.ts";
import { scrapedSoldOutForDraft } from "./soldOutSync.ts";

/**
 * Columns read back before a pending-draft upsert. The upsert writes every
 * column present in the payload, so a missing scrape value has to be filled
 * from here instead of sent as null.
 */
export const EXISTING_DRAFT_COLUMNS =
  "external_id, title, event_date, start_time, price, genres, description, lineup, ticket_url, image_url, external_url, status, raw_data, sold_out";

export type ExistingDraftRow = {
  external_id: string;
  title: string | null;
  event_date: string | null;
  start_time: string | null;
  price: number | string | null;
  genres: string[] | null;
  description: string | null;
  lineup: string[] | null;
  ticket_url: string | null;
  image_url: string | null;
  external_url: string | null;
  status: string;
  raw_data: Record<string, unknown> | null;
  sold_out: boolean | null;
};

/** Nothing the venue page actually gave us: null, blank text, or an empty list. */
export function isBlankScrapedValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) {
    return !value.some((item) => {
      if (typeof item === "string") return item.trim().length > 0;
      return item != null;
    });
  }
  return false;
}

/**
 * Site icons that used to land in image_url. A later scrape that finds the
 * real flyer should replace them; the icon itself is not a flyer.
 */
export function isPlaceholderImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  let pathname = trimmed.split(/[?#]/, 1)[0] ?? trimmed;
  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    // Relative or otherwise non-absolute values still have a filename.
  }

  const file = decodeURIComponent(pathname.split("/").pop() ?? "").toLowerCase();
  if (!file) return false;
  if (file.endsWith(".ico")) return true;
  return /favicon|apple-touch-icon|site-icon/.test(file);
}

function preferScraped<T>(scraped: T, existing: T | null | undefined): T {
  if (!isBlankScrapedValue(scraped)) return scraped;
  if (isBlankScrapedValue(existing)) return scraped;
  return existing as T;
}

function preferImage(
  scraped: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  const scrapedUrl = typeof scraped === "string" ? scraped.trim() : "";
  const existingUrl = typeof existing === "string" ? existing.trim() : "";
  const scrapedReal = scrapedUrl.length > 0 && !isPlaceholderImageUrl(scrapedUrl);
  const existingReal = existingUrl.length > 0 && !isPlaceholderImageUrl(existingUrl);

  if (scrapedReal) return scrapedUrl;
  if (existingReal) return existingUrl;
  if (scrapedUrl) return scrapedUrl;
  if (existingUrl) return existingUrl;
  return null;
}

export function venueIdForDraft(source: ScrapeSource, event: ScrapedEvent): string | null {
  const fromEvent = event.raw_data.venue_id;
  if (typeof fromEvent === "string" && fromEvent.trim()) return fromEvent.trim();
  if (typeof event.raw_data.venue_name === "string" && event.raw_data.venue_name.trim()) {
    return null;
  }
  return source.venue_id?.trim() || null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
}

function mergeRawData(
  existing: Record<string, unknown> | null | undefined,
  scraped: Record<string, unknown>,
  extras: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };

  const apply = (key: string, value: unknown) => {
    if (isBlankScrapedValue(value) && !isBlankScrapedValue(merged[key])) return;
    merged[key] = value;
  };

  for (const [key, value] of Object.entries(scraped)) apply(key, value);
  for (const [key, value] of Object.entries(extras)) apply(key, value);
  return merged;
}

/**
 * Row for `draft_events` upsert. On a pending draft that already exists, a
 * blank scraped field keeps the stored value (manual edits, Resident Advisor,
 * an earlier scrape). A real scraped value still wins, including a flyer that
 * replaces a favicon. New drafts are unchanged: blank fields stay null.
 * `is_promoted` is not a draft column and is never a top-level field here.
 */
export function buildDraftRow(
  source: ScrapeSource,
  event: ScrapedEvent,
  existing: ExistingDraftRow | undefined,
) {
  const enriched = enrichEventText(event.description);
  const explicitLineup = normalizeLineupNames(event.lineup ?? []);
  const scrapedLineup = explicitLineup.length > 0 ? explicitLineup : enriched.lineup;
  const lineup = preferScraped(scrapedLineup, stringList(existing?.lineup));
  const eventDate = preferScraped(event.event_date, existing?.event_date ?? null);
  const soldOut = scrapedSoldOutForDraft({
    scrapedSoldOut: event.sold_out === true,
    existingRawData: existing?.raw_data,
    existingSoldOut: existing?.sold_out,
  });

  return {
    source_id: source.id,
    venue_id: venueIdForDraft(source, event),
    title: preferScraped(event.title, existing?.title ?? null),
    event_date: eventDate,
    start_time: preferScraped(event.start_time, existing?.start_time ?? null),
    price: preferScraped<number | string | null>(event.price, existing?.price ?? null),
    sold_out: soldOut.soldOut,
    genres: preferScraped<string[]>(
      normalizeEventGenres(event.genres),
      stringList(existing?.genres),
    ),
    description: preferScraped(enriched.description, existing?.description ?? null),
    lineup,
    ticket_url: preferScraped(event.ticket_url, existing?.ticket_url ?? null),
    image_url: preferImage(event.image_url, existing?.image_url),
    external_url: preferScraped(event.external_url, existing?.external_url ?? null),
    external_id: event.external_id,
    status: "pending" as const,
    confidence: eventDate?.trim() ? 0.8 : 0.35,
    raw_data: mergeRawData(existing?.raw_data, event.raw_data, {
      extracted_lineup: scrapedLineup,
      ...(soldOut.preserveManual ? { sold_out_manual: true } : {}),
    }),
  };
}
