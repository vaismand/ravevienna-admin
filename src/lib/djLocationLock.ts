/**
 * `djs.location_locked` is optional until the migration runs.
 * A missing column, null, or false all mean enrichment may still write city and country.
 */
export function isDjLocationLocked(
  row: { location_locked?: unknown } | null | undefined,
): boolean {
  return row?.location_locked === true;
}

export function isMissingLocationLockedColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const record = error as {
    message?: unknown;
    details?: unknown;
    hint?: unknown;
    code?: unknown;
  };
  const code = typeof record.code === 'string' ? record.code : '';
  const message = [record.message, record.details, record.hint]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');

  if (!/location_locked/i.test(message)) return false;
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    /schema cache|does not exist/i.test(message)
  );
}

export function withoutLocationLock<T extends Record<string, unknown>>(
  row: T,
): Omit<T, 'location_locked'> {
  const copy: Record<string, unknown> = { ...row };
  delete copy.location_locked;
  return copy as Omit<T, 'location_locked'>;
}

/** Retry payload when the database does not have `location_locked` yet. */
export function rowWithoutMissingLocationLock<T extends Record<string, unknown>>(
  row: T,
  error: unknown,
): Omit<T, 'location_locked'> | null {
  if (!isMissingLocationLockedColumn(error) || !('location_locked' in row)) {
    return null;
  }
  return withoutLocationLock(row);
}

/** Remove city and country from an enrichment write when the location is locked. */
export function withoutLockedLocationFields<T extends Record<string, unknown>>(
  dj: { location_locked?: unknown } | null | undefined,
  updates: T,
): T {
  if (!isDjLocationLocked(dj)) return updates;
  if (!('city' in updates) && !('country' in updates)) return updates;

  const next: Record<string, unknown> = { ...updates };
  delete next.city;
  delete next.country;
  return next as T;
}
