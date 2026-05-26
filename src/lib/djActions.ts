import { supabase } from './supabase';
import { djFormToPayload } from './djUtils';
import { formatPostgrestError } from './supabaseErrors';
import type { Dj, DjFormData } from '../types/database';

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
  const { data, error } = await supabase
    .from('djs')
    .insert({
      ...djFormToPayload(payload),
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) throw new Error(formatPostgrestError(error));
  return data as Dj;
}

export async function updateDj(id: string, payload: DjFormData): Promise<Dj> {
  const { data, error } = await supabase
    .from('djs')
    .update(djFormToPayload(payload))
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw new Error(formatPostgrestError(error));
  return data as Dj;
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
