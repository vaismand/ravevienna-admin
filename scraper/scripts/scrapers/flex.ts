import * as cheerio from "cheerio";

import {
  cleanText,
  decodeHtml,
  guessGenres,
  http,
  isRelevantRaveEvent,
  parseIsoDateTimeLocal,
  parsePrice,
  sleep,
} from "./helpers";
import type { ScrapedEvent, ScrapeSource } from "./types";

async function scrapeFlexEventPage(
  eventUrl: string,
  source: ScrapeSource
): Promise<ScrapedEvent | null> {
  const { data: html } = await http.get(eventUrl);
  const $ = cheerio.load(html);

  const jsonLdEvents = $("script[type='application/ld+json']")
    .map((_, el) => $(el).text().trim())
    .get()
    .flatMap((scriptText) => {
      try {
        const parsed = JSON.parse(scriptText);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    })
    .filter((item) => item["@type"] === "Event");

  const data = jsonLdEvents.find((item) => item.url === eventUrl) ?? jsonLdEvents[0];

  if (!data) {
    console.log(`No JSON-LD event found for ${eventUrl}`);
    return null;
  }

  const local = parseIsoDateTimeLocal(data.startDate);

  const title = decodeHtml(data.name ?? "").trim();

  const description = cleanText(
    $(".espbp_content_wrapper").first().text() ||
      $(".espbp-evt-excerpt").first().text() ||
      decodeHtml(data.description ?? "")
  );

  const ticketUrl =
    $("a.elementor-price-list-item[href^='http']").first().attr("href") ||
    $("a[href*='ticket']").first().attr("href") ||
    null;

  const categories = $(".espbp-events-cate a")
    .map((_, el) => cleanText($(el).text()))
    .get();

  return {
    title,
    event_date: local.date,
    start_time: local.time,
    price: parsePrice(description),
    genres: guessGenres(`${title} ${description} ${categories.join(" ")}`),
    description,
    ticket_url: ticketUrl ? new URL(ticketUrl, eventUrl).toString() : null,
    image_url: data.image ?? $("meta[property='og:image']").attr("content") ?? null,
    external_url: eventUrl,
    external_id: eventUrl,
    raw_data: {
      source: source.name,
      categories,
      jsonLd: data,
    },
  };
}

export async function scrapeFlex(source: ScrapeSource): Promise<ScrapedEvent[]> {
  const { data: html } = await http.get(source.url);
  const $ = cheerio.load(html);

  const urls = new Set<string>();

  $("a[href*='/event/']").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;

    const fullUrl = new URL(href, source.url).toString();

    if (fullUrl.includes("flex.at/event/")) {
      urls.add(fullUrl);
    }
  });

  console.log(`Found ${urls.size} Flex event URLs`);

  const events: ScrapedEvent[] = [];

  for (const url of urls) {
    const event = await scrapeFlexEventPage(url, source);

    if (event && isRelevantRaveEvent(event)) {
      events.push(event);
    }

    await sleep(400);
  }

  return events;
}
