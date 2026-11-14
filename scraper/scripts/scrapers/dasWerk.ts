import * as cheerio from "cheerio";

import { parseDasWerkProgramHtml } from "./dasWerkParse";
import {
  cleanText,
  guessGenres,
  hasHardRejectKeywords,
  http,
  parseIsoDateTimeLocal,
  parsePrice,
  sleep,
} from "./helpers";
import type { ScrapedEvent, ScrapeSource } from "./types";

async function enrichFromEventimTicketPage(
  ticketUrl: string | null
): Promise<{
  genres: string[];
  price: number | null;
  description: string | null;
  event_date: string | null;
  start_time: string | null;
} | null> {
  if (!ticketUrl || !ticketUrl.includes("eventim-light.com")) {
    return null;
  }

  try {
    const { data: html } = await http.get(ticketUrl);
    const $ = cheerio.load(html);

    const rawJson = $("#vike_pageContext").text().trim();

    if (!rawJson) {
      return null;
    }

    const context = JSON.parse(rawJson);
    const event = context?.data ?? context?.initialStoreState?.events?.event;

    if (!event) {
      return null;
    }

    const plainDescription = cleanText(event.description ?? "");
    const teaser = cleanText(event.teaser ?? "");

    const combinedText = [event.title, event.category, teaser, plainDescription]
      .filter(Boolean)
      .join(" ");

    const local = parseIsoDateTimeLocal(event.start);

    return {
      genres: guessGenres(combinedText),
      price: event.minPrice?.value ?? null,
      description: plainDescription || teaser || null,
      event_date: local.date,
      start_time: local.time,
    };
  } catch {
    return null;
  }
}

/**
 * Das Werk is a club program. Nights stay in the review queue even when the
 * title has no rave keyword. Drop concerts and other non-club listings:
 * titles that start with "Konzert:", early 19:00 shows, and hard-reject bills.
 */
export function isDasWerkClubNight(event: {
  title: string;
  description?: string | null;
  genres?: string[];
  start_time?: string | null;
}): boolean {
  const title = event.title.trim();
  if (/^konzert\s*:/i.test(title)) return false;

  const text = `${title} ${event.description ?? ""} ${(event.genres ?? []).join(" ")}`;
  if (hasHardRejectKeywords(text)) return false;

  const hour = Number((event.start_time ?? "").slice(0, 2));
  if (Number.isFinite(hour) && hour >= 17 && hour <= 20) return false;

  return true;
}

function descriptionAlreadyListsArtists(description: string): boolean {
  return /\b(?:line[\s-]?up|main\s*floor|mainfloor|luster\s*floor|laster\s*floor|second\s*floor)\b/i.test(
    description
  );
}

function mergeDasWerkDescription(description: string, actsLine: string): string {
  const acts = actsLine.trim();
  if (!acts || descriptionAlreadyListsArtists(description)) return description;
  return [description, `Lineup:\n${acts}`].filter(Boolean).join("\n\n");
}

export async function scrapeDasWerk(source: ScrapeSource): Promise<ScrapedEvent[]> {
  const { data: html } = await http.get(source.url);
  const rawEvents = parseDasWerkProgramHtml(html);

  if (rawEvents.length === 0) {
    console.log("Could not find Das Werk events payload");
    return [];
  }

  const events: ScrapedEvent[] = [];

  for (const item of rawEvents) {
    const local = parseIsoDateTimeLocal(item.dateIso ?? "");
    const title = item.title ?? "Untitled event";
    const description = item.description ?? "";
    const actsLine = item.actsLine ?? "";
    const ticketUrl = item.ticketUrl || null;

    if (
      !isDasWerkClubNight({
        title,
        description,
        start_time: local.time,
      })
    ) {
      continue;
    }

    const ticketData = await enrichFromEventimTicketPage(ticketUrl);
    const cmsDescription = description || ticketData?.description || "";
    const mergedDescription = mergeDasWerkDescription(cmsDescription, actsLine);

    const genres = ticketData?.genres?.length
      ? ticketData.genres
      : guessGenres(`${title} ${cmsDescription} ${actsLine}`);

    events.push({
      title,
      event_date: ticketData?.event_date ?? local.date,
      start_time: ticketData?.start_time ?? local.time,
      price: ticketData?.price ?? parsePrice(cmsDescription),
      genres,
      description: mergedDescription,
      ticket_url: ticketUrl,
      image_url: item.flyerUrl || null,
      external_url: source.url,
      external_id: item.documentId ?? item.id ?? `${source.name}-${local.date}-${title}`,
      raw_data: {
        ...item,
        ticketPageEnriched: Boolean(ticketData),
        ticketPageData: ticketData,
      },
    });

    await sleep(350);
  }

  return events;
}
