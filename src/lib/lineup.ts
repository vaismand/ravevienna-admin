/**
 * Convert DB lineup array to textarea text (one row per line).
 * `[ROOM]` stage markers are real rows and must be kept.
 */
export function formatLineupArray(lineup: string[] | null | undefined): string {
  return (lineup ?? []).join('\n');
}

/**
 * Parse textarea text into a trimmed lineup array; empty input → [].
 * A line like `[MAINFLOOR]` is a stage marker, not something to drop.
 */
export function parseLineupText(text: string): string[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}
