import type { ReviewStatus } from '../../types/database';
import styles from './StatusBadge.module.css';

const LABELS: Record<ReviewStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  published: 'Published',
};

interface StatusBadgeProps {
  status: ReviewStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      {LABELS[status]}
    </span>
  );
}
