import * as cheerio from "cheerio";

import { parseLineupNames } from "../../../scripts/lib/lineupArtists.ts";
import { collectDasWerkProgram } from "./dasWerkParse";
import { extractLineup } from "./lineup";
import {
  cleanText,
  guessGenres,
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

export async function scrapeDasWerk(source: ScrapeSource): Promise<ScrapedEvent[]> {
  const rawEvents = await collectDasWerkProgram(source.url, async (url) => {
    const { data } = await http.get<string>(url);
    return data;
  }, {
    pause: () => sleep(400),
  });

  if (rawEvents.length === 0) {
    console.log("Could not find Das Werk events payload");
    return [];
  }

  console.log(`Das Werk: loaded ${rawEvents.length} events across program pages`);

  const events: ScrapedEvent[] = [];

  for (const item of rawEvents) {
    const local = parseIsoDateTimeLocal(item.dateIso ?? "");

    const title = item.title ?? "Untitled event";
    const description = item.description ?? "";
    const actsLine = item.actsLine ?? "";
    const ticketUrl = item.ticketUrl || null;

    const ticketData = await enrichFromEventimTicketPage(ticketUrl);

    const mergedDescription = [
      description,
      ticketData?.description,
      actsLine ? `Lineup: ${actsLine}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const lineup = parseLineupNames(
      [...parseLineupNames(actsLine), ...extractLineup(description)].join("\n"),
    );

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
      lineup,
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
