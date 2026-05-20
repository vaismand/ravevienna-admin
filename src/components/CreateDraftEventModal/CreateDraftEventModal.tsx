import { useEffect, useState } from 'react';
import type {
  DraftEventFormData,
  DraftEventStatus,
  EventSource,
  Venue,
} from '../../types/database';
import { EMPTY_DRAFT_FORM, validateDraftForm } from '../../lib/draftEventForm';
import { resolveManualSourceId } from '../../lib/draftEventActions';
import { DraftEventFormFields } from '../DraftEventFormFields/DraftEventFormFields';
import styles from './CreateDraftEventModal.module.css';

interface CreateDraftEventModalProps {
  open: boolean;
  busy: boolean;
  venues: Venue[];
  sources: EventSource[];
  onClose: () => void;
  onCreate: (
    data: DraftEventFormData,
    sourceId: string,
    status: DraftEventStatus,
  ) => Promise<void>;
}

export function CreateDraftEventModal({
  open,
  busy,
  venues,
  sources,
  onClose,
  onCreate,
}: CreateDraftEventModalProps) {
  const [form, setForm] = useState<DraftEventFormData>(EMPTY_DRAFT_FORM);
  const [sourceId, setSourceId] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_DRAFT_FORM);
      setSourceId(resolveManualSourceId(sources) ?? '');
      setValidationError(null);
    }
  }, [open, sources]);

  if (!open) return null;

  const submit = async (status: DraftEventStatus) => {
    const err = validateDraftForm(form, {
      requireSource: true,
      sourceId,
    });
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    await onCreate(form, sourceId, status);
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 className={styles.heading}>Add event manually</h2>
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

        <p className={styles.intro}>
          Creates a new draft in the review queue. You can approve and publish
          it like scraped events.
        </p>

        <div className={styles.body}>
          <DraftEventFormFields
            form={form}
            onChange={setForm}
            venues={venues}
            sources={sources}
            sourceId={sourceId}
            onSourceChange={setSourceId}
          />
        </div>

        {validationError && (
          <p className={styles.validationError}>{validationError}</p>
        )}

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={styles.pendingBtn}
            onClick={() => void submit('pending')}
            disabled={busy}
          >
            Create as pending
          </button>
          <button
            type="button"
            className={styles.approveBtn}
            onClick={() => void submit('approved')}
            disabled={busy}
          >
            Create & approve
          </button>
        </footer>
      </div>
    </div>
  );
}
