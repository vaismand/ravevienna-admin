import { djInitials } from '../../lib/djUtils';
import { formatDate } from '../../utils/format';
import type { Dj } from '../../types/database';
import styles from './DjCard.module.css';

interface DjCardProps {
  dj: Dj;
  onEdit: (dj: Dj) => void;
  onToggleActive: (dj: Dj) => void;
  onDelete: (dj: Dj) => void;
}

export function DjCard({ dj, onEdit, onToggleActive, onDelete }: DjCardProps) {
  const genres = dj.genres ?? [];
  const links = [
    dj.instagram_url && 'IG',
    dj.soundcloud_url && 'SC',
    dj.spotify_url && 'SP',
    dj.website_url && 'Web',
  ].filter(Boolean);

  return (
    <article className={styles.card}>
      <div className={styles.topRow}>
        <div className={styles.avatarWrap}>
          {dj.image_url ? (
            <img
              src={dj.image_url}
              alt=""
              className={styles.avatar}
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className={styles.avatarFallback}>{djInitials(dj.name)}</div>
          )}
        </div>
        <div className={styles.headline}>
          <h3 className={styles.name}>{dj.name}</h3>
          <p className={styles.slug}>/{dj.slug}</p>
        </div>
        <span
          className={`${styles.status} ${dj.is_active ? styles.active : styles.inactive}`}
        >
          {dj.is_active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className={styles.meta}>
        <span>
          {[dj.city, dj.country].filter(Boolean).join(', ') || '—'}
        </span>
        {dj.updated_at && (
          <>
            <span className={styles.dot}>·</span>
            <span>Updated {formatDate(dj.updated_at)}</span>
          </>
        )}
        {!dj.updated_at && dj.created_at && (
          <>
            <span className={styles.dot}>·</span>
            <span>Created {formatDate(dj.created_at)}</span>
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

      {links.length > 0 && (
        <div className={styles.links}>
          {links.map((label) => (
            <span key={label} className={styles.linkChip}>
              {label}
            </span>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <button type="button" className={styles.editBtn} onClick={() => onEdit(dj)}>
          Edit
        </button>
        <button
          type="button"
          className={styles.toggleBtn}
          onClick={() => onToggleActive(dj)}
        >
          {dj.is_active ? 'Deactivate' : 'Activate'}
        </button>
        <button
          type="button"
          className={styles.deleteBtn}
          onClick={() => onDelete(dj)}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
