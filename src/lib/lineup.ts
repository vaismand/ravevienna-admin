import { normalizeVsLineupEntry } from '../../scripts/lib/lineupArtists';

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
 * `vs.` / `versus` become `vs` inside the row. `X vs Y` stays one row,
 * the same way `X b2b Y` stays one row.
 */
export function parseLineupText(text: string): string[] {
  return text
    .split('\n')
    .map((item) => normalizeVsLineupEntry(item))
    .filter(Boolean);
}
