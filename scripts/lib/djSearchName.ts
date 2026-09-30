/**
 * Normalize DJ names for search matching.
 * Case, accents, a leading "DJ ", and live-set markers do not change the match.
 */

const LIVE_GROUP =
  /\s*[([｛【]\s*(?:live(?:\s*set)?|dj\s*set|liveset)\s*[)\]｝】]\s*/gi;

export function normalizeDjSearchName(name: string): string {
  const withoutMarks = name.normalize("NFD").replace(/\p{M}/gu, "");
  const withoutLiveGroups = withoutMarks.replace(LIVE_GROUP, " ");

  let normalized = withoutLiveGroups
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[._-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  normalized = normalized.replace(/^dj\s+/, "").trim();

  if (/\s+live$/.test(normalized)) {
    normalized = normalized.replace(/\s+live$/, "").trim();
  }

  return normalized;
}

export function compactDjSearchName(name: string): string {
  return normalizeDjSearchName(name).replace(/\s+/g, "");
}

export function djSearchNamesMatch(a: string, b: string): boolean {
  const left = normalizeDjSearchName(a);
  const right = normalizeDjSearchName(b);
  if (!left || !right) {
    return false;
  }
  return left === right || compactDjSearchName(a) === compactDjSearchName(b);
}
