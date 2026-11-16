import { supabase } from './supabase';
import { rowWithoutMissingLocationLock } from './djLocationLock';
import { djFormToPayload } from './djUtils';
import { formatPostgrestError } from './supabaseErrors';
import type { Dj, DjFormData } from '../types/database';

type DjWriteResult = {
  data: Dj | null;
  error: unknown;
};

async function saveDj(
  write: (row: Record<string, unknown>) => PromiseLike<DjWriteResult>,
  row: Record<string, unknown>,
): Promise<Dj> {
  const first = await write(row);
  if (!first.error) return first.data as Dj;

  const retry = rowWithoutMissingLocationLock(row, first.error);
  if (!retry) throw new Error(formatPostgrestError(first.error));

  const second = await write(retry);
  if (second.error) throw new Error(formatPostgrestError(second.error));
  return second.data as Dj;
}

export async function fetchDjs(): Promise<Dj[]> {
  const { data, error } = await supabase
    .from('djs')
    .select('*')
    .order('name', { ascending: true });

  if (error) throw new Error(formatPostgrestError(error));
  return (data ?? []) as Dj[];
}

export async function fetchActiveDjs(): Promise<Dj[]> {
  const { data, error } = await supabase
    .from('djs')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) throw new Error(formatPostgrestError(error));
  return (data ?? []) as Dj[];
}

export async function createDj(payload: DjFormData): Promise<Dj> {
  const row = {
    ...djFormToPayload(payload),
    created_at: new Date().toISOString(),
  };
  return saveDj(
    (body) => supabase.from('djs').insert(body).select('*').single(),
    row,
  );
}

export async function updateDj(id: string, payload: DjFormData): Promise<Dj> {
  return saveDj(
    (body) =>
      supabase.from('djs').update(body).eq('id', id).select('*').single(),
    djFormToPayload(payload),
  );
}

export async function deleteDj(id: string): Promise<void> {
  const { error } = await supabase.from('djs').delete().eq('id', id);
  if (error) throw new Error(formatPostgrestError(error));
}

export async function toggleDjActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('djs')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw new Error(formatPostgrestError(error));
}

export async function bulkActivateDjs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase
    .from('djs')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .in('id', ids);

  if (error) throw new Error(formatPostgrestError(error));
}

export async function bulkDeleteDjs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const { error } = await supabase.from('djs').delete().in('id', ids);
  if (error) throw new Error(formatPostgrestError(error));
}

export async function fetchEventsForDj(
  djId: string,
): Promise<{ event_id: string; position: number }[]> {
  const { data, error } = await supabase
    .from('event_djs')
    .select('event_id, position')
    .eq('dj_id', djId)
    .order('position', { ascending: true });

  if (error) throw new Error(formatPostgrestError(error));
  return data ?? [];
}
