import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  type D1Migration
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCmsArticle,
  resolveCmsSession,
  transitionCmsArticle,
  updateCmsArticle
} from "../worker/cms-repository";
import {
  consumeDiscordMilestoneNotifications,
  recoverPendingDiscordMilestoneNotifications,
  type CmsDiscordNotificationQueue,
  type CmsDiscordQueueMessage
} from "../worker/discord-milestone-notifications";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const NOW = new Date("2026-08-24T00:00:00.000Z");

beforeAll(async () => {
  await applyD1Migrations(testEnv.CMS_DB, testEnv.CMS_TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.CMS_DB.batch([
    testEnv.CMS_DB.prepare("DELETE FROM cms_discord_notification_outbox"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_review_comments"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_audiences"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_references"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_members"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_member_invitations")
  ]);
});

describe("Discord milestone notifications", () => {
  it("queues only creation, review request, and a new publication revision", async () => {
    const admin = await bootstrapAdmin();
    const queue = queueCollector();
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      articleInput("milestones", "最初の記事"),
      NOW,
      { notificationQueue: queue }
    );

    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      articleInput("milestones", "更新後の記事"),
      new Date("2026-08-24T00:01:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:02:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "approve",
      article.lockVersion,
      { note: "確認しました。" },
      new Date("2026-08-24T00:03:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "publish",
      article.lockVersion,
      { visibility: "public" },
      new Date("2026-08-24T00:04:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "revoke_approval",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:05:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "approve",
      article.lockVersion,
      { note: "再確認しました。" },
      new Date("2026-08-24T00:06:00.000Z"),
      { notificationQueue: queue }
    );
    await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "publish",
      article.lockVersion,
      { visibility: "public" },
      new Date("2026-08-24T00:07:00.000Z"),
      { notificationQueue: queue }
    );

    expect(queue.messages).toHaveLength(3);
    const result = await testEnv.CMS_DB.prepare(
      `SELECT kind, title, revision_id
       FROM cms_discord_notification_outbox
       ORDER BY created_at ASC`
    ).all<{ kind: string; revision_id: string; title: string }>();
    expect(result.results.map((row) => row.kind)).toEqual([
      "article_created",
      "review_requested",
      "article_published"
    ]);
    expect(result.results.map((row) => row.title)).toEqual([
      "最初の記事",
      "更新後の記事",
      "更新後の記事"
    ]);
    expect(new Set(result.results.map((row) => row.revision_id)).size).toBe(2);
  });

  it("queues every explicit review request but not other review transitions", async () => {
    const admin = await bootstrapAdmin();
    const queue = queueCollector();
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      articleInput("review-cycle", "レビューサイクル"),
      NOW,
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:01:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "withdraw_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:02:00.000Z"),
      { notificationQueue: queue }
    );
    await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:03:00.000Z"),
      { notificationQueue: queue }
    );

    expect(queue.messages).toHaveLength(3);
    const reviewCount = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_discord_notification_outbox WHERE kind = 'review_requested'"
    ).first<number>("count");
    expect(reviewCount).toBe(2);
  });

  it("queues publication again only after a newer revision is approved", async () => {
    const admin = await bootstrapAdmin();
    const queue = queueCollector();
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      articleInput("new-publication-revision", "公開revision 1"),
      NOW,
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:01:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "approve",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:02:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "publish",
      article.lockVersion,
      { visibility: "public" },
      new Date("2026-08-24T00:03:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "revoke_approval",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:04:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "withdraw_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:04:30.000Z"),
      { notificationQueue: queue }
    );
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      articleInput("new-publication-revision", "公開revision 2"),
      new Date("2026-08-24T00:05:00.000Z"),
      { notificationQueue: queue }
    );
    expect(article.currentRevision.number).toBe(2);
    expect(queue.messages).toHaveLength(3);

    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:06:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "approve",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:07:00.000Z"),
      { notificationQueue: queue }
    );
    await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "publish",
      article.lockVersion,
      { visibility: "public" },
      new Date("2026-08-24T00:08:00.000Z"),
      { notificationQueue: queue }
    );

    expect(queue.messages).toHaveLength(5);
    const publications = await testEnv.CMS_DB.prepare(
      `SELECT revision_id, title
       FROM cms_discord_notification_outbox
       WHERE kind = 'article_published'
       ORDER BY created_at ASC`
    ).all<{ revision_id: string; title: string }>();
    expect(publications.results.map((row) => row.title)).toEqual([
      "公開revision 1",
      "公開revision 2"
    ]);
    expect(new Set(publications.results.map((row) => row.revision_id)).size).toBe(2);
  });

  it("does not expose an internal draft title while an older revision stays public", async () => {
    const admin = await bootstrapAdmin();
    const queue = queueCollector();
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      articleInput("public-with-internal-draft", "公開中の題名"),
      NOW,
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:01:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "approve",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:02:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "publish",
      article.lockVersion,
      { visibility: "public" },
      new Date("2026-08-24T00:03:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "revoke_approval",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:04:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "withdraw_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:04:30.000Z"),
      { notificationQueue: queue }
    );
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      {
        ...articleInput("public-with-internal-draft", "外へ出せないrevision 2の題名"),
        visibility: "internal"
      },
      new Date("2026-08-24T00:05:00.000Z"),
      { notificationQueue: queue }
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-08-24T00:06:00.000Z"),
      { notificationQueue: queue }
    );

    expect(article.publicationStatus).toBe("published");
    expect(article.publishedRevisionNumber).toBe(1);
    expect(article.currentRevision.number).toBe(2);
    const message = messageHandle(queue.messages.at(-1));
    const contents: string[] = [];
    await consumeDiscordMilestoneNotifications(
      { messages: [message] },
      { CMS_DB: testEnv.CMS_DB, DISCORD_WEBHOOK_URL: "https://discord.test/webhook" },
      new Date("2026-08-24T00:07:00.000Z"),
      async (_url, content) => {
        contents.push(content);
        return { ok: true, status: 204 };
      }
    );

    expect(contents).toEqual(["👀 レビュー待ちになりました\n**（限定記事）**"]);
    expect(contents[0]).not.toContain("公開中の題名");
    expect(contents[0]).not.toContain("外へ出せないrevision 2の題名");
  });

  it.each(["internal", "restricted"] as const)(
    "hides the title of a %s article at delivery time",
    async (visibility) => {
      const admin = await bootstrapAdmin();
      const queue = queueCollector();
      await createCmsArticle(
        testEnv.CMS_DB,
        admin.identity,
        { ...articleInput(`hidden-${visibility}`, "外へ出せない題名"), visibility },
        NOW,
        { notificationQueue: queue }
      );
      const message = messageHandle(queue.messages[0]);
      const contents: string[] = [];

      await consumeDiscordMilestoneNotifications(
        { messages: [message] },
        { CMS_DB: testEnv.CMS_DB, DISCORD_WEBHOOK_URL: "https://discord.test/webhook" },
        new Date("2026-08-24T00:01:00.000Z"),
        async (_url, content) => {
          contents.push(content);
          return { ok: true, status: 204 };
        }
      );

      expect(contents).toEqual(["📝 新しい記事が作成されました\n**（限定記事）**"]);
      expect(contents[0]).not.toContain("外へ出せない題名");
      expect(message.ack).toHaveBeenCalledOnce();
      expect(message.retry).not.toHaveBeenCalled();
    }
  );

  it("disables mentions and escapes Discord Markdown in public titles", async () => {
    const admin = await bootstrapAdmin();
    const queue = queueCollector();
    await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      articleInput("safe-markdown", "**重要** @everyone [確認](https://example.com)"),
      NOW,
      { notificationQueue: queue }
    );
    const message = messageHandle(queue.messages[0]);
    let payload: { allowed_mentions?: unknown; content?: unknown } | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      payload = JSON.parse(String(init?.body)) as typeof payload;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await consumeDiscordMilestoneNotifications(
        { messages: [message] },
        { CMS_DB: testEnv.CMS_DB, DISCORD_WEBHOOK_URL: "https://discord.test/webhook" },
        new Date("2026-08-24T00:01:00.000Z")
      );
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(payload).toEqual({
      allowed_mentions: { parse: [] },
      content: "📝 新しい記事が作成されました\n**\\*\\*重要\\*\\* @everyone \\[確認\\]\\(https://example.com\\)**"
    });
  });

  it("retries rejected deliveries and skips an already delivered outbox row", async () => {
    const admin = await bootstrapAdmin();
    const queue = queueCollector();
    await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      articleInput("retry", "再送する記事"),
      NOW,
      { notificationQueue: queue }
    );
    const first = messageHandle(queue.messages[0]);
    await consumeDiscordMilestoneNotifications(
      { messages: [first] },
      { CMS_DB: testEnv.CMS_DB, DISCORD_WEBHOOK_URL: "https://discord.test/webhook" },
      new Date("2026-08-24T00:01:00.000Z"),
      async () => ({ ok: false, retryAfterSeconds: 2, status: 429 })
    );
    expect(first.retry).toHaveBeenCalledWith({ delaySeconds: 2 });
    expect(first.ack).not.toHaveBeenCalled();

    const second = messageHandle(queue.messages[0]);
    const deliver = vi.fn(async () => ({ ok: true, status: 204 }));
    await consumeDiscordMilestoneNotifications(
      { messages: [second] },
      { CMS_DB: testEnv.CMS_DB, DISCORD_WEBHOOK_URL: "https://discord.test/webhook" },
      new Date("2026-08-24T00:02:00.000Z"),
      deliver
    );
    expect(second.ack).toHaveBeenCalledOnce();

    const duplicate = messageHandle(queue.messages[0]);
    await consumeDiscordMilestoneNotifications(
      { messages: [duplicate] },
      { CMS_DB: testEnv.CMS_DB, DISCORD_WEBHOOK_URL: "https://discord.test/webhook" },
      new Date("2026-08-24T00:03:00.000Z"),
      deliver
    );
    expect(duplicate.ack).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledOnce();
    const row = await testEnv.CMS_DB.prepare(
      `SELECT attempt_count, delivered_at, last_error
       FROM cms_discord_notification_outbox
       WHERE id = ?1`
    ).bind(queue.messages[0]?.outboxId).first<{
      attempt_count: number;
      delivered_at: string | null;
      last_error: string | null;
    }>();
    expect(row).toEqual({
      attempt_count: 2,
      delivered_at: "2026-08-24T00:02:00.000Z",
      last_error: null
    });
  });

  it("recovers an outbox row when the first Queue send fails", async () => {
    const admin = await bootstrapAdmin();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingQueue: CmsDiscordNotificationQueue = {
      async send() {
        throw new Error("queue unavailable");
      }
    };
    await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      articleInput("recover", "回収する記事"),
      NOW,
      { notificationQueue: failingQueue }
    );
    const pending = await testEnv.CMS_DB.prepare(
      "SELECT queued_at, delivered_at, last_error FROM cms_discord_notification_outbox"
    ).first<{ delivered_at: string | null; last_error: string | null; queued_at: string | null }>();
    expect(pending).toEqual({
      delivered_at: null,
      last_error: "queue unavailable",
      queued_at: null
    });

    const recoveredQueue = queueCollector();
    const recovered = await recoverPendingDiscordMilestoneNotifications(
      testEnv.CMS_DB,
      recoveredQueue,
      new Date("2026-08-24T01:01:00.000Z")
    );
    expect(recovered).toBe(1);
    expect(recoveredQueue.messages).toHaveLength(1);
    const queuedAt = await testEnv.CMS_DB.prepare(
      "SELECT queued_at FROM cms_discord_notification_outbox"
    ).first<string | null>("queued_at");
    expect(queuedAt).toBe("2026-08-24T01:01:00.000Z");
    consoleError.mockRestore();
  });
});

function queueCollector(): CmsDiscordNotificationQueue & { messages: CmsDiscordQueueMessage[] } {
  const messages: CmsDiscordQueueMessage[] = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
    }
  };
}

function messageHandle(body: CmsDiscordQueueMessage | undefined) {
  if (!body) throw new Error("Queue message was not created.");
  return {
    ack: vi.fn(),
    body,
    retry: vi.fn()
  };
}

async function bootstrapAdmin() {
  return resolveCmsSession(
    testEnv.CMS_DB,
    { email: "owner@example.com", subject: "owner-subject" },
    "owner@example.com",
    NOW
  );
}

function articleInput(slug: string, title: string) {
  return {
    frontmatter: {
      title,
      description: "Discordへ記事の節目だけを通知するための確認用記事です。",
      slug,
      status: "draft" as const,
      updatedAt: "2026-08-24",
      authors: ["Noema編集部"],
      topics: ["development-environment" as const],
      tags: ["CMS"],
      approach: "development" as const,
      outcome: "通知する節目を確認できる",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    },
    markdown: "## 通知する節目\n\n保存回数ではなく状態遷移を通知します。",
    visibility: "public" as const
  };
}
