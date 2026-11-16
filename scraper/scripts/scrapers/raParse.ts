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

/** Concert halls, fancy clubs, skybars, rooftop bars, and hotel bars. */
const DENIED_VENUE = [
  /o[-\s]?club/i,
  /o\s*der\s*klub/i,
  /volksgarten/i,
  /konzerthaus/i,
  /musikverein/i,
  /staatsoper/i,
  /volksoper/i,
  /skybar/i,
  /rooftop/i,
  /hotel\s*bar/i,
  /oktogon/i,
  /am himmel/i,
  /jaz in the city/i,
];

/** Same idea when the venue name is generic but the title says where it is. */
const DENIED_PLACE_TEXT = [/\bskybar\b/i, /\brooftop\b/i, /\bhotel\s*bar\b/i, /\bskyscraper\b/i];

/** Clubs whose RA listings are in scope even when the title is loose. */
const KNOWN_RAVE_VENUE = [
  /das werk/i,
  /grelle forelle/i,
  /the loft/i,
  /\bsass\b/i,
  /flucc/i,
  /\bflex\b/i,
  /\barena\b/i,
  /\brhiz\b/i,
  /\bloop\b/i,
  /kramladen/i,
  /\bprst\b/i,
  /club lucia/i,
  /\bceleste\b/i,
  /tagada/i,
  /prater dome/i,
  /club exil/i,
  /weberknecht/i,
];

const DISCO_FUNK_ONLY = /\b(?:disco|funk|soul)\b/i;

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

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function strongFromRaTags(genreNames: string[]): boolean {
  return genreNames.some((name) =>
    guessGenres(name).some((genre) => STRONG_GENRES.has(genre)),
  );
}

/** Disco / funk / soul tags and no techno, house, DnB, or other rave tag. */
export function raGenresAreDiscoFunkOnly(genreNames: string[]): boolean {
  if (genreNames.length === 0 || strongFromRaTags(genreNames)) return false;
  return DISCO_FUNK_ONLY.test(genreNames.join(" "));
}

export function isDeniedRaVenue(venueName: string, title = ""): boolean {
  if (matchesAny(venueName, DENIED_VENUE)) return true;
  return matchesAny(`${venueName} ${title}`, DENIED_PLACE_TEXT);
}

export function isKnownRaveVenue(venueName: string): boolean {
  return matchesAny(venueName, KNOWN_RAVE_VENUE);
}

function tagsAreNonRaveOnly(genreNames: string[]): boolean {
  if (genreNames.length === 0 || strongFromRaTags(genreNames)) return false;
  return genreNames.every((name) =>
    /\b(?:classical|jazz|rock|metal|punk|pop|hip[\s-]?hop|folk|schlager)\b/i.test(name),
  );
}

export function isRelevantRaEvent(event: {
  title: string;
  venueName: string;
  genres: string[];
  /** RA's own genre tags. The title is not scanned, so "House of Funk" is not House. */
  raGenres?: string[];
  artists: string[];
  promoters: string[];
}): boolean {
  if (isDeniedRaVenue(event.venueName, event.title)) return false;

  const tags = event.raGenres ?? event.genres;
  if (isKnownRaveVenue(event.venueName)) return !tagsAreNonRaveOnly(tags);
  if (raGenresAreDiscoFunkOnly(tags)) return false;
  return strongFromRaTags(tags);
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
        raGenres: genreNames,
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
