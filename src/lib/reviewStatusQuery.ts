import type { ReviewStatus } from '../types/database';
import { todayInVienna } from '../utils/format';

/**
 * Published tab = status published + event_date today or later (or no date).
 * Passed tab = status published + event_date before today.
 */
export function publishedTabFilter(): {
  status: 'published';
  dateOr: string;
} {
  const today = todayInVienna();
  return {
    status: 'published',
    dateOr: `event_date.gte.${today},event_date.is.null`,
  };
}

export function passedTabFilter(): {
  status: 'published';
  beforeDate: string;
} {
  return {
    status: 'published',
    beforeDate: todayInVienna(),
  };
}

export function isDateSplitTab(status: ReviewStatus): boolean {
  return status === 'published' || status === 'passed';
}

/** Passed tab: newest past events first. Other tabs: soonest first. */
export function reviewListSort(status: ReviewStatus): {
  eventDateAsc: boolean;
  startTimeAsc: boolean;
} {
  if (status === 'passed') {
    return { eventDateAsc: false, startTimeAsc: false };
  }
  return { eventDateAsc: true, startTimeAsc: true };
}
