import { isPastViennaDate } from "../../../scripts/lib/dates.ts";
import { guessGenres } from "./helpers.ts";
import { normalizeLineupNames } from "./lineup.ts";
import { matchVenueId, type VenueRow } from "./eventMatch.ts";
import type { ScrapedEvent } from "./types.ts";

/** Resident Advisor area id for Vienna (`/guide/at/vienna`). */
export const RA_VIENNA_AREA_ID = "450";

export const RA_EVENT_LISTINGS_QUERY = `query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    totalResults
    data {
      id
      listingDate
      event {
        id
        title
        date
        startTime
        endTime
        contentUrl
        flyerFront
        cost
        images { filename type }
        venue { id name contentUrl live }
        artists { id name }
        promoters { id name }
        genres { id name }
        pick { blurb }
      }
    }
  }
}`;

const STRONG_GENRES = new Set([
  "Techno",
  "Hard Techno",
  "House",
  "Trance",
  "Psytrance",
  "Drum & Bass",
  "Jungle",
  "Bass Music",
  "Dubstep",
  "Breakbeat",
  "Hardcore",
  "Tekno",
  "Hardstyle",
  "Gabber",
  "Electro",
  "EBM",
]);

const EXCLUDED_VENUE = [/o[-\s]?club/i, /o\s*der\s*klub/i, /volksgarten/i];

const NON_RAVE_TITLE = /\b(?:classical|jazz|hip[\s-]?hop|punk|metal|schlager|kabarett|comedy|wrestling)\b/i;

export type RaListingEvent = {
  id?: string;
  title?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  contentUrl?: string;
  flyerFront?: string | null;
  cost?: string | null;
  images?: Array<{ filename?: string | null; type?: string | null }> | null;
  venue?: { id?: string; name?: string | null; contentUrl?: string | null } | null;
  artists?: Array<{ id?: string; name?: string | null }> | null;
  promoters?: Array<{ id?: string; name?: string | null }> | null;
  genres?: Array<{ id?: string; name?: string | null }> | null;
  pick?: { blurb?: string | null } | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/** RA sends local Vienna clocks with no offset. Don't shift them through UTC. */
export function parseRaDateTime(value: string | null | undefined): {
  date: string | null;
  time: string | null;
} {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return { date: null, time: null };
  return { date: match[1] ?? null, time: `${match[2]}:${match[3]}:00` };
}

export function parseRaPrice(cost: string | null | undefined): number | null {
  if (!cost?.trim()) return null;
  if (/\b(?:free|kostenlos|eintritt frei)\b/i.test(cost)) return 0;

  const numbers = [...cost.matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((match) => Number(match[0].replace(",", ".")))
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Math.min(...numbers);
}

export function raEventUrl(event: RaListingEvent): string | null {
  const id = event.id?.trim();
  if (id) return `https://ra.co/events/${id}`;
  const content = event.contentUrl?.trim();
  if (!content) return null;
  if (content.startsWith("http")) return content;
  return `https://ra.co${content.startsWith("/") ? content : `/${content}`}`;
}

export function raFlyerUrl(event: RaListingEvent): string | null {
  const images = event.images ?? [];
  const front = images.find(
    (image) => image?.type === "FLYERFRONT" && image.filename?.trim(),
  );
  const raw = front?.filename?.trim() || event.flyerFront?.trim() || "";
  if (!raw) return null;
  if (raw.startsWith("http")) return raw;
  return `https://ra.co${raw.startsWith("/") ? raw : `/${raw}`}`;
}

/** Evening and afterhours. A late-morning festival such as Donauinselfest is not a club night. */
function raStartIsClubTime(time: string | null): boolean {
  if (!time) return true;
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return true;
  return hour >= 17 || hour < 6;
}

function venueIsOutOfScope(name: string): boolean {
  return EXCLUDED_VENUE.some((pattern) => pattern.test(name));
}

export function isRelevantRaEvent(event: {
  title: string;
  venueName: string;
  genres: string[];
  artists: string[];
  promoters: string[];
}): boolean {
  if (venueIsOutOfScope(event.venueName)) return false;

  const text = [event.title, ...event.artists, ...event.promoters, ...event.genres].join(" ");
  const strong =
    event.genres.some((genre) => STRONG_GENRES.has(genre)) ||
    guessGenres(text).some((genre) => STRONG_GENRES.has(genre));
  if (!strong) return false;
  if (NON_RAVE_TITLE.test(event.title) && !event.genres.some((genre) => STRONG_GENRES.has(genre))) {
    return false;
  }
  return true;
}

function listingEvents(payload: unknown): RaListingEvent[] {
  const data = asRecord(asRecord(payload)?.data);
  const listings = asRecord(data?.eventListings);
  const rows = listings?.data;
  if (!Array.isArray(rows)) return [];

  const events: RaListingEvent[] = [];
  for (const row of rows) {
    const event = asRecord(asRecord(row)?.event);
    if (!event) continue;
    events.push(event as RaListingEvent);
  }
  return events;
}

export function parseRaEventListings(
  payload: unknown,
  venues: VenueRow[],
  today?: string,
): ScrapedEvent[] {
  const events: ScrapedEvent[] = [];

  for (const item of listingEvents(payload)) {
    const title = item.title?.trim() || "";
    const venueName = item.venue?.name?.trim() || "";
    const when = parseRaDateTime(item.startTime || item.date);
    if (!title || !when.date || isPastViennaDate(when.date, today)) continue;
    if (!raStartIsClubTime(when.time)) continue;

    const genreNames = (item.genres ?? [])
      .map((genre) => genre?.name?.trim() || "")
      .filter(Boolean);
    const artistNames = normalizeLineupNames(
      (item.artists ?? []).map((artist) => artist?.name?.trim() || "").filter(Boolean),
    );
    const promoterNames = (item.promoters ?? [])
      .map((promoter) => promoter?.name?.trim() || "")
      .filter((name) => name && !/^tickets?$/i.test(name));
    const genres = guessGenres([...genreNames, title].join(" "));

    if (
      !isRelevantRaEvent({
        title,
        venueName,
        genres,
        artists: artistNames,
        promoters: promoterNames,
      })
    ) {
      continue;
    }

    const url = raEventUrl(item);
    if (!url || !item.id) continue;
    const end = parseRaDateTime(item.endTime);

    events.push({
      title,
      event_date: when.date,
      start_time: when.time,
      price: parseRaPrice(item.cost),
      genres,
      description: item.pick?.blurb?.trim() || null,
      lineup: artistNames,
      ticket_url: url,
      image_url: raFlyerUrl(item),
      external_url: url,
      external_id: `ra-${item.id}`,
      raw_data: {
        source: "Resident Advisor",
        venue_name: venueName,
        venue_id: matchVenueId(venueName, venues),
        end_time: end.time,
        ra_event_id: item.id,
        ra_venue_id: item.venue?.id ?? null,
        promoters: promoterNames,
        ra_genres: genreNames,
        cost: item.cost ?? null,
      },
    });
  }

  return events;
}
