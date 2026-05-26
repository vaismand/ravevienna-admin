import type { DjFormData } from '../../types/database';
import { slugFromName } from '../../lib/djUtils';
import { GenreMultiSelect } from '../GenreMultiSelect/GenreMultiSelect';
import styles from '../DraftEventFormFields/DraftEventFormFields.module.css';

interface DjFormFieldsProps {
  form: DjFormData;
  onChange: (form: DjFormData) => void;
  slugTouched: boolean;
  onSlugTouched: () => void;
}

export function DjFormFields({
  form,
  onChange,
  slugTouched,
  onSlugTouched,
}: DjFormFieldsProps) {
  const update = <K extends keyof DjFormData>(
    key: K,
    value: DjFormData[K],
  ) => {
    onChange({ ...form, [key]: value });
  };

  const onNameChange = (name: string) => {
    const next = { ...form, name };
    if (!slugTouched && !form.slug.trim()) {
      next.slug = slugFromName(name);
    }
    onChange(next);
  };

  return (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.label}>Name *</span>
        <input
          className={styles.input}
          value={form.name}
          onChange={(e) => onNameChange(e.target.value)}
          required
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Slug *</span>
        <input
          className={styles.input}
          value={form.slug}
          onChange={(e) => {
            onSlugTouched();
            update('slug', e.target.value);
          }}
          placeholder="dj-name"
          required
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Bio</span>
        <textarea
          className={`${styles.input} ${styles.textarea}`}
          rows={4}
          value={form.bio}
          onChange={(e) => update('bio', e.target.value)}
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
        <span className={styles.label}>Instagram URL</span>
        <input
          className={styles.input}
          value={form.instagram_url}
          onChange={(e) => update('instagram_url', e.target.value)}
          placeholder="https://instagram.com/…"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>SoundCloud URL</span>
        <input
          className={styles.input}
          value={form.soundcloud_url}
          onChange={(e) => update('soundcloud_url', e.target.value)}
          placeholder="https://soundcloud.com/…"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Spotify URL</span>
        <input
          className={styles.input}
          value={form.spotify_url}
          onChange={(e) => update('spotify_url', e.target.value)}
          placeholder="https://open.spotify.com/…"
        />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>Website URL</span>
        <input
          className={styles.input}
          value={form.website_url}
          onChange={(e) => update('website_url', e.target.value)}
          placeholder="https://…"
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

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>City</span>
          <input
            className={styles.input}
            value={form.city}
            onChange={(e) => update('city', e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Country</span>
          <input
            className={styles.input}
            value={form.country}
            onChange={(e) => update('country', e.target.value)}
          />
        </label>
      </div>

      <label className={styles.toggleRow}>
        <input
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => update('is_active', e.target.checked)}
        />
        <span>Active (visible in app lineup picker)</span>
      </label>
    </div>
  );
}
