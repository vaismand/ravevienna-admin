import type { EnsureLineupDjsResult } from './ensureLineupDjs';

export function formatDraftApproveMessage(
  eventCount: number,
  djs: EnsureLineupDjsResult | null,
): string {
  let message =
    eventCount === 1
      ? 'Event approved.'
      : `Approved ${eventCount} event(s).`;

  const created = djs?.created.length ?? 0;
  if (created > 0) {
    message += ` Added ${created} new DJ(s) as inactive drafts — edit them on the DJs page.`;
  }

  return message;
}

export function formatDraftPublishMessage(
  eventCount: number,
  djs: EnsureLineupDjsResult | null,
): string {
  let message =
    eventCount === 1
      ? 'Event published to mobile feed.'
      : `Published ${eventCount} event(s).`;

  const created = djs?.created.length ?? 0;
  if (created > 0) {
    message += ` Added ${created} new DJ(s) as inactive drafts — edit them on the DJs page.`;
  }

  return message;
}

export function mergeLineupDjResults(
  results: EnsureLineupDjsResult[],
): EnsureLineupDjsResult {
  const created = new Set<string>();
  const existing = new Set<string>();

  for (const result of results) {
    for (const name of result.created) created.add(name);
    for (const name of result.existing) existing.add(name);
  }

  return {
    created: [...created],
    existing: [...existing],
  };
}
