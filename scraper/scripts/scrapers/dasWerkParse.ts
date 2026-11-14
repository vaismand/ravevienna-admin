export type DasWerkProgramEvent = {
  id?: string;
  documentId?: string;
  title?: string;
  dateIso?: string;
  dateLabel?: string;
  actsLine?: string;
  description?: string;
  ticketUrl?: string;
  flyerUrl?: string | null;
};

const FLIGHT_PUSH = 'self.__next_f.push([1,"';

function decodeJsString(
  source: string,
  startQuote: number
): { text: string; end: number } | null {
  let index = startQuote + 1;
  let out = "";

  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      const next = source[index + 1];
      if (next === "n") out += "\n";
      else if (next === "r") out += "\r";
      else if (next === "t") out += "\t";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "u") {
        const hex = source.slice(index + 2, index + 6);
        const code = Number.parseInt(hex, 16);
        out += Number.isNaN(code) ? "" : String.fromCharCode(code);
        index += 6;
        continue;
      } else if (next != null) {
        out += next;
      }
      index += 2;
      continue;
    }

    if (char === '"') return { text: out, end: index };
    out += char;
    index += 1;
  }

  return null;
}

function sliceByUtf8Bytes(
  value: string,
  byteLength: number
): { text: string; charCount: number } {
  let bytes = 0;
  let chars = 0;

  while (chars < value.length && bytes < byteLength) {
    const code = value.charCodeAt(chars);
    const step = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
    bytes += Buffer.byteLength(value.slice(chars, chars + step));
    chars += step;
  }

  return { text: value.slice(0, chars), charCount: chars };
}

function collectTextChunks(decoded: string, into: Map<string, string>) {
  const pattern = /(?:^|\n)([0-9a-f]+):T([0-9a-f]+),/g;
  let match: RegExpExecArray | null = pattern.exec(decoded);

  while (match) {
    const id = match[1];
    const byteLength = Number.parseInt(match[2] ?? "", 16);
    if (!id || !Number.isFinite(byteLength)) {
      match = pattern.exec(decoded);
      continue;
    }

    const start = match.index + match[0].length;
    const sliced = sliceByUtf8Bytes(decoded.slice(start), byteLength);
    into.set(id, sliced.text);
    pattern.lastIndex = start + sliced.charCount;
    match = pattern.exec(decoded);
  }
}

function matchingBracket(source: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/** CMS descriptions are sometimes a flight ref (`$1a`) instead of text. */
export function resolveDasWerkDescription(
  description: string | undefined,
  chunks: Map<string, string>
): string {
  const raw = (description ?? "").replace(/\\r/g, "\n").replace(/\\n/g, "\n").trim();
  if (!raw) return "";

  const ref = raw.match(/^\$([0-9a-f]+)$/i);
  if (!ref) return raw;

  const resolved = chunks.get((ref[1] ?? "").toLowerCase());
  return resolved?.replace(/\\r/g, "\n").replace(/\\n/g, "\n").trim() ?? "";
}

function eventsFromDecoded(decoded: string): DasWerkProgramEvent[] {
  let from = 0;

  while (from < decoded.length) {
    const key = decoded.indexOf('"events":', from);
    if (key < 0) return [];

    const arrayStart = decoded.indexOf("[", key);
    if (arrayStart < 0) return [];

    const arrayEnd = matchingBracket(decoded, arrayStart);
    if (arrayEnd > arrayStart) {
      try {
        const parsed = JSON.parse(decoded.slice(arrayStart, arrayEnd + 1)) as unknown;
        if (Array.isArray(parsed)) {
          const events = parsed.filter(
            (item): item is DasWerkProgramEvent =>
              Boolean(item) && typeof item === "object" && "title" in (item as object)
          );
          if (events.length > 0) return events;
        }
      } catch {
        // Footer JSON can contain the word "events" too.
      }
    }

    from = key + 8;
  }

  return [];
}

function parseFlightProgram(html: string): {
  events: DasWerkProgramEvent[];
  chunks: Map<string, string>;
} {
  const chunks = new Map<string, string>();
  const decodedParts: string[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const push = html.indexOf(FLIGHT_PUSH, cursor);
    if (push < 0) break;

    const quote = push + FLIGHT_PUSH.length - 1;
    const decoded = decodeJsString(html, quote);
    if (!decoded) break;

    decodedParts.push(decoded.text);
    collectTextChunks(decoded.text, chunks);
    cursor = decoded.end + 1;
  }

  return {
    events: eventsFromDecoded(decodedParts.join("\n")),
    chunks,
  };
}

function parseLegacyProgram(html: string): DasWerkProgramEvent[] {
  const eventsMatch = html.match(/\\"events\\":\[(.*?)\]\}\]\}\]/s);
  if (!eventsMatch?.[1]) return [];

  try {
    const cleanedJson = `[${eventsMatch[1]}]`
      .replace(/\\"/g, '"')
      .replace(/\\u0026/g, "&");
    const parsed = JSON.parse(cleanedJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DasWerkProgramEvent =>
        Boolean(item) && typeof item === "object"
    );
  } catch {
    return [];
  }
}

function withResolvedDescriptions(
  events: DasWerkProgramEvent[],
  chunks: Map<string, string>
): DasWerkProgramEvent[] {
  return events.map((event) => ({
    ...event,
    description: resolveDasWerkDescription(event.description, chunks),
    actsLine: event.actsLine?.replace(/\\n/g, "\n"),
  }));
}

/** Events embedded in one Das Werk program HTML page. Broken `$1a` refs are resolved or cleared. */
export function parseDasWerkProgramHtml(html: string): DasWerkProgramEvent[] {
  const flight = parseFlightProgram(html);
  const events = flight.events.length > 0 ? flight.events : parseLegacyProgram(html);
  return withResolvedDescriptions(events, flight.chunks);
}
