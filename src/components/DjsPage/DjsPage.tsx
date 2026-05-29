import { useMemo, useState } from 'react';
import {
  createDj,
  deleteDj,
  toggleDjActive,
  updateDj,
} from '../../lib/djActions';
import { matchesDjSearch } from '../../lib/djUtils';
import { useDjs } from '../../hooks/useDjs';
import { useNotification } from '../../context/NotificationContext';
import { useScriptRunner } from '../../hooks/useScriptRunner';
import { formatPostgrestError } from '../../lib/supabaseErrors';
import type { Dj, DjFilters, DjFormData } from '../../types/database';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { DjCard } from '../DjCard/DjCard';
import { DjEditor } from '../DjEditor/DjEditor';
import { DjFiltersBar } from '../DjFiltersBar/DjFiltersBar';
import {
  buildRaEnrichArgs,
  RaEnrichModal,
  type RaEnrichFormData,
} from '../RaEnrichModal/RaEnrichModal';
import { ScriptOutputPanel } from '../ScriptOutputPanel/ScriptOutputPanel';
import { ScriptRunnerHint } from '../ScriptRunnerHint/ScriptRunnerHint';
import styles from './DjsPage.module.css';

const defaultFilters: DjFilters = { search: '', active: 'all' };

type ConfirmAction = 'enrichSpotify' | null;

export function DjsPage() {
  const { djs, loading, error, reload } = useDjs();
  const { notify } = useNotification();
  const [filters, setFilters] = useState<DjFilters>(defaultFilters);
  const [editingDj, setEditingDj] = useState<Dj | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Dj | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [raModalOpen, setRaModalOpen] = useState(false);

  const {
    configured: scriptApiConfigured,
    missingEnv: scriptMissingEnv,
    apiError: scriptApiError,
    running: scriptRunning,
    job: scriptJob,
    runScript,
    clearJob,
  } = useScriptRunner();

  const filteredDjs = useMemo(() => {
    return djs.filter((dj) => {
      if (filters.active === 'active' && !dj.is_active) return false;
      if (filters.active === 'inactive' && dj.is_active) return false;
      if (!matchesDjSearch(dj, filters.search)) return false;
      return true;
    });
  }, [djs, filters]);

  const runWithBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      notify(formatPostgrestError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (data: DjFormData) => {
    await runWithBusy(async () => {
      if (editingDj) {
        await updateDj(editingDj.id, data);
        notify('DJ updated.', 'success');
        setEditingDj(null);
      } else {
        await createDj(data);
        notify('DJ created.', 'success');
        setCreateOpen(false);
      }
      await reload();
    });
  };

  const handleToggleActive = async (dj: Dj) => {
    await runWithBusy(async () => {
      await toggleDjActive(dj.id, !dj.is_active);
      notify(
        dj.is_active ? 'DJ deactivated.' : 'DJ activated.',
        'success',
      );
      await reload();
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await runWithBusy(async () => {
      await deleteDj(deleteTarget.id);
      notify('DJ deleted.', 'success');
      setDeleteTarget(null);
      await reload();
    });
  };

  const handleScriptFinished = async (
    label: string,
    finished: Awaited<ReturnType<typeof runScript>>,
  ) => {
    if (finished.status === 'completed') {
      notify(`${label} finished. Refreshing DJs…`, 'success');
      await reload();
    } else {
      notify(`${label} finished with errors. See output below.`, 'error');
    }
  };

  const executeEnrichSpotify = async () => {
    setConfirmAction(null);
    try {
      const finished = await runScript('enrich-spotify');
      await handleScriptFinished('Spotify enrichment', finished);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'Spotify enrichment failed to start.',
        'error',
      );
    }
  };

  const handleRaEnrich = async (data: RaEnrichFormData) => {
    try {
      const finished = await runScript('enrich-ra', buildRaEnrichArgs(data));
      setRaModalOpen(false);
      await handleScriptFinished('RA enrichment', finished);
    } catch (err) {
      notify(
        err instanceof Error ? err.message : 'RA enrichment failed to start.',
        'error',
      );
    }
  };

  const scriptPanelTitle =
    scriptJob?.scriptId === 'enrich-spotify'
      ? 'Spotify DJ enrichment'
      : scriptJob?.scriptId === 'enrich-ra'
        ? 'RA DJ enrichment'
        : 'Admin script';

  return (
    <div className={styles.page}>
      <p className={styles.sectionHint}>
        Manage DJs for the mobile app. Deleting a DJ removes event links via
        database cascade; events are not deleted.
      </p>

      <div className={styles.toolbar}>
        <DjFiltersBar filters={filters} onChange={setFilters} />
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.scriptBtn}
            disabled={scriptRunning || scriptApiConfigured === false}
            title={
              scriptApiConfigured === false
                ? 'Configure .env.scripts and restart npm run dev'
                : undefined
            }
            onClick={() => setConfirmAction('enrichSpotify')}
          >
            {scriptRunning && scriptJob?.scriptId === 'enrich-spotify'
              ? 'Spotify running…'
              : 'Enrich from Spotify'}
          </button>
          <button
            type="button"
            className={styles.scriptBtn}
            disabled={scriptRunning || scriptApiConfigured === false}
            onClick={() => setRaModalOpen(true)}
          >
            {scriptRunning && scriptJob?.scriptId === 'enrich-ra'
              ? 'RA running…'
              : 'Enrich from RA'}
          </button>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setCreateOpen(true)}
          >
            + Add DJ
          </button>
        </div>
      </div>

      <ScriptRunnerHint
        configured={scriptApiConfigured}
        missingEnv={scriptMissingEnv}
        apiError={scriptApiError}
      />

      {scriptJob && (
        <ScriptOutputPanel
          title={scriptPanelTitle}
          output={scriptJob.output}
          status={scriptJob.status}
          onClose={clearJob}
        />
      )}

      {error && <p className={styles.error}>{error}</p>}
      {loading && <p className={styles.loading}>Loading DJs…</p>}

      {!loading && !error && filteredDjs.length === 0 && (
        <p className={styles.empty}>
          {djs.length === 0
            ? 'No DJs yet. Add your first DJ.'
            : 'No DJs match the current filters.'}
        </p>
      )}

      <div className={styles.grid}>
        {filteredDjs.map((dj) => (
          <DjCard
            key={dj.id}
            dj={dj}
            onEdit={setEditingDj}
            onToggleActive={handleToggleActive}
            onDelete={setDeleteTarget}
          />
        ))}
      </div>

      <DjEditor
        key={editingDj ? `edit-${editingDj.id}` : 'edit-closed'}
        dj={editingDj}
        open={Boolean(editingDj)}
        busy={busy}
        onClose={() => setEditingDj(null)}
        onSave={handleSave}
      />

      <DjEditor
        key={createOpen ? 'create-open' : 'create-closed'}
        dj={null}
        open={createOpen}
        busy={busy}
        onClose={() => setCreateOpen(false)}
        onSave={handleSave}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete DJ"
        message="Delete this DJ? This will remove DJ links from events, but it will not delete events."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={confirmAction === 'enrichSpotify'}
        title="Run Spotify enrichment?"
        message="Match DJs against Spotify and update profiles where confidence is high enough. This writes to Supabase for matched DJs."
        confirmLabel="Run enrichment"
        onConfirm={() => void executeEnrichSpotify()}
        onCancel={() => setConfirmAction(null)}
      />

      <RaEnrichModal
        open={raModalOpen}
        busy={scriptRunning}
        onClose={() => setRaModalOpen(false)}
        onRun={(data) => void handleRaEnrich(data)}
      />
    </div>
  );
}
