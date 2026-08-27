const ARTICLE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface UpdatesActionTrackerOptions {
  fetcher?: Fetcher;
  now?: () => Date;
  randomUUID?: () => string;
}

export function sourceArticleFromUpdatesUrl(url: URL): string | null {
  const parameters = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
  const articleSlug = parameters.get("from")?.trim() ?? "";
  return articleSlug.length <= 100 && ARTICLE_SLUG_PATTERN.test(articleSlug)
    ? articleSlug
    : null;
}

export function createUpdatesActionTracker(
  url: URL,
  options: UpdatesActionTrackerOptions = {}
): (() => Promise<void>) | null {
  const articleSlug = sourceArticleFromUpdatesUrl(url);
  if (!articleSlug) return null;

  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  let sent = false;

  return async () => {
    if (sent) return;
    sent = true;
    const payload = JSON.stringify({
      articleSlug,
      eventId: randomUUID(),
      eventType: "updates_action",
      occurredAt: now().toISOString(),
      schemaVersion: 1
    });
    const send = () => fetcher("/api/analytics/events", {
      body: payload,
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST"
    });

    try {
      const response = await send();
      if (response.status === 429 || response.status >= 500) {
        try {
          await send();
        } catch {
          // The first reader action remains successful when the retry fails.
        }
      }
    } catch {
      try {
        await send();
      } catch {
        // RSS actions must never be interrupted by analytics availability.
      }
    }
  };
}
