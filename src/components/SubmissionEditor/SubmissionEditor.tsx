import { useEffect, useState } from 'react';
import type {
  EventSubmission,
  EventSubmissionFormData,
  Venue,
} from '../../types/database';
import { submissionToFormData } from '../../lib/submissionForm';
import { SubmissionFormFields } from '../SubmissionFormFields/SubmissionFormFields';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import styles from '../DraftEventEditor/DraftEventEditor.module.css';

interface SubmissionEditorProps {
  submission: EventSubmission;
  venues: Venue[];
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (data: EventSubmissionFormData) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onPending: () => Promise<void>;
  onPublish: (data: EventSubmissionFormData) => Promise<void>;
}

export function SubmissionEditor({
  submission,
  venues,
  open,
  busy,
  onClose,
  onSave,
  onApprove,
  onReject,
  onPending,
  onPublish,
}: SubmissionEditorProps) {
  const [form, setForm] = useState<EventSubmissionFormData>(() =>
    submissionToFormData(submission),
  );

  useEffect(() => {
    if (open) setForm(submissionToFormData(submission));
  }, [open, submission]);

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.heading}>Review user submission</h2>
            <StatusBadge status={submission.status} />
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className={styles.formScroll}>
          <SubmissionFormFields form={form} onChange={setForm} venues={venues} />
        </div>

        <footer className={styles.footer}>
          <div className={styles.primaryActions}>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => void onSave(form)}
              disabled={busy}
            >
              Save changes
            </button>
          </div>
          <div className={styles.statusActions}>
            <button
              type="button"
              className={styles.approveBtn}
              onClick={() => void onApprove()}
              disabled={busy}
            >
              Approve
            </button>
            <button
              type="button"
              className={styles.rejectBtn}
              onClick={() => void onReject()}
              disabled={busy}
            >
              Reject
            </button>
            <button
              type="button"
              className={styles.pendingBtn}
              onClick={() => void onPending()}
              disabled={busy}
            >
              Mark pending
            </button>
            <button
              type="button"
              className={styles.publishBtn}
              onClick={() => void onPublish(form)}
              disabled={busy}
            >
              Publish
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
