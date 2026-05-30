import * as cheerio from "cheerio";

import {
  cleanText,
  decodeHtml,
  guessGenres,
  http,
  parseIsoDateTimeLocal,
  parsePrice,
  sleep,
} from "./helpers";
import type { ScrapedEvent, ScrapeSource } from "./types";

type FlexListingEvent = {
  eventUrl: string;
  title: string;
  excerpt: string | null;
  event_date: string | null;
  start_time: string | null;
  image_url: string | null;
};

type FlexDetailEnrichment = {
  title: string | null;
  description: string | null;
  image_url: string | null;
  ticket_url: string | null;
  price: number | null;
  genres: string[];
  event_date: string | null;
  start_time: string | null;
  raw_data: Record<string, unknown>;
};

const FLEX_GERMAN_MONTHS: Record<string, string> = {
  Jänner: "01",
  Januar: "01",
  Jän: "01",
  Jan: "01",
  Februar: "02",
  Feb: "02",
  März: "03",
  Mär: "03",
  Mar: "03",
  April: "04",
  Apr: "04",
  Mai: "05",
  Juni: "06",
  Jun: "06",
  Juli: "07",
  Jul: "07",
  August: "08",
  Aug: "08",
  September: "09",
  Sep: "09",
  Oktober: "10",
  Okt: "10",
  November: "11",
  Nov: "11",
  Dezember: "12",
  Dez: "12",
};

function parseFlexListingDate(text: string): {
  date: string | null;
  time: string | null;
} {
  const match = cleanText(text).match(
    /^(\d{1,2})\s+([A-Za-zÄÖÜäöüß]+)\s*@\s*(\d{1,2}:\d{2})/
  );

  if (!match) {
    return { date: null, time: null };
  }

  const [, dayStr, monthName, timeStr] = match;
  const month = FLEX_GERMAN_MONTHS[monthName];

  if (!month) {
    return { date: null, time: null };
  }

  const now = new Date();
  let year = now.getFullYear();
  const day = dayStr.padStart(2, "0");
  const candidate = new Date(`${year}-${month}-${day}T12:00:00`);

  if (candidate.getTime() < now.getTime() - 30 * 24 * 60 * 60 * 1000) {
    year += 1;
  }

  const [hour, minute] = timeStr.split(":");

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour.padStart(2, "0")}:${minute}:00`,
  };
}

function parseFlexListingEvents(
  $: cheerio.CheerioAPI,
  sourceUrl: string
): FlexListingEvent[] {
  const byUrl = new Map<string, FlexListingEvent>();

  $("ul.ecs-event-list li.ecs-event.club_ecs_category").each((_, element) => {
    const $li = $(element);
    const titleLink = $li.find("h4.entry-title.summary a").first();
    const fallbackLink = $li.find('a[href*="/event/"]').first();
    const href = titleLink.attr("href") ?? fallbackLink.attr("href");

    if (!href) return;

    const eventUrl = new URL(href, sourceUrl).toString();

    if (!eventUrl.includes("flex.at/event/")) return;

    const title = cleanText($li.find("h4.entry-title.summary").first().text());

    if (!title) return;

    const excerptText = $li.find("p.ecs-excerpt").first().text();
    const excerpt = excerptText ? cleanText(excerptText) : null;
    const { date, time } = parseFlexListingDate(
      $li.find(".tribe-event-date-start").first().text()
    );
    const imageSrc = $li.find("img.wp-post-image").first().attr("src");
    const image_url = imageSrc
      ? new URL(imageSrc, sourceUrl).toString()
      : null;

    byUrl.set(eventUrl, {
      eventUrl,
      title,
      excerpt,
      event_date: date,
      start_time: time,
      image_url,
    });
  });

  return [...byUrl.values()];
}

function extractFlexDetailFromHtml(
  html: string,
  eventUrl: string,
  source: ScrapeSource
): FlexDetailEnrichment {
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

  const data =
    jsonLdEvents.find((item) => item.url === eventUrl) ?? jsonLdEvents[0];

  const local = data?.startDate
    ? parseIsoDateTimeLocal(data.startDate)
    : { date: null, time: null };

  const title = data?.name
    ? decodeHtml(data.name).trim()
    : cleanText($("h1").first().text() || $("title").first().text()) || null;

  const description = cleanText(
    $(".espbp_content_wrapper").first().text() ||
      $(".espbp-evt-excerpt").first().text() ||
      decodeHtml(data?.description ?? "")
  );

  const ticketUrl =
    $("a.elementor-price-list-item[href^='http']").first().attr("href") ||
    $("a[href*='ticket']").first().attr("href") ||
    null;

  const categories = $(".espbp-events-cate a")
    .map((_, el) => cleanText($(el).text()))
    .get();

  const image_url =
    data?.image ??
    $("meta[property='og:image']").attr("content") ??
    $("img.wp-post-image").first().attr("src") ??
    null;

  return {
    title,
    description: description || null,
    image_url: image_url ? new URL(image_url, eventUrl).toString() : null,
    ticket_url: ticketUrl ? new URL(ticketUrl, eventUrl).toString() : null,
    price: parsePrice(description),
    genres: guessGenres(`${title ?? ""} ${description} ${categories.join(" ")}`),
    event_date: local.date,
    start_time: local.time,
    raw_data: {
      source: source.name,
      categories,
      ...(data ? { jsonLd: data } : {}),
    },
  };
}

async function scrapeFlexEventPage(
  eventUrl: string,
  source: ScrapeSource
): Promise<FlexDetailEnrichment | null> {
  try {
    const { data: html } = await http.get(eventUrl);
    return extractFlexDetailFromHtml(html, eventUrl, source);
  } catch {
    return null;
  }
}

function mergeFlexEvent(
  listing: FlexListingEvent,
  detail: FlexDetailEnrichment | null,
  source: ScrapeSource
): ScrapedEvent {
  const description = detail?.description ?? listing.excerpt;

  return {
    title: listing.title,
    event_date: listing.event_date ?? detail?.event_date ?? null,
    start_time: listing.start_time ?? detail?.start_time ?? null,
    price: detail?.price ?? parsePrice(description ?? ""),
    genres:
      detail?.genres.length && detail.genres.some(Boolean)
        ? detail.genres
        : guessGenres(`${listing.title} ${description ?? ""}`),
    description,
    ticket_url: detail?.ticket_url ?? null,
    image_url: detail?.image_url ?? listing.image_url,
    external_url: listing.eventUrl,
    external_id: listing.eventUrl,
    raw_data: {
      source: source.name,
      listingExcerpt: listing.excerpt,
      listingImageUrl: listing.image_url,
      ...(detail?.raw_data ?? {}),
    },
  };
}

function flexHomepageUrl(sourceUrl: string): string {
  return new URL("/", sourceUrl).toString();
}

export async function scrapeFlex(source: ScrapeSource): Promise<ScrapedEvent[]> {
  const homepageUrl = flexHomepageUrl(source.url);
  const { data: html } = await http.get(homepageUrl);
  const $ = cheerio.load(html);

  const listings = parseFlexListingEvents($, homepageUrl);

  console.log(`Found ${listings.length} Flex club event URLs`);

  const events: ScrapedEvent[] = [];

  for (const listing of listings) {
    const detail = await scrapeFlexEventPage(listing.eventUrl, source);
    events.push(mergeFlexEvent(listing, detail, source));
    await sleep(400);
  }

  console.log(`Scraped ${events.length} Flex club events`);

  return events;
}
