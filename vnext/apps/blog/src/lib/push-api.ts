import { parsePushSubscription, pushSubscriptionId } from "@noema/cms";
import type { CmsAnalyticsDatabase, CmsAnalyticsRateLimiter } from "./analytics";
export interface ReaderPushEnvironment {
  CMS_DB: CmsAnalyticsDatabase;
  PUSH_VAPID_PUBLIC_KEY?: string;
  PUSH_RATE_LIMITER?: CmsAnalyticsRateLimiter;
}
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const origins = new Set(["https://noema-learn.uk", "https://noema-learn.mani1261790.workers.dev", "http://localhost:4324"]);
export async function handleReaderPush(request: Request, env: ReaderPushEnvironment): Promise<Response> {
  const url = new URL(request.url);
  if (!origins.has(url.origin)) return json({ error: "origin" }, 403);
  if (request.method === "GET") return json({ enabled: Boolean(env.PUSH_VAPID_PUBLIC_KEY), publicKey: env.PUSH_VAPID_PUBLIC_KEY ?? null });
  if (!["POST", "DELETE"].includes(request.method)) return json({ error: "method" }, 405);
  if (request.headers.get("origin") !== url.origin) return json({ error: "origin" }, 403);
  if (!env.PUSH_RATE_LIMITER || !(await env.PUSH_RATE_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" })).success) return json({ error: "rate_limit" }, 429);
  if (request.method === "POST" && !env.PUSH_VAPID_PUBLIC_KEY) return json({ error: "unavailable" }, 503);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "json_required" }, 415);
  // Bound bytes while streaming; Content-Length alone is not trustworthy.
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "subscription" }, 400);
  let body = ""; let size = 0; const decoder = new TextDecoder();
  while (true) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > 4096) { await reader.cancel(); return json({ error: "too_large" }, 413); }
    body += decoder.decode(part.value, { stream: true });
  }
  let subscription; let statusOnly = false;
  try { const value = JSON.parse(body + decoder.decode()); subscription = parsePushSubscription(value); statusOnly = value.action === "status"; } catch { return json({ error: "subscription" }, 400); }
  if (!subscription) return json({ error: "subscription" }, 400);
  const id = await pushSubscriptionId(url.origin, subscription.endpoint);
  if (request.method === "DELETE") {
    await env.CMS_DB.prepare("DELETE FROM reader_push_subscriptions WHERE id = ? AND auth = ? AND p256dh = ?")
      .bind(id, subscription.keys.auth, subscription.keys.p256dh).run();
    return json({ ok: true });
  }
  if (statusOnly) {
    const result = await env.CMS_DB.prepare("UPDATE reader_push_subscriptions SET expires_at = unixepoch() + 15552000 WHERE id = ? AND auth = ? AND p256dh = ? AND expires_at > unixepoch() RETURNING id")
      .bind(id, subscription.keys.auth, subscription.keys.p256dh).first();
    return json({ active: Boolean(result) });
  }
  const result = await env.CMS_DB.prepare(`INSERT INTO reader_push_subscriptions(id, origin, endpoint, p256dh, auth, expires_at)
    SELECT ?, ?, ?, ?, ?, unixepoch() + 15552000
    WHERE (SELECT COUNT(*) FROM reader_push_subscriptions) < 10000 OR EXISTS (SELECT 1 FROM reader_push_subscriptions WHERE id = ?)
    ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at
    WHERE reader_push_subscriptions.auth = excluded.auth AND reader_push_subscriptions.p256dh = excluded.p256dh
    RETURNING id`).bind(id, url.origin, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, id).first();
  return result ? json({ ok: true }) : json({ error: "registration_unavailable" }, 409);
}
