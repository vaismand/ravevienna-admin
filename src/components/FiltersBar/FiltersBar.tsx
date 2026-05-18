import { GENRE_OPTIONS } from '../../lib/constants';
import type {
  DraftEventFilters,
  EventSource,
  Venue,
} from '../../types/database';
import styles from './FiltersBar.module.css';

interface FiltersBarProps {
  filters: DraftEventFilters;
  onChange: (filters: DraftEventFilters) => void;
  venues: Venue[];
  sources: EventSource[];
  hideStatusFilter?: boolean;
}

export function FiltersBar({
  filters,
  onChange,
  venues,
  sources,
  hideStatusFilter = true,
}: FiltersBarProps) {
  const update = <K extends keyof DraftEventFilters>(
    key: K,
    value: DraftEventFilters[K],
  ) => {
    onChange({ ...filters, [key]: value });
  };

  const hasActiveFilters =
    filters.search || filters.venueId || filters.genre || filters.sourceId;

  return (
    <div className={styles.bar}>
      <div className={styles.field}>
        <label className={styles.label}>Search</label>
        <input
          type="search"
          className={styles.input}
          placeholder="Title or description…"
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
        />
      </div>

      {!hideStatusFilter && (
        <div className={styles.field}>
          <label className={styles.label}>Status</label>
          <select
            className={styles.select}
            value={filters.status}
            onChange={(e) =>
              update('status', e.target.value as DraftEventFilters['status'])
            }
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="published">Published</option>
          </select>
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label}>Venue</label>
        <select
          className={styles.select}
          value={filters.venueId}
          onChange={(e) => update('venueId', e.target.value)}
        >
          <option value="">All venues</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Genre</label>
        <select
          className={styles.select}
          value={filters.genre}
          onChange={(e) => update('genre', e.target.value)}
        >
          <option value="">All genres</option>
          {GENRE_OPTIONS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Source</label>
        <select
          className={styles.select}
          value={filters.sourceId}
          onChange={(e) => update('sourceId', e.target.value)}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          className={styles.clearBtn}
          onClick={() =>
            onChange({
              ...filters,
              search: '',
              venueId: '',
              genre: '',
              sourceId: '',
            })
          }
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
