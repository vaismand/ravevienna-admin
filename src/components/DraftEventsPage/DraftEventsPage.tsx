import { useMemo, useState } from 'react';
import { STATUS_TABS } from '../../lib/constants';
import {
  bulkDeleteDraftEvents,
  bulkPublish,
  bulkUpdateStatus,
  createDraftEvent,
  formDataToUpdatePayload,
  publishDraftEvent,
  saveDraftEvent,
  updateDraftStatus,
} from '../../lib/draftEventActions';
import { useNotification } from '../../context/NotificationContext';
import { useDraftEvents } from '../../hooks/useDraftEvents';
import { useReferenceData } from '../../hooks/useReferenceData';
import { useScriptRunner } from '../../hooks/useScriptRunner';
import { syncEventDjsForDraft, updateEventDjs } from '../../lib/eventDjActions';
import {
  formatDraftApproveMessage,
  formatDraftPublishMessage,
} from '../../lib/draftApproveMessages';
import { parseLineupText } from '../../lib/lineup';
import { formatPostgrestError } from '../../lib/supabaseErrors';
import { matchesSearch } from '../../utils/format';
import type {
  DraftEvent,
  DraftEventFilters,
  DraftEventFormData,
  ReviewStatus,
} from '../../types/database';
import { CreateDraftEventModal } from '../CreateDraftEventModal/CreateDraftEventModal';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { DraftEventCard } from '../DraftEventCard/DraftEventCard';
import { DraftEventEditor } from '../DraftEventEditor/DraftEventEditor';
import { FiltersBar } from '../FiltersBar/FiltersBar';
import { ScriptOutputPanel } from '../ScriptOutputPanel/ScriptOutputPanel';
import { ScriptRunButton } from '../ScriptRunButton/ScriptRunButton';
import { ScriptRunnerHint } from '../ScriptRunnerHint/ScriptRunnerHint';
import styles from './DraftEventsPage.module.css';

type ConfirmAction =
  | 'bulkApprove'
  | 'bulkReject'
  | 'bulkDelete'
  | 'bulkPublish'
  | 'runScraper'
  | null;

const defaultFilters = (status: ReviewStatus): DraftEventFilters => ({
  status,
  venueId: '',
  genre: '',
  sourceId: '',
  search: '',
});

export function DraftEventsPage() {
  const [activeTab, setActiveTab] = useState<ReviewStatus>('pending');
  const [filters, setFilters] = useState<DraftEventFilters>(() =>
    defaultFilters('pending'),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingEvent, setEditingEvent] = useState<DraftEvent | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const { notify } = useNotification();
  const { events, loading, error, rlsBlocked, totalInDb, reload } =
    useDraftEvents(activeTab);
  const { venues, sources, maps, loading: refLoading, warning: refWarning } =
    useReferenceData();
  const {
    configured: scriptApiConfigured,
    missingEnv: scriptMissingEnv,
    apiError: scriptApiError,
    running: scriptRunning,
    job: scriptJob,
    runScript,
    clearJob,
  } = useScriptRunner();

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (filters.venueId && event.venue_id !== filters.venueId) return false;
      if (filters.sourceId && event.source_id !== filters.sourceId)
        return false;
      if (filters.genre && !(event.genres ?? []).includes(filters.genre))
        return false;
      if (!matchesSearch(event, filters.search)) return false;
      return true;
    });
  }, [events, filters]);

  const selectedEvents = useMemo(
    () => filteredEvents.filter((e) => selectedIds.has(e.id)),
    [filteredEvents, selectedIds],
  );

  const publishableSelectedEvents = useMemo(
    () =>
      selectedEvents.filter(
        (e) => e.status === 'approved' || e.status === 'published',
      ),
    [selectedEvents],
  );

  const switchTab = (status: ReviewStatus) => {
    setActiveTab(status);
    setFilters(defaultFilters(status));
    setSelectedIds(new Set());
    setEditingEvent(null);
  };

  const toggleSelect = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(filteredEvents.map((e) => e.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const refreshAfterAction = async () => {
    await reload();
    setSelectedIds(new Set());
    if (editingEvent) {
      setEditingEvent(null);
    }
  };

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

  const handleCreate = async (
    data: DraftEventFormData,
    sourceId: string,
    status: ReviewStatus,
  ) => {
    await runWithBusy(async () => {
      const { djs } = await createDraftEvent(data, sourceId, status);
      notify(
        status === 'approved'
          ? formatDraftApproveMessage(1, djs)
          : 'Event created as pending.',
        'success',
      );
      setCreateOpen(false);
      if (activeTab !== status) {
        switchTab(status);
      } else {
        await reload();
      }
    });
  };

  const handleSave = async (data: DraftEventFormData, djIds: string[]) => {
    if (!editingEvent) return;
    await runWithBusy(async () => {
      await saveDraftEvent(editingEvent.id, data);
      const merged: DraftEvent = {
        ...editingEvent,
        ...formDataToUpdatePayload(data),
      };
      await syncEventDjsForDraft(
        merged.source_id,
        merged.external_id,
        djIds,
      );
      setEditingEvent(merged);
      notify('Draft event saved.', 'success');
      await reload();
    });
  };

  const handleStatusChange = async (
    status: ReviewStatus,
    formData?: DraftEventFormData,
  ) => {
    if (!editingEvent) return;
    await runWithBusy(async () => {
      let djs = null;
      if (status === 'approved' && formData) {
        await saveDraftEvent(editingEvent.id, formData);
        djs = await updateDraftStatus(editingEvent.id, status, {
          lineup: parseLineupText(formData.lineup),
          eventGenres: formData.genres,
        });
      } else {
        djs = await updateDraftStatus(editingEvent.id, status);
      }

      if (status === 'approved') {
        notify(formatDraftApproveMessage(1, djs), 'success');
      } else {
        notify(`Marked as ${status}.`, 'success');
      }
      await refreshAfterAction();
    });
  };

  const handlePublish = async (data: DraftEventFormData, djIds: string[]) => {
    if (!editingEvent) return;
    await runWithBusy(async () => {
      await saveDraftEvent(editingEvent.id, data);
      const merged: DraftEvent = {
        ...editingEvent,
        ...formDataToUpdatePayload(data),
      };
      const { eventId, djs } = await publishDraftEvent(merged);
      await updateEventDjs(eventId, djIds);
      notify(formatDraftPublishMessage(1, djs), 'success');
      await refreshAfterAction();
    });
  };

  const executeBulkApprove = async () => {
    const ids = [...selectedIds];
    await runWithBusy(async () => {
      const djs = await bulkUpdateStatus(ids, 'approved');
      notify(formatDraftApproveMessage(ids.length, djs), 'success');
      await refreshAfterAction();
    });
    setConfirmAction(null);
  };

  const executeBulkReject = async () => {
    const ids = [...selectedIds];
    await runWithBusy(async () => {
      await bulkUpdateStatus(ids, 'rejected');
      notify(
        `Rejected ${ids.length} event(s). They will not reappear as pending.`,
        'success',
      );
      await refreshAfterAction();
    });
    setConfirmAction(null);
  };

  const executeBulkDelete = async () => {
    const ids = [...selectedIds];
    await runWithBusy(async () => {
      await bulkDeleteDraftEvents(ids);
      notify(
        `Deleted ${ids.length} draft event(s) from the database. The scraper can add them again on the next run.`,
        'success',
      );
      await refreshAfterAction();
    });
    setConfirmAction(null);
  };

  const executeBulkPublish = async () => {
    const toPublish = publishableSelectedEvents;
    if (toPublish.length === 0) {
      notify('Select approved or published events to publish.', 'error');
      setConfirmAction(null);
      return;
    }

    await runWithBusy(async () => {
      const { succeeded, failed, djs } = await bulkPublish(toPublish);
      if (succeeded > 0) {
        notify(formatDraftPublishMessage(succeeded, djs), 'success');
      }
      if (failed.length > 0) {
        notify(`Some publishes failed:\n${failed.slice(0, 3).join('\n')}`, 'error');
      }
      await refreshAfterAction();
    });
    setConfirmAction(null);
  };

  const executeRunScraper = async () => {
    try {
      const finished = await runScript('scrape');
      setConfirmAction(null);
      if (finished.status === 'completed') {
        notify('Scraper finished. Refreshing draft events…', 'success');
        await reload();
      } else {
        notify('Scraper finished with errors. See output below.', 'error');
      }
    } catch (err) {
      setConfirmAction(null);
      notify(
        err instanceof Error ? err.message : 'Scraper failed to start.',
        'error',
      );
    }
  };

  const confirmConfig = {
    bulkApprove: {
      title: 'Approve selected events?',
      message: `Approve ${selectedIds.size} draft event(s)?`,
      confirmLabel: 'Approve all',
      variant: 'default' as const,
      onConfirm: () => void executeBulkApprove(),
    },
    bulkReject: {
      title: 'Reject selected events?',
      message: `Reject ${selectedIds.size} draft event(s)? Rejected events stay in the database and will not return as pending when the scraper uses ignoreDuplicates.`,
      confirmLabel: 'Reject all',
      variant: 'danger' as const,
      onConfirm: () => void executeBulkReject(),
    },
    bulkDelete: {
      title: 'Delete selected events?',
      message: `Permanently delete ${selectedIds.size} draft event(s) from draft_events? This cannot be undone. The scraper can insert them again on the next run.`,
      confirmLabel: 'Delete permanently',
      variant: 'danger' as const,
      onConfirm: () => void executeBulkDelete(),
    },
    bulkPublish: {
      title: 'Publish selected events?',
      message: `Publish ${publishableSelectedEvents.length} event(s) to the mobile feed? Already published events will be updated.`,
      confirmLabel: 'Publish all',
      variant: 'default' as const,
      onConfirm: () => void executeBulkPublish(),
    },
    runScraper: {
      title: 'Run venue scraper?',
      message:
        'Fetch events from active venue websites and upsert pending draft_events. Approved, published, and rejected drafts are left unchanged. This usually takes 1–3 minutes — keep this tab open until it finishes.',
      confirmLabel: 'Run scraper',
      variant: 'default' as const,
      onConfirm: () => void executeRunScraper(),
    },
  };

  const activeConfirm = confirmAction ? confirmConfig[confirmAction] : null;

  const isLoading = loading || refLoading;

  return (
    <div className={styles.page}>
      <div className={styles.tabsRow}>
        <div className={styles.tabs}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => switchTab(tab.key)}
          >
            {tab.label}
            {activeTab === tab.key && !loading && (
              <span className={styles.count}>{filteredEvents.length}</span>
            )}
          </button>
        ))}
        </div>
        <div className={styles.tabsActions}>
          <ScriptRunButton
            label="Run scraper"
            runningLabel="Scraper running…"
            running={scriptRunning && scriptJob?.scriptId === 'scrape'}
            disabled={scriptApiConfigured === false}
            title={
              scriptApiConfigured === false
                ? 'Configure script runner env vars and redeploy'
                : undefined
            }
            onClick={() => setConfirmAction('runScraper')}
          />
          <button
            type="button"
            className={styles.addEventBtn}
            onClick={() => setCreateOpen(true)}
          >
            + Add event
          </button>
        </div>
      </div>

      <ScriptRunnerHint
        configured={scriptApiConfigured}
        missingEnv={scriptMissingEnv}
        apiError={scriptApiError}
      />

      {(scriptJob || scriptRunning) && (
        <ScriptOutputPanel
          title="Venue scraper"
          output={scriptJob?.output ?? 'Starting script…'}
          status={scriptJob?.status ?? (scriptRunning ? 'running' : null)}
          onClose={clearJob}
        />
      )}

      <FiltersBar
        filters={filters}
        onChange={setFilters}
        venues={venues}
        sources={sources}
        hideStatusFilter
      />

      <div className={styles.toolbar}>
        <div className={styles.selectionInfo}>
          {selectedIds.size > 0 ? (
            <span>{selectedIds.size} selected</span>
          ) : (
            <span>{filteredEvents.length} events</span>
          )}
          <button
            type="button"
            className={styles.linkBtn}
            onClick={selectAllVisible}
            disabled={filteredEvents.length === 0}
          >
            Select all
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              className={styles.linkBtn}
              onClick={clearSelection}
            >
              Clear
            </button>
          )}
        </div>

        <div className={styles.bulkActions}>
          <button
            type="button"
            className={styles.bulkBtn}
            disabled={selectedIds.size === 0 || busy}
            onClick={() => setConfirmAction('bulkApprove')}
          >
            Approve selected
          </button>
          <button
            type="button"
            className={`${styles.bulkBtn} ${styles.danger}`}
            disabled={selectedIds.size === 0 || busy}
            onClick={() => setConfirmAction('bulkReject')}
          >
            Reject selected
          </button>
          <button
            type="button"
            className={`${styles.bulkBtn} ${styles.danger}`}
            disabled={selectedIds.size === 0 || busy}
            onClick={() => setConfirmAction('bulkDelete')}
          >
            Delete selected
          </button>
          <button
            type="button"
            className={styles.bulkBtn}
            disabled={publishableSelectedEvents.length === 0 || busy}
            onClick={() => setConfirmAction('bulkPublish')}
          >
            Publish selected
          </button>
        </div>
      </div>

      {isLoading && <p className={styles.state}>Loading draft events…</p>}
      {error && !isLoading && <p className={styles.error}>{error}</p>}
      {refWarning && !isLoading && (
        <p className={styles.warning}>{refWarning}</p>
      )}

      {!isLoading && !error && rlsBlocked && (
        <div className={styles.rlsBox}>
          <strong>Cannot read draft_events from the app.</strong>
          <p>
            Your database has rows (visible in Supabase Table Editor as{' '}
            <code>postgres</code>), but Row Level Security is blocking the
            logged-in admin user. Run the SQL in{' '}
            <code>supabase/admin-rls.sql</code> in the Supabase SQL Editor, then
            refresh this page.
          </p>
        </div>
      )}

      {!isLoading && !error && !rlsBlocked && filteredEvents.length === 0 && (
        <p className={styles.state}>
          No {activeTab} draft events
          {filters.search || filters.venueId || filters.genre || filters.sourceId
            ? ' match your filters'
            : ''}
          .
          {activeTab === 'published' &&
            ' Upcoming published events (today or later).'}
          {activeTab === 'passed' &&
            ' Published events that already took place (before today).'}
          {activeTab === 'pending' &&
            (totalInDb ?? 0) > 0 &&
            ' Try another status tab.'}
        </p>
      )}

      {!isLoading && !error && filteredEvents.length > 0 && (
        <div className={styles.grid}>
          {filteredEvents.map((event) => (
            <DraftEventCard
              key={event.id}
              event={event}
              maps={maps}
              selected={selectedIds.has(event.id)}
              onSelect={toggleSelect}
              onEdit={setEditingEvent}
            />
          ))}
        </div>
      )}

      <CreateDraftEventModal
        open={createOpen}
        busy={busy}
        venues={venues}
        sources={sources}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
      />

      {editingEvent && (
        <DraftEventEditor
          event={editingEvent}
          venues={venues}
          open={!!editingEvent}
          busy={busy}
          onClose={() => setEditingEvent(null)}
          onSave={handleSave}
          onApprove={(form) => handleStatusChange('approved', form)}
          onReject={() => handleStatusChange('rejected')}
          onPending={() => handleStatusChange('pending')}
          onPublish={handlePublish}
        />
      )}

      {activeConfirm && (
        <ConfirmDialog
          open
          title={activeConfirm.title}
          message={activeConfirm.message}
          confirmLabel={activeConfirm.confirmLabel}
          variant={activeConfirm.variant}
          busy={confirmAction === 'runScraper' && scriptRunning}
          onConfirm={activeConfirm.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
