export function todayInVienna(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
  }).format(new Date());
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`);
    return d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function formatPrice(price: number | string | null): string {
  if (price === null || price === undefined || price === '') return '';
  if (typeof price === 'number') {
    return Number.isInteger(price) ? `€${price}` : `€${price.toFixed(2)}`;
  }
  return String(price);
}

export function formatTime(timeStr: string | null): string {
  if (!timeStr) return '—';
  const parts = timeStr.split(':');
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return timeStr;
}

export function matchesSearch(
  event: { title: string; description: string | null },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const title = event.title.toLowerCase();
  const desc = (event.description ?? '').toLowerCase();
  return title.includes(q) || desc.includes(q);
}

/** True when event_date is strictly before today (Vienna). */
export function isEventDatePast(eventDate: string | null): boolean {
  if (!eventDate) return false;
  return eventDate.slice(0, 10) < todayInVienna();
}
