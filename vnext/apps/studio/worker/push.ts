import { buildPushPayload } from "@block65/webcrypto-web-push";
import { allowedPushEndpoint } from "@noema/cms";
export interface PushEnvironment { CMS_DB: D1Database; PUSH_VAPID_PUBLIC_KEY?: string; PUSH_VAPID_PRIVATE_KEY?: string }
export async function dispatchReaderPush(env: PushEnvironment, fetcher: typeof fetch = fetch): Promise<void> {
  if (!env.PUSH_VAPID_PUBLIC_KEY || !env.PUSH_VAPID_PRIVATE_KEY) return;
  const db = env.CMS_DB;
  await db.prepare("DELETE FROM reader_push_subscriptions WHERE expires_at < unixepoch()").run();
  const events = await db.prepare("SELECT article_id FROM reader_push_events WHERE expanded = 0 ORDER BY created_at LIMIT 3").all<{article_id: string}>();
  for (const event of events.results) {
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO reader_push_deliveries(article_id, subscription_id)
        SELECT e.article_id, s.id FROM reader_push_events e JOIN cms_articles a ON a.id = e.article_id
        CROSS JOIN reader_push_subscriptions s WHERE e.article_id = ? AND e.expanded = 0
        AND e.created_at > unixepoch() - 86400 AND s.created_at <= e.created_at
        AND s.expires_at > unixepoch() AND a.publication_status = 'published' AND a.published_visibility = 'public'`).bind(event.article_id),
      db.prepare("UPDATE reader_push_events SET expanded = 1 WHERE article_id = ?").bind(event.article_id),
    ]);
  }
  const claims = await db.prepare(`UPDATE reader_push_deliveries SET lease_until = unixepoch() + 120, attempts = attempts + 1
    WHERE rowid IN (SELECT d.rowid FROM reader_push_deliveries d JOIN reader_push_events e ON e.article_id = d.article_id
      WHERE d.status = 'pending' AND d.next_attempt <= unixepoch() AND d.lease_until < unixepoch()
      AND d.attempts < 5 AND e.created_at > unixepoch() - 86400 LIMIT 30)
    RETURNING article_id, subscription_id, attempts`).all<{article_id: string; subscription_id: string; attempts: number}>();
  const deliver = async (claim: (typeof claims.results)[number]) => {
    const row = await db.prepare(`SELECT s.endpoint, s.auth, s.p256dh, s.origin, a.published_slug, r.frontmatter_json
      FROM reader_push_subscriptions s JOIN cms_articles a ON a.id = ?
      JOIN cms_article_revisions r ON r.id = a.published_revision_id
      WHERE s.id = ? AND a.publication_status = 'published' AND a.published_visibility = 'public'`)
      .bind(claim.article_id, claim.subscription_id).first<{endpoint: string; auth: string; p256dh: string; origin: string; published_slug: string; frontmatter_json: string}>();
    let status = "failed";
    if (row && allowedPushEndpoint(row.endpoint)) {
      try {
        const article = JSON.parse(row.frontmatter_json) as {title: string; description: string};
        const payload = await buildPushPayload({ data: JSON.stringify({
          title: String(article.title).slice(0, 120), body: String(article.description).slice(0, 160),
          url: `/articles/${row.published_slug}`, tag: `noema-${claim.article_id}`,
        }), options: { ttl: 3600 } }, { endpoint: row.endpoint, expirationTime: null, keys: { auth: row.auth, p256dh: row.p256dh } }, {
          subject: "https://noema-learn.uk", publicKey: env.PUSH_VAPID_PUBLIC_KEY, privateKey: env.PUSH_VAPID_PRIVATE_KEY,
        });
        const response = await fetcher(row.endpoint, { ...payload, redirect: "error", signal: AbortSignal.timeout(8000) });
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410) {
          await db.prepare("DELETE FROM reader_push_subscriptions WHERE id = ?").bind(claim.subscription_id).run(); return;
        }
        status = response.ok ? "sent" : (response.status === 429 || response.status >= 500) && claim.attempts < 5 ? "pending" : "failed";
      } catch { status = claim.attempts < 5 ? "pending" : "failed"; }
    }
    await db.prepare("UPDATE reader_push_deliveries SET status = ?, next_attempt = unixepoch() + ?, lease_until = 0 WHERE article_id = ? AND subscription_id = ?")
      .bind(status, 60 * 2 ** claim.attempts, claim.article_id, claim.subscription_id).run();
  }
  for (let start = 0; start < claims.results.length; start += 5) {
    await Promise.all(claims.results.slice(start, start + 5).map(deliver));
  }
  await db.prepare("DELETE FROM reader_push_deliveries WHERE article_id IN (SELECT article_id FROM reader_push_events WHERE created_at < unixepoch() - 604800)").run();
}
