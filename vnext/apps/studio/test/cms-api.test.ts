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
  await testEnv.CMS_DB.batch([
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_audiences"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
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
