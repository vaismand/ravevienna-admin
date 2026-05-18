import { formatDate, formatPrice, formatTime } from '../../utils/format';
import type { DraftEvent, ReferenceMaps } from '../../types/database';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import styles from './DraftEventCard.module.css';

interface DraftEventCardProps {
  event: DraftEvent;
  maps: ReferenceMaps;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onEdit: (event: DraftEvent) => void;
}

export function DraftEventCard({
  event,
  maps,
  selected,
  onSelect,
  onEdit,
}: DraftEventCardProps) {
  const venueName = event.venue_id
    ? (maps.venues.get(event.venue_id)?.name ?? 'Unknown venue')
    : 'No venue';
  const sourceName = event.source_id
    ? (maps.sources.get(event.source_id)?.name ?? 'Unknown source')
    : 'No source';
  const genres = event.genres ?? [];

  return (
    <article className={`${styles.card} ${selected ? styles.selected : ''}`}>
      <div className={styles.selectRow}>
        <input
          type="checkbox"
          className={styles.checkbox}
          checked={selected}
          onChange={(e) => onSelect(event.id, e.target.checked)}
          aria-label={`Select ${event.title}`}
        />
        <StatusBadge status={event.status} />
      </div>

      <div className={styles.body}>
        <div className={styles.imageWrap}>
          {event.image_url ? (
            <img
              src={event.image_url}
              alt=""
              className={styles.image}
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className={styles.imagePlaceholder}>No image</div>
          )}
        </div>

        <div className={styles.content}>
          <h3 className={styles.title}>{event.title}</h3>
          <p className={styles.venue}>{venueName}</p>

          <div className={styles.meta}>
            <span>{formatDate(event.event_date)}</span>
            <span className={styles.dot}>·</span>
            <span>{formatTime(event.start_time)}</span>
            {event.price != null && event.price !== '' && (
              <>
                <span className={styles.dot}>·</span>
                <span>{formatPrice(event.price)}</span>
              </>
            )}
          </div>

          {genres.length > 0 && (
            <div className={styles.genres}>
              {genres.map((g) => (
                <span key={g} className={styles.genreChip}>
                  {g}
                </span>
              ))}
            </div>
          )}

          <p className={styles.source}>Source: {sourceName}</p>

          <div className={styles.links}>
            {event.external_url && (
              <a
                href={event.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.linkBtn}
              >
                External
              </a>
            )}
            {event.ticket_url && (
              <a
                href={event.ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.linkBtn}
              >
                Tickets
              </a>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        className={styles.editBtn}
        onClick={() => onEdit(event)}
      >
        Edit & review
      </button>
    </article>
  );
}
