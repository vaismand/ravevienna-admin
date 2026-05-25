/** Convert DB lineup array to textarea text (one artist per line). */
export function formatLineupArray(lineup: string[] | null | undefined): string {
  return (lineup ?? []).join('\n');
}

/** Parse textarea text into a trimmed lineup array; empty input → []. */
export function parseLineupText(text: string): string[] {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}
