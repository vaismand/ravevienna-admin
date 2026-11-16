import {
  hasHardLineupSeparator,
  isLineupFloorLabel,
  splitLineupCollaborations,
} from "../../../scripts/lib/lineupArtists.ts";

const LINEUP_HEADER_REGEX =
  /^(?:line[\s-]?up|artists?|djs?|acts?|with|w\/)\s*:?\s*$/i;

const GLUED_LINEUP_HEADER_REGEX = /([!?.…])(\s*line[\s-]?up)\b/gi;
const GLUED_AFTER_HEADER_REGEX = /(line[\s-]?up)(?=[A-ZÀ-ÖØ-Þ])/gi;
const INLINE_LINEUP_HEADER_REGEX =
  /(?:^|[\s!?.…])((?:line[\s-]?up))\s*:?\s*/gi;

const NON_ARTIST_LABELS = new Set([
  "line up",
  "lineup",
  "line-up",
  "artist",
  "artists",
  "dj",
  "djs",
  "act",
  "acts",
  "with",
  "w/",
  "tba",
  "tbc",
  "t.b.a",
  "more tba",
]);

const MIN_ARTIST_LENGTH = 2;
const MAX_ARTIST_LENGTH = 80;

function normalizeSpaces(value: string): string {
  return value.replace(/[ \t]+/g, " ").trim();
}

function htmlToTextWithNewlines(raw: string): string {
  return (
    raw
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\n")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<\/strong>/gi, "\n")
      .replace(/<\/b>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
  );
}

function insertNewlinesAroundGluedHeaders(text: string): string {
  return text
    .replace(GLUED_LINEUP_HEADER_REGEX, "$1\n$2\n")
    .replace(GLUED_AFTER_HEADER_REGEX, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function prepareTextForLineup(raw: string): string {
  const withNewlines = htmlToTextWithNewlines(raw);
  return insertNewlinesAroundGluedHeaders(withNewlines);
}

function isLineupHeaderLine(line: string): boolean {
  const clean = stripDecorations(normalizeSpaces(line));
  if (!clean) return false;
  if (LINEUP_HEADER_REGEX.test(clean)) return true;
  if (/^line[\s-]?up\b(?:\s*\([^)]*\))?\s*:?\s*$/i.test(clean)) return true;
  if (/^[^a-z0-9]*line[\s-]?up[^a-z0-9]*$/i.test(clean)) return true;
  return false;
}

const ROOM_CORE =
  "main\\s*floor|mainfloor|laster\\s*floor|luster\\s*floor|second\\s*floor|kitchen(?:\\s+hosted\\s+by\\s+\\S+)?|oben|unten|wohnzimmer";

function stripDecorations(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\p{So}\uFE0F\u200D]/gu, " ")
    .replace(/[▶►➔➤▸▹▼▲●○■□◆◇★☆✓✔✕✖╪╱╲•·▪‣]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bracket a room/floor header the way the app's stage markers expect. */
export function formatRoomTag(label: string): string {
  const clean = stripDecorations(label).replace(/[:|]+$/g, "").trim();
  const hosted = clean.match(/^(.*\S)\s+(hosted\s+by\s+.+)$/i);
  if (hosted?.[1] && hosted[2]) {
    return `[${hosted[1].toUpperCase()} ${hosted[2]}]`;
  }
  return `[${clean.toUpperCase()}]`;
}

function isStopLine(line: string): boolean {
  const clean = stripDecorations(line);
  if (!clean) return false;
  if (
    /^(?:tickets?|doors?|entry|admission|presale|pre[\s-]*sale|box office|location|venue|address|awareness|hardfacts|no place|no photo|respect the club|earlybird|limited pre|stay hard|art program|exhibiting artists|presented by|highlights of|(?:graphics|visuals|photos?)\s+by)\b/i.test(
      clean
    )
  ) {
    return true;
  }
  if (/^(?:das werk|daswerk)\b/i.test(clean)) return true;
  if (/^\d{1,2}[:.]\d{2}/.test(clean)) return true;
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}\b/.test(clean)) return true;
  if (/[€]/.test(clean) && !/\bb2b\b/i.test(clean)) return true;
  return false;
}

/** A credit row (label path, aka, parenthetical country) is not a paragraph. */
function isCreditLine(line: string): boolean {
  const clean = stripDecorations(line);
  if (!clean) return false;
  if (/^[▶►▴▲✓✔]/.test(clean)) return true;
  if (/\baka\b/i.test(clean)) return true;
  if ((clean.match(/\//g) ?? []).length >= 1 && clean.split(/\s+/).length <= 16) {
    return true;
  }
  if (/\([^)]*\)/.test(clean) && clean.split(/\s+/).length <= 14) return true;
  return false;
}

function isLongProse(line: string): boolean {
  if (hasHardLineupSeparator(line)) return false;
  if (isCreditLine(line)) return false;

  const parts = line
    .split(/[,;•·|]/)
    .map((part) => stripDecorations(part))
    .filter(Boolean);
  if (parts.length >= 2 && parts.every((part) => part.split(/\s+/).length <= 6)) {
    return false;
  }

  const words = stripDecorations(line).split(/\s+/).filter(Boolean);
  if (words.length < 7) return false;
  return true;
}

function proseRoomLabel(line: string): string | null {
  const clean = stripDecorations(line);
  if (!clean.endsWith(":")) return null;
  if (/^line[\s-]?up\b/i.test(clean)) return null;
  if (new RegExp(`^(?:${ROOM_CORE})\\s*:$`, "i").test(clean)) return null;
  if (clean.split(/\s+/).length < 5) return null;
  const match = clean.match(new RegExp(`\\b(${ROOM_CORE})\\b`, "i"));
  return match?.[1] ?? null;
}

function splitByRoomMarkers(
  line: string
): { room: string; body: string }[] | null {
  const re = new RegExp(
    `(?:^|\\.\\s*|\\s)(${ROOM_CORE})\\s*:`,
    "giu",
  );
  const matches = [...line.matchAll(re)].filter((match) => {
    const at = match.index ?? 0;
    const hasColon = /:\s*$/.test(match[0] ?? "");
    if (at > 0 && !hasColon) return false;
    // A room word with no colon is only a header when it fills the line.
    if (!hasColon && line.slice(at + (match[0]?.length ?? 0)).trim()) {
      return false;
    }
    return Boolean(match[1]);
  });

  if (matches.length === 0) return null;

  return matches.map((match, index) => {
    const start = (match.index ?? 0) + (match[0]?.length ?? 0);
    const end =
      index + 1 < matches.length
        ? (matches[index + 1]?.index ?? line.length)
        : line.length;
    return {
      room: match[1] ?? "",
      body: line.slice(start, end).replace(/[.\s]+$/g, "").trim(),
    };
  });
}

/** "Name / Label / GER" keeps the artist. A slash-separated label chain does not. */
function stripLabelSuffix(name: string): string {
  if (
    /\bhosted\s+by\b/i.test(name) &&
    /\b(?:house|techno|dubstep|ukg|dnb|trance|garage)\b/i.test(name)
  ) {
    return "";
  }

  const parts = name
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return name;

  const labelWord =
    /\b(?:records?|audio|sounds|tunes|tools|music|ballroom|drumcode|hospital|parade|calling)\b/i;
  const head = parts[0] ?? "";
  const tail = parts.slice(1).join(" / ");
  if (/\baka\b/i.test(head)) return head;

  const headWords = head.split(/\s+/).filter(Boolean);
  const billed =
    headWords.length >= 2 ||
    /^[\p{Lu}0-9][\p{Lu}0-9 .'+!_-]*$/u.test(head);
  const tailIsSecondAct =
    parts.length === 2 &&
    /^[\p{Lu}0-9][\p{Lu}0-9 .'+!_-]*$/u.test(parts[1] ?? "");
  if (billed && !labelWord.test(head) && !tailIsSecondAct) return head;
  if (!labelWord.test(tail)) return name;

  if (parts.length >= 3 && parts.every((part) => part.split(/\s+/).length <= 3)) {
    return "";
  }
  return name;
}

function cleanArtistToken(value: string): string | null {
  const cut = value.split(
    /\b(?:entry|doors?|box\s+office|pre[\s-]*sale|presale|tickets?)\b/i
  )[0] ?? "";

  const name = stripLabelSuffix(
    stripDecorations(cut)
      .replace(/@[A-Za-z0-9._]+/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/^(?:hosted\s+by\s*:?\s*)/i, "")
      .replace(/\s+w\/\s*$/i, "")
      .replace(/^[\s\-–—*|:;/\\+]+/, "")
      .replace(/[\s|:/\\.,¿?]+$/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );

  if (!name) return null;
  if (isLineupFloorLabel(name)) return null;
  if (name.startsWith("[") && name.endsWith("]")) return name;
  if (name.length < MIN_ARTIST_LENGTH || name.length > MAX_ARTIST_LENGTH) {
    return null;
  }

  const lowered = name.toLowerCase();
  const compact = lowered.replace(/[.\s]/g, "");
  if (NON_ARTIST_LABELS.has(lowered) || NON_ARTIST_LABELS.has(compact)) {
    return null;
  }
  if (/^line[\s-]?up$/i.test(name)) return null;
  if (/^\(?a\s*-\s*z\)?:?$/i.test(name)) return null;
  if (/^https?:\/\//i.test(name)) return null;
  if (/^\d+$/.test(name)) return null;
  if (/^(?:vienna debut|live|tba|tbc|residents?)$/i.test(name)) return null;
  if (/\bresidents?\b/i.test(name) && name.split(/\s+/).length <= 4) return null;
  if (/^[\p{So}\p{Sk}\p{P}\p{Z}█▓▒░■□●○]+$/u.test(name)) return null;
  if (/^\d{1,2}[:.]\d{2}/.test(name)) return null;
  if (!/\p{L}/u.test(name)) return null;

  return name;
}

function splitArtists(body: string): { names: string[]; stopped: boolean } {
  const stopped = /\b(?:entry|doors?|box\s+office|pre[\s-]*sale|presale|tickets?)\b/i.test(
    body
  );
  const names = body
    .split(/\n+|[,;•·|]+|\s*\/\/\s*/)
    .map((part) => cleanArtistToken(part))
    .filter((name): name is string => Boolean(name));

  return { names, stopped };
}

function consumeLine(line: string, into: string[]): "stop" | "ok" {
  const clean = stripDecorations(line);
  if (!clean) return "ok";
  if (isStopLine(clean)) return "stop";

  const proseRoom = proseRoomLabel(clean);
  if (proseRoom) {
    into.push(formatRoomTag(proseRoom));
    return "ok";
  }

  const rooms = splitByRoomMarkers(clean);
  if (rooms) {
    let stopped = false;
    for (const room of rooms) {
      if (room.room) into.push(formatRoomTag(room.room));
      const artists = splitArtists(room.body);
      into.push(...artists.names);
      if (artists.stopped) stopped = true;
    }
    return stopped ? "stop" : "ok";
  }

  if (isLongProse(clean)) return "stop";

  const artists = splitArtists(clean);
  into.push(...artists.names);
  return artists.stopped ? "stop" : "ok";
}

function dedupeArtists(artists: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const artist of artists) {
    const key = artist.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(artist);
  }

  return result;
}

function findLineupStartIndex(lines: string[]): number {
  let lastHeaderIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeSpaces(lines[index]);
    if (!line) {
      continue;
    }

    if (isLineupHeaderLine(line) || splitInlineHeaderLine(line).isHeader) {
      lastHeaderIndex = index;
    }
  }

  return lastHeaderIndex;
}

function isProseLineupMention(match: RegExpExecArray, line: string): boolean {
  const header = (match[1] ?? "").toLowerCase();
  if (!/^line[\s-]?up$/.test(header)) {
    return false;
  }

  const afterIndex = (match.index ?? 0) + match[0].length;
  const after = line.slice(afterIndex);

  return (
    /^['’]s?\b/i.test(after) ||
    /^\s*(is|here|that|for|with|in|at|to|of|and|or|as|was|were|will|would|should)\b/i.test(
      after
    )
  );
}

function findLastLineupHeaderMatch(line: string): RegExpExecArray | null {
  const pattern = new RegExp(INLINE_LINEUP_HEADER_REGEX.source, "gi");
  let lastMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null = pattern.exec(line);

  while (match) {
    if (!isProseLineupMention(match, line)) {
      lastMatch = match;
    }
    match = pattern.exec(line);
  }

  return lastMatch;
}

function splitInlineHeaderLine(line: string): {
  isHeader: boolean;
  remainder: string;
} {
  const match = findLastLineupHeaderMatch(line);

  if (!match || match.index == null) {
    return { isHeader: false, remainder: line };
  }

  const start = match.index + match[0].length;

  return {
    isHeader: true,
    remainder: normalizeSpaces(line.slice(start)),
  };
}

function collectLineupFromLines(lines: string[], startIndex: number): string[] {
  const artists: string[] = [];
  const headerLine = normalizeSpaces(lines[startIndex] ?? "");
  let index = startIndex;
  const inlineHeader = splitInlineHeaderLine(headerLine);

  // "Lineup: A, B, C" is a header plus the whole bill on one line.
  if (inlineHeader.isHeader || isLineupHeaderLine(headerLine)) {
    if (inlineHeader.isHeader && inlineHeader.remainder) {
      const status = consumeLine(inlineHeader.remainder, artists);
      if (status === "stop") return dedupeArtists(artists);
    }
    index = startIndex + 1;
  }

  while (index < lines.length) {
    const line = normalizeSpaces(lines[index] ?? "");
    index += 1;

    if (!line) continue;
    if (isLineupHeaderLine(line)) break;

    const status = consumeLine(line, artists);
    if (status === "stop") break;
  }

  return dedupeArtists(artists);
}

/**
 * Extract artist names from a lineup section inside event description text.
 */
/**
 * Turn event HTML into text that keeps lineup rows on their own lines.
 * `<br>` between DJs must survive; collapsing them glues room names onto artists.
 */
export function htmlToStructuredText(raw: string): string {
  return prepareTextForLineup(raw)
    .split("\n")
    .map((line) => normalizeSpaces(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Drop room headers, unnamed floor markers, and junk, then split billed pairs.
 * Every source runs its lineup through this so a fix applies everywhere.
 */
export function normalizeLineupNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of names) {
    if (isLineupFloorLabel(raw)) continue;
    const cleaned = cleanArtistToken(raw);
    if (!cleaned || isLineupFloorLabel(cleaned)) continue;

    for (const artist of splitLineupCollaborations(cleaned)) {
      const name = cleanArtistToken(artist) ?? artist;
      if (!name || isLineupFloorLabel(name)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(name);
    }
  }

  return result;
}

/**
 * Extract DJ names from a lineup section inside event description text.
 * Room and floor headers are removed. b2b / B2B / vs / vs. / versus / x / &
 * pairs are split when they are two artists. Event titles are left alone.
 */
export function extractLineup(description: string): string[] {
  if (!description?.trim()) {
    return [];
  }

  const prepared = prepareTextForLineup(
    description.replace(/\\r/g, "\n").replace(/\\n/g, "\n")
  );
  const lines = prepared.split("\n").map((line) => line.trim());

  let startIndex = findLineupStartIndex(lines);
  if (startIndex === -1) {
    startIndex = lines.findIndex((line) => {
      const clean = stripDecorations(line);
      return Boolean(splitByRoomMarkers(clean) || proseRoomLabel(clean));
    });
  }
  if (startIndex === -1) {
    return [];
  }

  const artists = collectLineupFromLines(lines, startIndex);
  const names = normalizeLineupNames(artists);
  return names.length > 0 ? names : [];
}

function formatDescriptionBody(raw: string): string {
  return normalizeSpaces(
    prepareTextForLineup(raw)
      .split("\n")
      .map((line) => normalizeSpaces(line))
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * Remove lineup header + artist block from description when lineup is stored separately.
 */
export function stripLineupFromDescription(description: string): string {
  if (!description?.trim()) {
    return "";
  }

  const prepared = prepareTextForLineup(description);
  const lines = prepared.split("\n").map((line) => line.trim());

  const startIndex = findLineupStartIndex(lines);
  if (startIndex === -1) {
    return formatDescriptionBody(description);
  }

  const introParts: string[] = [];

  for (let index = 0; index < startIndex; index += 1) {
    const line = normalizeSpaces(lines[index] ?? "");
    if (line) {
      introParts.push(line);
    }
  }

  const headerLine = lines[startIndex] ?? "";
  const headerMatch = findLastLineupHeaderMatch(headerLine);

  if (headerMatch?.index != null && headerMatch.index > 0) {
    const beforeHeader = normalizeSpaces(headerLine.slice(0, headerMatch.index));
    if (beforeHeader) {
      introParts.push(beforeHeader);
    }
  } else if (isLineupHeaderLine(headerLine) && startIndex > 0) {
    // Standalone header line — intro is only prior lines.
  } else if (!headerMatch && headerLine && !isLineupHeaderLine(headerLine)) {
    introParts.push(headerLine);
  }

  return introParts.join(" ").trim();
}

/**
 * Prepare description + lineup for Supabase payloads.
 */
export function enrichEventText(description: string | null): {
  description: string | null;
  lineup: string[];
} {
  if (!description?.trim()) {
    return {
      description: description?.trim() || null,
      lineup: [],
    };
  }

  const lineup = extractLineup(description);

  if (lineup.length === 0) {
    return {
      description: formatDescriptionBody(description) || null,
      lineup: [],
    };
  }

  const stripped = stripLineupFromDescription(description);

  return {
    description: stripped || formatDescriptionBody(description) || null,
    lineup,
  };
}
