import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  type D1Migration
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCmsArticle,
  listCmsAssets,
  listCmsArticles,
  registerCmsAsset,
  resolveCmsSession,
  transitionCmsArticle,
  updateCmsArticle,
  updateCmsAsset,
  upsertCmsMemberInvitation
} from "../worker/cms-repository";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const NOW = new Date("2026-07-18T00:00:00.000Z");

beforeAll(async () => {
  await applyD1Migrations(testEnv.CMS_DB, testEnv.CMS_TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.CMS_DB.batch([
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_audiences"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_references"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_assets"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_imports"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_members"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_member_invitations")
  ]);
});

describe("CMS repository", () => {
  it("tracks article references and prevents archiving an image that is in use", async () => {
    const admin = await bootstrapAdmin();
    const asset = await registerCmsAsset(
      testEnv.CMS_DB,
      admin.identity,
      {
        byteSize: 2048,
        contentType: "image/png",
        id: "00000000-0000-4000-8000-000000000001",
        originalName: "editor.png",
        r2Key: "articles/00000000-0000-4000-8000-000000000001.png"
      },
      NOW
    );
    const input = validArticle("asset-reference");
    input.markdown = `## 画像を使う\n\n![編集画面](${asset.markdownUrl})`;
    const article = await createCmsArticle(testEnv.CMS_DB, admin.identity, input, NOW);

    const [referenced] = await listCmsAssets(testEnv.CMS_DB, admin.identity);
    expect(referenced).toMatchObject({
      alt: "",
      id: asset.id,
      referenceCount: 1,
      status: "active",
      tags: []
    });
    await expect(updateCmsAsset(
      testEnv.CMS_DB,
      admin.identity,
      asset.id,
      { alt: "記事編集画面", status: "archived", tags: ["Studio"] },
      NOW
    )).rejects.toMatchObject({ code: "asset_in_use" });

    const withoutImage = validArticle("asset-reference");
    await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      withoutImage,
      new Date("2026-07-18T00:01:00.000Z")
    );
    const archived = await updateCmsAsset(
      testEnv.CMS_DB,
      admin.identity,
      asset.id,
      { alt: "記事編集画面", status: "archived", tags: ["Studio", "Studio"] },
      new Date("2026-07-18T00:02:00.000Z")
    );
    expect(archived).toMatchObject({
      alt: "記事編集画面",
      referenceCount: 0,
      status: "archived",
      tags: ["Studio"]
    });
  });

  it("lists the latest article metadata in descending update order", async () => {
    const admin = await bootstrapAdmin();
    const older = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("older-article"),
      NOW
    );
    const newer = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("newer-article"),
      new Date("2026-07-18T00:01:00.000Z")
    );
    const updatedInput = validArticle("older-article-updated");
    updatedInput.frontmatter.title = "更新した記事";
    const updated = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      older.id,
      older.lockVersion,
      updatedInput,
      new Date("2026-07-18T00:02:00.000Z")
    );

    const articles = await listCmsArticles(testEnv.CMS_DB, admin.identity);

    expect(articles.map((article) => article.id)).toEqual([updated.id, newer.id]);
    expect(articles[0]).toMatchObject({
      publicationStatus: "unpublished",
      revisionNumber: 2,
      reviewStatus: "draft",
      slug: "older-article-updated",
      title: "更新した記事",
      updatedByEmail: "owner@example.com",
      visibility: "internal"
    });
  });

  it("provisions the same first-login identity idempotently", async () => {
    const [first, second] = await Promise.all([
      resolveCmsSession(
        testEnv.CMS_DB,
        { email: "owner@example.com", subject: "owner-subject" },
        "owner@example.com",
        NOW
      ),
      resolveCmsSession(
        testEnv.CMS_DB,
        { email: "owner@example.com", subject: "owner-subject" },
        "owner@example.com",
        NOW
      )
    ]);

    expect(first.identity).toEqual(second.identity);
    expect(first.identity.role).toBe("admin");
    const memberCount = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_members"
    ).first<number>("count");
    expect(memberCount).toBe(1);
  });

  it("atomically provisions an active invitation and refuses a revoked one", async () => {
    await testEnv.CMS_DB.batch([
      testEnv.CMS_DB.prepare(
        `INSERT INTO cms_member_invitations
          (email, role, active, invited_by_subject, created_at, updated_at)
         VALUES ('editor@example.com', 'editor', 1, 'owner-subject', ?1, ?1)`
      ).bind(NOW.toISOString()),
      testEnv.CMS_DB.prepare(
        `INSERT INTO cms_member_invitations
          (email, role, active, invited_by_subject, created_at, updated_at)
         VALUES ('revoked@example.com', 'reviewer', 0, 'owner-subject', ?1, ?1)`
      ).bind(NOW.toISOString())
    ]);

    const [first, second] = await Promise.all([
      resolveCmsSession(
        testEnv.CMS_DB,
        { email: "editor@example.com", subject: "editor-subject" },
        "owner@example.com",
        NOW
      ),
      resolveCmsSession(
        testEnv.CMS_DB,
        { email: "editor@example.com", subject: "editor-subject" },
        "owner@example.com",
        NOW
      )
    ]);

    expect(first.identity).toEqual(second.identity);
    expect(first.identity.role).toBe("editor");
    await expect(resolveCmsSession(
      testEnv.CMS_DB,
      { email: "revoked@example.com", subject: "revoked-subject" },
      "owner@example.com",
      NOW
    )).rejects.toMatchObject({ code: "member_not_registered" });
    const revokedMemberCount = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_members WHERE email = 'revoked@example.com'"
    ).first<number>("count");
    expect(revokedMemberCount).toBe(0);
  });

  it("bootstraps only the configured administrator", async () => {
    const session = await resolveCmsSession(
      testEnv.CMS_DB,
      { email: "owner@example.com", subject: "owner-subject" },
      "owner@example.com",
      NOW
    );

    expect(session.identity).toEqual({
      email: "owner@example.com",
      role: "admin",
      subject: "owner-subject"
    });

    await expect(resolveCmsSession(
      testEnv.CMS_DB,
      { email: "unknown@example.com", subject: "unknown-subject" },
      "owner@example.com",
      NOW
    )).rejects.toMatchObject({ code: "member_not_registered" });
  });

  it("rejects stale saves without creating a stray revision", async () => {
    const admin = await bootstrapAdmin();
    const asset = await registerCmsAsset(
      testEnv.CMS_DB,
      admin.identity,
      {
        byteSize: 1024,
        contentType: "image/png",
        id: "00000000-0000-4000-8000-000000000009",
        originalName: "concurrent.png",
        r2Key: "articles/00000000-0000-4000-8000-000000000009.png"
      },
      NOW
    );
    const created = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("concurrent-edit"),
      NOW
    );
    const first = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      created.id,
      created.lockVersion,
      {
        ...validArticle("concurrent-edit"),
        markdown: `## 最初の保存\n\n一人目の内容です。\n\n![競合確認](${asset.markdownUrl})`
      },
      new Date("2026-07-18T00:01:00.000Z")
    );

    await expect(updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      created.id,
      created.lockVersion,
      {
        ...validArticle("concurrent-edit"),
        markdown: "## 古い保存\n\n二人目の古い内容です。"
      },
      new Date("2026-07-18T00:02:00.000Z")
    )).rejects.toMatchObject({ code: "revision_conflict" });

    const revisionCount = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_article_revisions WHERE article_id = ?1"
    ).bind(created.id).first<number>("count");
    const referenceCount = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_asset_references WHERE article_id = ?1"
    ).bind(created.id).first<number>("count");
    expect(first.currentRevision.number).toBe(2);
    expect(revisionCount).toBe(2);
    expect(referenceCount).toBe(1);
  });

  it("keeps the published revision stable while a new draft is edited", async () => {
    const admin = await bootstrapAdmin();
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("stable-publication"),
      NOW
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-07-18T00:01:00.000Z")
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "approve",
      article.lockVersion,
      {},
      new Date("2026-07-18T00:02:00.000Z")
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "publish",
      article.lockVersion,
      { visibility: "public" },
      new Date("2026-07-18T00:03:00.000Z")
    );
    expect(article.publishedRevisionNumber).toBe(1);

    const edited = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      {
        ...validArticle("stable-publication-draft"),
        markdown: "## 公開後の下書き\n\nまだ読者には見せない内容です。"
      },
      new Date("2026-07-18T00:04:00.000Z")
    );

    expect(edited.currentRevision.number).toBe(2);
    expect(edited.publishedRevisionNumber).toBe(1);
    expect(edited.publicationStatus).toBe("published");
    expect(edited.reviewStatus).toBe("draft");
    const publication = await testEnv.CMS_DB.prepare(
      "SELECT slug, published_slug FROM cms_articles WHERE id = ?1"
    ).bind(article.id).first<{ published_slug: string; slug: string }>();
    expect(publication).toEqual({
      published_slug: "stable-publication",
      slug: "stable-publication-draft"
    });
  });

  it("validates the approved revision again immediately before publication", async () => {
    const admin = await bootstrapAdmin();
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("publish-validation"),
      NOW
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      NOW
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "approve",
      article.lockVersion,
      {},
      NOW
    );

    await testEnv.CMS_DB.prepare(
      "UPDATE cms_article_revisions SET markdown = '<script>alert(1)</script>' WHERE id = ?1"
    ).bind(article.currentRevision.id).run();

    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "publish",
      article.lockVersion,
      { visibility: "public" },
      NOW
    )).rejects.toMatchObject({ code: "invalid_article" });
  });

  it("does not allow two live publications to claim the same pinned slug", async () => {
    const admin = await bootstrapAdmin();
    let first = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("shared-live-slug"),
      NOW
    );
    first = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      first.id,
      "request_review",
      first.lockVersion,
      {},
      NOW
    );
    first = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      first.id,
      "approve",
      first.lockVersion,
      {},
      NOW
    );
    first = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      first.id,
      "publish",
      first.lockVersion,
      { visibility: "public" },
      NOW
    );
    await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      first.id,
      first.lockVersion,
      validArticle("first-new-draft-slug"),
      NOW
    );

    let second = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("shared-live-slug"),
      NOW
    );
    second = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      second.id,
      "request_review",
      second.lockVersion,
      {},
      NOW
    );
    second = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      second.id,
      "approve",
      second.lockVersion,
      {},
      NOW
    );

    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      second.id,
      "publish",
      second.lockVersion,
      { visibility: "public" },
      NOW
    )).rejects.toMatchObject({ code: "slug_conflict" });

    const secondState = await testEnv.CMS_DB.prepare(
      "SELECT publication_status, published_slug FROM cms_articles WHERE id = ?1"
    ).bind(second.id).first<{
      publication_status: string;
      published_slug: string | null;
    }>();
    expect(secondState).toEqual({
      publication_status: "unpublished",
      published_slug: null
    });
  });

  it("prevents a reviewer from approving their own latest revision", async () => {
    const admin = await bootstrapAdmin();
    await upsertCmsMemberInvitation(
      testEnv.CMS_DB,
      admin.identity,
      { active: true, email: "reviewer@example.com", role: "reviewer" },
      NOW
    );
    const reviewer = await resolveCmsSession(
      testEnv.CMS_DB,
      { email: "reviewer@example.com", subject: "reviewer-subject" },
      "owner@example.com",
      NOW
    );
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      reviewer.identity,
      validArticle("self-approval"),
      NOW
    );
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      reviewer.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      NOW
    );

    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      reviewer.identity,
      article.id,
      "approve",
      article.lockVersion,
      {},
      NOW
    )).rejects.toMatchObject({ code: "self_approval_forbidden" });
  });

  it("keeps at least one active administrator", async () => {
    const admin = await bootstrapAdmin();

    await expect(upsertCmsMemberInvitation(
      testEnv.CMS_DB,
      admin.identity,
      { active: false, email: "owner@example.com", role: "admin" },
      NOW
    )).rejects.toMatchObject({ code: "last_admin_required" });

    await upsertCmsMemberInvitation(
      testEnv.CMS_DB,
      admin.identity,
      { active: true, email: "second-admin@example.com", role: "admin" },
      NOW
    );
    await resolveCmsSession(
      testEnv.CMS_DB,
      { email: "second-admin@example.com", subject: "second-admin-subject" },
      "owner@example.com",
      NOW
    );
    const members = await upsertCmsMemberInvitation(
      testEnv.CMS_DB,
      admin.identity,
      { active: false, email: "owner@example.com", role: "admin" },
      NOW
    );

    expect(members).toContainEqual(expect.objectContaining({
      active: false,
      email: "owner@example.com",
      role: "admin"
    }));
  });
});

async function bootstrapAdmin() {
  return resolveCmsSession(
    testEnv.CMS_DB,
    { email: "owner@example.com", subject: "owner-subject" },
    "owner@example.com",
    NOW
  );
}

function validArticle(slug: string) {
  return {
    frontmatter: {
      title: "CMS記事",
      description: "Cloudflare CMSで管理する記事の説明です。",
      slug,
      status: "draft" as const,
      updatedAt: "2026-07-18",
      authors: ["Noema編集部"],
      topics: ["development-environment" as const],
      tags: ["CMS"],
      approach: "development" as const,
      outcome: "CMSの記事管理フローを理解できる",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    },
    markdown: "## CMSで管理する\n\n記事本文をD1のrevisionとして保存します。",
    visibility: "internal" as const
  };
}
