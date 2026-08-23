export interface DiscordActivityLogEnvironment {
  CMS_DB?: D1Database;
  DISCORD_WEBHOOK_URL?: string;
}

export type DiscordActivityStream = "instant" | "daily";

export const DISCORD_INSTANT_CRON = "* * * * *";
export const DISCORD_DAILY_CRON = "0 8 * * *";

const INSTANT_ACTIONS = [
  "article.request_review",
  "article.withdraw_review",
  "article.approve",
  "article.revoke_approval",
  "article.request_changes",
  "article.publish",
  "article.archive",
  "article.restore"
] as const;

const ACTION_LABELS: Record<string, string> = {
  "article.approve": "✅ 承認",
  "article.archive": "📦 アーカイブ",
  "article.publish": "🚀 公開",
  "article.request_changes": "🔁 修正依頼",
  "article.request_review": "📤 レビュー依頼",
  "article.restore": "♻️ 公開に復帰",
  "article.revoke_approval": "↩️ 承認取り消し",
  "article.withdraw_review": "↩️ レビュー取り下げ"
};

const DISCORD_MESSAGE_LIMIT = 2000;
const INSTANT_EVENT_LIMIT = 20;
const DAILY_EVENT_LIMIT = 500;
const INTERNAL_TITLE = "（内部限定の記事）";
const UNTITLED = "（無題）";

interface AuditRow {
  id: string;
  article_id: string | null;
  actor_subject: string;
  action: string;
  metadata_json: string;
  created_at: string;
  actor_email: string | null;
  article_title: string | null;
  article_visibility: string | null;
}

interface DeliveryCursor {
  lastCreatedAt: string;
  lastEventId: string;
}

export type DiscordDeliver = (webhookUrl: string, content: string) => Promise<boolean>;

export function resolveDiscordActivityStream(cron: string): DiscordActivityStream | null {
  if (cron === DISCORD_INSTANT_CRON) return "instant";
  if (cron === DISCORD_DAILY_CRON) return "daily";
  return null;
}

export async function runDiscordActivityLog(
  cron: string,
  env: DiscordActivityLogEnvironment,
  now: Date,
  deliver: DiscordDeliver = postToDiscord
): Promise<void> {
  const stream = resolveDiscordActivityStream(cron);
  if (!stream || !env.CMS_DB || !env.DISCORD_WEBHOOK_URL) return;

  const db = env.CMS_DB;
  const timestamp = now.toISOString();
  const cursor = await readCursor(db, stream);
  if (!cursor) {
    // 初回起動時に過去のログをまとめて投稿しないよう、現在地までを配信済みとして記録する。
    await writeCursor(db, stream, { lastCreatedAt: timestamp, lastEventId: "" }, timestamp);
    return;
  }

  const rows = await readEvents(db, stream, cursor);
  if (rows.length === 0) return;

  const content = stream === "instant"
    ? formatInstantMessage(rows)
    : formatDailyMessage(rows, now);
  if (!content) {
    await advanceCursor(db, stream, rows, timestamp);
    return;
  }

  const delivered = await deliver(env.DISCORD_WEBHOOK_URL, content);
  if (!delivered) return;

  await advanceCursor(db, stream, rows, timestamp);
}

async function readCursor(
  db: D1Database,
  stream: DiscordActivityStream
): Promise<DeliveryCursor | null> {
  const row = await db.prepare(
    `SELECT last_created_at, last_event_id
     FROM cms_discord_deliveries
     WHERE stream = ?1`
  ).bind(stream).first<{ last_created_at: string; last_event_id: string }>();
  if (!row) return null;
  return { lastCreatedAt: row.last_created_at, lastEventId: row.last_event_id };
}

async function writeCursor(
  db: D1Database,
  stream: DiscordActivityStream,
  cursor: DeliveryCursor,
  timestamp: string
): Promise<void> {
  await db.prepare(
    `INSERT INTO cms_discord_deliveries
      (stream, last_created_at, last_event_id, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (stream) DO UPDATE SET
       last_created_at = excluded.last_created_at,
       last_event_id = excluded.last_event_id,
       updated_at = excluded.updated_at`
  ).bind(stream, cursor.lastCreatedAt, cursor.lastEventId, timestamp).run();
}

async function advanceCursor(
  db: D1Database,
  stream: DiscordActivityStream,
  rows: AuditRow[],
  timestamp: string
): Promise<void> {
  const last = rows[rows.length - 1];
  await writeCursor(
    db,
    stream,
    { lastCreatedAt: last.created_at, lastEventId: last.id },
    timestamp
  );
}

async function readEvents(
  db: D1Database,
  stream: DiscordActivityStream,
  cursor: DeliveryCursor
): Promise<AuditRow[]> {
  const placeholders = INSTANT_ACTIONS.map((_, index) => `?${index + 4}`).join(", ");
  const actionFilter = stream === "instant"
    ? `AND e.action IN (${placeholders})`
    : `AND e.action NOT IN (${placeholders})`;
  const result = await db.prepare(
    `SELECT
       e.id,
       e.article_id,
       e.actor_subject,
       e.action,
       e.metadata_json,
       e.created_at,
       m.email AS actor_email,
       json_extract(r.frontmatter_json, '$.title') AS article_title,
       COALESCE(a.published_visibility, a.draft_visibility) AS article_visibility
     FROM cms_audit_events e
     LEFT JOIN cms_members m ON m.subject = e.actor_subject
     LEFT JOIN cms_articles a ON a.id = e.article_id
     LEFT JOIN cms_article_revisions r ON r.id = a.current_revision_id
     WHERE (e.created_at > ?1 OR (e.created_at = ?1 AND e.id > ?2))
       ${actionFilter}
     ORDER BY e.created_at ASC, e.id ASC
     LIMIT ?3`
  ).bind(
    cursor.lastCreatedAt,
    cursor.lastEventId,
    stream === "instant" ? INSTANT_EVENT_LIMIT : DAILY_EVENT_LIMIT,
    ...INSTANT_ACTIONS
  ).all<AuditRow>();
  return result.results ?? [];
}

function formatInstantMessage(rows: AuditRow[]): string {
  const lines = rows.map((row) => {
    const label = ACTION_LABELS[row.action] ?? row.action;
    return `${label} — **${articleTitle(row)}**（${actorName(row)} · ${formatTime(row.created_at)}）`;
  });
  return truncate(lines.join("\n"));
}

interface DailyArticleEntry {
  title: string;
  created: boolean;
  manualSaves: number;
  autoSaves: number;
  comments: number;
}

function formatDailyMessage(rows: AuditRow[], now: Date): string {
  const articles = new Map<string, DailyArticleEntry>();
  const actors = new Set<string>();
  let assetEvents = 0;
  let otherEvents = 0;

  for (const row of rows) {
    actors.add(actorName(row));
    if (row.action.startsWith("asset.")) {
      assetEvents += 1;
      continue;
    }
    if (!row.article_id) {
      otherEvents += 1;
      continue;
    }
    const entry = articles.get(row.article_id) ?? {
      title: articleTitle(row),
      created: false,
      manualSaves: 0,
      autoSaves: 0,
      comments: 0
    };
    if (row.action === "article.created") entry.created = true;
    else if (row.action === "article.revised") {
      if (readSaveReason(row.metadata_json) === "autosave") entry.autoSaves += 1;
      else entry.manualSaves += 1;
    } else if (row.action.startsWith("article.comment")) entry.comments += 1;
    else otherEvents += 1;
    articles.set(row.article_id, entry);
  }

  if (articles.size === 0 && assetEvents === 0 && otherEvents === 0) return "";

  const lines = [`📓 **Noema 執筆ログ — ${formatDate(now)}**`, ""];
  for (const entry of articles.values()) {
    const parts: string[] = [];
    if (entry.created) parts.push("新規作成");
    if (entry.manualSaves > 0) parts.push(`保存${entry.manualSaves}回`);
    if (entry.autoSaves > 0) parts.push(`自動保存${entry.autoSaves}回`);
    if (entry.comments > 0) parts.push(`レビューコメント${entry.comments}件`);
    lines.push(`・**${entry.title}** — ${parts.length > 0 ? parts.join(" / ") : "更新あり"}`);
  }
  if (assetEvents > 0) lines.push(`・画像の追加・更新 ${assetEvents}件`);
  if (actors.size > 0) {
    lines.push("");
    lines.push(`執筆: ${[...actors].join(", ")}`);
  }
  return truncate(lines.join("\n"));
}

function readSaveReason(metadataJson: string): string | null {
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    if (typeof parsed !== "object" || parsed === null) return null;
    const reason = (parsed as { saveReason?: unknown }).saveReason;
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}

function articleTitle(row: AuditRow): string {
  if (row.article_visibility === "internal") return INTERNAL_TITLE;
  const title = row.article_title?.trim();
  return title ? title : UNTITLED;
}

function actorName(row: AuditRow): string {
  const email = row.actor_email?.trim();
  if (!email) return "メンバー";
  const localPart = email.split("@")[0];
  return localPart || "メンバー";
}

function formatTime(isoTimestamp: string): string {
  const value = new Date(isoTimestamp);
  if (Number.isNaN(value.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tokyo"
  }).format(value);
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    day: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
    year: "numeric"
  }).format(value);
}

function truncate(content: string): string {
  if (content.length <= DISCORD_MESSAGE_LIMIT) return content;
  return `${content.slice(0, DISCORD_MESSAGE_LIMIT - 1)}…`;
}

async function postToDiscord(webhookUrl: string, content: string): Promise<boolean> {
  try {
    const response = await fetch(webhookUrl, {
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        content
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    return response.ok;
  } catch {
    return false;
  }
}
