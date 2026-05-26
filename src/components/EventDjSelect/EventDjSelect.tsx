import type { Dj } from '../../types/database';
import styles from './EventDjSelect.module.css';

interface EventDjSelectProps {
  activeDjs: Dj[];
  selectedDjIds: string[];
  onChange: (djIds: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function EventDjSelect({
  activeDjs,
  selectedDjIds,
  onChange,
  loading = false,
  disabled = false,
}: EventDjSelectProps) {
  const djMap = new Map(activeDjs.map((d) => [d.id, d]));
  const selectedDjs = selectedDjIds
    .map((id) => djMap.get(id))
    .filter((d): d is Dj => Boolean(d));
  const available = activeDjs.filter((d) => !selectedDjIds.includes(d.id));

  const addDj = (id: string) => {
    if (disabled || selectedDjIds.includes(id)) return;
    onChange([...selectedDjIds, id]);
  };

  const removeDj = (id: string) => {
    onChange(selectedDjIds.filter((djId) => djId !== id));
  };

  const moveDj = (index: number, direction: -1 | 1) => {
    const next = [...selectedDjIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <section className={styles.section}>
      <h3 className={styles.title}>Lineup / DJs</h3>
      <p className={styles.hint}>
        Link DJs from the directory. Order is saved as lineup position. Manual
        lineup text above is kept separately.
      </p>

      {loading ? (
        <p className={styles.muted}>Loading DJs…</p>
      ) : activeDjs.length === 0 ? (
        <p className={styles.muted}>
          No active DJs. Add DJs in the DJs tab first.
        </p>
      ) : (
        <>
          <div className={styles.selectedBlock}>
            <span className={styles.subLabel}>Selected ({selectedDjs.length})</span>
            {selectedDjs.length === 0 ? (
              <p className={styles.muted}>No DJs selected.</p>
            ) : (
              <ul className={styles.selectedList}>
                {selectedDjs.map((dj, index) => (
                  <li key={dj.id} className={styles.selectedItem}>
                    <span className={styles.order}>{index + 1}.</span>
                    <span className={styles.djName}>{dj.name}</span>
                    <div className={styles.itemActions}>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => moveDj(index, -1)}
                        disabled={disabled || index === 0}
                        aria-label={`Move ${dj.name} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={styles.iconBtn}
                        onClick={() => moveDj(index, 1)}
                        disabled={
                          disabled || index === selectedDjs.length - 1
                        }
                        aria-label={`Move ${dj.name} down`}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={() => removeDj(dj.id)}
                        disabled={disabled}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={styles.availableBlock}>
            <span className={styles.subLabel}>Add DJ</span>
            {available.length === 0 ? (
              <p className={styles.muted}>All active DJs are selected.</p>
            ) : (
              <div className={styles.availableList}>
                {available.map((dj) => (
                  <button
                    key={dj.id}
                    type="button"
                    className={styles.addBtn}
                    onClick={() => addDj(dj.id)}
                    disabled={disabled}
                  >
                    + {dj.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
