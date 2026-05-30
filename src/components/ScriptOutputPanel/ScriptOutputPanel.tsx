import styles from './ScriptOutputPanel.module.css';

interface ScriptOutputPanelProps {
  title: string;
  output: string;
  status: 'running' | 'completed' | 'failed' | null;
  onClose?: () => void;
}

export function ScriptOutputPanel({
  title,
  output,
  status,
  onClose,
}: ScriptOutputPanelProps) {
  if (!output && !status) {
    return null;
  }

  return (
    <section
      className={`${styles.panel} ${status === 'running' ? styles.panelRunning : ''}`}
      aria-live="polite"
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h3 className={styles.title}>{title}</h3>
          {status && (
            <span className={`${styles.badge} ${styles[status]}`}>
              {status === 'running'
                ? 'Running…'
                : status === 'completed'
                  ? 'Completed'
                  : 'Failed'}
            </span>
          )}
        </div>
        {onClose && status !== 'running' && (
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            Dismiss
          </button>
        )}
      </div>
      <pre className={styles.output}>{output || 'Waiting for output…'}</pre>
    </section>
  );
}
