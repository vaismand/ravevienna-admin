import * as cheerio from "cheerio";

import {
  cleanText,
  decodeHtml,
  guessGenres,
  http,
  isRelevantRaveEvent,
  parseEuropeanPrice,
  parsePrice,
  sleep,
} from "./helpers";
import type { ScrapedEvent, ScrapeSource } from "./types";

async function enrichFromTicketIoPage(ticketUrl: string | null): Promise<{
  price: number | null;
  description: string | null;
  image_url: string | null;
} | null> {
  if (!ticketUrl || !ticketUrl.includes("ticket.io")) {
    return null;
  }

  try {
    const { data: html } = await http.get(ticketUrl);
    const $ = cheerio.load(html);

    let structuredPrice: number | null = null;
    let structuredDescription: string | null = null;
    let structuredImage: string | null = null;

    $("script[type='application/ld+json']").each((_, el) => {
      try {
        const parsed = JSON.parse($(el).text().trim());

        if (parsed["@type"] === "MusicEvent" || parsed["@type"] === "Event") {
          structuredPrice = Number(parsed.offers?.price ?? null);
          structuredDescription = cleanText(parsed.description ?? "");
          structuredImage = parsed.image ?? null;
        }
      } catch {
        // ignore bad JSON-LD
      }
    });

    const visiblePrices = $(".ticket-price-value")
      .map((_, el) => parseEuropeanPrice($(el).text()))
      .get()
      .filter((value) => value !== null) as number[];

    const activePrices = $(".ticketTypes:not(.typeNotActive) .ticket-price-value")
      .map((_, el) => parseEuropeanPrice($(el).text()))
      .get()
      .filter((value) => value !== null) as number[];

    const price =
      structuredPrice ??
      (activePrices.length > 0 ? Math.min(...activePrices) : null) ??
      (visiblePrices.length > 0 ? Math.min(...visiblePrices) : null);

    return {
      price,
      description: structuredDescription,
      image_url: structuredImage,
    };
  } catch (error: any) {
    console.log(`Could not enrich from ticket.io page: ${ticketUrl}`);
    console.log(error.response?.status ?? error.message);
    return null;
  }
}

function parseGrelleDateFromTitle(title: string): string | null {
  const match = title.match(/(\d{1,2})\/(\d{1,2})/);

  if (!match) return null;

  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = "2026";

  return `${year}-${month}-${day}`;
}

function parseGrelleStartTime(text: string): string | null {
  const doorsMatch = text.match(/DOORS\s*(\d{1,2})[:.](\d{2})/i);

  if (doorsMatch) {
    return `${doorsMatch[1].padStart(2, "0")}:${doorsMatch[2]}:00`;
  }

  const genericMatch = text.match(/(\d{1,2})[:.](\d{2})/);

  if (genericMatch) {
    return `${genericMatch[1].padStart(2, "0")}:${genericMatch[2]}:00`;
  }

  return null;
}

function cleanGrelleTitle(title: string): string {
  return decodeHtml(title)
    .replace(/\s*\|\s*<>?<?\s*$/g, "")
    .replace(/\s*\|\s*Grelle Forelle\s*$/i, "")
    .replace(/^\d{1,2}\/\d{1,2}\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function scrapeGrelleForelleEventPage(
  eventUrl: string,
  source: ScrapeSource
): Promise<ScrapedEvent | null> {
  const { data: html } = await http.get(eventUrl);
  const $ = cheerio.load(html);

  const rawTitle =
    $("article h1").first().text().trim() ||
    $("h1").first().text().trim() ||
    $("title").first().text().trim();

  if (!rawTitle) return null;

  const title = cleanGrelleTitle(rawTitle);
  const eventDate = parseGrelleDateFromTitle(rawTitle);

  if (!eventDate) {
    console.log(`No date found in Grelle title: ${rawTitle}`);
    return null;
  }

  const contentText = cleanText(
    $(".entry-content").first().text() ||
      $("article").first().text() ||
      $("body").text()
  );

  const imageUrl =
    $(".et_pb_image img").first().attr("src") ||
    $("meta[property='og:image']").attr("content") ||
    null;

  const ticketUrl =
    $("a[href*='paylogic']").first().attr("href") ||
    $("a[href*='tickets']").first().attr("href") ||
    $("a[href*='ticket']").first().attr("href") ||
    null;

  const ticketData = await enrichFromTicketIoPage(
    ticketUrl ? new URL(ticketUrl, eventUrl).toString() : null
  );

  const facebookUrl =
    $("a[href*='facebook.com/events']").first().attr("href") || null;

  return {
    title,
    event_date: eventDate,
    start_time: parseGrelleStartTime(contentText) ?? "23:00:00",
    price: ticketData?.price ?? parsePrice(contentText),
    genres: guessGenres(`${title} ${contentText}`),
    description: (ticketData?.description ?? contentText).slice(0, 2200),
    ticket_url: ticketUrl ? new URL(ticketUrl, eventUrl).toString() : null,
    image_url:
      ticketData?.image_url ?? (imageUrl ? new URL(imageUrl, eventUrl).toString() : null),
    external_url: eventUrl,
    external_id: eventUrl,
    raw_data: {
      source: source.name,
      facebookUrl,
      rawTitle,
      pageText: contentText,
    },
  };
}

export async function scrapeGrelleForelle(
  source: ScrapeSource
): Promise<ScrapedEvent[]> {
  const { data: html } = await http.get(source.url);
  const $ = cheerio.load(html);

  const urls = new Set<string>();

  $(".et_pb_portfolio_item.project_category_club").each((_, element) => {
    const href = $(element).find("a[href*='/project/']").first().attr("href");
    if (!href) return;

    urls.add(new URL(href, source.url).toString());
  });

  console.log(`Found ${urls.size} Grelle Forelle club event URLs`);

  const events: ScrapedEvent[] = [];

  for (const url of urls) {
    const event = await scrapeGrelleForelleEventPage(url, source);

    if (event && isRelevantRaveEvent(event)) {
      events.push(event);
    }

    await sleep(400);
  }

  return events;
}
