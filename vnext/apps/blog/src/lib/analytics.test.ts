import { describe, expect, it, vi } from "vitest";
import {
  allowCmsAnalyticsEvent,
  analyticsRateLimitKey,
  recordCmsAnalyticsEvent,
  type CmsAnalyticsDatabase
} from "./analytics";

describe("reader analytics", () => {
  const envelope = {
    eventId: "019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e",
    occurredAt: "2026-08-23T01:02:02.000Z",
    schemaVersion: 1 as const
  };

  it("uses the Cloudflare client address only as an ephemeral rate-limit key", () => {
    expect(analyticsRateLimitKey(new Request("https://noema.example/articles/test", {
      headers: { "cf-connecting-ip": "203.0.113.10" }
    }))).toBe("203.0.113.10");
    expect(analyticsRateLimitKey(new Request("http://localhost/articles/test"))).toBe("unknown");
  });

  it("stops analytics before storage when the edge rate limit is exhausted", async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const request = new Request("https://noema.example/api/analytics/events", {
      headers: { "cf-connecting-ip": "198.51.100.42" }
    });

    await expect(allowCmsAnalyticsEvent({ limit }, request)).resolves.toBe(false);
    expect(limit).toHaveBeenCalledWith({ key: "198.51.100.42" });
  });

  it("binds a published revision to both long-term and exploratory analytics", async () => {
    const first = vi.fn(async () => ({
      id: "article-id",
      published_revision_number: 4,
      published_slug: "local-ai-on-mac"
    }));
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const boundValues: unknown[][] = [];
    const db: CmsAnalyticsDatabase = {
      prepare(query) {
        return {
          bind(...values: unknown[]) {
            boundValues.push(values);
            return this;
          },
          first: query.startsWith("SELECT") ? first : vi.fn(async () => null),
          run
        };
      }
    };
    const writeDataPoint = vi.fn();

    const recorded = await recordCmsAnalyticsEvent(db, { writeDataPoint }, {
      ...envelope,
      articleSlug: "local-ai-on-mac",
      attribution: {
        campaign: "ollama_series",
        content: "memory_chart",
        medium: "social",
        referrerHost: "example.com",
        source: "x"
      },
      entryKind: "article_search",
      eventType: "navigation_click",
      navigationKind: "related",
      targetSlug: "quantization-basics"
    }, { now: new Date("2026-08-23T01:02:03.000Z") });

    expect(recorded).toBe("recorded");
    expect(run).toHaveBeenCalledOnce();
    expect(boundValues[1]).toEqual([
      "019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e",
      1,
      "2026-08-23",
      "2026-08-23T01:02:02.000Z",
      "2026-08-23T01:02:03.000Z",
      "article-id",
      "local-ai-on-mac",
      4,
      "navigation_click",
      "x",
      "social",
      "ollama_series",
      "memory_chart",
      "example.com",
      "related",
      "quantization-basics",
      "article_search"
    ]);
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: [
        "navigation_click",
        "local-ai-on-mac",
        "4",
        "x",
        "social",
        "ollama_series",
        "memory_chart",
        "example.com",
        "related",
        "quantization-basics",
        "article_search"
      ],
      doubles: [1],
      indexes: ["article-id"]
    });
  });

  it("keeps the canonical aggregate when exploratory analytics is unavailable", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const db: CmsAnalyticsDatabase = {
      prepare(query) {
        return {
          bind() { return this; },
          first: query.startsWith("SELECT")
            ? vi.fn(async () => ({
                id: "article-id",
                published_revision_number: 1,
                published_slug: "durable-aggregate"
              }))
            : vi.fn(async () => null),
          run
        };
      }
    };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(recordCmsAnalyticsEvent(db, {
      writeDataPoint() { throw new Error("dataset unavailable"); }
    }, {
      ...envelope,
      articleSlug: "durable-aggregate",
      eventType: "landing"
    })).resolves.toBe("recorded");
    expect(run).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("exploratory_write_failed"));
    warning.mockRestore();
  });

  it("stores the canonical aggregate without an Analytics Engine binding", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const db: CmsAnalyticsDatabase = {
      prepare(query) {
        return {
          bind() { return this; },
          first: query.startsWith("SELECT")
            ? vi.fn(async () => ({
                id: "article-id",
                published_revision_number: 1,
                published_slug: "d1-only"
              }))
            : vi.fn(async () => null),
          run
        };
      }
    };

    await expect(recordCmsAnalyticsEvent(db, undefined, {
      ...envelope,
      articleSlug: "d1-only",
      eventType: "landing"
    })).resolves.toBe("recorded");
    expect(run).toHaveBeenCalledOnce();
  });

  it("does not write events for an unpublished slug", async () => {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const db: CmsAnalyticsDatabase = {
      prepare() {
        return {
          bind() { return this; },
          first: vi.fn(async () => null),
          run
        };
      }
    };
    const writeDataPoint = vi.fn();

    expect(await recordCmsAnalyticsEvent(db, { writeDataPoint }, {
      ...envelope,
      articleSlug: "draft-only",
      eventType: "landing"
    })).toBe("unknown_article");
    expect(run).not.toHaveBeenCalled();
    expect(writeDataPoint).not.toHaveBeenCalled();
  });

  it("deduplicates retried event IDs before incrementing the reporting mart", async () => {
    const writes: string[] = [];
    const db: CmsAnalyticsDatabase = {
      prepare(query) {
        return {
          bind() { writes.push(query); return this; },
          first: query.startsWith("SELECT")
            ? vi.fn(async () => ({
                id: "article-id",
                published_revision_number: 1,
                published_slug: "deduplicated"
              }))
            : vi.fn(async () => null),
          run: vi.fn(async () => ({ meta: { changes: query.startsWith("INSERT OR IGNORE") ? 0 : 1 } }))
        };
      }
    };

    await expect(recordCmsAnalyticsEvent(db, undefined, {
      ...envelope,
      articleSlug: "deduplicated",
      eventType: "landing"
    })).resolves.toBe("duplicate");
    expect(writes.some((query) => query.includes("duplicate_event_count"))).toBe(true);
  });
});
