import { useState } from 'react';
import type {
  DraftEvent,
  DraftEventFormData,
  Venue,
} from '../../types/database';
import { formatLineupArray } from '../../lib/lineup';
import { formatPrice } from '../../utils/format';
import { useEventDjSelection } from '../../hooks/useEventDjSelection';
import { DraftEventFormFields } from '../DraftEventFormFields/DraftEventFormFields';
import { EventDjSelect } from '../EventDjSelect/EventDjSelect';
import { StatusBadge } from '../StatusBadge/StatusBadge';
import styles from './DraftEventEditor.module.css';

function toFormData(event: DraftEvent, isPromoted: boolean): DraftEventFormData {
  return {
    title: event.title ?? '',
    venue_id: event.venue_id,
    event_date: event.event_date?.slice(0, 10) ?? '',
    start_time: event.start_time?.slice(0, 5) ?? '',
    price: formatPrice(event.price).replace(/^€/, '') || '',
    sold_out: event.sold_out === true,
    genres: event.genres ?? [],
    description: event.description ?? '',
    lineup: formatLineupArray(event.lineup),
    image_url: event.image_url ?? '',
    ticket_url: event.ticket_url ?? '',
    ticketswap_url: event.ticketswap_url ?? '',
    external_url: event.external_url ?? '',
    is_promoted: isPromoted,
  };
}

interface DraftEventEditorProps {
  event: DraftEvent;
  venues: Venue[];
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (data: DraftEventFormData, djIds: string[]) => Promise<void>;
  onApprove: (data: DraftEventFormData) => Promise<void>;
  onReject: () => Promise<void>;
  onPending: () => Promise<void>;
  onPublish: (data: DraftEventFormData) => Promise<void>;
  isPromoted: boolean;
  promotionLoaded: boolean;
  columnReady: boolean;
  hasPublishedEventRow: boolean;
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
  isPromoted,
  promotionLoaded,
  columnReady,
  hasPublishedEventRow,
}: DraftEventEditorProps) {
  const [form, setForm] = useState<DraftEventFormData>(() =>
    toFormData(event, isPromoted),
  );
  const {
    activeDjs,
    selectedDjIds,
    setSelectedDjIds,
    loading: djsLoading,
    hasPublishedEvent,
  } = useEventDjSelection(open, event.source_id, event.external_id);

  const promotedHint = !columnReady
    ? 'Run the is_promoted migration before using this. The scraper will never set it.'
    : hasPublishedEventRow
      ? 'Pins this event to the top of Tonight. A few per day, per genre, is enough. Saving here is the only thing that changes it.'
      : 'Publish the event to save this. It is stored on the live event, and a re-scrape will not clear it.';

  if (!open) return null;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true">
      <div className={styles.panel}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h2 className={styles.heading}>
              {event.status === 'published' ? 'Edit event' : 'Edit draft event'}
            </h2>
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

        <div className={styles.formScroll}>
          <DraftEventFormFields
            form={form}
            onChange={setForm}
            venues={venues}
            showPromoted
            promotedDisabled={!promotionLoaded || !columnReady}
            promotedHint={promotedHint}
          />
          <EventDjSelect
            activeDjs={activeDjs}
            selectedDjIds={selectedDjIds}
            onChange={setSelectedDjIds}
            loading={djsLoading}
          />
          {!hasPublishedEvent && event.source_id && event.external_id && (
            <p className={styles.djNote}>
              Publish links each lineup name to a DJ, in that order, and creates
              any missing DJs. Save changes stores this directory selection once
              the event is already in the feed.
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          <div className={styles.primaryActions}>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={() => void onSave(form, selectedDjIds)}
              disabled={busy}
            >
              Save changes
            </button>
          </div>
          <div className={styles.statusActions}>
            <button
              type="button"
              className={styles.approveBtn}
              onClick={() => void onApprove(form)}
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
