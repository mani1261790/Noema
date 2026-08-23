import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  type D1Migration
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCmsArticle,
  resolveCmsSession,
  transitionCmsArticle,
  updateCmsArticle
} from "../worker/cms-repository";
import {
  DISCORD_DAILY_CRON,
  DISCORD_INSTANT_CRON,
  runDiscordActivityLog
} from "../worker/discord-activity-log";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const NOW = new Date("2026-08-23T01:00:00.000Z");
const WEBHOOK_URL = "https://discord.test/webhook";

beforeAll(async () => {
  await applyD1Migrations(testEnv.CMS_DB, testEnv.CMS_TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.CMS_DB.batch([
    testEnv.CMS_DB.prepare("DELETE FROM cms_discord_deliveries"),
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

describe("Discord activity log", () => {
  it("records a starting point without posting the existing backlog", async () => {
    const admin = await bootstrapAdmin();
    await createCmsArticle(testEnv.CMS_DB, admin.identity, article("first-run"), NOW);

    const posts = collector();
    await runDiscordActivityLog(DISCORD_DAILY_CRON, environment(), NOW, posts.deliver);

    expect(posts.contents).toHaveLength(0);
    const cursor = await readCursor("daily");
    expect(cursor?.last_created_at).toBe(NOW.toISOString());
  });

  it("posts review and publication milestones as they happen", async () => {
    const admin = await bootstrapAdmin();
    const posts = collector();
    await runDiscordActivityLog(DISCORD_INSTANT_CRON, environment(), NOW, posts.deliver);

    const created = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article("milestones"),
      new Date("2026-08-23T01:10:00.000Z")
    );
    await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      created.id,
      "request_review",
      created.lockVersion,
      {},
      new Date("2026-08-23T01:20:00.000Z")
    );

    await runDiscordActivityLog(
      DISCORD_INSTANT_CRON,
      environment(),
      new Date("2026-08-23T01:21:00.000Z"),
      posts.deliver
    );

    expect(posts.contents).toHaveLength(1);
    expect(posts.contents[0]).toContain("レビュー依頼");
    expect(posts.contents[0]).toContain("Discord通知の記事");
    expect(posts.contents[0]).toContain("owner");
    expect(posts.contents[0]).not.toContain("新規作成");
  });

  it("keeps saves out of the instant stream and folds them into the daily summary", async () => {
    const admin = await bootstrapAdmin();
    const posts = collector();
    await runDiscordActivityLog(DISCORD_INSTANT_CRON, environment(), NOW, posts.deliver);
    await runDiscordActivityLog(DISCORD_DAILY_CRON, environment(), NOW, posts.deliver);

    const created = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article("daily-summary"),
      new Date("2026-08-23T01:10:00.000Z")
    );
    await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      created.id,
      created.lockVersion,
      article("daily-summary"),
      new Date("2026-08-23T01:15:00.000Z"),
      {},
      { saveReason: "manual" }
    );

    await runDiscordActivityLog(
      DISCORD_INSTANT_CRON,
      environment(),
      new Date("2026-08-23T01:20:00.000Z"),
      posts.deliver
    );
    expect(posts.contents).toHaveLength(0);

    await runDiscordActivityLog(
      DISCORD_DAILY_CRON,
      environment(),
      new Date("2026-08-23T13:00:00.000Z"),
      posts.deliver
    );

    expect(posts.contents).toHaveLength(1);
    expect(posts.contents[0]).toContain("Noema 執筆ログ");
    expect(posts.contents[0]).toContain("新規作成");
    expect(posts.contents[0]).toContain("保存1回");
  });

  it("hides the title of an internal article", async () => {
    const admin = await bootstrapAdmin();
    const posts = collector();
    await runDiscordActivityLog(DISCORD_DAILY_CRON, environment(), NOW, posts.deliver);

    await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      { ...article("internal-draft"), visibility: "internal" as const },
      new Date("2026-08-23T01:10:00.000Z")
    );

    await runDiscordActivityLog(
      DISCORD_DAILY_CRON,
      environment(),
      new Date("2026-08-23T13:00:00.000Z"),
      posts.deliver
    );

    expect(posts.contents).toHaveLength(1);
    expect(posts.contents[0]).toContain("（内部限定の記事）");
    expect(posts.contents[0]).not.toContain("Discord通知の記事");
  });

  it("retries the same events when Discord rejects the delivery", async () => {
    const admin = await bootstrapAdmin();
    const failing = collector(false);
    await runDiscordActivityLog(DISCORD_DAILY_CRON, environment(), NOW, failing.deliver);

    await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article("retry"),
      new Date("2026-08-23T01:10:00.000Z")
    );

    await runDiscordActivityLog(
      DISCORD_DAILY_CRON,
      environment(),
      new Date("2026-08-23T13:00:00.000Z"),
      failing.deliver
    );
    expect(failing.contents).toHaveLength(1);

    const succeeding = collector();
    await runDiscordActivityLog(
      DISCORD_DAILY_CRON,
      environment(),
      new Date("2026-08-23T13:01:00.000Z"),
      succeeding.deliver
    );
    expect(succeeding.contents).toHaveLength(1);
    expect(succeeding.contents[0]).toContain("新規作成");
  });

  it("stays idle when the webhook is not configured", async () => {
    const admin = await bootstrapAdmin();
    await createCmsArticle(testEnv.CMS_DB, admin.identity, article("no-webhook"), NOW);

    const posts = collector();
    await runDiscordActivityLog(
      DISCORD_DAILY_CRON,
      { CMS_DB: testEnv.CMS_DB },
      NOW,
      posts.deliver
    );

    expect(posts.contents).toHaveLength(0);
    expect(await readCursor("daily")).toBeNull();
  });
});

function environment() {
  return { CMS_DB: testEnv.CMS_DB, DISCORD_WEBHOOK_URL: WEBHOOK_URL };
}

function collector(succeeds = true) {
  const contents: string[] = [];
  return {
    contents,
    deliver: async (webhookUrl: string, content: string) => {
      expect(webhookUrl).toBe(WEBHOOK_URL);
      contents.push(content);
      return succeeds;
    }
  };
}

async function readCursor(stream: string) {
  return testEnv.CMS_DB.prepare(
    "SELECT last_created_at, last_event_id FROM cms_discord_deliveries WHERE stream = ?1"
  ).bind(stream).first<{ last_created_at: string; last_event_id: string }>();
}

async function bootstrapAdmin() {
  return resolveCmsSession(
    testEnv.CMS_DB,
    { email: "owner@example.com", subject: "owner-subject" },
    "owner@example.com",
    NOW
  );
}

function article(slug: string) {
  return {
    frontmatter: {
      title: "Discord通知の記事",
      description: "Studioの作業ログをDiscordへ流す仕組みを確認する記事です。",
      slug,
      status: "draft" as const,
      updatedAt: "2026-08-23",
      authors: ["Noema編集部"],
      topics: ["development-environment" as const],
      tags: ["CMS"],
      approach: "development" as const,
      outcome: "作業ログの流れを確認できる",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    },
    markdown: "## 作業ログ\n\nStudioの操作をDiscordへ通知します。",
    visibility: "public" as const
  };
}
