import styles from './LoadingSpinner.module.css';

interface LoadingSpinnerProps {
  className?: string;
  label?: string;
}

export function LoadingSpinner({ className, label }: LoadingSpinnerProps) {
  return (
    <span
      className={`${styles.spinner} ${className ?? ''}`}
      role="status"
      aria-label={label ?? 'Loading'}
    />
  );
}
