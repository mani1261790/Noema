import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  type D1Migration
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsArticleDetail, CmsMember, CmsSeries, CmsSession } from "@noema/cms";
import { handleCmsApiRequest } from "../worker/cms-api";
import { handleStudioApiRequest } from "../worker/app";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const ORIGIN = "https://studio.example.com";
const ADMIN = { email: "owner@example.com", subject: "owner-subject" };

beforeAll(async () => {
  await applyD1Migrations(testEnv.CMS_DB, testEnv.CMS_TEST_MIGRATIONS);
});

beforeEach(async () => {
  const objects = await testEnv.ARTICLE_ASSETS.list({ limit: 1000 });
  if (objects.objects.length > 0) {
    await testEnv.ARTICLE_ASSETS.delete(objects.objects.map((object) => object.key));
  }
  await testEnv.CMS_DB.batch([
    testEnv.CMS_DB.prepare("DELETE FROM cms_analytics_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_analytics_daily"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_analytics_ingestion_daily"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_analytics_pipeline_runs"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_review_comments"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_series"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series_revision_items"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_audiences"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_references"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_assets"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_deletions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_imports"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_auth_identities"),
    testEnv.CMS_DB.prepare("DELETE FROM studio_auth_session"),
    testEnv.CMS_DB.prepare("DELETE FROM studio_auth_account"),
    testEnv.CMS_DB.prepare("DELETE FROM studio_auth_user"),
    testEnv.CMS_DB.prepare("DELETE FROM studio_auth_verification"),
    testEnv.CMS_DB.prepare("DELETE FROM studio_auth_rate_limit"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_members"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_member_invitations")
  ]);
  await testEnv.CMS_DB.prepare(
    "UPDATE cms_analytics_pipeline_state SET state_value = date('now', '+1 day'), updated_at = datetime('now') WHERE state_key = 'raw_coverage_complete_from'"
  ).run();
});

describe("CMS HTTP API", () => {
  it("reports reader behavior by published revision without reader identifiers", async () => {
    await bootstrapAdmin();
    const { article } = await createArticle("analytics-article");
    const date = new Date().toISOString().slice(0, 10);
    const timestamp = `${date}T00:00:00.000Z`;
    const futureDate = new Date(`${date}T00:00:00.000Z`);
    futureDate.setUTCDate(futureDate.getUTCDate() + 1);
    const future = futureDate.toISOString().slice(0, 10);
    const expiredDate = new Date(`${date}T00:00:00.000Z`);
    expiredDate.setUTCDate(expiredDate.getUTCDate() - 90);
    const expired = expiredDate.toISOString().slice(0, 10);
    const insert = testEnv.CMS_DB.prepare(
      `INSERT INTO cms_analytics_daily (
         event_date, article_id, article_slug, revision_number, event_type,
         source, medium, campaign, content, referrer_host,
         navigation_kind, target_slug, event_count, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
    );
    await testEnv.CMS_DB.batch([
      insert.bind(expired, article.id, article.slug, article.revisionNumber, "landing", "old", "", "", "", "", "", "", 99, `${expired}T00:00:00.000Z`),
      insert.bind(date, article.id, article.slug, article.revisionNumber, "landing", "x", "social", "launch", "diagram", "", "", "", 4, timestamp),
      insert.bind(date, article.id, article.slug, article.revisionNumber, "article_50", "x", "social", "launch", "diagram", "", "", "", 3, timestamp),
      insert.bind(date, article.id, article.slug, article.revisionNumber, "article_end", "x", "social", "launch", "diagram", "", "", "", 2, timestamp),
      insert.bind(date, article.id, article.slug, article.revisionNumber, "navigation_click", "x", "social", "launch", "diagram", "", "related", "next-article", 1, timestamp),
      insert.bind(date, article.id, article.slug, article.revisionNumber, "assistant_open", "", "", "", "", "", "", "", 2, timestamp),
      insert.bind(date, article.id, article.slug, article.revisionNumber, "assistant_success", "", "", "", "", "", "", "", 1, timestamp),
      insert.bind(future, article.id, article.slug, article.revisionNumber, "landing", "", "", "", "", "", "", "", 100, `${future}T00:00:00.000Z`)
    ]);
    const retained = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_analytics_daily WHERE event_date = ?1"
    ).bind(expired).first<{ count: number }>();

    const response = await handleCmsApiRequest(
      cmsRequest("/api/cms/analytics/summary?days=30"),
      cmsEnv(),
      ADMIN
    );
    const body = (await response.json()) as { summary: {
      articles: Array<{
        article50Rate: number;
        assistantSuccessRate: number;
        assistantUseRate: number;
        onwardRate: number;
        qualifiedReadRate: number;
      }>;
      sources: Array<{
        article50Rate: number;
        campaign: string;
        landing: number;
        qualifiedReadRate: number;
      }>;
      totals: {
        article50Rate: number;
        assistantSuccessRate: number;
        assistantUseRate: number;
        landing: number;
        onwardRate: number;
        qualifiedReadRate: number;
      };
    } };

    expect(response.status).toBe(200);
    expect(retained?.count).toBe(1);
    expect(body.summary.totals).toMatchObject({
      article50Rate: 0.75,
      assistantSuccessRate: 0.5,
      assistantUseRate: 0.5,
      landing: 4,
      onwardRate: 0.5,
      qualifiedReadRate: 0.5
    });
    expect(body.summary.articles[0]).toMatchObject({
      article50Rate: 0.75,
      assistantSuccessRate: 0.5,
      assistantUseRate: 0.5,
      onwardRate: 0.5,
      qualifiedReadRate: 0.5
    });
    expect(body.summary.sources).toContainEqual(expect.objectContaining({
      article50Rate: 0.75,
      campaign: "launch",
      landing: 4,
      qualifiedReadRate: 0.5
    }));
    expect(body.summary.sources).toHaveLength(1);
    expect((body.summary as { health?: { status: string } }).health?.status).toBe("collecting");
  });

  it("rejects unsupported analytics ranges", async () => {
    await bootstrapAdmin();
    const response = await handleCmsApiRequest(
      cmsRequest("/api/cms/analytics/summary?days=365"),
      cmsEnv(),
      ADMIN
    );
    expect(response.status).toBe(400);
    await expectErrorCode(response, "invalid_analytics_range");
  });

  it("projects immutable facts once and lets an admin rebuild a corrupted mart", async () => {
    await bootstrapAdmin();
    const { article } = await createArticle("fact-based");
    const date = new Date().toISOString().slice(0, 10);
    const timestamp = `${date}T01:02:03.000Z`;
    await testEnv.CMS_DB.prepare(
      "UPDATE cms_analytics_pipeline_state SET state_value = ?1, updated_at = ?2 WHERE state_key = 'raw_coverage_complete_from'"
    ).bind(date, timestamp).run();
    const insert = testEnv.CMS_DB.prepare(
      `INSERT OR IGNORE INTO cms_analytics_events (
         event_id, schema_version, event_date, occurred_at, received_at,
         article_id, article_slug, revision_number, event_type
       ) VALUES (?1, 1, ?2, ?3, ?3, ?4, 'fact-based', ?5, 'landing')`
    );
    await insert.bind("019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e", date, timestamp, article.id, article.revisionNumber).run();
    await insert.bind("019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e", date, timestamp, article.id, article.revisionNumber).run();
    const projected = await testEnv.CMS_DB.prepare(
      "SELECT event_count FROM cms_analytics_daily WHERE event_date = ?1 AND article_id = ?2"
    ).bind(date, article.id).first<{ event_count: number }>();
    expect(projected?.event_count).toBe(1);

    await testEnv.CMS_DB.prepare(
      "UPDATE cms_analytics_daily SET event_count = 9 WHERE event_date = ?1 AND article_id = ?2"
    ).bind(date, article.id).run();
    const response = await handleCmsApiRequest(
      cmsRequest("/api/cms/analytics/rebuild", {
        body: JSON.stringify({ from: date, through: date }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }),
      cmsEnv(),
      ADMIN
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rebuild: { from: date, sourceEventCount: 1, through: date }
    });
    const repaired = await testEnv.CMS_DB.prepare(
      "SELECT event_count FROM cms_analytics_daily WHERE event_date = ?1 AND article_id = ?2"
    ).bind(date, article.id).first<{ event_count: number }>();
    const runs = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_analytics_pipeline_runs"
    ).first<{ count: number }>();
    expect(repaired?.event_count).toBe(1);
    expect(runs?.count).toBe(1);

    const summaryResponse = await handleCmsApiRequest(
      cmsRequest("/api/cms/analytics/summary?days=7"),
      cmsEnv(),
      ADMIN
    );
    const summaryBody = (await summaryResponse.json()) as {
      summary: { health: { checks: Array<{ id: string; status: string }>; status: string } };
    };
    expect(summaryBody.summary.health.status).toBe("healthy");
    expect(summaryBody.summary.health.checks).toContainEqual(expect.objectContaining({
      id: "mart_reconciliation",
      status: "pass"
    }));
  });

  it("stores anchored review comments and records the resolution revision", async () => {
    await bootstrapAdmin();
    const { article: created } = await createArticle("anchored-review-api");
    const reviewResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.id}/actions`, {
        body: JSON.stringify({ action: "request_review", expectedVersion: created.lockVersion }),
        headers: { "content-type": "application/json", "if-match": `"cms-v${created.lockVersion}"` },
        method: "POST"
      }),
      cmsEnv(),
      ADMIN
    );
    const inReview = ((await reviewResponse.json()) as { article: CmsArticleDetail }).article;
    const quote = "記事本文";
    const startOffset = inReview.currentRevision.markdown.indexOf(quote);
    const commentResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.id}/comments`, {
        body: JSON.stringify({
          anchor: {
            endOffset: startOffset + quote.length,
            prefix: inReview.currentRevision.markdown.slice(0, startOffset),
            quote,
            startOffset,
            suffix: inReview.currentRevision.markdown.slice(startOffset + quote.length)
          },
          body: "根拠を具体的にしてください。",
          target: "body"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }),
      cmsEnv(),
      ADMIN
    );
    const comment = (await commentResponse.json()) as { comment: { anchor: { quote: string }; id: string; status: string } };
    expect(commentResponse.status).toBe(201);
    expect(comment.comment).toMatchObject({ anchor: { quote }, status: "open" });

    const changesResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.id}/actions`, {
        body: JSON.stringify({
          action: "request_changes",
          expectedVersion: inReview.lockVersion,
          note: "未対応のレビューコメントが1件あります。"
        }),
        headers: { "content-type": "application/json", "if-match": `"cms-v${inReview.lockVersion}"` },
        method: "POST"
      }),
      cmsEnv(),
      ADMIN
    );
    expect(changesResponse.status).toBe(200);
    const resolvedResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.id}/comments/${comment.comment.id}`, {
        body: JSON.stringify({ action: "resolve" }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      }),
      cmsEnv(),
      ADMIN
    );
    const resolved = (await resolvedResponse.json()) as { comment: { resolvedRevisionNumber: number; status: string } };
    expect(resolvedResponse.status).toBe(200);
    expect(resolved.comment).toMatchObject({
      resolvedRevisionNumber: inReview.revisionNumber,
      status: "resolved"
    });
  });

  it("creates, reorders, and exposes restorable series revisions", async () => {
    await bootstrapAdmin();
    const first = await createArticle("series-first");
    const second = await createArticle("series-second");
    const createdResponse = await handleCmsApiRequest(
      cmsRequest("/api/cms/series", {
        body: JSON.stringify({
          articleIds: [first.article.id, second.article.id],
          description: "APIで管理するシリーズです。",
          slug: "api-series",
          title: "APIシリーズ"
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }),
      cmsEnv(),
      ADMIN
    );
    const created = (await createdResponse.json()) as { series: CmsSeries };
    expect(createdResponse.status).toBe(201);
    expect(createdResponse.headers.get("etag")).toBe('"cms-v1"');

    const updatedResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/series/${created.series.id}`, {
        body: JSON.stringify({
          articleIds: [second.article.id, first.article.id],
          description: created.series.description,
          expectedVersion: created.series.lockVersion,
          slug: created.series.slug,
          title: created.series.title
        }),
        headers: { "content-type": "application/json", "if-match": '"cms-v1"' },
        method: "PUT"
      }),
      cmsEnv(),
      ADMIN
    );
    const updated = (await updatedResponse.json()) as { series: CmsSeries };
    expect(updatedResponse.status).toBe(200);
    expect(updated.series.articleIds).toEqual([second.article.id, first.article.id]);
    expect(updated.series.revisionNumber).toBe(2);

    const versionsResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/series/${created.series.id}/versions`),
      cmsEnv(),
      ADMIN
    );
    const versions = (await versionsResponse.json()) as { versions: Array<{ articleIds: string[] }> };
    expect(versionsResponse.status).toBe(200);
    expect(versions.versions.map((version) => version.articleIds)).toEqual([
      [second.article.id, first.article.id],
      [first.article.id, second.article.id]
    ]);
  });

  it("bootstraps the configured administrator without exposing cacheable identity data", async () => {
    const response = await handleCmsApiRequest(
      cmsRequest("/api/cms/session"),
      cmsEnv(),
      ADMIN
    );
    const session = (await response.json()) as CmsSession;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(session.identity).toEqual({ ...ADMIN, role: "admin" });
    expect(session.capabilities).toEqual({
      canApprove: true,
      canComment: true,
      canEdit: true,
      canManageMembers: true,
      canPublish: true
    });
  });

  it("requires If-Match and returns the next ETag for an accepted save", async () => {
    await bootstrapAdmin();
    const created = await createArticle();
    expect(created.response.headers.get("etag")).toBe('"cms-v1"');

    const missingPrecondition = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}`, {
        body: JSON.stringify({
          ...validArticle("safe-concurrency"),
          expectedVersion: 1,
          markdown: "## 未保存\n\nIf-Matchがない更新です。"
        }),
        headers: { "content-type": "application/json" },
        method: "PUT"
      }),
      cmsEnv(),
      ADMIN
    );
    expect(missingPrecondition.status).toBe(428);
    await expectErrorCode(missingPrecondition, "precondition_required");

    const staleHeader = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}`, {
        body: JSON.stringify({
          ...validArticle("safe-concurrency"),
          expectedVersion: 1,
          markdown: "## 未保存\n\nETagが一致しない更新です。"
        }),
        headers: {
          "content-type": "application/json",
          "if-match": '"cms-v0"'
        },
        method: "PUT"
      }),
      cmsEnv(),
      ADMIN
    );
    expect(staleHeader.status).toBe(412);
    await expectErrorCode(staleHeader, "revision_conflict");

    const accepted = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}`, {
        body: JSON.stringify({
          ...validArticle("safe-concurrency"),
          expectedVersion: 1,
          markdown: "## 保存済み\n\n競合検査を通った更新です。"
        }),
        headers: {
          "content-type": "application/json",
          "if-match": '"cms-v1"'
        },
        method: "PUT"
      }),
      cmsEnv(),
      ADMIN
    );
    const body = (await accepted.json()) as { article: CmsArticleDetail };

    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("etag")).toBe('"cms-v2"');
    expect(body.article.lockVersion).toBe(2);
    expect(body.article.currentRevision.number).toBe(2);

    const revisionCount = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_article_revisions WHERE article_id = ?1"
    ).bind(created.article.id).first<number>("count");
    expect(revisionCount).toBe(2);
  });

  it("returns grouped version history and immutable revision details", async () => {
    await bootstrapAdmin();
    const editSessionId = "33333333-3333-4333-8333-333333333333";
    const createResponse = await handleCmsApiRequest(
      cmsRequest("/api/cms/articles", {
        body: JSON.stringify({ ...validArticle("history-api"), editSessionId }),
        headers: { "content-type": "application/json" },
        method: "POST"
      }),
      cmsEnv(),
      ADMIN
    );
    const created = (await createResponse.json()) as { article: CmsArticleDetail };
    const updateResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}`, {
        body: JSON.stringify({
          ...validArticle("history-api"),
          editSessionId,
          expectedVersion: created.article.lockVersion,
          markdown: "## 履歴API\n\n自動保存した内容です。",
          saveReason: "autosave"
        }),
        headers: {
          "content-type": "application/json",
          "if-match": `"cms-v${created.article.lockVersion}"`
        },
        method: "PUT"
      }),
      cmsEnv(),
      ADMIN
    );
    expect(updateResponse.status).toBe(200);

    const historyResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}/versions`),
      cmsEnv(),
      ADMIN
    );
    const history = (await historyResponse.json()) as {
      versions: Array<{ checkpointCount: number; latestRevisionId: string }>;
    };
    expect(historyResponse.status).toBe(200);
    expect(history.versions).toHaveLength(1);
    expect(history.versions[0]?.checkpointCount).toBe(2);

    const checkpointsResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}/versions/${editSessionId}/checkpoints`),
      cmsEnv(),
      ADMIN
    );
    const checkpoints = (await checkpointsResponse.json()) as {
      checkpoints: Array<{ number: number }>;
      nextBeforeRevisionNumber: number | null;
    };
    expect(checkpointsResponse.status).toBe(200);
    expect(checkpoints.checkpoints.map((checkpoint) => checkpoint.number)).toEqual([2, 1]);
    expect(checkpoints.nextBeforeRevisionNumber).toBeNull();

    const olderCheckpointsResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}/versions/${editSessionId}/checkpoints?before=2`),
      cmsEnv(),
      ADMIN
    );
    const olderCheckpoints = (await olderCheckpointsResponse.json()) as {
      checkpoints: Array<{ number: number }>;
    };
    expect(olderCheckpointsResponse.status).toBe(200);
    expect(olderCheckpoints.checkpoints.map((checkpoint) => checkpoint.number)).toEqual([1]);

    const invalidCursorResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}/versions/${editSessionId}/checkpoints?before=99999999999999999999`),
      cmsEnv(),
      ADMIN
    );
    expect(invalidCursorResponse.status).toBe(400);

    const detailResponse = await handleCmsApiRequest(
      cmsRequest(`/api/cms/articles/${created.article.id}/versions/${history.versions[0]?.latestRevisionId}`),
      cmsEnv(),
      ADMIN
    );
    const detail = (await detailResponse.json()) as {
      version: { reason: string; revision: { markdown: string }; visibility: string };
    };
    expect(detailResponse.status).toBe(200);
    expect(detail.version).toMatchObject({
      reason: "autosave",
      visibility: "internal"
    });
    expect(detail.version.revision.markdown).toContain("自動保存した内容");
  });

  it("enforces role permissions at the API boundary", async () => {
    await bootstrapAdmin();
    const invitation = await handleCmsApiRequest(
      cmsRequest("/api/cms/members", {
        body: JSON.stringify({
          active: true,
          email: "editor@example.com",
          role: "editor"
        }),
        headers: { "content-type": "application/json" },
        method: "PUT"
      }),
      cmsEnv(),
      ADMIN
    );
    const invited = (await invitation.json()) as { members: CmsMember[] };
    expect(invitation.status).toBe(200);
    expect(invited.members).toContainEqual(expect.objectContaining({
      email: "editor@example.com",
      provisioned: false,
      role: "editor"
    }));

    const editor = { email: "editor@example.com", subject: "editor-subject" };
    const editorSession = await handleCmsApiRequest(
      cmsRequest("/api/cms/session"),
      cmsEnv(),
      editor
    );
    expect(editorSession.status).toBe(200);

    const forbidden = await handleCmsApiRequest(
      cmsRequest("/api/cms/members"),
      cmsEnv(),
      editor
    );
    expect(forbidden.status).toBe(403);
    await expectErrorCode(forbidden, "forbidden");
  });

  it("rejects cross-origin mutations before Access verification", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(ADMIN);
    const response = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/cms/articles`, {
        body: JSON.stringify(validArticle("cross-origin")),
        headers: {
          "cf-access-jwt-assertion": "test-token",
          "content-type": "application/json",
          origin: "https://attacker.example"
        },
        method: "POST"
      }),
      {
        ACCESS_POLICY_AUD: "test-audience",
        ACCESS_TEAM_DOMAIN: "noema.cloudflareaccess.com",
        CMS_BOOTSTRAP_ADMIN_EMAIL: ADMIN.email,
        CMS_DB: testEnv.CMS_DB,
        STUDIO_ALLOWED_ORIGIN: ORIGIN
      },
      { verifyAccessToken }
    );

    expect(response.status).toBe(403);
    await expectErrorCode(response, "same_origin_required");
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("links an existing CMS member to a Noema password and accepts its session without Access", async () => {
    const verifyAccessToken = vi.fn().mockResolvedValue(ADMIN);
    const envWithAuth = {
      ACCESS_POLICY_AUD: "test-audience",
      ACCESS_TEAM_DOMAIN: "noema.cloudflareaccess.com",
      BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
      CMS_BOOTSTRAP_ADMIN_EMAIL: ADMIN.email,
      CMS_DB: testEnv.CMS_DB,
      STUDIO_ALLOWED_ORIGIN: ORIGIN
    };
    const accessHeaders = {
      "cf-access-jwt-assertion": "test-token",
      origin: ORIGIN
    };

    const bootstrap = await handleStudioApiRequest(
      cmsRequest("/api/cms/session", { headers: accessHeaders }),
      envWithAuth,
      { verifyAccessToken }
    );
    expect(bootstrap.status).toBe(200);

    const configured = await handleStudioApiRequest(
      cmsRequest("/api/studio-auth/password", {
        body: JSON.stringify({ password: "a-safe-test-password-123" }),
        headers: { ...accessHeaders, "content-type": "application/json" },
        method: "POST"
      }),
      envWithAuth,
      { verifyAccessToken }
    );
    expect(configured.status).toBe(200);

    const account = await testEnv.CMS_DB.prepare(
      "SELECT password FROM studio_auth_account WHERE providerId = 'credential'"
    ).first<{ password: string }>();
    expect(account?.password).toBeTruthy();
    expect(account?.password).not.toContain("a-safe-test-password-123");
    expect(await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_auth_identities"
    ).first<number>("count")).toBe(1);

    const signIn = await handleStudioApiRequest(
      cmsRequest("/api/auth/sign-in/email", {
        body: JSON.stringify({
          email: ADMIN.email,
          password: "a-safe-test-password-123"
        }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST"
      }),
      envWithAuth,
      { verifyAccessToken }
    );
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeTruthy();

    const session = await handleStudioApiRequest(
      cmsRequest("/api/cms/session", { headers: { cookie: cookie ?? "" } }),
      envWithAuth,
      { verifyAccessToken }
    );
    expect(session.status).toBe(200);
    const cmsSession = await session.json() as CmsSession;
    expect(cmsSession.identity).toEqual({ ...ADMIN, role: "admin" });
    expect(cmsSession.passwordLoginReadyAt).toBeTruthy();
    expect(verifyAccessToken).toHaveBeenCalledTimes(2);
  });

  it("does not expose Better Auth public sign-up", async () => {
    const response = await handleStudioApiRequest(
      cmsRequest("/api/auth/sign-up/email", {
        body: JSON.stringify({
          email: "attacker@example.com",
          name: "attacker",
          password: "a-safe-test-password-123"
        }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST"
      }),
      {
        ACCESS_POLICY_AUD: "test-audience",
        ACCESS_TEAM_DOMAIN: "noema.cloudflareaccess.com",
        BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
        CMS_DB: testEnv.CMS_DB,
        STUDIO_ALLOWED_ORIGIN: ORIGIN
      }
    );

    expect(response.status).toBe(404);
    expect(await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM studio_auth_user"
    ).first<number>("count")).toBe(0);
  });

  it("stores supported images privately and serves them to authenticated Studio previews", async () => {
    await bootstrapAdmin();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "diagram.png", {
      type: "image/png"
    }));
    const upload = await handleCmsApiRequest(
      cmsRequest("/api/cms/assets", { body: form, method: "POST" }),
      cmsEnv(),
      ADMIN
    );
    const uploaded = (await upload.json()) as {
      asset: { markdownUrl: string; previewUrl: string };
    };

    expect(upload.status).toBe(201);
    expect(uploaded.asset.markdownUrl).toMatch(/^\/media\/articles\/[0-9a-f-]{36}\.png$/);
    expect(uploaded.asset.previewUrl).toMatch(/^\/api\/cms\/assets\/articles\/[0-9a-f-]{36}\.png$/);

    const preview = await handleCmsApiRequest(
      cmsRequest(uploaded.asset.previewUrl),
      cmsEnv(),
      ADMIN
    );
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    expect(preview.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await preview.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71]));
  });

  it("lists uploaded images and updates reusable alt text and tags", async () => {
    await bootstrapAdmin();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "library.png", {
      type: "image/png"
    }));
    const upload = await handleCmsApiRequest(
      cmsRequest("/api/cms/assets", { body: form, method: "POST" }),
      cmsEnv(),
      ADMIN
    );
    const uploaded = (await upload.json()) as { asset: { id: string } };

    const patch = await handleCmsApiRequest(
      cmsRequest(`/api/cms/assets/${uploaded.asset.id}`, {
        body: JSON.stringify({ alt: "記事ライブラリの画面", status: "active", tags: ["Studio", "UI"] }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      }),
      cmsEnv(),
      ADMIN
    );
    expect(patch.status).toBe(200);

    const list = await handleCmsApiRequest(
      cmsRequest("/api/cms/assets"),
      cmsEnv(),
      ADMIN
    );
    const body = (await list.json()) as { assets: Array<Record<string, unknown>> };
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0]).toMatchObject({
      alt: "記事ライブラリの画面",
      originalName: "library.png",
      referenceCount: 0,
      status: "active",
      tags: ["Studio", "UI"]
    });
  });

  it("deletes an unused image from D1 and R2", async () => {
    await bootstrapAdmin();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "obsolete.png", {
      type: "image/png"
    }));
    const upload = await handleCmsApiRequest(
      cmsRequest("/api/cms/assets", { body: form, method: "POST" }),
      cmsEnv(),
      ADMIN
    );
    const uploaded = (await upload.json()) as { asset: { id: string; previewUrl: string } };
    const key = uploaded.asset.previewUrl.replace("/api/cms/assets/", "");

    const response = await handleCmsApiRequest(
      cmsRequest(`/api/cms/assets/${uploaded.asset.id}`, { method: "DELETE" }),
      cmsEnv(),
      ADMIN
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(await testEnv.ARTICLE_ASSETS.get(key)).toBeNull();
    expect(await testEnv.CMS_DB.prepare("SELECT 1 FROM cms_assets WHERE id = ?1")
      .bind(uploaded.asset.id).first()).toBeNull();
    expect(await testEnv.CMS_DB.prepare("SELECT 1 FROM cms_asset_deletions WHERE asset_id = ?1")
      .bind(uploaded.asset.id).first()).toBeNull();
  });

  it("refuses to delete an image that is still used by an article", async () => {
    await bootstrapAdmin();
    const form = new FormData();
    form.set("file", new File([new Uint8Array([137, 80, 78, 71])], "in-use.png", {
      type: "image/png"
    }));
    const upload = await handleCmsApiRequest(
      cmsRequest("/api/cms/assets", { body: form, method: "POST" }),
      cmsEnv(),
      ADMIN
    );
    const uploaded = (await upload.json()) as {
      asset: { id: string; markdownUrl: string; previewUrl: string };
    };
    const key = uploaded.asset.previewUrl.replace("/api/cms/assets/", "");
    const input = validArticle("asset-delete-guard");
    input.markdown = `## 使用中\n\n![使用中の画像](${uploaded.asset.markdownUrl})`;
    const articleResponse = await handleCmsApiRequest(
      cmsRequest("/api/cms/articles", {
        body: JSON.stringify(input),
        headers: { "content-type": "application/json" },
        method: "POST"
      }),
      cmsEnv(),
      ADMIN
    );
    expect(articleResponse.status).toBe(201);

    const response = await handleCmsApiRequest(
      cmsRequest(`/api/cms/assets/${uploaded.asset.id}`, { method: "DELETE" }),
      cmsEnv(),
      ADMIN
    );

    expect(response.status).toBe(409);
    await expectErrorCode(response, "asset_in_use");
    expect(await testEnv.ARTICLE_ASSETS.get(key)).not.toBeNull();
    expect(await testEnv.CMS_DB.prepare("SELECT 1 FROM cms_assets WHERE id = ?1")
      .bind(uploaded.asset.id).first()).not.toBeNull();
  });

  it("rejects SVG uploads", async () => {
    await bootstrapAdmin();
    const form = new FormData();
    form.set("file", new File(["<svg></svg>"], "unsafe.svg", { type: "image/svg+xml" }));
    const response = await handleCmsApiRequest(
      cmsRequest("/api/cms/assets", { body: form, method: "POST" }),
      cmsEnv(),
      ADMIN
    );

    expect(response.status).toBe(415);
    await expectErrorCode(response, "unsupported_asset_type");
  });
});

async function bootstrapAdmin(): Promise<void> {
  const response = await handleCmsApiRequest(
    cmsRequest("/api/cms/session"),
    cmsEnv(),
    ADMIN
  );
  expect(response.status).toBe(200);
}

async function createArticle(slug = "safe-concurrency"): Promise<{
  article: CmsArticleDetail;
  response: Response;
}> {
  const response = await handleCmsApiRequest(
    cmsRequest("/api/cms/articles", {
      body: JSON.stringify(validArticle(slug)),
      headers: { "content-type": "application/json" },
      method: "POST"
    }),
    cmsEnv(),
    ADMIN
  );
  const body = (await response.clone().json()) as { article: CmsArticleDetail };
  expect(response.status).toBe(201);
  return { article: body.article, response };
}

function cmsEnv() {
  return {
    ARTICLE_ASSETS: testEnv.ARTICLE_ASSETS,
    CMS_BOOTSTRAP_ADMIN_EMAIL: ADMIN.email,
    CMS_DB: testEnv.CMS_DB
  };
}

function cmsRequest(pathname: string, init?: RequestInit): Request {
  return new Request(`${ORIGIN}${pathname}`, init);
}

function validArticle(slug: string) {
  return {
    frontmatter: {
      approach: "development" as const,
      authors: ["Noema編集部"],
      description: "Cloudflare CMSで管理する記事の説明です。",
      estimatedMinutes: 10,
      heroImage: null,
      outcome: "安全なCMSの記事管理フローを理解できる",
      prerequisites: [],
      slug,
      sources: [],
      status: "draft" as const,
      tags: ["CMS"],
      title: "CMS記事",
      topics: ["development-environment" as const],
      updatedAt: "2026-07-18"
    },
    markdown: "## CMSで管理する\n\n記事本文をD1のrevisionとして保存します。",
    visibility: "internal" as const
  };
}

async function expectErrorCode(response: Response, code: string): Promise<void> {
  const body = (await response.clone().json()) as { error: { code: string } };
  expect(body.error.code).toBe(code);
}
