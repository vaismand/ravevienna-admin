import { supabase } from './supabase';

export type ScriptId = 'scrape' | 'enrich-spotify' | 'enrich-ra';

export type ScriptJobStatus = 'running' | 'completed' | 'failed';

export type ScriptJob = {
  id: string;
  scriptId: ScriptId;
  status: ScriptJobStatus;
  output: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ScriptHealth = {
  configured: boolean;
  activeJob: ScriptJob | null;
  missingEnv?: string[];
  apiError?: string;
};

async function authHeaders(): Promise<HeadersInit> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error('You must be signed in to run admin scripts.');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed (${response.status}).`);
  }
  return payload;
}

export async function fetchScriptHealth(): Promise<ScriptHealth> {
  try {
    const response = await fetch('/api/scripts/health');
    if (!response.ok) {
      return {
        configured: false,
        activeJob: null,
        apiError: `Script API returned ${response.status}. Redeploy the latest admin panel code.`,
      };
    }
    return parseJson<ScriptHealth>(response);
  } catch {
    return {
      configured: false,
      activeJob: null,
      apiError:
        'Could not reach /api/scripts/health. Check that the latest code is deployed on Vercel.',
    };
  }
}

export async function runScriptJob(
  scriptId: ScriptId,
  args: string[] = [],
): Promise<ScriptJob> {
  const response = await fetch('/api/scripts/run', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ scriptId, args }),
  });

  const payload = await parseJson<{ job: ScriptJob }>(response);
  return payload.job;
}
