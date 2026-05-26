import { useMemo, useState } from 'react';
import { STATUS_TABS } from '../../lib/constants';
import {
  bulkDeleteSubmissions,
  bulkPublishSubmissions,
  bulkUpdateSubmissionStatus,
  publishEventSubmission,
  resolveSubmissionSourceId,
  saveEventSubmission,
  submissionFormToPayload,
  updateSubmissionStatus,
} from '../../lib/submissionActions';
import { matchesSubmissionSearch, submissionToFormData } from '../../lib/submissionForm';
import { useNotification } from '../../context/NotificationContext';
import { useEventSubmissions } from '../../hooks/useEventSubmissions';
import { useReferenceData } from '../../hooks/useReferenceData';
import { syncEventDjsForDraft, updateEventDjs } from '../../lib/eventDjActions';
import { formatPostgrestError } from '../../lib/supabaseErrors';
import type {
  EventSubmission,
  EventSubmissionFormData,
  ReviewStatus,
  SubmissionFilters,
} from '../../types/database';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import { SubmissionCard } from '../SubmissionCard/SubmissionCard';
import { SubmissionEditor } from '../SubmissionEditor/SubmissionEditor';
import { SubmissionFiltersBar } from '../SubmissionFiltersBar/SubmissionFiltersBar';
import pageStyles from '../DraftEventsPage/DraftEventsPage.module.css';

type ConfirmAction =
  | 'bulkApprove'
  | 'bulkReject'
  | 'bulkDelete'
  | 'bulkPublish'
  | null;

const defaultFilters = (): SubmissionFilters => ({
  venueName: '',
  genre: '',
  search: '',
});

export function SubmissionsPage() {
  const [activeTab, setActiveTab] = useState<ReviewStatus>('pending');
  const [filters, setFilters] = useState<SubmissionFilters>(defaultFilters);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EventSubmission | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const { notify } = useNotification();
  const { submissions, loading, error, rlsBlocked, meta, reload } =
    useEventSubmissions(activeTab);
  const { venues, sources, loading: refLoading, warning: refWarning } =
    useReferenceData();

  const submissionSourceId = useMemo(
    () => resolveSubmissionSourceId(sources),
    [sources],
  );

  const filtered = useMemo(() => {
    return submissions.filter((s) => {
      if (
        filters.venueName &&
        (s.venue_name ?? '').toLowerCase() !== filters.venueName.toLowerCase()
      ) {
        return false;
      }
      if (filters.genre && !(s.genres ?? []).includes(filters.genre)) {
        return false;
      }
      if (!matchesSubmissionSearch(s, filters.search)) return false;
      return true;
    });
  }, [submissions, filters]);

  const selectedItems = useMemo(
    () => filtered.filter((s) => selectedIds.has(s.id)),
    [filtered, selectedIds],
  );

  const switchTab = (status: ReviewStatus) => {
    setActiveTab(status);
    setFilters(defaultFilters());
    setSelectedIds(new Set());
    setEditing(null);
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
    setSelectedIds(new Set(filtered.map((s) => s.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const refreshAfterAction = async () => {
    await reload();
    setSelectedIds(new Set());
    setEditing(null);
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

  const handleSave = async (data: EventSubmissionFormData, djIds: string[]) => {
    if (!editing) return;
    await runWithBusy(async () => {
      await saveEventSubmission(editing.id, data);
      if (submissionSourceId) {
        await syncEventDjsForDraft(
          submissionSourceId,
          `submission-${editing.id}`,
          djIds,
        );
      }
      notify('Submission saved.', 'success');
      await refreshAfterAction();
    });
  };

  const handleStatusChange = async (status: ReviewStatus) => {
    if (!editing) return;
    await runWithBusy(async () => {
      await updateSubmissionStatus(editing.id, status);
      notify(`Marked as ${status}.`, 'success');
      await refreshAfterAction();
    });
  };

  const handlePublish = async (data: EventSubmissionFormData, djIds: string[]) => {
    if (!editing) return;
    if (!submissionSourceId) {
      notify(
        'No event source configured. Add a source in event_sources (e.g. "User submission").',
        'error',
      );
      return;
    }
    await runWithBusy(async () => {
      await saveEventSubmission(editing.id, data);
      const merged: EventSubmission = {
        ...editing,
        ...submissionFormToPayload(data),
      };
      const eventId = await publishEventSubmission(
        merged,
        data,
        venues,
        submissionSourceId,
      );
      await updateEventDjs(eventId, djIds);
      notify('Submission published to mobile feed.', 'success');
      await refreshAfterAction();
    });
  };

  const executeBulkApprove = async () => {
    const ids = [...selectedIds];
    await runWithBusy(async () => {
      await bulkUpdateSubmissionStatus(ids, 'approved');
      notify(`Approved ${ids.length} submission(s).`, 'success');
      await refreshAfterAction();
    });
    setConfirmAction(null);
  };

  const executeBulkReject = async () => {
    const ids = [...selectedIds];
    await runWithBusy(async () => {
      await bulkUpdateSubmissionStatus(ids, 'rejected');
      notify(`Rejected ${ids.length} submission(s).`, 'success');
      await refreshAfterAction();
    });
    setConfirmAction(null);
  };

  const executeBulkDelete = async () => {
    const ids = [...selectedIds];
    await runWithBusy(async () => {
      await bulkDeleteSubmissions(ids);
      notify(`Deleted ${ids.length} submission(s).`, 'success');
      await refreshAfterAction();
    });
    setConfirmAction(null);
  };

  const executeBulkPublish = async () => {
    const toPublish = selectedItems.filter((s) => s.status === 'approved');
    if (toPublish.length === 0) {
      notify('Select approved submissions to publish.', 'error');
      setConfirmAction(null);
      return;
    }
    if (!submissionSourceId) {
      notify('No event source configured for user submissions.', 'error');
      setConfirmAction(null);
      return;
    }

    await runWithBusy(async () => {
      const { succeeded, failed } = await bulkPublishSubmissions(
        toPublish.map((s) => ({
          submission: s,
          form: submissionToFormData(s),
        })),
        venues,
        submissionSourceId,
      );
      if (succeeded > 0) {
        notify(`Published ${succeeded} submission(s).`, 'success');
      }
      if (failed.length > 0) {
        notify(`Some failed:\n${failed.slice(0, 3).join('\n')}`, 'error');
      }
      await refreshAfterAction();
    });
    setConfirmAction(null);
  };

  const confirmConfig = {
    bulkApprove: {
      title: 'Approve selected submissions?',
      message: `Approve ${selectedIds.size} user submission(s)?`,
      confirmLabel: 'Approve all',
      variant: 'default' as const,
      onConfirm: () => void executeBulkApprove(),
    },
    bulkReject: {
      title: 'Reject selected submissions?',
      message: `Reject ${selectedIds.size} user submission(s)?`,
      confirmLabel: 'Reject all',
      variant: 'danger' as const,
      onConfirm: () => void executeBulkReject(),
    },
    bulkDelete: {
      title: 'Delete selected submissions?',
      message: `Permanently delete ${selectedIds.size} submission(s) from event_submissions?`,
      confirmLabel: 'Delete permanently',
      variant: 'danger' as const,
      onConfirm: () => void executeBulkDelete(),
    },
    bulkPublish: {
      title: 'Publish selected submissions?',
      message: `Publish ${selectedItems.filter((s) => s.status === 'approved').length} approved submission(s) to events?`,
      confirmLabel: 'Publish all',
      variant: 'default' as const,
      onConfirm: () => void executeBulkPublish(),
    },
  };

  const activeConfirm = confirmAction ? confirmConfig[confirmAction] : null;
  const isLoading = loading || refLoading;

  return (
    <div className={pageStyles.page}>
      <p className={pageStyles.sectionHint}>
        Events submitted by app users. Review, approve, and publish to the
        live feed.
      </p>

      <div className={pageStyles.tabs}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`${pageStyles.tab} ${activeTab === tab.key ? pageStyles.tabActive : ''}`}
            onClick={() => switchTab(tab.key)}
          >
            {tab.label}
            {activeTab === tab.key && !loading && (
              <span className={pageStyles.count}>{filtered.length}</span>
            )}
          </button>
        ))}
      </div>

      <SubmissionFiltersBar
        filters={filters}
        onChange={setFilters}
        venues={venues}
      />

      <div className={pageStyles.toolbar}>
        <div className={pageStyles.selectionInfo}>
          {selectedIds.size > 0 ? (
            <span>{selectedIds.size} selected</span>
          ) : (
            <span>{filtered.length} submissions</span>
          )}
          <button
            type="button"
            className={pageStyles.linkBtn}
            onClick={selectAllVisible}
            disabled={filtered.length === 0}
          >
            Select all
          </button>
          {selectedIds.size > 0 && (
            <button
              type="button"
              className={pageStyles.linkBtn}
              onClick={clearSelection}
            >
              Clear
            </button>
          )}
        </div>

        <div className={pageStyles.bulkActions}>
          <button
            type="button"
            className={pageStyles.bulkBtn}
            disabled={selectedIds.size === 0 || busy}
            onClick={() => setConfirmAction('bulkApprove')}
          >
            Approve selected
          </button>
          <button
            type="button"
            className={`${pageStyles.bulkBtn} ${pageStyles.danger}`}
            disabled={selectedIds.size === 0 || busy}
            onClick={() => setConfirmAction('bulkReject')}
          >
            Reject selected
          </button>
          <button
            type="button"
            className={`${pageStyles.bulkBtn} ${pageStyles.danger}`}
            disabled={selectedIds.size === 0 || busy}
            onClick={() => setConfirmAction('bulkDelete')}
          >
            Delete selected
          </button>
          <button
            type="button"
            className={pageStyles.bulkBtn}
            disabled={selectedIds.size === 0 || busy}
            onClick={() => setConfirmAction('bulkPublish')}
          >
            Publish selected
          </button>
        </div>
      </div>

      {isLoading && <p className={pageStyles.state}>Loading submissions…</p>}
      {error && !isLoading && <p className={pageStyles.error}>{error}</p>}
      {refWarning && !isLoading && (
        <p className={pageStyles.warning}>{refWarning}</p>
      )}

      {!isLoading && error && rlsBlocked && (
        <div className={pageStyles.rlsBox}>
          <strong>Cannot read event_submissions.</strong>
          <p>{error}</p>
          <p>
            Run the event_submissions section in{' '}
            <code>supabase/admin-rls.sql</code>, then sign out and back in.
          </p>
        </div>
      )}

      {!isLoading && !error && meta.statusMismatch && (
        <div className={pageStyles.warning}>
          <strong>Submissions exist but not under “{activeTab}”.</strong>
          <p>
            Found {meta.totalAccessible} row(s) in the database with statuses:{' '}
            {Object.entries(meta.statusBreakdown)
              .map(([s, n]) => `${s} (${n})`)
              .join(', ')}
            . Try another tab, or align your app to use: pending, approved,
            rejected, published.
          </p>
        </div>
      )}

      {!isLoading &&
        !error &&
        !rlsBlocked &&
        !meta.statusMismatch &&
        filtered.length === 0 && (
        <p className={pageStyles.state}>
          {meta.totalAccessible === 0
            ? 'No user submissions in the database yet.'
            : `No ${activeTab} user submissions`}
          {filters.search || filters.venueName || filters.genre
            ? ' match your filters'
            : ''}
          .
          {activeTab === 'published' &&
            ' Upcoming published events (today or later).'}
          {activeTab === 'passed' &&
            ' Published events that already took place (before today).'}
        </p>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <div className={pageStyles.grid}>
          {filtered.map((s) => (
            <SubmissionCard
              key={s.id}
              submission={s}
              selected={selectedIds.has(s.id)}
              onSelect={toggleSelect}
              onEdit={setEditing}
            />
          ))}
        </div>
      )}

      {editing && (
        <SubmissionEditor
          submission={editing}
          venues={venues}
          submissionSourceId={submissionSourceId}
          open={!!editing}
          busy={busy}
          onClose={() => setEditing(null)}
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
