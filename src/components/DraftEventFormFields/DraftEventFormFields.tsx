import type { DraftEventFormData, EventSource, Venue } from '../../types/database';
import { GenreMultiSelect } from '../GenreMultiSelect/GenreMultiSelect';
import styles from './DraftEventFormFields.module.css';

interface DraftEventFormFieldsProps {
  form: DraftEventFormData;
  onChange: (form: DraftEventFormData) => void;
  venues: Venue[];
  sources?: EventSource[];
  sourceId?: string;
  onSourceChange?: (sourceId: string) => void;
}

export function DraftEventFormFields({
  form,
  onChange,
  venues,
  sources,
  sourceId,
  onSourceChange,
}: DraftEventFormFieldsProps) {
  const update = <K extends keyof DraftEventFormData>(
    key: K,
    value: DraftEventFormData[K],
  ) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <div className={styles.form}>
      {sources && onSourceChange && (
        <label className={styles.field}>
          <span className={styles.label}>Source</span>
          <select
            className={styles.input}
            value={sourceId ?? ''}
            onChange={(e) => onSourceChange(e.target.value)}
            required
          >
            <option value="">— Select source —</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <span className={styles.hint}>
            Use a &quot;Manual&quot; source if you have one, or any source for
            publishing.
          </span>
        </label>
      )}

      <label className={styles.field}>
        <span className={styles.label}>Title *</span>
        <input
          className={styles.input}
          value={form.title}
          onChange={(e) => update('title', e.target.value)}
          required
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Venue</span>
        <select
          className={styles.input}
          value={form.venue_id ?? ''}
          onChange={(e) => update('venue_id', e.target.value || null)}
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
          placeholder="e.g. 15 or Free"
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
          placeholder="https://…"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Ticket URL</span>
        <input
          className={styles.input}
          value={form.ticket_url}
          onChange={(e) => update('ticket_url', e.target.value)}
          placeholder="https://…"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>External URL</span>
        <input
          className={styles.input}
          value={form.external_url}
          onChange={(e) => update('external_url', e.target.value)}
          placeholder="https://…"
        />
      </label>
    </div>
  );
}
