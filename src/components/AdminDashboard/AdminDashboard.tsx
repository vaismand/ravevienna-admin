import { useState } from 'react';
import { DraftEventsPage } from '../DraftEventsPage/DraftEventsPage';
import { DjsPage } from '../DjsPage/DjsPage';
import { SubmissionsPage } from '../SubmissionsPage/SubmissionsPage';
import styles from './AdminDashboard.module.css';

type MainSection = 'drafts' | 'submissions' | 'djs';

export function AdminDashboard() {
  const [section, setSection] = useState<MainSection>('drafts');

  return (
    <div className={styles.dashboard}>
      <nav className={styles.mainNav} aria-label="Review sections">
        <button
          type="button"
          className={`${styles.navBtn} ${section === 'drafts' ? styles.navActive : ''}`}
          onClick={() => setSection('drafts')}
        >
          Scraped drafts
        </button>
        <button
          type="button"
          className={`${styles.navBtn} ${section === 'submissions' ? styles.navActive : ''}`}
          onClick={() => setSection('submissions')}
        >
          User submissions
        </button>
        <button
          type="button"
          className={`${styles.navBtn} ${section === 'djs' ? styles.navActive : ''}`}
          onClick={() => setSection('djs')}
        >
          DJs
        </button>
      </nav>

      {section === 'drafts' && <DraftEventsPage />}
      {section === 'submissions' && <SubmissionsPage />}
      {section === 'djs' && <DjsPage />}
    </div>
  );
}
