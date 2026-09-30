import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  genresJsonToTextArray,
  lineupToTextArray,
  normalizeEventPrice,
  publishDraftRecord,
} from "../src/lib/publishDraft.ts";
import type { DraftEvent } from "../src/types/database.ts";

type Row = Record<string, unknown>;

type Filter =
  | { op: "eq"; column: string; value: unknown }
  | { op: "ilike"; column: string; pattern: string }
  | { op: "or"; raw: string };

function unescapeLike(pattern: string): string {
  return pattern.replace(/\\([%_\\])/g, "$1");
}

function ilikeEquals(value: string, pattern: string): boolean {
  return value.toLowerCase() === unescapeLike(pattern).toLowerCase();
}

function sqlLike(value: string, pattern: string): boolean {
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${source}$`).test(value);
}

function matchOr(row: Row, raw: string): boolean {
  return raw.split(",").some((clause) => {
    const eq = clause.match(/^(\w+)\.eq\.(.*)$/);
    if (eq) return String(row[eq[1]] ?? "") === eq[2];
    const like = clause.match(/^(\w+)\.like\.(.*)$/);
    if (like) return sqlLike(String(row[like[1]] ?? ""), like[2]);
    return false;
  });
}

class Query {
  private filters: Filter[] = [];
  private action: "select" | "insert" | "update" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private limitN: number | null = null;
  private orderBy: { column: string; ascending: boolean } | null = null;

  constructor(
    private readonly table: string,
    private readonly db: Map<string, Row[]>,
  ) {}

  select(): this {
    return this;
  }

  insert(payload: Row | Row[]): this {
    this.action = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }

  delete(): this {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ op: "eq", column, value });
    return this;
  }

  ilike(column: string, pattern: string): this {
    this.filters.push({ op: "ilike", column, pattern });
    return this;
  }

  or(raw: string): this {
    this.filters.push({ op: "or", raw });
    return this;
  }

  limit(count: number): this {
    this.limitN = count;
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderBy = { column, ascending: options?.ascending !== false };
    return this;
  }

  in(): this {
    return this;
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return this.execute("maybe");
  }

  single(): Promise<{ data: Row | null; error: null }> {
    return this.execute("single");
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute("many").then(onfulfilled, onrejected);
  }

  private tableRows(): Row[] {
    const rows = this.db.get(this.table);
    if (rows) return rows;
    const created: Row[] = [];
    this.db.set(this.table, created);
    return created;
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      if (filter.op === "eq") return row[filter.column] === filter.value;
      if (filter.op === "ilike") {
        return ilikeEquals(String(row[filter.column] ?? ""), filter.pattern);
      }
      return matchOr(row, filter.raw);
    });
  }

  private matchedRows(): Row[] {
    let matched = this.tableRows().filter((row) => this.matches(row));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      matched = [...matched].sort((a, b) => {
        const av = Number(a[column] ?? 0);
        const bv = Number(b[column] ?? 0);
        return ascending ? av - bv : bv - av;
      });
    }
    if (this.limitN != null) matched = matched.slice(0, this.limitN);
    return matched;
  }

  private async execute(
    mode: "many" | "maybe" | "single",
  ): Promise<{ data: unknown; error: null }> {
    const tableRows = this.tableRows();

    if (this.action === "insert") {
      const incoming = Array.isArray(this.payload)
        ? this.payload
        : [this.payload ?? {}];
      const inserted = incoming.map((row) => ({
        ...row,
        id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
      }));
      tableRows.push(...inserted);
      if (mode === "many") return { data: null, error: null };
      return { data: inserted[0] ?? null, error: null };
    }

    const matched = this.matchedRows();

    if (this.action === "update") {
      for (const row of matched) Object.assign(row, this.payload);
      return { data: null, error: null };
    }

    if (this.action === "delete") {
      const remove = new Set(matched);
      this.db.set(
        this.table,
        tableRows.filter((row) => !remove.has(row)),
      );
      return { data: null, error: null };
    }

    if (mode === "many") {
      return { data: matched.map((row) => ({ ...row })), error: null };
    }

    return { data: matched[0] ? { ...matched[0] } : null, error: null };
  }
}

function createDb() {
  const db = new Map<string, Row[]>();
  const client = {
    from(table: string) {
      return new Query(table, db);
    },
  };
  return { db, client: client as unknown as SupabaseClient };
}

function draft(overrides: Partial<DraftEvent> = {}): DraftEvent {
  return {
    id: "draft-1",
    source_id: "source-1",
    venue_id: "venue-1",
    title: "Bass Cave",
    event_date: "2026-10-02",
    start_time: "23:00",
    price: "15",
    genres: ["Techno", "Electronic"],
    description: "Night",
    lineup: ["Alice", "Bob", "Alice"],
    ticket_url: null,
    image_url: null,
    external_url: "https://example.com/event",
    external_id: "ext-1",
    status: "approved",
    confidence: 1,
    raw_data: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function rows(db: Map<string, Row[]>, table: string): Row[] {
  return db.get(table) ?? [];
}

describe("publish payload conversion", () => {
  it("copies jsonb genre arrays into text[] values without remapping", () => {
    assert.deepEqual(genresJsonToTextArray(["Techno", "Electronic", "Schranz"]), [
      "Techno",
      "Electronic",
      "Schranz",
    ]);
    assert.deepEqual(genresJsonToTextArray('["House","DnB"]'), ["House", "DnB"]);
    assert.deepEqual(genresJsonToTextArray(null), []);
    assert.deepEqual(genresJsonToTextArray(["  ", "Tek"]), ["Tek"]);
  });

  it("keeps one plain DJ name per lineup entry", () => {
    assert.deepEqual(lineupToTextArray([" Amelie Lens ", "", "FJAAK"]), [
      "Amelie Lens",
      "FJAAK",
    ]);
    assert.deepEqual(lineupToTextArray('["A","B"]'), ["A", "B"]);
  });

  it("normalizes numeric and string prices", () => {
    assert.equal(normalizeEventPrice(12.5), 12.5);
    assert.equal(normalizeEventPrice("€15,00"), 15);
    assert.equal(normalizeEventPrice(""), null);
    assert.equal(normalizeEventPrice(null), null);
  });
});

describe("publishDraftRecord", () => {
  it("writes the event, missing DJs, and lineup links in order", async () => {
    const { db, client } = createDb();
    db.set("draft_events", [{ id: "draft-1", status: "approved" }]);

    const { eventId, djs } = await publishDraftRecord(client, draft());

    const events = rows(db, "events");
    assert.equal(events.length, 1);
    assert.equal(events[0]?.id, eventId);
    assert.equal(events[0]?.draft_event_id, "draft-1");
    assert.equal(events[0]?.price, 15);
    assert.deepEqual(events[0]?.genres, ["Techno", "Electronic"]);
    assert.deepEqual(events[0]?.lineup, ["Alice", "Bob", "Alice"]);

    const djsTable = rows(db, "djs");
    assert.deepEqual(
      djsTable.map((row) => row.name),
      ["Alice", "Bob"],
    );
    assert.equal(djsTable.every((row) => row.is_active === false), true);
    assert.deepEqual(djs.created, ["Alice", "Bob"]);

    const links = rows(db, "event_djs");
    const nameById = new Map(djsTable.map((row) => [row.id, row.name]));
    assert.deepEqual(
      links.map((row) => ({
        name: nameById.get(row.dj_id),
        position: row.position,
      })),
      [
        { name: "Alice", position: 0 },
        { name: "Bob", position: 1 },
      ],
    );

    assert.equal(rows(db, "draft_events")[0]?.status, "published");
  });

  it("re-publishes without duplicating DJs or event_djs", async () => {
    const { db, client } = createDb();
    db.set("draft_events", [{ id: "draft-1", status: "approved" }]);
    const source = draft();

    await publishDraftRecord(client, source);
    const firstLinks = rows(db, "event_djs").map((row) => row.id);

    const again = await publishDraftRecord(client, {
      ...source,
      status: "published",
    });

    assert.equal(rows(db, "events").length, 1);
    assert.equal(rows(db, "djs").length, 2);
    assert.deepEqual(again.djs.created, []);
    assert.deepEqual(
      rows(db, "event_djs").map((row) => row.id),
      firstLinks,
    );
  });

  it("replaces lineup links when the lineup changes", async () => {
    const { db, client } = createDb();
    db.set("draft_events", [{ id: "draft-1", status: "approved" }]);
    const source = draft();

    await publishDraftRecord(client, source);
    await publishDraftRecord(client, {
      ...source,
      lineup: ["Bob"],
    });

    const djsTable = rows(db, "djs");
    const nameById = new Map(djsTable.map((row) => [row.id, row.name]));
    assert.equal(djsTable.length, 2);
    assert.deepEqual(
      rows(db, "event_djs").map((row) => nameById.get(row.dj_id)),
      ["Bob"],
    );
    assert.deepEqual(rows(db, "events")[0]?.lineup, ["Bob"]);
  });

  it("does not write rows when the draft cannot be published", async () => {
    const { db, client } = createDb();
    await assert.rejects(
      () => publishDraftRecord(client, draft({ source_id: null })),
      /source_id and external_id/,
    );
    assert.equal(rows(db, "events").length, 0);
    assert.equal(rows(db, "event_djs").length, 0);
  });
});
