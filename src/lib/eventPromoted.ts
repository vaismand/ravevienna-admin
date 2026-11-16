/**
 * `events.is_promoted` is set only from the admin panel.
 * Scrapers, draft republish, and submission republish omit it so a re-run
 * cannot reset a pin back to the column default (false).
 * The column is optional in the client until that migration has been run.
 */

export type PromotedFilter = 'all' | 'promoted' | 'not';

export const PROMOTED_MIGRATION_PATH =
  'supabase/migrations/20261116183000_add_events_is_promoted.sql';

export function isEventPromoted(
  row: { is_promoted?: unknown } | null | undefined,
): boolean {
  return row?.is_promoted === true;
}

export function matchesPromotedFilter(
  isPromoted: boolean,
  filter: PromotedFilter,
): boolean {
  if (filter === 'promoted') return isPromoted;
  if (filter === 'not') return !isPromoted;
  return true;
}

export function isMissingPromotedColumn(error: unknown): boolean {
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

  if (!/is_promoted/i.test(message)) return false;
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    /schema cache|does not exist/i.test(message)
  );
}

/** Drop a manual pin from any scraper or republish payload. */
export function withoutPromotedFlag<T extends object>(
  row: T,
): Omit<T, 'is_promoted'> {
  if (!('is_promoted' in row)) return row;
  const copy: Record<string, unknown> = { ...row };
  delete copy.is_promoted;
  return copy as Omit<T, 'is_promoted'>;
}
