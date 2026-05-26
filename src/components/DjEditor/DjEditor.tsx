import { useState } from 'react';
import type { Dj, DjFormData } from '../../types/database';
import { EMPTY_DJ_FORM } from '../../lib/djForm';
import { djToFormData, slugFromName, validateDjForm } from '../../lib/djUtils';
import { DjFormFields } from '../DjFormFields/DjFormFields';
import styles from '../DraftEventEditor/DraftEventEditor.module.css';

interface DjEditorProps {
  dj: Dj | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (data: DjFormData) => Promise<void>;
}

export function DjEditor({ dj, open, busy, onClose, onSave }: DjEditorProps) {
  const [form, setForm] = useState<DjFormData>(() =>
    dj ? djToFormData(dj) : EMPTY_DJ_FORM,
  );
  const [slugTouched, setSlugTouched] = useState(() => Boolean(dj));
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async () => {
    const data = {
      ...form,
      slug: form.slug.trim() || slugFromName(form.name),
    };
    const err = validateDjForm(data);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError(null);
    await onSave(data);
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <header className={styles.header}>
          <h2 className={styles.heading}>{dj ? 'Edit DJ' : 'Add DJ'}</h2>
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
          <DjFormFields
            form={form}
            onChange={setForm}
            slugTouched={slugTouched}
            onSlugTouched={() => setSlugTouched(true)}
          />
          {validationError && (
            <p className={styles.validationError}>{validationError}</p>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.primaryActions}>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => void submit()}
              disabled={busy}
            >
              {dj ? 'Save changes' : 'Create DJ'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
