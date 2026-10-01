import {
  isLineupFloorLabel,
  normalizeLineupLine,
  parseLineupNames,
} from "../../../scripts/lib/lineupArtists.ts";

const LINEUP_HEADER_REGEX =
  /^(?:line[\s-]?up|artists?|djs?|acts?|with|w\/)\s*:?\s*$/i;

const GLUED_LINEUP_HEADER_REGEX = /([!?.…])(\s*line[\s-]?up)\b/gi;
const GLUED_AFTER_HEADER_REGEX = /(line[\s-]?up)(?=[A-ZÀ-ÖØ-Þ])/gi;
const INLINE_LINEUP_HEADER_REGEX =
  /(?:^|[\s!?.…])((?:line[\s-]?up))\s*:?\s*/gi;

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
  const clean = normalizeLineupLine(line).replace(/^[-–—•·*]+\s*/, "");
  return LINEUP_HEADER_REGEX.test(clean);
}

function isLineupStopLine(line: string): boolean {
  const clean = normalizeLineupLine(line);
  if (!clean || isLineupFloorLabel(clean)) return false;

  if (
    /^(?:tickets?|doors?|entry|admission|presale|pre\s*sale|box\s*office|location|venue|address|awareness|facebook|instagram|no\s+photo|graphics\s+by)\b/i.test(
      clean,
    )
  ) {
    return true;
  }

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 8) return true;
  if (words.length >= 6 && /[.!?]/.test(clean)) return true;
  return false;
}

function findLineupHeaderIndexes(lines: string[]): number[] {
  const indexes: number[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (!line) continue;
    if (isLineupHeaderLine(line) || splitInlineHeaderLine(line).isHeader) {
      indexes.push(index);
    }
  }

  return indexes;
}

function extractLineupWithoutHeader(rawLines: string[], lines: string[]): string[] {
  const compact = lines.filter(Boolean).join("\n");
  if (/\/\//.test(compact) && compact.length < 300 && !/[.!?]/.test(compact)) {
    return parseLineupNames(compact);
  }

  const bullets = rawLines.filter((line) =>
    /^\s*(?:[-–—*•·▪►▶]|\p{Extended_Pictographic})/u.test(line),
  );
  const floors = lines.filter(
    (line) =>
      isLineupFloorLabel(line) ||
      /^(?:floor\s*\d+|main\s*floor|mainfloor|live|kitchen)\s*:/i.test(line),
  );

  if (bullets.length + floors.length >= 2) {
    return parseLineupNames([...floors, ...bullets].join("\n"));
  }

  return [];
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

function collectLineupSections(lines: string[], headerIndexes: number[]): string {
  const sections: string[] = [];

  for (let header = 0; header < headerIndexes.length; header += 1) {
    const start = headerIndexes[header] ?? 0;
    const end = headerIndexes[header + 1] ?? lines.length;
    const inline = splitInlineHeaderLine(lines[start] ?? "");
    const section: string[] = [];

    if (inline.remainder && !isLineupHeaderLine(inline.remainder)) {
      section.push(inline.remainder);
    }

    for (let index = start + 1; index < end; index += 1) {
      const line = lines[index] ?? "";
      if (!line) continue;
      if (isLineupHeaderLine(line) || splitInlineHeaderLine(line).isHeader) break;
      if (isLineupStopLine(line)) break;
      section.push(line);
    }

    if (section.length > 0) sections.push(section.join("\n"));
  }

  return sections.join("\n");
}

/**
 * Extract artist names from a lineup section inside event description text.
 * Names that only show up in the description (no separate lineup field) are included.
 */
export function extractLineup(description: string): string[] {
  if (!description?.trim()) {
    return [];
  }

  const prepared = prepareTextForLineup(description);
  const rawLines = prepared.split("\n");
  const lines = rawLines.map((line) => normalizeLineupLine(line));
  const headerIndexes = findLineupHeaderIndexes(lines);

  if (headerIndexes.length === 0) {
    return extractLineupWithoutHeader(rawLines, lines);
  }

  return parseLineupNames(collectLineupSections(lines, headerIndexes));
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

  const startIndex = findLineupHeaderIndexes(lines)[0] ?? -1;
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
