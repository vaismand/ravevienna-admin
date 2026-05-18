import type { DraftEventStatus } from '../../types/database';
import styles from './StatusBadge.module.css';

const LABELS: Record<DraftEventStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  published: 'Published',
};

interface StatusBadgeProps {
  status: DraftEventStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      {LABELS[status]}
    </span>
  );
}
