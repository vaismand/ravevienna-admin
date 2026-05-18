import { useAuth } from '../../context/AuthContext';
import styles from './AccessDenied.module.css';

export function AccessDenied() {
  const { signOut, user, profile, authError, refreshProfile } = useAuth();

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>Access denied</h1>
        <p className={styles.message}>
          Your account{user?.email ? ` (${user.email})` : ''} does not have
          admin access. Contact an administrator to update your profile role.
        </p>

        {authError && (
          <p className={styles.detail}>
            <strong>Details:</strong> {authError}
          </p>
        )}

        {profile && (
          <p className={styles.detail}>
            Profile role: <code>{profile.role}</code>
          </p>
        )}

        {!profile && user && (
          <p className={styles.detail}>
            Auth user ID: <code>{user.id}</code>
          </p>
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={() => void refreshProfile()}
          >
            Retry
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
