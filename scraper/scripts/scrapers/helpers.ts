import axios from "axios";
import * as cheerio from "cheerio";

import {
  detectGenresFromText,
  normalizeEventGenres,
} from "../../../scripts/lib/genres.ts";
import { classifyEdmEvent } from "./edmFilter";
import type { ScrapedEvent } from "./types";

export const http = axios.create({
  headers: {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,de;q=0.8",
    "Cache-Control": "no-cache",
  },
  timeout: 30000,
});

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&#8222;/g, "„")
    .replace(/&#8220;/g, "“")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function cleanText(value: string): string {
  return decodeHtml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePrice(text: string | null): number | null {
  if (!text) return null;

  const match = text.match(/(\d{1,3})\s*€/);

  if (!match) return null;

  return Number(match[1]);
}

export function parseEuropeanPrice(value: string): number | null {
  const match = value.match(/(\d+(?:[,.]\d{1,2})?)/);
  if (!match) return null;

  return Number(match[1].replace(",", "."));
}

export function guessGenres(text: string): string[] {
  return normalizeEventGenres(detectGenresFromText(decodeHtml(text)));
}

export function parseIsoDateTimeLocal(value: string): {
  date: string | null;
  time: string | null;
} {
  if (!value) {
    return {
      date: null,
      time: null,
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      date: null,
      time: null,
    };
  }

  const viennaDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Vienna",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

  const viennaTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Vienna",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);

  return {
    date: viennaDate,
    time: viennaTime,
  };
}

/**
 * Keep and review decisions still produce a draft. Clear non-EDM is rejected
 * later by the scrape runner instead of being dropped here.
 */
export function isRelevantRaveEvent(event: ScrapedEvent): boolean {
  return (
    classifyEdmEvent({
      title: event.title,
      description: event.description,
      genres: event.genres,
    }).decision !== "reject"
  );
}
