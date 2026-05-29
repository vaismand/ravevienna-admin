import * as cheerio from "cheerio";

import { cleanText, guessGenres, http, parsePrice, sleep } from "./helpers";
import type { ScrapedEvent, ScrapeSource } from "./types";

const BASE_URL = "https://www.theloft.at";
const DEFAULT_EVENTS_URL = `${BASE_URL}/programm/`;

function absoluteUrl(path?: string | null) {
  if (!path) return null;
  return new URL(path, BASE_URL).toString();
}

function parseLoftDate(dateText: string): string | null {
  const match = dateText.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return null;

  const [, day, month, year] = match;

  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseLoftTime(timeText: string): string | null {
  const match = cleanText(timeText).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const [, hour, minute] = match;

  return `${hour.padStart(2, "0")}:${minute}:00`;
}

function extractLoftPriceAmounts(text: string): number[] {
  const amounts: number[] = [];

  for (const match of text.matchAll(/€\s*([\d\s/\-–—]+)/g)) {
    const numbers = match[1].match(/\d+/g);

    if (numbers) {
      amounts.push(...numbers.map(Number));
    }
  }

  if (amounts.length === 0) {
    for (const match of text.matchAll(/(\d{1,3})\s*€/g)) {
      amounts.push(Number(match[1]));
    }
  }

  return amounts;
}

function normalizeLoftPrice(text: string | null | undefined): string | null {
  if (!text) return null;

  const value = cleanText(text);
  if (!value) return null;

  const lower = value.toLowerCase();

  if (lower.includes("freie spende") || lower.includes("freiwillige spende")) {
    return null;
  }

  if (/\bfrei\b/.test(lower)) {
    return "0 €";
  }

  const amounts = extractLoftPriceAmounts(value);
  if (amounts.length === 0) return null;

  return `${Math.min(...amounts)} €`;
}

const EXCLUDED_LOFT_TAGS = new Set(["afro", "dancehall"]);

function hasExcludedLoftTags(tags: string[], genres: string[]) {
  for (const tag of tags) {
    if (EXCLUDED_LOFT_TAGS.has(cleanText(tag).toLowerCase())) {
      return true;
    }
  }

  for (const genre of genres) {
    if (EXCLUDED_LOFT_TAGS.has(genre.toLowerCase())) {
      return true;
    }
  }

  return false;
}

function isAfterparty(title: string, description: string, startTime: string) {
  const lower = `${title} ${description}`.toLowerCase();
  const hour = Number(startTime.split(":")[0]);

  return (
    lower.includes("afterparty") ||
    lower.includes("after party") ||
    lower.includes("saturday morning") ||
    lower.includes("liminal") ||
    (hour >= 5 && hour <= 10)
  );
}

function isRelevantLoftEvent(event: {
  title: string;
  description: string;
  startTime: string;
  genres: string[];
  tags: string[];
}) {
  if (hasExcludedLoftTags(event.tags, event.genres)) {
    return false;
  }

  const lower = `${event.title} ${event.description}`.toLowerCase();
  const hour = Number(event.startTime.split(":")[0]);

  const startsLikeClubNight = hour >= 21 || hour <= 4;
  const afterparty = isAfterparty(event.title, event.description, event.startTime);

  const hasElectronicKeyword =
    event.genres.length > 0 ||
    lower.includes("dj") ||
    lower.includes("club") ||
    lower.includes("rave") ||
    lower.includes("electronic") ||
    lower.includes("elektronisch");

  const obviousNotRelevant =
    lower.includes("slam") ||
    lower.includes("comedy") ||
    lower.includes("tryout") ||
    lower.includes("konzert") ||
    lower.includes("concert") ||
    lower.includes("akustik") ||
    lower.includes("album release") ||
    lower.includes("lesung") ||
    lower.includes("workshop");

  return (startsLikeClubNight || afterparty) && hasElectronicKeyword && !obviousNotRelevant;
}

function extractEventLink($: cheerio.CheerioAPI) {
  return (
    $("a.elementor-button")
      .filter((_, el) => cleanText($(el).text()).toLowerCase().includes("eventlink"))
      .first()
      .attr("href") || null
  );
}

async function scrapeLoftDetail(eventUrl: string) {
  const { data: html } = await http.get(eventUrl);
  const $ = cheerio.load(html);

  const jsonLd = $("script[type='application/ld+json']")
    .map((_, el) => $(el).text())
    .get()
    .map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })
    .find((item) => item?.["@type"] === "MusicEvent");

  const title =
    cleanText(jsonLd?.name ?? "") ||
    cleanText($("h1.elementor-heading-title").first().text()) ||
    cleanText(($("meta[property='og:title']").attr("content") ?? "").replace("@ The Loft", ""));

  const description =
    cleanText($(".party-inhalt").first().text()) ||
    cleanText(jsonLd?.description ?? "") ||
    cleanText($("meta[property='og:description']").attr("content") ?? "");

  const image =
    absoluteUrl(
      (typeof jsonLd?.image === "string" ? jsonLd.image : jsonLd?.image?.[0]) ??
        $("meta[property='og:image']").attr("content") ??
        $(".elementor-widget-theme-post-featured-image img").first().attr("src")
    ) ?? null;

  const tags = $("meta[property='article:tag']")
    .map((_, el) => $(el).attr("content"))
    .get()
    .filter(Boolean);

  const detailText = `${title} ${description} ${tags.join(" ")}`;
  const genres = guessGenres(detailText);
  const ticketUrl = absoluteUrl(extractEventLink($));

  return {
    title,
    description,
    image,
    genres,
    tags,
    ticketUrl,
  };
}

export async function scrapeTheLoft(source: ScrapeSource): Promise<ScrapedEvent[]> {
  const eventsUrl = source.url || DEFAULT_EVENTS_URL;
  const { data: html } = await http.get(eventsUrl);
  const $ = cheerio.load(html);

  const listingEvents = $("a:has(.box-wrap)")
    .map((_, el) => {
      const $link = $(el);
      const $box = $link.find(".box-wrap").first();

      const eventUrl = absoluteUrl($link.attr("href"));
      const dateText = cleanText($box.find(".datum").text());
      const startTime = parseLoftTime($box.find(".open").text());
      const priceText = cleanText($box.find(".preis").text().replace("Eintritt:", ""));
      const title = cleanText($box.find(".content-middle").text());
      const floor = cleanText($box.find(".content-right").text());

      return {
        title,
        date: parseLoftDate(dateText),
        startTime,
        priceText,
        floor,
        eventUrl,
      };
    })
    .get()
    .filter((event) => event.eventUrl && event.date && event.startTime);

  console.log(`Found ${listingEvents.length} The Loft event URLs`);

  const events: ScrapedEvent[] = [];

  for (const listingEvent of listingEvents) {
    try {
      const detail = await scrapeLoftDetail(listingEvent.eventUrl!);
      const title = listingEvent.title || detail.title;
      const startTime = listingEvent.startTime!;
      const genres = detail.genres;

      const relevant = isRelevantLoftEvent({
        title,
        description: detail.description,
        startTime,
        genres,
        tags: detail.tags,
      });

      if (!relevant) continue;

      const finalGenres = [...genres];

      if (isAfterparty(title, detail.description, startTime)) {
        finalGenres.push("Afterparty");
      }

      events.push({
        title,
        event_date: listingEvent.date,
        start_time: startTime,
        price:
          parsePrice(normalizeLoftPrice(listingEvent.priceText)) ??
          parsePrice(normalizeLoftPrice(detail.description)),
        genres: [...new Set(finalGenres)],
        description: detail.description || null,
        ticket_url: detail.ticketUrl,
        image_url: detail.image,
        external_url: listingEvent.eventUrl!,
        external_id: listingEvent.eventUrl!,
        raw_data: {
          source: source.name,
          floor: listingEvent.floor || null,
          priceText: listingEvent.priceText || null,
        },
      });
    } catch {
      continue;
    }

    await sleep(400);
  }

  console.log(`Keeping ${events.length} relevant The Loft events`);

  return events;
}
