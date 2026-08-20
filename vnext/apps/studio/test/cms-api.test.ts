import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  type D1Migration
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CmsArticleDetail, CmsMember, CmsSession } from "@noema/cms";
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
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_audiences"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_references"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_assets"),
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
});

describe("CMS HTTP API", () => {
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

async function createArticle(): Promise<{
  article: CmsArticleDetail;
  response: Response;
}> {
  const response = await handleCmsApiRequest(
    cmsRequest("/api/cms/articles", {
      body: JSON.stringify(validArticle("safe-concurrency")),
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
