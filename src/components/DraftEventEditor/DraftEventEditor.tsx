import { useEffect, useState } from 'react';
import type {
  DraftEvent,
  DraftEventFormData,
  Venue,
} from '../../types/database';
import { formatPrice } from '../../utils/format';
import { GenreMultiSelect } from '../GenreMultiSelect/GenreMultiSelect';
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
  onSave: (data: DraftEventFormData) => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
  onPending: () => Promise<void>;
  onPublish: (data: DraftEventFormData) => Promise<void>;
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

  useEffect(() => {
    if (open) setForm(toFormData(event));
  }, [open, event]);

  if (!open) return null;

  const update = <K extends keyof DraftEventFormData>(
    key: K,
    value: DraftEventFormData[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    await onSave(form);
  };

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

        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>Title</span>
            <input
              className={styles.input}
              value={form.title}
              onChange={(e) => update('title', e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Venue</span>
            <select
              className={styles.input}
              value={form.venue_id ?? ''}
              onChange={(e) =>
                update('venue_id', e.target.value || null)
              }
            >
              <option value="">— Select venue —</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>

          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.label}>Event date</span>
              <input
                type="date"
                className={styles.input}
                value={form.event_date}
                onChange={(e) => update('event_date', e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Start time</span>
              <input
                type="time"
                className={styles.input}
                value={form.start_time}
                onChange={(e) => update('start_time', e.target.value)}
              />
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Price</span>
            <input
              className={styles.input}
              value={form.price}
              onChange={(e) => update('price', e.target.value)}
              placeholder="e.g. €15 / Free"
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Genres</span>
            <GenreMultiSelect
              value={form.genres}
              onChange={(genres) => update('genres', genres)}
            />
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Description</span>
            <textarea
              className={`${styles.input} ${styles.textarea}`}
              rows={4}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Image URL</span>
            <input
              className={styles.input}
              value={form.image_url}
              onChange={(e) => update('image_url', e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Ticket URL</span>
            <input
              className={styles.input}
              value={form.ticket_url}
              onChange={(e) => update('ticket_url', e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>External URL</span>
            <input
              className={styles.input}
              value={form.external_url}
              onChange={(e) => update('external_url', e.target.value)}
            />
          </label>
        </div>

        <footer className={styles.footer}>
          <div className={styles.primaryActions}>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => void handleSave()}
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
