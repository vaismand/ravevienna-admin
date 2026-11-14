/**
 * TicketSwap link check shared by the admin forms.
 * Any TicketSwap locale host is accepted (ticketswap.com, ticketswap.at, …).
 * The mobile app shows its TicketSwap button for any valid http(s) URL.
 */

const TICKETSWAP_HOST =
  /^(?:[a-z0-9-]+\.)*ticketswap\.(?:[a-z]{2,}|co\.[a-z]{2})$/i;

export function isTicketSwapUrl(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (url.username || url.password) return false;
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    return TICKETSWAP_HOST.test(host);
  } catch {
    return false;
  }
}

export function ticketSwapUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isTicketSwapUrl(trimmed)) return null;
  return "TicketSwap URL must be an http(s) link on a TicketSwap domain (ticketswap.com, ticketswap.at, and other TicketSwap locales).";
}

export function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}
