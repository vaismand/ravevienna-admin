import type { DjFilters } from '../../types/database';
import styles from '../FiltersBar/FiltersBar.module.css';

interface DjFiltersBarProps {
  filters: DjFilters;
  onChange: (filters: DjFilters) => void;
}

export function DjFiltersBar({ filters, onChange }: DjFiltersBarProps) {
  const update = <K extends keyof DjFilters>(key: K, value: DjFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const hasActiveFilters =
    filters.search || filters.active !== 'all';

  return (
    <div className={styles.bar}>
      <div className={styles.field}>
        <label className={styles.label}>Search</label>
        <input
          type="search"
          className={styles.input}
          placeholder="Name, slug, genres…"
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Status</label>
        <select
          className={styles.select}
          value={filters.active}
          onChange={(e) =>
            update('active', e.target.value as DjFilters['active'])
          }
        >
          <option value="all">All</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </div>

      {hasActiveFilters && (
        <button
          type="button"
          className={styles.clearBtn}
          onClick={() => onChange({ search: '', active: 'all' })}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
