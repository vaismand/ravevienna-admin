import type { EventSubmissionFormData, Venue } from '../../types/database';
import { GenreMultiSelect } from '../GenreMultiSelect/GenreMultiSelect';
import styles from './SubmissionFormFields.module.css';

interface SubmissionFormFieldsProps {
  form: EventSubmissionFormData;
  onChange: (form: EventSubmissionFormData) => void;
  venues: Venue[];
}

export function SubmissionFormFields({
  form,
  onChange,
  venues,
}: SubmissionFormFieldsProps) {
  const update = <K extends keyof EventSubmissionFormData>(
    key: K,
    value: EventSubmissionFormData[K],
  ) => {
    onChange({ ...form, [key]: value });
  };

  return (
    <div className={styles.form}>
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
        <span className={styles.label}>Venue name</span>
        <input
          className={styles.input}
          list="venue-suggestions"
          value={form.venue_name}
          onChange={(e) => update('venue_name', e.target.value)}
          placeholder="Type or pick a venue"
        />
        <datalist id="venue-suggestions">
          {venues.map((v) => (
            <option key={v.id} value={v.name} />
          ))}
        </datalist>
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

      <div className={styles.field}>
        <span className={styles.label}>Genres</span>
        <GenreMultiSelect
          value={form.genres}
          onChange={(genres) => update('genres', genres)}
        />
      </div>

      <label className={styles.field}>
        <span className={styles.label}>Event URL</span>
        <input
          className={styles.input}
          value={form.event_url}
          onChange={(e) => update('event_url', e.target.value)}
          placeholder="https://…"
        />
      </label>

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
        <span className={styles.label}>Lineup</span>
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          rows={4}
          value={form.lineup}
          onChange={(e) => update('lineup', e.target.value)}
          placeholder={
            'Heimlich Maneuver\nCoop Audio Crew\nJustus Kaya'
          }
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Contact</span>
        <input
          className={styles.input}
          value={form.contact}
          onChange={(e) => update('contact', e.target.value)}
          placeholder="Email or social handle"
        />
      </label>
    </div>
  );
}
