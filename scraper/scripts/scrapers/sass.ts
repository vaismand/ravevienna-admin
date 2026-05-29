import * as cheerio from "cheerio";

import {
  cleanText,
  guessGenres,
  http,
  isRelevantRaveEvent,
  parseEuropeanPrice,
  sleep,
} from "./helpers";
import type { ScrapedEvent, ScrapeSource } from "./types";

const BASE_URL = "https://sassvienna.com";
const DEFAULT_EVENTS_URL = `${BASE_URL}/en/events`;
const TICKET_URL = "https://sass.ticket.io/?hideHolder=1";

function absoluteUrl(path?: string) {
  if (!path) return undefined;
  return new URL(path, BASE_URL).toString();
}

function extractPrices(text: string) {
  const matches = text.match(/(?:\d{1,3},\d{2}|\d{1,3}\.\d{2})\s*EUR/g);
  return matches ? [...new Set(matches)] : [];
}

function parseSassPrice(text: string): number | null {
  const prices = extractPrices(text);

  if (prices.length === 0) return null;

  const parsed = prices
    .map((value) => parseEuropeanPrice(value))
    .filter((value): value is number => value !== null);

  if (parsed.length === 0) return null;

  return Math.min(...parsed);
}

function parseSassDate(dateText: string): string | null {
  const match = dateText.match(/(\d{1,2})\s+([A-Za-z]+)/);

  if (!match) return null;

  const day = match[1].padStart(2, "0");
  const monthName = match[2];
  const monthIndex = new Date(`${monthName} 1, 2000`).getMonth();

  if (Number.isNaN(monthIndex)) return null;

  const month = String(monthIndex + 1).padStart(2, "0");
  const now = new Date();
  let year = now.getFullYear();

  const candidate = new Date(`${year}-${month}-${day}T12:00:00`);

  if (Number.isNaN(candidate.getTime())) return null;

  const oneDayMs = 24 * 60 * 60 * 1000;

  if (candidate.getTime() < now.getTime() - oneDayMs) {
    year += 1;
  }

  return `${year}-${month}-${day}`;
}

function parseSassTime(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);

  if (!match) return null;

  let hour = Number(match[1]);
  const minute = match[2];
  const meridiem = match[3].toUpperCase();

  if (meridiem === "PM" && hour < 12) hour += 12;
  if (meridiem === "AM" && hour === 12) hour = 0;

  return `${String(hour).padStart(2, "0")}:${minute}:00`;
}

function parseArtists($: cheerio.CheerioAPI, $event: cheerio.Cheerio<any>) {
  return $event
    .find(".lineup strong")
    .map((_, el) => cleanText($(el).text()))
    .get()
    .filter(Boolean);
}

function isMorningStartTime(startTime: string | null): boolean {
  if (!startTime) return false;

  const match = startTime.match(/^(\d{2}):(\d{2})/);
  if (!match) return false;

  const totalMinutes = Number(match[1]) * 60 + Number(match[2]);
  return totalMinutes >= 5 * 60 && totalMinutes <= 12 * 60;
}

function isSassMorningEvent(event: ScrapedEvent): boolean {
  if (event.title.toLowerCase().includes("morgengymnastik")) return true;
  return isMorningStartTime(event.start_time);
}

function isRelevantSassEvent(event: ScrapedEvent): boolean {
  return isRelevantRaveEvent(event) || isSassMorningEvent(event);
}

export async function scrapeSass(source: ScrapeSource): Promise<ScrapedEvent[]> {
  const eventsUrl = source.url || DEFAULT_EVENTS_URL;
  const { data: html } = await http.get(eventsUrl);
  const $ = cheerio.load(html);

  const eventLinks = $(".events .event a.eventlink")
    .map((_, el) => absoluteUrl($(el).attr("href")))
    .get()
    .filter(Boolean) as string[];

  console.log(`Found ${eventLinks.length} SASS event URLs`);

  const events: ScrapedEvent[] = [];

  for (const eventUrl of eventLinks) {
    const { data: eventHtml } = await http.get(eventUrl);
    const $$ = cheerio.load(eventHtml);

    const $event = $$(".events.detail .event").first();

    const title = cleanText($event.find(".title h3").text());
    const dateText = cleanText($event.find(".start_date").text());
    const dayText = cleanText($event.find(".day").text());
    const startTimeRaw = cleanText($event.find(".start_time").text());
    const endTimeRaw = cleanText($event.find(".end_time").text());
    const artists = parseArtists($$, $event);
    const description = cleanText($event.find(".description").text());

    const image =
      absoluteUrl($event.find(".images img").first().attr("src")) ||
      $$("meta[property='og:image']").attr("content") ||
      null;

    const lineupLine = artists.length > 0 ? `Lineup: ${artists.join(", ")}` : "";
    const mergedDescription = [description, lineupLine].filter(Boolean).join("\n\n");
    const start_time = parseSassTime(startTimeRaw);
    const isMorningEvent =
      title.toLowerCase().includes("morgengymnastik") ||
      isMorningStartTime(start_time);
    const genres = guessGenres(`${title} ${mergedDescription} ${artists.join(" ")}`);

    if (isMorningEvent && !genres.includes("Afterparty")) {
      genres.push("Afterparty");
    }

    events.push({
      title,
      event_date: parseSassDate(dateText),
      start_time,
      price: parseSassPrice(description),
      genres,
      description: mergedDescription || null,
      ticket_url: TICKET_URL,
      image_url: image,
      external_url: eventUrl,
      external_id: eventUrl,
      raw_data: {
        source: source.name,
        dayText,
        dateText,
        startTimeRaw,
        endTimeRaw,
        artists,
        prices: extractPrices(description),
      },
    });

    await sleep(400);
  }

  return events.filter(isRelevantSassEvent);
}
