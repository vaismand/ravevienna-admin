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
import { formatPostgrestError } from '../../lib/supabaseErrors';
import { matchesSearch } from '../../utils/format';
import type {
  DraftEvent,
  DraftEventFilters,
  DraftEventFormData,
  DraftEventStatus,
} from '../../types/database';
import { CreateDraftEventModal } from '../CreateDraftEventModal/CreateDraftEventModal';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { DraftEventCard } from '../DraftEventCard/DraftEventCard';
import { DraftEventEditor } from '../DraftEventEditor/DraftEventEditor';
import { FiltersBar } from '../FiltersBar/FiltersBar';
import styles from './DraftEventsPage.module.css';

type ConfirmAction =
  | 'bulkApprove'
  | 'bulkReject'
  | 'bulkDelete'
  | 'bulkPublish'
  | null;

const defaultFilters = (status: DraftEventStatus): DraftEventFilters => ({
  status,
  venueId: '',
  genre: '',
  sourceId: '',
  search: '',
});

export function DraftEventsPage() {
  const [activeTab, setActiveTab] = useState<DraftEventStatus>('pending');
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

  const switchTab = (status: DraftEventStatus) => {
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
    status: DraftEventStatus,
  ) => {
    await runWithBusy(async () => {
      await createDraftEvent(data, sourceId, status);
      notify(
        status === 'approved'
          ? 'Event created and approved.'
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

  const handleSave = async (data: DraftEventFormData) => {
    if (!editingEvent) return;
    await runWithBusy(async () => {
      await saveDraftEvent(editingEvent.id, data);
      notify('Draft event saved.', 'success');
      await refreshAfterAction();
    });
  };

  const handleStatusChange = async (status: DraftEventStatus) => {
    if (!editingEvent) return;
    await runWithBusy(async () => {
      await updateDraftStatus(editingEvent.id, status);
      notify(`Marked as ${status}.`, 'success');
      await refreshAfterAction();
    });
  };

  const handlePublish = async (data: DraftEventFormData) => {
    if (!editingEvent) return;
    await runWithBusy(async () => {
      await saveDraftEvent(editingEvent.id, data);
      const merged: DraftEvent = {
        ...editingEvent,
        ...formDataToUpdatePayload(data),
      };
      await publishDraftEvent(merged);
      notify('Event published to mobile feed.', 'success');
      await refreshAfterAction();
    });
  };

  const executeBulkApprove = async () => {
    const ids = [...selectedIds];
    await runWithBusy(async () => {
      await bulkUpdateStatus(ids, 'approved');
      notify(`Approved ${ids.length} event(s).`, 'success');
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
    const toPublish = selectedEvents.filter((e) => e.status === 'approved');
    if (toPublish.length === 0) {
      notify('Select approved events to publish.', 'error');
      setConfirmAction(null);
      return;
    }

    await runWithBusy(async () => {
      const { succeeded, failed } = await bulkPublish(toPublish);
      if (succeeded > 0) {
        notify(`Published ${succeeded} event(s).`, 'success');
      }
      if (failed.length > 0) {
        notify(`Some publishes failed:\n${failed.slice(0, 3).join('\n')}`, 'error');
      }
      await refreshAfterAction();
    });
    setConfirmAction(null);
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
      message: `Publish ${selectedEvents.filter((e) => e.status === 'approved').length} approved event(s) to the events table?`,
      confirmLabel: 'Publish all',
      variant: 'default' as const,
      onConfirm: () => void executeBulkPublish(),
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
        <button
          type="button"
          className={styles.addEventBtn}
          onClick={() => setCreateOpen(true)}
        >
          + Add event
        </button>
      </div>

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
            disabled={selectedIds.size === 0 || busy}
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
          {activeTab === 'approved' &&
            (totalInDb ?? 0) > 0 &&
            ' Events you publish move to the Published tab.'}
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
          onApprove={() => handleStatusChange('approved')}
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
          onConfirm={activeConfirm.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
