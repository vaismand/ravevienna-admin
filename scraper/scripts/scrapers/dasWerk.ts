import * as cheerio from "cheerio";

import {
  cleanText,
  guessGenres,
  http,
  isRelevantRaveEvent,
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

export async function scrapeDasWerk(source: ScrapeSource): Promise<ScrapedEvent[]> {
  const { data: html } = await http.get(source.url);

  const eventsMatch = html.match(/\\"events\\":\[(.*?)\]\}\]\}\]/s);

  if (!eventsMatch?.[1]) {
    console.log("Could not find Das Werk events payload");
    return [];
  }

  let rawEvents: any[] = [];

  try {
    const cleanedJson = `[${eventsMatch[1]}]`
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\\n")
      .replace(/\\u0026/g, "&");

    rawEvents = JSON.parse(cleanedJson);
  } catch (error) {
    console.error("Could not parse Das Werk JSON payload:", error);
    return [];
  }

  const events: ScrapedEvent[] = [];

  for (const item of rawEvents) {
    const local = parseIsoDateTimeLocal(item.dateIso);

    const title = item.title ?? "Untitled event";
    const description = item.description ?? "";
    const actsLine = item.actsLine ?? "";
    const ticketUrl = item.ticketUrl || null;

    const ticketData = await enrichFromEventimTicketPage(ticketUrl);

    const mergedDescription = [
      ticketData?.description || description,
      actsLine ? `Lineup: ${actsLine}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const genres = ticketData?.genres?.length
      ? ticketData.genres
      : guessGenres(`${title} ${description} ${actsLine}`);

    events.push({
      title,
      event_date: ticketData?.event_date ?? local.date,
      start_time: ticketData?.start_time ?? local.time,
      price: ticketData?.price ?? parsePrice(description),
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

  return events.filter(isRelevantRaveEvent);
}
