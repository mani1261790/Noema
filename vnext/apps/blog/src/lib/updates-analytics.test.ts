import { describe, expect, it, vi } from "vitest";
import {
  createUpdatesActionTracker,
  sourceArticleFromUpdatesUrl
} from "./updates-analytics";

describe("updates analytics", () => {
  it("accepts only a canonical article slug from the URL fragment", () => {
    expect(sourceArticleFromUpdatesUrl(new URL(
      "https://noema.example/updates#from=local-ai-on-mac"
    ))).toBe("local-ai-on-mac");
    expect(sourceArticleFromUpdatesUrl(new URL(
      "https://noema.example/updates?from=ignored#from=%E8%B3%AA%E5%95%8F"
    ))).toBeNull();
    expect(sourceArticleFromUpdatesUrl(new URL(
      `https://noema.example/updates#from=${"a".repeat(101)}`
    ))).toBeNull();
  });

  it("sends one content-free action event for the source article per page view", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    const track = createUpdatesActionTracker(
      new URL("https://noema.example/updates#from=local-ai-on-mac"),
      {
        fetcher,
        now: () => new Date("2026-08-28T01:02:03.000Z"),
        randomUUID: () => "019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e"
      }
    );

    expect(track).not.toBeNull();
    await Promise.all([track?.(), track?.()]);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith("/api/analytics/events", expect.objectContaining({
      body: JSON.stringify({
        articleSlug: "local-ai-on-mac",
        eventId: "019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e",
        eventType: "updates_action",
        occurredAt: "2026-08-28T01:02:03.000Z",
        schemaVersion: 1
      }),
      keepalive: true,
      method: "POST"
    }));
  });

  it("does not create a tracker for a direct updates-page visit", () => {
    expect(createUpdatesActionTracker(new URL("https://noema.example/updates"))).toBeNull();
  });

  it("retries a transient failure with the same event envelope", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const track = createUpdatesActionTracker(
      new URL("https://noema.example/updates#from=retry-source"),
      {
        fetcher,
        now: () => new Date("2026-08-28T01:02:03.000Z"),
        randomUUID: () => "019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e"
      }
    );

    await track?.();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(fetcher.mock.calls[1]?.[1]?.body);
  });
});
