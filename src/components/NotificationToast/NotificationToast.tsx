import { useNotification } from '../../context/NotificationContext';
import styles from './NotificationToast.module.css';

export function NotificationToast() {
  const { notifications, dismiss } = useNotification();

  if (notifications.length === 0) return null;

  return (
    <div className={styles.container} aria-live="polite">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`${styles.toast} ${styles[n.type]}`}
          role="alert"
        >
          <span>{n.message}</span>
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
