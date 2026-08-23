import { describe, expect, it, vi } from "vitest";
import { recordCmsAnalyticsEvent, type CmsAnalyticsDatabase } from "./analytics";

describe("reader analytics", () => {
  it("binds a published revision to both long-term and exploratory analytics", async () => {
    const first = vi.fn(async () => ({
      id: "article-id",
      published_revision_number: 4,
      published_slug: "local-ai-on-mac"
    }));
    const run = vi.fn(async () => undefined);
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
      articleSlug: "local-ai-on-mac",
      attribution: {
        campaign: "ollama_series",
        content: "memory_chart",
        medium: "social",
        referrerHost: "example.com",
        source: "x"
      },
      eventType: "navigation_click",
      navigationKind: "related",
      targetSlug: "quantization-basics"
    }, { now: new Date("2026-08-23T01:02:03.000Z") });

    expect(recorded).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(boundValues[1]).toEqual([
      "2026-08-23",
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
      "2026-08-23T01:02:03.000Z"
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
        "quantization-basics"
      ],
      doubles: [1],
      indexes: ["article-id"]
    });
  });

  it("keeps the canonical aggregate when exploratory analytics is unavailable", async () => {
    const run = vi.fn(async () => undefined);
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
      articleSlug: "durable-aggregate",
      eventType: "landing"
    })).resolves.toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("exploratory_write_failed"));
    warning.mockRestore();
  });

  it("does not write events for an unpublished slug", async () => {
    const run = vi.fn(async () => undefined);
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
      articleSlug: "draft-only",
      eventType: "landing"
    })).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(writeDataPoint).not.toHaveBeenCalled();
  });
});
