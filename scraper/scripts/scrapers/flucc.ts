import * as cheerio from "cheerio";

import {
  cleanText,
  guessGenres,
  http,
  isRelevantRaveEvent,
  parseEuropeanPrice,
  parsePrice,
  sleep,
} from "./helpers";
import type { ScrapedEvent, ScrapeSource } from "./types";

const BASE_URL = "https://flucc.at";
const DEFAULT_EVENTS_URL = `${BASE_URL}/`;

function absoluteUrl(path?: string) {
  if (!path) return undefined;
  return new URL(path, BASE_URL).toString();
}

function parseFluccDate(dateText: string): string | null {
  const shortMatch = dateText.match(/(\d{2})\.(\d{2})\.(\d{2})/);
  if (shortMatch) {
    const [, day, month, year] = shortMatch;
    return `20${year}-${month}-${day}`;
  }

  const longMatch = dateText.match(/(\d{1,2})\.\s*([A-Za-zäöüÄÖÜ]+)\.?\s*(\d{4})/);
  if (!longMatch) return null;

  const day = longMatch[1].padStart(2, "0");
  const monthName = longMatch[2].toLowerCase().replace(/\./g, "");
  const year = longMatch[3];

  const months: Record<string, string> = {
    jan: "01",
    januar: "01",
    feb: "02",
    februar: "02",
    mär: "03",
    mar: "03",
    maer: "03",
    märz: "03",
    marz: "03",
    apr: "04",
    april: "04",
    mai: "05",
    jun: "06",
    juni: "06",
    jul: "07",
    juli: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    okt: "10",
    oct: "10",
    oktober: "10",
    nov: "11",
    november: "11",
    dez: "12",
    dec: "12",
    dezember: "12",
  };

  const month = months[monthName];
  if (!month) return null;

  return `${year}-${month}-${day}`;
}

function parseFluccTime(timeText: string): string | null {
  const trimmed = cleanText(timeText);
  if (!trimmed) return null;

  const match = trimmed.match(/(\d{1,2}:\d{2})/);
  if (!match) return null;

  const [hour, minute] = match[1].split(":");
  return `${hour.padStart(2, "0")}:${minute}:00`;
}

/** FLUCC club nights typically start 22:00–23:00 (or after midnight). */
function isFluccRaveStartTime(startTime: string | null): boolean {
  if (!startTime) return false;

  const match = startTime.match(/^(\d{2}):/);
  if (!match) return false;

  const hour = Number(match[1]);
  return hour >= 22 || hour < 6;
}

function isRelevantFluccEvent(event: ScrapedEvent): boolean {
  return isRelevantRaveEvent(event) && isFluccRaveStartTime(event.start_time);
}

function parseMoneyToken(value: string): number | null {
  const trimmed = value.replace(/€/g, "").trim();
  return parseEuropeanPrice(trimmed) ?? parsePrice(`${trimmed} €`);
}

function extractPrices(text: string): string[] {
  const found: string[] = [];

  const rangePattern =
    /(\d{1,3}(?:[,.]\d{1,2})?)\s*[-–—]\s*(\d{1,3}(?:[,.]\d{1,2})?)\s*€/gi;

  for (const match of text.matchAll(rangePattern)) {
    found.push(`${match[1]} €`, `${match[2]} €`);
  }

  const singlePattern = /\d{1,3}(?:[,.]\d{1,2})?\s*€/g;

  for (const match of text.matchAll(singlePattern)) {
    found.push(match[0].trim());
  }

  return [...new Set(found)];
}

/** FLUCC often shows ranges like "11-17 €" — use the lowest tier (early / presale). */
function parseFluccPrice(priceText: string): number | null {
  const prices = extractPrices(priceText);

  if (prices.length > 0) {
    const parsed = prices
      .map((value) => parseMoneyToken(value))
      .filter((value): value is number => value !== null);

    if (parsed.length > 0) {
      return Math.min(...parsed);
    }
  }

  return parseMoneyToken(priceText);
}

function extractTicketUrl($: cheerio.CheerioAPI) {
  const ticketLink = $("a.btn")
    .filter((_, el) => cleanText($(el).text()).toLowerCase().includes("ticket"))
    .first()
    .attr("href");

  return ticketLink || undefined;
}

async function scrapeFluccDetail(eventUrl: string) {
  const { data: html } = await http.get(eventUrl);
  const $ = cheerio.load(html);

  const title = cleanText($(".heading-col h2").first().text());
  const dateText = cleanText($(".more-info .date").first().text());
  const timeText = cleanText($(".more-info .time").first().text()).replace(" Uhr", "");
  const location = cleanText($(".more-info .location").first().text()).replace("@", "");

  const description = cleanText(
    $(".event-main-col .entry-content p[data-block-key]").text()
  );

  const image =
    $(".gallery img").first().attr("src") ||
    $(".image-col img").first().attr("src") ||
    $("meta[property='og:image']").attr("content");

  const priceText = cleanText($(".container.price .value").text());
  const prices = extractPrices(priceText);

  const ticketUrl = extractTicketUrl($);

  const combinedText = `${title} ${description} ${priceText}`;
  const genres = guessGenres(combinedText);

  return {
    title,
    date: parseFluccDate(dateText),
    startTime: parseFluccTime(timeText),
    location,
    description,
    image: image ? absoluteUrl(image) : null,
    price: prices.length ? prices.join(" / ") : priceText || undefined,
    ticketUrl: ticketUrl ? absoluteUrl(ticketUrl) : null,
    eventUrl,
    genres,
  };
}

export async function scrapeFlucc(source: ScrapeSource): Promise<ScrapedEvent[]> {
  const eventsUrl = source.url || DEFAULT_EVENTS_URL;
  const { data: html } = await http.get(eventsUrl);
  const $ = cheerio.load(html);

  const eventUrls = new Set<string>();

  $(".himmel-card.card a").each((_, el) => {
    const href = $(el).attr("href");

    if (href?.startsWith("/events/")) {
      eventUrls.add(absoluteUrl(href)!);
    }
  });

  console.log(`Found ${eventUrls.size} FLUCC event URLs`);

  const events: ScrapedEvent[] = [];

  for (const eventUrl of eventUrls) {
    try {
      const detail = await scrapeFluccDetail(eventUrl);

      if (!detail.title || !detail.date) {
        continue;
      }

      events.push({
        title: detail.title,
        event_date: detail.date,
        start_time: detail.startTime,
        price: parseFluccPrice(detail.price ?? ""),
        genres: detail.genres,
        description: detail.description || null,
        ticket_url: detail.ticketUrl ?? null,
        image_url: detail.image ?? null,
        external_url: detail.eventUrl,
        external_id: detail.eventUrl,
        raw_data: {
          source: source.name,
          location: detail.location,
          priceText: detail.price,
        },
      });
    } catch {
      continue;
    }

    await sleep(400);
  }

  return events.filter(isRelevantFluccEvent);
}
