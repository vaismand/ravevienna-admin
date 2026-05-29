import { useState, type FormEvent } from 'react';
import styles from './RaEnrichModal.module.css';

export type RaEnrichFormData = {
  url: string;
  name: string;
  djId: string;
  apply: boolean;
};

interface RaEnrichModalProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onRun: (data: RaEnrichFormData) => void;
}

const emptyForm: RaEnrichFormData = {
  url: '',
  name: '',
  djId: '',
  apply: false,
};

export function RaEnrichModal({
  open,
  busy,
  onClose,
  onRun,
}: RaEnrichModalProps) {
  const [form, setForm] = useState<RaEnrichFormData>(emptyForm);

  if (!open) {
    return null;
  }

  const handleClose = () => {
    if (busy) return;
    setForm(emptyForm);
    onClose();
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onRun(form);
  };

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <form className={styles.dialog} onSubmit={handleSubmit}>
        <h3 className={styles.title}>Enrich DJ from Resident Advisor</h3>
        <p className={styles.hint}>
          Fetches one RA profile URL and updates a matching DJ. Leave apply
          unchecked for a dry run preview.
        </p>

        <label className={styles.field}>
          <span>RA profile URL</span>
          <input
            type="url"
            required
            value={form.url}
            disabled={busy}
            placeholder="https://de.ra.co/dj/artist-slug"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, url: event.target.value }))
            }
          />
        </label>

        <label className={styles.field}>
          <span>DJ name (optional match)</span>
          <input
            type="text"
            value={form.name}
            disabled={busy}
            placeholder="Artist name"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, name: event.target.value }))
            }
          />
        </label>

        <label className={styles.field}>
          <span>DJ ID (optional match)</span>
          <input
            type="text"
            value={form.djId}
            disabled={busy}
            placeholder="Supabase UUID"
            onChange={(event) =>
              setForm((prev) => ({ ...prev, djId: event.target.value }))
            }
          />
        </label>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={form.apply}
            disabled={busy}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, apply: event.target.checked }))
            }
          />
          Apply changes to Supabase
        </label>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            disabled={busy}
            onClick={handleClose}
          >
            Cancel
          </button>
          <button type="submit" className={styles.runBtn} disabled={busy}>
            {busy ? 'Running…' : form.apply ? 'Run & apply' : 'Run preview'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function buildRaEnrichArgs(data: RaEnrichFormData): string[] {
  const args = ['--url', data.url.trim()];

  if (data.name.trim()) {
    args.push('--name', data.name.trim());
  }

  if (data.djId.trim()) {
    args.push('--dj-id', data.djId.trim());
  }

  if (data.apply) {
    args.push('--apply');
  } else {
    args.push('--dry-run');
  }

  return args;
}
