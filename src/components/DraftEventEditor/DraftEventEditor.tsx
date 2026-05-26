import { useEffect, useState } from 'react';
import type {
  DraftEvent,
  DraftEventFormData,
  Venue,
} from '../../types/database';
import { formatLineupArray } from '../../lib/lineup';
import { formatPrice } from '../../utils/format';
import { useEventDjSelection } from '../../hooks/useEventDjSelection';
import { DraftEventFormFields } from '../DraftEventFormFields/DraftEventFormFields';
import { EventDjSelect } from '../EventDjSelect/EventDjSelect';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import styles from './DraftEventEditor.module.css';

function toFormData(event: DraftEvent): DraftEventFormData {
  return {
    title: event.title ?? '',
    venue_id: event.venue_id,
    event_date: event.event_date?.slice(0, 10) ?? '',
    start_time: event.start_time?.slice(0, 5) ?? '',
    price: formatPrice(event.price).replace(/^€/, '') || '',
    genres: event.genres ?? [],
    description: event.description ?? '',
    lineup: formatLineupArray(event.lineup),
    image_url: event.image_url ?? '',
    ticket_url: event.ticket_url ?? '',
    external_url: event.external_url ?? '',
  };
}

interface DraftEventEditorProps {
  event: DraftEvent;
  venues: Venue[];
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (data: DraftEventFormData, djIds: string[]) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onPending: () => Promise<void>;
  onPublish: (data: DraftEventFormData, djIds: string[]) => Promise<void>;
}

export function DraftEventEditor({
  event,
  venues,
  open,
  busy,
  onClose,
  onSave,
  onApprove,
  onReject,
  onPending,
  onPublish,
}: DraftEventEditorProps) {
  const [form, setForm] = useState<DraftEventFormData>(() => toFormData(event));
  const {
    activeDjs,
    selectedDjIds,
    setSelectedDjIds,
    loading: djsLoading,
    hasPublishedEvent,
  } = useEventDjSelection(open, event.source_id, event.external_id);

  useEffect(() => {
    if (open) setForm(toFormData(event));
  }, [open, event]);

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.heading}>Edit draft event</h2>
            <StatusBadge status={event.status} />
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
          <DraftEventFormFields
            form={form}
            onChange={setForm}
            venues={venues}
          />
          <EventDjSelect
            activeDjs={activeDjs}
            selectedDjIds={selectedDjIds}
            onChange={setSelectedDjIds}
            loading={djsLoading}
          />
          {!hasPublishedEvent && event.source_id && event.external_id && (
            <p className={styles.djNote}>
              DJ links are stored when you publish (or after the event exists in
              the feed). Selection is kept when you publish from this dialog.
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
