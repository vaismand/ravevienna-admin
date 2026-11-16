import { formatDate, formatTime } from '../../utils/format';
import type { EventSubmission } from '../../types/database';
import { PromotedControl } from '../PromotedControl/PromotedControl';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import cardStyles from '../DraftEventCard/DraftEventCard.module.css';
import styles from './SubmissionCard.module.css';

interface SubmissionCardProps {
  submission: EventSubmission;
  selected: boolean;
  promoted: boolean;
  promoteDisabled: boolean;
  promoteBusy: boolean;
  promoteTitle?: string;
  onTogglePromoted: (checked: boolean) => void;
  onSelect: (id: string, checked: boolean) => void;
  onEdit: (submission: EventSubmission) => void;
}

export function SubmissionCard({
  submission,
  selected,
  promoted,
  promoteDisabled,
  promoteBusy,
  promoteTitle,
  onTogglePromoted,
  onSelect,
  onEdit,
}: SubmissionCardProps) {
  const genres = submission.genres ?? [];

  return (
    <article
      className={`${cardStyles.card} ${selected ? cardStyles.selected : ''}`}
    >
      <div className={cardStyles.selectRow}>
        <div className={cardStyles.selectLeft}>
          <input
            type="checkbox"
            className={cardStyles.checkbox}
            checked={selected}
            onChange={(e) => onSelect(submission.id, e.target.checked)}
            aria-label={`Select ${submission.title}`}
          />
          <PromotedControl
            compact
            checked={promoted}
            disabled={promoteDisabled}
            busy={promoteBusy}
            title={promoteTitle}
            ariaLabel={
              promoted
                ? `Remove promotion from ${submission.title}`
                : `Promote ${submission.title}`
            }
            onChange={onTogglePromoted}
          />
        </div>
        <div className={cardStyles.badges}>
          {promoted && (
            <span className={cardStyles.promotedBadge}>Promoted</span>
          )}
          <StatusBadge status={submission.status} />
        </div>
      </div>

      <div className={`${cardStyles.body} ${styles.body}`}>
        <div className={styles.iconWrap}>
          <span className={styles.userIcon}>👤</span>
          <span className={styles.userLabel}>User submit</span>
        </div>

        <div className={cardStyles.content}>
          <h3 className={cardStyles.title}>{submission.title}</h3>
          <p className={cardStyles.venue}>
            {submission.venue_name?.trim() || 'No venue'}
          </p>

          <div className={cardStyles.meta}>
            <span>{formatDate(submission.event_date)}</span>
            <span className={cardStyles.dot}>·</span>
            <span>{formatTime(submission.start_time)}</span>
          </div>

          {genres.length > 0 && (
            <div className={cardStyles.genres}>
              {genres.map((g) => (
                <span key={g} className={cardStyles.genreChip}>
                  {g}
                </span>
              ))}
            </div>
          )}

          {submission.contact && (
            <p className={styles.contact}>Contact: {submission.contact}</p>
          )}

          <div className={cardStyles.links}>
            {submission.event_url && (
              <a
                href={submission.event_url}
                target="_blank"
                rel="noopener noreferrer"
                className={cardStyles.linkBtn}
              >
                Event link
              </a>
            )}
          </div>
        </div>
      </div>

      <button
        type="button"
        className={cardStyles.editBtn}
        onClick={() => onEdit(submission)}
      >
        Edit & review
      </button>
    </article>
  );
}
