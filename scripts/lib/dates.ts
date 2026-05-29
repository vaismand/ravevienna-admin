/** Local calendar day as YYYY-MM-DD (device timezone). */
export function getTodayDateKey(reference: Date = new Date()): string {
  const year = reference.getFullYear();
  const month = String(reference.getMonth() + 1).padStart(2, "0");
  const day = String(reference.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Normalize DB / ISO strings to YYYY-MM-DD for comparisons. */
export function toDateKey(dateString: string): string {
  const trimmed = dateString.trim();
  if (!trimmed) return trimmed;

  const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateOnly) return dateOnly[1];

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;

  return getTodayDateKey(parsed);
}

export function parseDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Compact display date, e.g. "22.05". */
export function formatShortEventDate(dateString: string): string {
  const dateKey = toDateKey(dateString);
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return dateString;
  }

  const [, , month, day] = match;
  return `${day}.${month}`;
}

export function isToday(eventDate: string, reference: Date = new Date()): boolean {
  return toDateKey(eventDate) === getTodayDateKey(reference);
}

/** True when the event calendar day is strictly after today (local time). */
export function isFutureEvent(
  eventDate: string,
  reference: Date = new Date()
): boolean {
  const today = parseDateKey(getTodayDateKey(reference));
  const eventDay = parseDateKey(toDateKey(eventDate));
  return eventDay.getTime() > today.getTime();
}
