import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import styles from './AdminLayout.module.css';

interface AdminLayoutProps {
  children: ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const { signOut, user } = useAuth();

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.kicker}>RaveVienna</span>
          <h1 className={styles.title}>Event Review</h1>
        </div>
        <div className={styles.userArea}>
          <span className={styles.email}>{user?.email}</span>
          <button
            type="button"
            className={styles.signOutBtn}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
