import styles from './ConfirmDialog.module.css';
import { LoadingSpinner } from '../LoadingSpinner/LoadingSpinner';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.dialog}>
        <h3 className={styles.title}>{title}</h3>
        <p className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={
              variant === 'danger' ? styles.dangerBtn : styles.confirmBtn
            }
            onClick={onConfirm}
            disabled={busy}
          >
            {busy && <LoadingSpinner className={styles.btnSpinner} />}
            {busy ? 'Running…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
