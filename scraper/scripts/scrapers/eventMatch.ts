/**
 * Same venue and date with a similar title is one event, even when Resident
 * Advisor and the venue site spell the name differently.
 */

const TITLE_FILLER = new Set([
  "and",
  "feat",
  "featuring",
  "ft",
  "night",
  "open",
  "air",
  "pres",
  "present",
  "presents",
  "rave",
  "the",
  "tour",
  "vol",
  "volume",
  "with",
]);

const GENERIC_COMPACT = new Set([
  "techno",
  "house",
  "trance",
  "rave",
  "club",
  "party",
  "openair",
  "vienna",
  "music",
]);

export type EventIdentity = {
  title: string;
  event_date: string | null;
  venue_id: string | null;
  venue_name: string | null;
};

export function compactEventTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
}

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !TITLE_FILLER.has(token));
}

export function titlesLookLikeSameEvent(left: string, right: string): boolean {
  const a = compactEventTitle(left);
  const b = compactEventTitle(right);
  if (!a || !b) return false;
  if (a === b) return true;

  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (
    shorter.length >= 5 &&
    !GENERIC_COMPACT.has(shorter) &&
    longer.includes(shorter)
  ) {
    return true;
  }

  const leftTokens = new Set(titleTokens(left));
  const rightTokens = new Set(titleTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;

  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  const union = leftTokens.size + rightTokens.size - shared;
  if (union > 0 && shared / union >= 0.67 && shared >= 2) return true;

  const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens;
  const larger = smaller === leftTokens ? rightTokens : leftTokens;
  if (smaller.size < 2) return false;
  for (const token of smaller) {
    if (!larger.has(token)) return false;
  }
  return true;
}

export function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const VENUE_GROUPS: string[][] = [
  ["das werk", "daswerk", "club werk"],
  ["grelle forelle", "grelleforelle"],
  ["the loft", "loft"],
  ["sass", "sass music club", "sass vienna"],
  ["flucc", "fluc"],
  ["flex", "flex wien", "flex vienna"],
  ["arena", "arena wien", "arena vienna", "wiener arena"],
  ["rhiz"],
];

function venueGroup(name: string): string[] | null {
  const normalized = normalizeVenueName(name);
  return (
    VENUE_GROUPS.find((group) =>
      group.some((alias) => alias === normalized),
    ) ?? null
  );
}

export function venueNamesMatch(left: string, right: string): boolean {
  const a = normalizeVenueName(left);
  const b = normalizeVenueName(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const group = venueGroup(left);
  return Boolean(group?.some((alias) => alias === b));
}

export type VenueRow = { id: string; name: string };

export function matchVenueId(venueName: string, venues: VenueRow[]): string | null {
  const trimmed = venueName.trim();
  if (!trimmed) return null;

  for (const venue of venues) {
    if (venueNamesMatch(trimmed, venue.name)) return venue.id;
  }
  return null;
}

export function isSameEvent(left: EventIdentity, right: EventIdentity): boolean {
  if (!left.event_date || !right.event_date) return false;
  if (left.event_date.slice(0, 10) !== right.event_date.slice(0, 10)) return false;

  const sameVenue =
    (Boolean(left.venue_id) && left.venue_id === right.venue_id) ||
    (Boolean(left.venue_name) &&
      Boolean(right.venue_name) &&
      venueNamesMatch(left.venue_name ?? "", right.venue_name ?? ""));
  if (!sameVenue) return false;

  return titlesLookLikeSameEvent(left.title, right.title);
}
