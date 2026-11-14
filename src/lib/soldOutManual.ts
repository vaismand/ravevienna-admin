/** Draft `raw_data` flag: an admin set `sold_out` in the edit form. */
export const SOLD_OUT_MANUAL_KEY = "sold_out_manual";

export function isSoldOutManuallySet(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return (raw as Record<string, unknown>)[SOLD_OUT_MANUAL_KEY] === true;
}

export function withSoldOutManual(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return { ...(raw ?? {}), [SOLD_OUT_MANUAL_KEY]: true };
}
