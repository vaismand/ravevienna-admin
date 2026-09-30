import { supabase } from './supabase';
import {
  ensureDjsFromDraftLineups as ensureDjsFromDraftLineupsWithClient,
  ensureDjsFromLineup as ensureDjsFromLineupWithClient,
  ensureDjsFromLineupSources as ensureDjsFromLineupSourcesWithClient,
  type EnsureLineupDjsResult,
  type LineupDjContext,
  type LineupDjSource,
} from './lineupDjEnsure';

export type { EnsureLineupDjsResult, LineupDjContext, LineupDjSource };

export async function ensureDjsFromLineupSources(
  sources: LineupDjSource[],
): Promise<EnsureLineupDjsResult> {
  return ensureDjsFromLineupSourcesWithClient(supabase, sources);
}

export async function ensureDjsFromLineup(
  lineup: string[] | null | undefined,
  eventGenres?: string[] | null,
): Promise<EnsureLineupDjsResult> {
  return ensureDjsFromLineupWithClient(supabase, lineup, eventGenres);
}

export async function ensureDjsFromDraftLineups(
  draftIds: string[],
): Promise<EnsureLineupDjsResult> {
  return ensureDjsFromDraftLineupsWithClient(supabase, draftIds);
}
