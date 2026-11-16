export type ScrapedEvent = {
  title: string;
  event_date: string | null;
  start_time: string | null;
  price: number | null;
  /** Shop or schema.org status. Omitted means not sold out. */
  sold_out?: boolean;
  genres: string[];
  description: string | null;
  /** When set, this lineup is stored instead of one parsed from the description. */
  lineup?: string[];
  ticket_url: string | null;
  image_url: string | null;
  external_url: string;
  external_id: string;
  raw_data: Record<string, unknown>;
};

export type ScrapeSource = {
  id: string;
  name: string;
  url: string;
  venue_id: string;
};

export type ScraperFn = (source: ScrapeSource) => Promise<ScrapedEvent[]>;
