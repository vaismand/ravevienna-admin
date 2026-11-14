import { mentionsSoldOut } from "./helpers";

export type TicketShopReading = {
  /** Lowest tier still on sale. Null when that price is missing or nothing is on sale. */
  price: number | null;
  /** True only when every shop tier is sold out. */
  soldOut: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * A present numeric price, including 0 (free). Missing, blank, and non-numeric
 * values stay null. `Number(null)` is 0, so callers must not use that.
 */
export function readStructuredPrice(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function readMoney(value: unknown): number | null {
  if (value == null) return null;
  const direct = readStructuredPrice(value);
  if (direct != null) return direct;
  const record = asRecord(value);
  if (!record) return null;
  return readStructuredPrice(record.amount);
}

/** schema.org SoldOut / OutOfStock, including full availability URLs. */
export function isSoldOutAvailability(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const leaf = value.trim().toLowerCase().replace(/\/+$/, "").split("/").pop() ?? "";
  return leaf === "soldout" || leaf === "outofstock";
}

function offerNodes(offers: unknown): Record<string, unknown>[] {
  if (offers == null) return [];
  if (Array.isArray(offers)) return offers.flatMap((entry) => offerNodes(entry));
  const record = asRecord(offers);
  if (!record) return [];
  if (record.offers != null) {
    const nested = offerNodes(record.offers);
    if (nested.length > 0) return nested;
  }
  return [record];
}

function offerPrice(offer: Record<string, unknown>): number | null {
  return readStructuredPrice(offer.price) ?? readStructuredPrice(offer.lowPrice);
}

/**
 * Price and sold-out state from schema.org Offer / AggregateOffer.
 * A missing price stays null (it must not become 0). Sold out only when every
 * offer's availability is SoldOut or OutOfStock.
 */
export function readJsonLdOfferSummary(offers: unknown): TicketShopReading {
  const nodes = offerNodes(offers);
  if (nodes.length === 0) return { price: null, soldOut: false };

  const soldOut =
    nodes.length > 0 && nodes.every((node) => isSoldOutAvailability(node.availability));
  const onSale = nodes.filter((node) => !isSoldOutAvailability(node.availability));
  const prices = onSale
    .map((node) => offerPrice(node))
    .filter((price): price is number => price != null);

  return {
    soldOut,
    price: prices.length > 0 ? Math.min(...prices) : null,
  };
}

function collectPaylogicItems(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry != null);
  }

  const record = asRecord(payload);
  if (!record) return [];

  const fromCategories: Record<string, unknown>[] = [];
  if (Array.isArray(record.categories)) {
    for (const category of record.categories) {
      const items = asRecord(category)?.items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const row = asRecord(item);
        if (row) fromCategories.push(row);
      }
    }
  }
  if (fromCategories.length > 0) return fromCategories;

  const embedded = asRecord(record._embedded)?.["shop:product"];
  if (Array.isArray(embedded)) {
    return embedded
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry != null);
  }

  if (Array.isArray(record.products)) {
    return record.products
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => entry != null);
  }

  return [];
}

function paylogicTierPrice(item: Record<string, unknown>): number | null {
  return readMoney(item.unit_price) ?? readMoney(item.price);
}

/**
 * Paylogic storefront or product list. `is_sold_out: true` on every product
 * means the event is sold out. Price is the lowest tier that is still on sale.
 */
export function readPaylogicProducts(payload: unknown): TicketShopReading {
  const items = collectPaylogicItems(payload);
  if (items.length === 0) {
    const topLevelSoldOut = asRecord(payload)?.is_sold_out === true;
    return { price: null, soldOut: topLevelSoldOut };
  }

  const onSale = items.filter((item) => item.is_sold_out !== true);
  const prices = onSale
    .map((item) => paylogicTierPrice(item))
    .filter((price): price is number => price != null);

  return {
    soldOut: onSale.length === 0,
    price: prices.length > 0 ? Math.min(...prices) : null,
  };
}

export function paylogicSaleId(ticketUrl: string): string | null {
  try {
    const url = new URL(ticketUrl);
    if (!url.hostname.toLowerCase().includes("paylogic")) return null;
    const saleId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return /^[a-f0-9]{16,}$/i.test(saleId) ? saleId : null;
  } catch {
    return null;
  }
}

function eventjetTierSoldOut(item: Record<string, unknown>): boolean {
  if (isSoldOutAvailability(item.availability)) return true;
  return (
    typeof item.unavailabilityReason === "string" &&
    mentionsSoldOut(item.unavailabilityReason)
  );
}

function eventjetTierOnSale(item: Record<string, unknown>): boolean {
  if (eventjetTierSoldOut(item)) return false;
  const reason = item.unavailabilityReason;
  if (typeof reason === "string" && reason.trim()) return false;
  return true;
}

export function readEventjetItems(items: unknown): TicketShopReading {
  const rows = Array.isArray(items)
    ? items
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => entry != null)
    : [];

  if (rows.length === 0) return { price: null, soldOut: false };

  const onSale = rows.filter((item) => eventjetTierOnSale(item));
  const prices = onSale
    .map((item) => readMoney(item.price))
    .filter((price): price is number => price != null);

  return {
    soldOut: rows.every((item) => eventjetTierSoldOut(item)),
    price: prices.length > 0 ? Math.min(...prices) : null,
  };
}

function matchingBracket(source: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

/** Eventjet shop HTML embeds `serverSideItems` in the React flight payload. */
export function extractEventjetItems(html: string): unknown[] {
  const decoded = html.replace(/\\"/g, '"');
  const marker = '"serverSideItems":';
  const markerAt = decoded.indexOf(marker);
  if (markerAt < 0) return [];

  const arrayStart = decoded.indexOf("[", markerAt);
  if (arrayStart < 0) return [];
  const arrayEnd = matchingBracket(decoded, arrayStart);
  if (arrayEnd < 0) return [];

  try {
    const parsed = JSON.parse(decoded.slice(arrayStart, arrayEnd + 1)) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function extractJsonLdOffers(html: string): unknown {
  const pattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1] ?? "") as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const record = asRecord(node);
        if (!record) continue;
        const type = record["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.includes("Event") || types.includes("MusicEvent")) {
          return record.offers ?? null;
        }
      }
    } catch {
      // Ignore broken JSON-LD blocks.
    }
  }
  return null;
}

/** Eventjet shop HTML, or a `{ items: [...] }` / item array fixture. */
export function readEventjetShop(source: unknown): TicketShopReading {
  if (typeof source === "string") {
    const items = extractEventjetItems(source);
    if (items.length > 0) return readEventjetItems(items);
    return readJsonLdOfferSummary(extractJsonLdOffers(source));
  }

  const record = asRecord(source);
  if (record && Array.isArray(record.items)) return readEventjetItems(record.items);
  if (Array.isArray(source)) return readEventjetItems(source);
  return { price: null, soldOut: false };
}
