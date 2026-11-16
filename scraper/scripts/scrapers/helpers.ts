import axios from "axios";

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

const SOLD_OUT_PHRASE = /sold[\s-]?out|ausverkauft|out of stock/i;

export function mentionsSoldOut(text: string): boolean {
  return SOLD_OUT_PHRASE.test(text);
}

/**
 * True for a ticket-status label such as "Ausverkauft" or "15 € sold out".
 * A sentence that only mentions a sold-out sign is not a status.
 */
export function priceTextMarksSoldOut(text: string | null | undefined): boolean {
  if (!text) return false;

  const value = cleanText(text).toLowerCase();
  if (!value || !mentionsSoldOut(value)) return false;

  const leftover = value
    .replace(/sold[\s-]?out/g, " ")
    .replace(/ausverkauft/g, " ")
    .replace(/out of stock/g, " ")
    .replace(/\d+(?:[.,]\d+)?/g, " ")
    .replace(/€/g, " ")
    .replace(/[^a-zäöüß]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return leftover.length === 0;
}

export function parsePrice(text: string | null): number | null {
  if (!text) return null;

  const match = text.match(/(\d{1,3})\s*€/);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  // "sold out" / "ausverkauft" must not be stored as free.
  if (value === 0 && mentionsSoldOut(text)) return null;

  return value;
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

/** Named non-rave acts. These always reject, including when the blurb also says techno. */
const NAMED_REJECT_ACTS = [
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
  "hämatom",
  "haematom",
];

/**
 * Genre words only count in a genre phrase: "rock night", "rock concert",
 * "Rock/Pop", "Indie Rock", "hip-hop". A bare "rock" inside „When I Rock“
 * or a longer word does not.
 */
const GENRE_CONTEXT_PATTERNS = [
  /\b(?:indie|hard|punk|alternative|classic|glam|soft|prog|folk|deutsch)\s+rock\b/i,
  /\brock\s+(?:night|concert|show|band|music|festival|n'?roll)\b/i,
  /\b(?:metal|punk|rap|hip[\s-]?hop|schlager)\s+(?:night|concert|show|band|festival)\b/i,
  /\b(?:rock|metal|punk|pop|indie|hip[\s-]?hop)\s*[/|]\s*(?:rock|metal|punk|pop|indie|hip[\s-]?hop)\b/i,
  /\bhip[\s-]?hop\b/i,
  /\bdeutschrock\b/i,
  /\blive\s+concert\b/i,
];

/** A lineup credit that means the night is a rave even if a genre word also appears. */
const KNOWN_RAVE_CREDITS = [
  "thomas schumacher",
  "elektrochemie",
  "drumcode",
  "electric ballroom",
  "eatbrain",
  "camo & krooked",
  "camo and krooked",
  "mefjus",
  "noisia",
  "hospital records",
  "critical music",
  "metalheadz",
  "shogun audio",
  "adam beyer",
  "amelie lens",
  "laurent garnier",
];

function withoutQuotedSpans(text: string): string {
  return text
    .replace(/[„"«][^"“»\n]{0,80}[“"»]/g, " ")
    .replace(/"[^"\n]{0,80}"/g, " ");
}

function hasNamedRejectAct(text: string): boolean {
  return NAMED_REJECT_ACTS.some((name) => textHasKeyword(text, name));
}

/** True when a genre word is used as a genre, not as a track or artist fragment. */
export function hasGenreRejectContext(text: string): boolean {
  const plain = withoutQuotedSpans(text);
  return GENRE_CONTEXT_PATTERNS.some((pattern) => pattern.test(plain));
}

export function hasKnownRaveCredit(text: string): boolean {
  return KNOWN_RAVE_CREDITS.some((name) => textHasKeyword(text, name));
}

/**
 * Named concert acts always reject. Genre words reject only in a genre
 * phrase, and a known techno / DnB / house credit outweighs that phrase.
 */
export function hasHardRejectKeywords(text: string): boolean {
  if (hasNamedRejectAct(text)) return true;
  if (!hasGenreRejectContext(text)) return false;
  if (hasKnownRaveCredit(text)) return false;
  return true;
}

export function isRelevantRaveEvent(event: ScrapedEvent): boolean {
  const text = `${event.title} ${event.description ?? ""} ${event.genres.join(" ")}`
    .toLowerCase();

  if (hasHardRejectKeywords(text)) {
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
