import * as cheerio from "cheerio";

import { cleanText, guessGenres, http, parsePrice, sleep } from "./helpers";
import type { ScrapedEvent, ScrapeSource } from "./types";

const BASE_URL = "https://arena.wien";
const EVENT_SEARCH_API = `${BASE_URL}/DesktopModules/WebAPI/API/Event/Search`;

type ArenaConcertListItem = {
  DetailUrl?: string;
};

type ArenaEventSearchResponse = {
  concerts?: ArenaConcertListItem[];
  maxPage?: number;
};

async function fetchArenaEventUrls(): Promise<string[]> {
  const eventUrls = new Set<string>();
  let page = 0;
  let maxPage = 1;

  while (page < maxPage) {
    const { data } = await http.get<ArenaEventSearchResponse>(EVENT_SEARCH_API, {
      params: {
        searchTerm: "",
        day: 1,
        month: -1,
        year: -1,
        page,
        pageSize: 100,
        eventCategory: -1,
        abonnement: -1,
        cultureCode: "de-AT",
        locationId: 0,
      },
    });

    maxPage = data.maxPage ?? 1;

    for (const concert of data.concerts ?? []) {
      const url = absoluteUrl(concert.DetailUrl);
      if (url) eventUrls.add(url);
    }

    page += 1;
  }

  return [...eventUrls];
}

function absoluteUrl(path?: string | null) {
  if (!path) return null;
  return new URL(path, BASE_URL).toString();
}

function parseArenaDate(description: string) {
  const months: Record<string, string> = {
    Jän: "01",
    Jänner: "01",
    Feb: "02",
    Mär: "03",
    März: "03",
    Apr: "04",
    April: "04",
    Mai: "05",
    Jun: "06",
    Juni: "06",
    Jul: "07",
    Juli: "07",
    Aug: "08",
    August: "08",
    Sep: "09",
    Okt: "10",
    Nov: "11",
    Dez: "12",
  };

  const match = description.match(
    /Beginn:\s*[A-Za-zÄÖÜäöüß.]+,\s*(\d{1,2})\s+([A-Za-zÄÖÜäöüß]+)\.?\s+(\d{4})\s+(\d{1,2}:\d{2})/
  );

  if (!match) {
    return { date: null as string | null, startTime: null as string | null };
  }

  const [, day, monthName, year, startTime] = match;
  const month = months[monthName];

  if (!month) {
    return { date: null, startTime: null };
  }

  const [hour, minute] = startTime.split(":");

  return {
    date: `${year}-${month}-${day.padStart(2, "0")}`,
    startTime: `${hour.padStart(2, "0")}:${minute}:00`,
  };
}

function extractPrices(text: string) {
  const matches = text.match(/\d{1,3}\s?€/g);
  return matches ? [...new Set(matches)] : [];
}

function parseArenaPrice(description: string): number | null {
  const prices = extractPrices(description);
  if (prices.length === 0) return parsePrice(description);

  const parsed = prices
    .map((value) => parsePrice(value))
    .filter((value): value is number => value !== null);

  return parsed.length > 0 ? Math.min(...parsed) : null;
}

function isRelevantArenaEvent(event: {
  title: string;
  description: string;
  startTime: string;
}) {
  const text = `${event.title} ${event.description}`.toLowerCase();
  const startHour = Number(event.startTime.split(":")[0]);

  const startsLikeClubNight = startHour >= 21 || startHour <= 4;

  const hasClubMusicKeyword =
    text.includes("drum & bass") ||
    text.includes("drum and bass") ||
    text.includes("dnb") ||
    text.includes("d&b") ||
    text.includes("rave") ||
    text.includes("techno") ||
    text.includes("clubnight") ||
    text.includes("bass music") ||
    text.includes("hard dance") ||
    text.includes("psytrance");

  const obviousConcertOnly =
    text.includes("punk") ||
    text.includes("rock") ||
    text.includes("metal") ||
    text.includes("indie") ||
    text.includes("singer-songwriter");

  return startsLikeClubNight && hasClubMusicKeyword && !obviousConcertOnly;
}

function extractTicketUrl($: cheerio.CheerioAPI) {
  const links = $(".suite_VAdescr a")
    .map((_, el) => $(el).attr("href")?.trim())
    .get()
    .filter(Boolean);

  return links.find((href) => href?.startsWith("http")) || null;
}

async function scrapeArenaDetail(eventUrl: string): Promise<ScrapedEvent | null> {
  const { data: html } = await http.get(eventUrl);
  const $ = cheerio.load(html);

  const title =
    cleanText($("#dnn_ctr577_ViewEventDetail_hl_ConcertTitle").text()) ||
    cleanText($("meta[name='og:title']").attr("content") ?? "");

  const metaDescription = cleanText($("meta[name='og:description']").attr("content") ?? "");
  const description = cleanText($(".suite_VAdescr").text()) || metaDescription;

  const { date, startTime } = parseArenaDate(metaDescription || description);

  const image =
    absoluteUrl($("#dnn_ctr577_ViewEventDetail_img_ConcertImage").attr("src")) ||
    absoluteUrl($("meta[name='og:image']").attr("content"));

  const prices = extractPrices(description);
  const genres = guessGenres(`${title} ${description}`);
  const ticketUrl = extractTicketUrl($);

  if (!title || !date || !startTime) {
    return null;
  }

  if (!isRelevantArenaEvent({ title, description, startTime })) {
    return null;
  }

  return {
    title,
    event_date: date,
    start_time: startTime,
    price: parseArenaPrice(description),
    genres,
    description: description || null,
    ticket_url: ticketUrl,
    image_url: image,
    external_url: eventUrl,
    external_id: eventUrl,
    raw_data: {
      prices,
      metaDescription,
    },
  };
}

export async function scrapeArena(_source: ScrapeSource): Promise<ScrapedEvent[]> {
  const eventUrls = await fetchArenaEventUrls();

  console.log(`Found ${eventUrls.length} Arena Wien event URLs`);

  const events: ScrapedEvent[] = [];

  for (const eventUrl of eventUrls) {
    try {
      const event = await scrapeArenaDetail(eventUrl);

      if (event) {
        events.push(event);
      }
    } catch {
      continue;
    }

    await sleep(400);
  }

  return events;
}
