/**
 * Year inference for venue dates that omit the year (Grelle Forelle titles
 * are "DD/MM Name").
 *
 * Use the next occurrence of that month/day. A date that is only slightly in
 * the past — within DATE_YEAR_PAST_WINDOW_DAYS — keeps the current year so a
 * night that already started is not pushed 12 months ahead. Anything older
 * rolls forward to next year, including dates that fall before a year boundary.
 */

/** How many days in the past still count as "this year" rather than next year. */
export const DATE_YEAR_PAST_WINDOW_DAYS = 7;

function utcDay(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day);
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const value = new Date(utcDay(year, month, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() + 1 === month && value.getUTCDate() === day;
}

/**
 * Year of the next occurrence of month/day relative to `reference`.
 * Returns null when that day does not exist in either candidate year.
 */
export function inferEventYear(
  month: number,
  day: number,
  reference: Date = new Date(),
  pastWindowDays: number = DATE_YEAR_PAST_WINDOW_DAYS,
): number | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const year = reference.getFullYear();
  const today = utcDay(year, reference.getMonth() + 1, reference.getDate());
  const windowStart = today - pastWindowDays * 24 * 60 * 60 * 1000;

  const at = (candidateYear: number): number | null =>
    isRealCalendarDate(candidateYear, month, day)
      ? utcDay(candidateYear, month, day)
      : null;

  const previous = at(year - 1);
  const current = at(year);
  const next = at(year + 1);

  // A December date in the first days of January is still the one that just happened.
  if (previous != null && previous >= windowStart && previous <= today) {
    return year - 1;
  }

  if (current != null && current >= windowStart) return year;
  if (next != null) return year + 1;
  if (current != null) return year;
  return null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Grelle Forelle titles look like "16/10 F*cken Plus" (day/month, no year).
 * An explicit year ("16/10/2028") is kept as written.
 */
export function parseGrelleDateFromTitle(
  title: string,
  reference: Date = new Date(),
): string | null {
  const withYear = title.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (withYear) {
    const day = Number(withYear[1]);
    const month = Number(withYear[2]);
    const year = Number(withYear[3]);
    if (!isRealCalendarDate(year, month, day)) return null;
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  const match = title.match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = inferEventYear(month, day, reference);
  if (year == null) return null;

  return `${year}-${pad(month)}-${pad(day)}`;
}
