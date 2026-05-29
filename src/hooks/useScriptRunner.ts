import { useCallback, useEffect, useState } from 'react';
import {
  fetchScriptHealth,
  runScriptJob,
  type ScriptId,
  type ScriptJob,
} from '../lib/scriptRunnerApi';

export function useScriptRunner() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<ScriptJob | null>(null);

  useEffect(() => {
    void fetchScriptHealth()
      .then((health) => {
        setConfigured(health.configured);
      })
      .catch(() => {
        setConfigured(false);
      });
  }, []);

  const runScript = useCallback(
    async (scriptId: ScriptId, args: string[] = []) => {
      setRunning(true);
      setJob({
        id: 'pending',
        scriptId,
        status: 'running',
        output: 'Starting script…',
        exitCode: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
      });

      try {
        const finished = await runScriptJob(scriptId, args);
        setJob(finished);
        return finished;
      } catch (error) {
        const failedJob: ScriptJob = {
          id: 'failed',
          scriptId,
          status: 'failed',
          output:
            error instanceof Error ? error.message : 'Script failed to start.',
          exitCode: 1,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        };
        setJob(failedJob);
        throw error;
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  const clearJob = useCallback(() => {
    if (!running) {
      setJob(null);
    }
  }, [running]);

  return {
    configured,
    running,
    job,
    runScript,
    clearJob,
  };
}
