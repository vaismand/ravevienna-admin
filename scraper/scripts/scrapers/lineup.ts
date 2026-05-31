import { isLineupFloorLabel, splitLineupCollaborations } from "../../../scripts/lib/lineupArtists.ts";

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
      .replace(/<br\s*\/?>/gi, "\n")
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
  const clean = normalizeSpaces(line.replace(/^[-–—•·*]+\s*/, ""));
  return LINEUP_HEADER_REGEX.test(clean);
}

function isValidArtistName(name: string): boolean {
  const clean = normalizeSpaces(
    name.replace(/^[-–—•·*]+\s*/, "").replace(/^:+/, "")
  );

  if (!clean) return false;
  if (isLineupFloorLabel(clean)) return false;
  if (clean.length < MIN_ARTIST_LENGTH || clean.length > MAX_ARTIST_LENGTH) {
    return false;
  }

  const lowered = clean.toLowerCase();
  if (NON_ARTIST_LABELS.has(lowered)) return false;
  if (/^line[\s-]?up$/i.test(clean)) return false;

  if (/^https?:\/\//i.test(clean)) return false;
  if (/^\d+$/.test(clean)) return false;

  return true;
}

function splitCamelCaseArtists(text: string): string[] {
  return text
    .split(/(?<=[a-zà-öø-ÿ0-9])(?=[A-ZÀ-ÖØ-Þ])/)
    .map((part) => normalizeSpaces(part))
    .filter(isValidArtistName);
}

function splitArtistChunk(chunk: string): string[] {
  const clean = normalizeSpaces(chunk.replace(/^[-–—•·*]+\s*/, ""));
  if (!clean) return [];

  const collaborations = splitLineupCollaborations(clean);
  if (collaborations.length > 1) {
    return collaborations.flatMap((part) => splitArtistChunk(part));
  }

  const byDelimiters = clean
    .split(/\n+|[,;|•·]+|\s\/\s+|\s\\\s+/)
    .map((part) => normalizeSpaces(part))
    .filter(Boolean);

  if (byDelimiters.length > 1) {
    return byDelimiters.flatMap((part) => {
      const camel = splitCamelCaseArtists(part);
      return camel.length > 0 ? camel : isValidArtistName(part) ? [part] : [];
    });
  }

  const camel = splitCamelCaseArtists(clean);
  if (camel.length > 1) {
    return camel;
  }

  return isValidArtistName(clean) ? [clean] : [];
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
  const inlineHeader = splitInlineHeaderLine(headerLine);

  if (inlineHeader.remainder) {
    artists.push(...splitArtistChunk(inlineHeader.remainder));
  }

  let index = startIndex + 1;

  while (index < lines.length) {
    const line = normalizeSpaces(lines[index]);

    if (!line) {
      index += 1;
      continue;
    }

    if (isLineupHeaderLine(line)) {
      break;
    }

    if (
      /^(tickets?|doors?|entry|admission|presale|location|venue|address)\b/i.test(
        line
      )
    ) {
      break;
    }

    artists.push(...splitArtistChunk(line));
    index += 1;
  }

  return dedupeArtists(artists);
}

/**
 * Extract artist names from a lineup section inside event description text.
 */
export function extractLineup(description: string): string[] {
  if (!description?.trim()) {
    return [];
  }

  const prepared = prepareTextForLineup(description);
  const lines = prepared.split("\n").map((line) => line.trim());

  const startIndex = findLineupStartIndex(lines);
  if (startIndex === -1) {
    return [];
  }

  const artists = collectLineupFromLines(lines, startIndex);
  return artists.length > 0 ? artists : [];
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
