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

export async function fetchScriptHealth(): Promise<{
  configured: boolean;
  activeJob: ScriptJob | null;
}> {
  const response = await fetch('/api/scripts/health');
  return parseJson(response);
}

export async function startScriptJob(
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

export async function fetchScriptJob(jobId: string): Promise<ScriptJob> {
  const response = await fetch(`/api/scripts/jobs/${jobId}`, {
    headers: await authHeaders(),
  });

  const payload = await parseJson<{ job: ScriptJob }>(response);
  return payload.job;
}

export async function waitForScriptJob(
  jobId: string,
  onUpdate?: (job: ScriptJob) => void,
  pollMs = 1000,
): Promise<ScriptJob> {
  while (true) {
    const job = await fetchScriptJob(jobId);
    onUpdate?.(job);

    if (job.status !== 'running') {
      return job;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
