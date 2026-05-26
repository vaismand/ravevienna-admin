import { useEffect, useState } from 'react';
import type {
  EventSubmission,
  EventSubmissionFormData,
  Venue,
} from '../../types/database';
import { submissionToFormData } from '../../lib/submissionForm';
import { useEventDjSelection } from '../../hooks/useEventDjSelection';
import { SubmissionFormFields } from '../SubmissionFormFields/SubmissionFormFields';
import { EventDjSelect } from '../EventDjSelect/EventDjSelect';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import styles from '../DraftEventEditor/DraftEventEditor.module.css';

interface SubmissionEditorProps {
  submission: EventSubmission;
  venues: Venue[];
  submissionSourceId: string | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (data: EventSubmissionFormData, djIds: string[]) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onPending: () => Promise<void>;
  onPublish: (data: EventSubmissionFormData, djIds: string[]) => Promise<void>;
}

export function SubmissionEditor({
  submission,
  venues,
  submissionSourceId,
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
  const externalId = `submission-${submission.id}`;
  const {
    activeDjs,
    selectedDjIds,
    setSelectedDjIds,
    loading: djsLoading,
    hasPublishedEvent,
  } = useEventDjSelection(open, submissionSourceId, externalId);

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
          <EventDjSelect
            activeDjs={activeDjs}
            selectedDjIds={selectedDjIds}
            onChange={setSelectedDjIds}
            loading={djsLoading}
          />
          {!hasPublishedEvent && submissionSourceId && (
            <p className={styles.djNote}>
              DJ links are saved when you publish this submission to the events
              feed.
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.primaryActions}>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => void onSave(form, selectedDjIds)}
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
              onClick={() => void onPublish(form, selectedDjIds)}
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
