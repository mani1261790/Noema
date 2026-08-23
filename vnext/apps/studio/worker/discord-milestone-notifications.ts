import type { CmsVisibility } from "@noema/cms";

export type CmsDiscordMilestoneKind =
  | "article_created"
  | "article_published"
  | "review_requested";

export interface CmsDiscordQueueMessage {
  outboxId: string;
}

export interface CmsDiscordNotificationQueue {
  send(message: CmsDiscordQueueMessage): Promise<unknown>;
}

export interface CmsDiscordOutboxInput {
  articleId: string;
  createdAt: string;
  id: string;
  kind: CmsDiscordMilestoneKind;
  revisionId: string;
  title: string;
  visibility: CmsVisibility;
}

export interface CmsDiscordConsumerEnvironment {
  CMS_DB: D1Database;
  DISCORD_WEBHOOK_URL?: string;
}

interface CmsDiscordOutboxRow {
  delivered_at: string | null;
  kind: CmsDiscordMilestoneKind;
  title: string;
  visibility: CmsVisibility;
}

interface CmsDiscordQueueMessageHandle {
  ack(): void;
  body: unknown;
  retry(options?: { delaySeconds?: number }): void;
}

interface CmsDiscordQueueBatch {
  messages: readonly CmsDiscordQueueMessageHandle[];
}

export interface DiscordWebhookResult {
  ok: boolean;
  retryAfterSeconds?: number;
  status?: number;
}

export type DiscordWebhookDeliver = (
  webhookUrl: string,
  content: string
) => Promise<DiscordWebhookResult>;

const HIDDEN_TITLE = "（限定記事）";
const RECOVERY_LIMIT = 100;
const REQUEUE_AFTER_MS = 60 * 60 * 1000;
const RETRY_DELAY_SECONDS = 300;

export function createDiscordMilestoneOutboxStatement(
  db: D1Database,
  input: CmsDiscordOutboxInput
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO cms_discord_notification_outbox (
       id, article_id, revision_id, kind, title, visibility, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    input.id,
    input.articleId,
    input.revisionId,
    input.kind,
    input.title,
    input.visibility,
    input.createdAt
  );
}

export async function enqueueDiscordMilestoneNotification(
  db: D1Database,
  queue: CmsDiscordNotificationQueue | undefined,
  outboxId: string,
  now = new Date()
): Promise<boolean> {
  if (!queue) return false;
  try {
    await queue.send({ outboxId });
    await db.prepare(
      `UPDATE cms_discord_notification_outbox
       SET queued_at = ?1, last_error = NULL
       WHERE id = ?2 AND delivered_at IS NULL`
    ).bind(now.toISOString(), outboxId).run();
    return true;
  } catch (error) {
    const message = errorMessage(error);
    try {
      await db.prepare(
        `UPDATE cms_discord_notification_outbox
         SET last_error = ?1
         WHERE id = ?2 AND delivered_at IS NULL`
      ).bind(message, outboxId).run();
    } catch (recordError) {
      console.error(JSON.stringify({
        error: errorMessage(recordError),
        event: "studio.discord_notification_enqueue_error_record_failed",
        outboxId
      }));
    }
    console.error(JSON.stringify({
      error: message,
      event: "studio.discord_notification_enqueue_failed",
      outboxId
    }));
    return false;
  }
}

export async function recoverPendingDiscordMilestoneNotifications(
  db: D1Database,
  queue: CmsDiscordNotificationQueue | undefined,
  now = new Date()
): Promise<number> {
  if (!queue) return 0;
  const staleBefore = new Date(now.getTime() - REQUEUE_AFTER_MS).toISOString();
  const result = await db.prepare(
    `SELECT id
     FROM cms_discord_notification_outbox
     WHERE delivered_at IS NULL
       AND (queued_at IS NULL OR queued_at < ?1)
     ORDER BY created_at ASC, id ASC
     LIMIT ?2`
  ).bind(staleBefore, RECOVERY_LIMIT).all<{ id: string }>();
  let queued = 0;
  for (const row of result.results ?? []) {
    if (await enqueueDiscordMilestoneNotification(db, queue, row.id, now)) queued += 1;
  }
  return queued;
}

export async function consumeDiscordMilestoneNotifications(
  batch: CmsDiscordQueueBatch,
  env: CmsDiscordConsumerEnvironment,
  now = new Date(),
  deliver: DiscordWebhookDeliver = postToDiscord
): Promise<void> {
  for (const message of batch.messages) {
    const outboxId = readOutboxId(message.body);
    if (!outboxId) {
      console.error(JSON.stringify({ event: "studio.discord_notification_message_invalid" }));
      message.ack();
      continue;
    }

    const row = await readOutboxRow(env.CMS_DB, outboxId);
    if (!row || row.delivered_at) {
      message.ack();
      continue;
    }

    const webhookUrl = env.DISCORD_WEBHOOK_URL?.trim();
    if (!webhookUrl) {
      await recordDeliveryFailure(env.CMS_DB, outboxId, "webhook_not_configured");
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
      continue;
    }

    try {
      const result = await deliver(webhookUrl, formatDiscordMilestone(row));
      if (!result.ok) {
        await recordDeliveryFailure(
          env.CMS_DB,
          outboxId,
          `discord_http_${result.status ?? "unknown"}`
        );
        message.retry({
          delaySeconds: normalizeRetryDelay(result.retryAfterSeconds)
        });
        continue;
      }
      await env.CMS_DB.prepare(
        `UPDATE cms_discord_notification_outbox
         SET delivered_at = ?1,
             attempt_count = attempt_count + 1,
             last_error = NULL
         WHERE id = ?2 AND delivered_at IS NULL`
      ).bind(now.toISOString(), outboxId).run();
      message.ack();
    } catch (error) {
      const detail = errorMessage(error);
      await recordDeliveryFailure(env.CMS_DB, outboxId, detail);
      console.error(JSON.stringify({
        error: detail,
        event: "studio.discord_notification_delivery_failed",
        outboxId
      }));
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    }
  }
}

async function readOutboxRow(
  db: D1Database,
  outboxId: string
): Promise<CmsDiscordOutboxRow | null> {
  return db.prepare(
    `SELECT kind, title, visibility, delivered_at
     FROM cms_discord_notification_outbox
     WHERE id = ?1`
  ).bind(outboxId).first<CmsDiscordOutboxRow>();
}

async function recordDeliveryFailure(
  db: D1Database,
  outboxId: string,
  detail: string
): Promise<void> {
  await db.prepare(
    `UPDATE cms_discord_notification_outbox
     SET attempt_count = attempt_count + 1, last_error = ?1
     WHERE id = ?2 AND delivered_at IS NULL`
  ).bind(detail.slice(0, 500), outboxId).run();
}

function formatDiscordMilestone(row: CmsDiscordOutboxRow): string {
  const label = row.kind === "article_created"
    ? "📝 新しい記事が作成されました"
    : row.kind === "review_requested"
      ? "👀 レビュー待ちになりました"
      : "🚀 記事を公開しました";
  const title = row.visibility === "internal" || row.visibility === "restricted"
    ? HIDDEN_TITLE
    : row.title;
  return `${label}\n**${escapeDiscordMarkdown(title)}**`;
}

function escapeDiscordMarkdown(value: string): string {
  return value.replace(/[\\`*_~|>\[\]()]/gu, "\\$&");
}

function readOutboxId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const outboxId = (value as { outboxId?: unknown }).outboxId;
  return typeof outboxId === "string" && outboxId.length > 0 && outboxId.length <= 100
    ? outboxId
    : null;
}

function normalizeRetryDelay(value: number | undefined): number {
  if (!Number.isFinite(value)) return RETRY_DELAY_SECONDS;
  return Math.min(86_400, Math.max(1, Math.ceil(value ?? RETRY_DELAY_SECONDS)));
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

async function postToDiscord(
  webhookUrl: string,
  content: string
): Promise<DiscordWebhookResult> {
  const response = await fetch(webhookUrl, {
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      content
    }),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  return {
    ok: response.ok,
    retryAfterSeconds: readRetryAfter(response.headers.get("retry-after")),
    status: response.status
  };
}

function readRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}
