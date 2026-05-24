import { GENRE_OPTIONS } from '../../lib/constants';
import type { SubmissionFilters, Venue } from '../../types/database';
import styles from '../FiltersBar/FiltersBar.module.css';

interface SubmissionFiltersBarProps {
  filters: SubmissionFilters;
  onChange: (filters: SubmissionFilters) => void;
  venues: Venue[];
}

export function SubmissionFiltersBar({
  filters,
  onChange,
  venues,
}: SubmissionFiltersBarProps) {
  const update = <K extends keyof SubmissionFilters>(
    key: K,
    value: SubmissionFilters[K],
  ) => {
    onChange({ ...filters, [key]: value });
  };

  const hasActiveFilters =
    filters.search || filters.venueName || filters.genre;

  return (
    <div className={styles.bar}>
      <div className={styles.field}>
        <label className={styles.label}>Search</label>
        <input
          type="search"
          className={styles.input}
          placeholder="Title, venue, description, contact…"
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Venue</label>
        <select
          className={styles.select}
          value={filters.venueName}
          onChange={(e) => update('venueName', e.target.value)}
        >
          <option value="">All venues</option>
          {venues.map((v) => (
            <option key={v.id} value={v.name}>
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

      {hasActiveFilters && (
        <button
          type="button"
          className={styles.clearBtn}
          onClick={() =>
            onChange({ search: '', venueName: '', genre: '' })
          }
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
