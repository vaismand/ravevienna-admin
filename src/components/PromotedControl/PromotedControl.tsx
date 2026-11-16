import styles from './PromotedControl.module.css';

interface PromotedControlProps {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  compact?: boolean;
  hint?: string;
  title?: string;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
}

export function PromotedControl({
  checked,
  disabled = false,
  busy = false,
  compact = false,
  hint,
  title,
  ariaLabel,
  onChange,
}: PromotedControlProps) {
  return (
    <div className={styles.wrap}>
      <label
        className={`${styles.toggle} ${compact ? styles.compact : ''}`}
        title={title}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || busy}
          aria-label={ariaLabel}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>Promoted</span>
      </label>
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </div>
  );
}
