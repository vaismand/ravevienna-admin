/** Turn PostgREST / Supabase errors into a readable string for toasts. */
export function formatPostgrestError(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };
    const parts = [e.message, e.details, e.hint, e.code ? `(${e.code})` : ''].filter(
      Boolean,
    );
    if (parts.length > 0) return parts.join(' — ');
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}
