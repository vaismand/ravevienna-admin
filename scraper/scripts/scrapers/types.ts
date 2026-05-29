export type ScrapedEvent = {
  title: string;
  event_date: string | null;
  start_time: string | null;
  price: number | null;
  genres: string[];
  description: string | null;
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
