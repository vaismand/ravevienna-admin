import { useCallback, useEffect, useState } from 'react';
import {
  fetchScriptHealth,
  startScriptJob,
  waitForScriptJob,
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
        if (health.activeJob) {
          setJob(health.activeJob);
          setRunning(health.activeJob.status === 'running');
        }
      })
      .catch(() => {
        setConfigured(false);
      });
  }, []);

  const runScript = useCallback(
    async (scriptId: ScriptId, args: string[] = []) => {
      setRunning(true);
      setJob(null);

      try {
        const started = await startScriptJob(scriptId, args);
        setJob(started);

        const finished = await waitForScriptJob(started.id, setJob);
        setJob(finished);
        return finished;
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
