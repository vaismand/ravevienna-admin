import styles from './ScriptRunnerHint.module.css';

interface ScriptRunnerHintProps {
  configured: boolean | null;
  missingEnv: string[];
  apiError: string | null;
}

export function ScriptRunnerHint({
  configured,
  missingEnv,
  apiError,
}: ScriptRunnerHintProps) {
  if (configured !== false) {
    return null;
  }

  if (apiError) {
    return <p className={styles.hint}>{apiError}</p>;
  }

  if (missingEnv.length > 0) {
    return (
      <p className={styles.hint}>
        Script runner unavailable. Add in Vercel → Settings → Environment
        Variables, then redeploy:{' '}
        {missingEnv.map((name) => (
          <code key={name}>{name}</code>
        ))}
      </p>
    );
  }

  return (
    <p className={styles.hint}>
      Script runner unavailable. Add <code>SUPABASE_SERVICE_ROLE_KEY</code> in
      Vercel → Settings → Environment Variables, then redeploy.
    </p>
  );
}
