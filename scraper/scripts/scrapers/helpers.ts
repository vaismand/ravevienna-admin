import axios from "axios";
import * as cheerio from "cheerio";

import {
  detectGenresFromText,
  normalizeEventGenres,
} from "../../../scripts/lib/genres.ts";
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

function textHasKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|[^\\w])${escaped.replace(/\s+/g, "\\s+")}(?:[^\\w]|$)`,
    "i"
  );
  return pattern.test(text);
}

export function isRelevantRaveEvent(event: ScrapedEvent): boolean {
  const text = `${event.title} ${event.description ?? ""} ${event.genres.join(" ")}`
    .toLowerCase();

  const hardRejectKeywords = [
    "gregor hägele",
    "gregor haegele",
    "nervy",
    "krs-one",
    "set it off",
    "audio88",
    "yassin",
    "i killed the prom queen",
    "touché amor",
    "touche amor",
    "immortal disfigurement",
    "gutrectomy",
    "don broco",
    "hands like houses",
    "broadside",
    "destroy boys",
    "drowning pool",
    "don west",
    "lance butters",
    "sampagne",
    "yami safdie",
    "neunundneunzig",
    "concert",
    "tour",
    "band",
    "rock",
    "metal",
    "hip-hop",
    "hip hop",
    "rap",
    "live concert",
  ];

  if (hardRejectKeywords.some((keyword) => textHasKeyword(text, keyword))) {
    return false;
  }

  const strongRaveKeywords = [
    "rave",
    "techno",
    "hard techno",
    "drum and bass",
    "dnb",
    "bass",
    "house",
    "trance",
    "psytrance",
    "goa",
    "acid",
    "breakbeat",
    "jungle",
    "garage",
    "electro",
    "tek",
    "soundsystem",
    "club",
    "afterparty",
    "mainfloor",
    "kitchen",
    "lineup",
    "dj",
    "b2b",
    "pres.",
    "presents",
  ];

  return strongRaveKeywords.some((keyword) => textHasKeyword(text, keyword));
}
