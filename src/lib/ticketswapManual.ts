/** Draft `raw_data` flag: an admin set or cleared `ticketswap_url` in the edit form. */
export const TICKETSWAP_URL_MANUAL_KEY = "ticketswap_url_manual";

export function isTicketSwapUrlManuallySet(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return (raw as Record<string, unknown>)[TICKETSWAP_URL_MANUAL_KEY] === true;
}

export function withTicketSwapManual(
  raw: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return { ...(raw ?? {}), [TICKETSWAP_URL_MANUAL_KEY]: true };
}
