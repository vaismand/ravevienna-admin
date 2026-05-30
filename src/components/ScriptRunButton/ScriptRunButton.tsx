import { LoadingSpinner } from '../LoadingSpinner/LoadingSpinner';
import styles from './ScriptRunButton.module.css';

interface ScriptRunButtonProps {
  label: string;
  runningLabel: string;
  running?: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}

export function ScriptRunButton({
  label,
  runningLabel,
  running = false,
  disabled = false,
  title,
  onClick,
}: ScriptRunButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${running ? styles.running : ''}`}
      disabled={running || disabled}
      title={title}
      onClick={onClick}
      aria-busy={running}
    >
      {running && <LoadingSpinner />}
      <span>{running ? runningLabel : label}</span>
    </button>
  );
}
