import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  type D1Migration
} from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCmsArticle,
  createCmsReviewComment,
  deleteCmsDraftArticle,
  getCmsArticleVersion,
  listCmsAssets,
  listCmsArticles,
  listCmsArticleVersions,
  listCmsArticleVersionCheckpoints,
  listCmsReviewComments,
  registerCmsAsset,
  resolveCmsSession,
  transitionCmsArticle,
  updateCmsArticle,
  updateCmsAsset,
  updateCmsMemberProfile,
  updateCmsReviewCommentStatus,
  upsertCmsMemberInvitation
} from "../worker/cms-repository";
import { createCmsSeries } from "../worker/cms-series-repository";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const NOW = new Date("2026-07-18T00:00:00.000Z");

beforeAll(async () => {
  await applyD1Migrations(testEnv.CMS_DB, testEnv.CMS_TEST_MIGRATIONS);
});

beforeEach(async () => {
  await testEnv.CMS_DB.batch([
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
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_imports"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_members"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_member_invitations")
  ]);
});

describe("CMS repository", () => {
  it("keeps the latest revision editor while an article is under review", async () => {
    const admin = await bootstrapAdmin();
    const firstEditor = await updateCmsMemberProfile(
      testEnv.CMS_DB,
      admin.identity,
      "最初の編集者",
      NOW
    );
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      firstEditor.identity,
      validArticle("last-editor"),
      NOW
    );

    expect(article.currentRevision.editor).toEqual({
      displayName: "最初の編集者",
      publicId: firstEditor.identity.publicId
    });

    await upsertCmsMemberInvitation(
      testEnv.CMS_DB,
      firstEditor.identity,
      { active: true, email: "last-editor@example.com", role: "editor" },
      NOW
    );
    const invited = await resolveCmsSession(
      testEnv.CMS_DB,
      { email: "last-editor@example.com", subject: "last-editor-subject" },
      "owner@example.com",
      NOW
    );
    const lastEditor = await updateCmsMemberProfile(
      testEnv.CMS_DB,
      invited.identity,
      "最後の編集者",
      NOW
    );
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      lastEditor.identity,
      article.id,
      article.lockVersion,
      { ...validArticle("last-editor"), markdown: "## 最後の編集\n\n最新revisionです。" },
      new Date("2026-07-18T00:01:00.000Z")
    );

    expect(article.currentRevision.editor).toEqual({
      displayName: "最後の編集者",
      publicId: lastEditor.identity.publicId
    });

    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      lastEditor.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-07-18T00:02:00.000Z")
    );

    expect(article.reviewStatus).toBe("in_review");
    expect(article.currentRevision.editor).toEqual({
      displayName: "最後の編集者",
      publicId: lastEditor.identity.publicId
    });
  });

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

  it("replaces author-supplied operational metadata with CMS-managed values", async () => {
    const admin = await bootstrapAdmin();
    const input = validArticle("managed-metadata");
    input.frontmatter.estimatedMinutes = 180;
    (input.frontmatter.prerequisites as string[]).push("手入力した前提知識");
    (input.frontmatter as typeof input.frontmatter & { publishedAt?: string }).publishedAt = "2020-01-01";
    input.frontmatter.updatedAt = "2020-01-02";
    input.markdown = "# 短い本文\n\nCMSが読了時間と日付を管理します。";

    const created = await createCmsArticle(testEnv.CMS_DB, admin.identity, input, NOW);
    expect(created.currentRevision.frontmatter).toMatchObject({
      estimatedMinutes: 1,
      prerequisites: [],
      updatedAt: "2026-07-18"
    });
    expect(created.currentRevision.frontmatter.publishedAt).toBeUndefined();
    const storedChecksum = await testEnv.CMS_DB.prepare(
      "SELECT content_sha256 FROM cms_article_revisions WHERE id = ?1"
    ).bind(created.currentRevision.id).first<string>("content_sha256");
    expect(storedChecksum).toBe(await sha256(JSON.stringify({
      frontmatter: created.currentRevision.frontmatter,
      markdown: created.currentRevision.markdown,
      visibility: created.visibility
    })));

    const updated = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      created.id,
      created.lockVersion,
      input,
      new Date("2026-07-19T09:00:00.000Z")
    );
    expect(updated.currentRevision.frontmatter.updatedAt).toBe("2026-07-19");
    expect(updated.currentRevision.frontmatter.publishedAt).toBeUndefined();
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

    expect(session.identity).toMatchObject({
      displayName: null,
      email: "owner@example.com",
      role: "admin",
      subject: "owner-subject"
    });
    expect(session.identity.publicId).toMatch(/^[a-f0-9]{32}$/u);

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

    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_changes",
      article.lockVersion,
      { note: "公開内容を更新します。" },
      new Date("2026-07-18T00:03:30.000Z")
    );

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

  it("reopens an approved revision without changing the live publication", async () => {
    const admin = await bootstrapAdmin();
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("revoke-approval"),
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

    const reopened = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "revoke_approval",
      article.lockVersion,
      {},
      new Date("2026-07-18T00:04:00.000Z")
    );

    expect(reopened.reviewStatus).toBe("in_review");
    expect(reopened.publicationStatus).toBe("published");
    expect(reopened.publishedRevisionNumber).toBe(1);
    const approvedRevisionId = await testEnv.CMS_DB.prepare(
      "SELECT approved_revision_id FROM cms_articles WHERE id = ?1"
    ).bind(article.id).first<string | null>("approved_revision_id");
    expect(approvedRevisionId).toBeNull();
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

  it("blocks review for a link to an unknown article but allows an existing unpublished target", async () => {
    const admin = await bootstrapAdmin();
    const missingInput = validArticle("missing-link-source");
    missingInput.markdown = "## 本文\n\n[存在しない記事](/articles/not-created)を参照します。";
    const missingSource = await createCmsArticle(testEnv.CMS_DB, admin.identity, missingInput, NOW);

    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      missingSource.id,
      "request_review",
      missingSource.lockVersion,
      {},
      NOW
    )).rejects.toMatchObject({
      code: "invalid_article",
      issues: [expect.objectContaining({ path: ["markdown", 3] })]
    });

    await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("future-article"),
      NOW
    );
    const pendingInput = validArticle("pending-link-source");
    pendingInput.markdown = "## 本文\n\n[公開予定の記事](/articles/future-article)を参照します。";
    let pendingSource = await createCmsArticle(testEnv.CMS_DB, admin.identity, pendingInput, NOW);
    pendingSource = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      pendingSource.id,
      "request_review",
      pendingSource.lockVersion,
      {},
      NOW
    );
    expect(pendingSource.reviewStatus).toBe("in_review");
  });

  it("deletes only a never-published draft and retains an anonymous audit record", async () => {
    const admin = await bootstrapAdmin();
    const article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("discarded-draft"),
      NOW
    );

    await deleteCmsDraftArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      NOW,
      { channel: "web" }
    );

    await expect(getCmsArticleVersion(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.currentRevision.id
    )).rejects.toMatchObject({ code: "article_not_found" });
    const audit = await testEnv.CMS_DB.prepare(
      `SELECT article_id, metadata_json
       FROM cms_audit_events
       WHERE action = 'article.deleted'`
    ).first<{ article_id: string | null; metadata_json: string }>();
    expect(audit?.article_id).toBeNull();
    expect(JSON.parse(audit?.metadata_json ?? "{}")).toMatchObject({
      articleId: article.id,
      channel: "web",
      slug: "discarded-draft",
      title: "CMS記事"
    });
  });

  it("rejects draft deletion after review starts, after publication, or when another article links to it", async () => {
    const admin = await bootstrapAdmin();
    let reviewed = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("reviewed-draft"),
      NOW
    );
    reviewed = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      reviewed.id,
      "request_review",
      reviewed.lockVersion,
      {},
      NOW
    );
    await expect(deleteCmsDraftArticle(
      testEnv.CMS_DB,
      admin.identity,
      reviewed.id,
      reviewed.lockVersion,
      NOW
    )).rejects.toMatchObject({ code: "invalid_transition" });

    let published = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("published-once"),
      NOW
    );
    published = await publishArticle(admin.identity, published, "public");
    await expect(deleteCmsDraftArticle(
      testEnv.CMS_DB,
      admin.identity,
      published.id,
      published.lockVersion,
      NOW
    )).rejects.toMatchObject({ code: "invalid_transition" });

    const target = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("linked-draft"),
      NOW
    );
    const sourceInput = validArticle("draft-source");
    sourceInput.markdown = "## 本文\n\n[準備中の記事](/articles/linked-draft)を参照します。";
    await createCmsArticle(testEnv.CMS_DB, admin.identity, sourceInput, NOW);
    await expect(deleteCmsDraftArticle(
      testEnv.CMS_DB,
      admin.identity,
      target.id,
      target.lockVersion,
      NOW
    )).rejects.toMatchObject({
      code: "invalid_transition",
      issues: [expect.objectContaining({ path: ["linkedArticles", "draft-source", 3] })]
    });
  });

  it("keeps a draft that appears in immutable series history", async () => {
    const admin = await bootstrapAdmin();
    const article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("series-draft"),
      NOW
    );
    await createCmsSeries(testEnv.CMS_DB, admin.identity, {
      articleIds: [article.id],
      description: "削除保護を確認するシリーズです。",
      slug: "protected-series",
      title: "保護対象シリーズ"
    });

    await expect(deleteCmsDraftArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      NOW
    )).rejects.toMatchObject({
      code: "invalid_transition",
      issues: [expect.objectContaining({ path: ["series", "protected-series"] })]
    });
  });

  it("prevents publication from removing a heading referenced by another published article", async () => {
    const admin = await bootstrapAdmin();
    const targetInput = validArticle("fragment-target");
    targetInput.markdown = "## 残す見出し\n\n参照先の本文です。";
    let target = await createCmsArticle(testEnv.CMS_DB, admin.identity, targetInput, NOW);
    target = await publishArticle(admin.identity, target, "public");

    const sourceInput = validArticle("fragment-source");
    sourceInput.markdown = "## 本文\n\n[参照先](/articles/fragment-target#残す見出し)を確認します。";
    let source = await createCmsArticle(testEnv.CMS_DB, admin.identity, sourceInput, NOW);
    source = await publishArticle(admin.identity, source, "public");
    expect(source.publicationStatus).toBe("published");

    target = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      target.id,
      "request_changes",
      target.lockVersion,
      { note: "見出しを変更します。" },
      NOW
    );
    target = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      target.id,
      target.lockVersion,
      { ...validArticle("fragment-target"), markdown: "## 別の見出し\n\n更新後の本文です。" },
      NOW
    );
    await resolveOpenReviewComments(admin.identity, target);
    target = await transitionCmsArticle(testEnv.CMS_DB, admin.identity, target.id, "request_review", target.lockVersion, {}, NOW);
    target = await transitionCmsArticle(testEnv.CMS_DB, admin.identity, target.id, "approve", target.lockVersion, {}, NOW);

    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      target.id,
      "publish",
      target.lockVersion,
      { visibility: "public" },
      NOW
    )).rejects.toMatchObject({ code: "invalid_article" });
  });

  it("creates a historical redirect when a published slug changes", async () => {
    const admin = await bootstrapAdmin();
    let article = await createCmsArticle(testEnv.CMS_DB, admin.identity, validArticle("old-public-slug"), NOW);
    article = await publishArticle(admin.identity, article, "public");
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_changes",
      article.lockVersion,
      { note: "slugを変更します。" },
      NOW
    );
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      validArticle("new-public-slug"),
      NOW
    );
    await resolveOpenReviewComments(admin.identity, article);
    article = await publishArticle(admin.identity, article, "public");

    const redirect = await testEnv.CMS_DB.prepare(
      "SELECT article_id FROM cms_article_slug_redirects WHERE old_slug = 'old-public-slug'"
    ).first<string>("article_id");
    expect(article.publishedSlug).toBe("new-public-slug");
    expect(redirect).toBe(article.id);

    const sourceInput = validArticle("historical-link-source");
    sourceInput.markdown = "## 本文\n\n[以前のURL](/articles/old-public-slug#cmsで管理する)を参照します。";
    let source = await createCmsArticle(testEnv.CMS_DB, admin.identity, sourceInput, NOW);
    source = await publishArticle(admin.identity, source, "public");
    expect(source.publicationStatus).toBe("published");

    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_changes",
      article.lockVersion,
      { note: "参照中の見出しを変更します。" },
      NOW
    );
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      { ...validArticle("new-public-slug"), markdown: "## 新しい見出し\n\n更新後の本文です。" },
      NOW
    );
    await resolveOpenReviewComments(admin.identity, article);
    article = await transitionCmsArticle(testEnv.CMS_DB, admin.identity, article.id, "request_review", article.lockVersion, {}, NOW);
    article = await transitionCmsArticle(testEnv.CMS_DB, admin.identity, article.id, "approve", article.lockVersion, {}, NOW);

    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "publish",
      article.lockVersion,
      { visibility: "public" },
      NOW
    )).rejects.toMatchObject({ code: "invalid_article" });
    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "archive",
      article.lockVersion,
      {},
      NOW
    )).rejects.toMatchObject({
      code: "invalid_transition",
      issues: [expect.objectContaining({ path: ["publishedArticles", "historical-link-source", 3] })]
    });
  });

  it("blocks publication end while another published article links to the target", async () => {
    const admin = await bootstrapAdmin();
    let target = await createCmsArticle(testEnv.CMS_DB, admin.identity, validArticle("archive-target"), NOW);
    target = await publishArticle(admin.identity, target, "public");
    const sourceInput = validArticle("archive-source");
    sourceInput.markdown = "## 本文\n\n[参照先](/articles/archive-target)を確認します。";
    let source = await createCmsArticle(testEnv.CMS_DB, admin.identity, sourceInput, NOW);
    source = await publishArticle(admin.identity, source, "public");
    expect(source.publicationStatus).toBe("published");

    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      target.id,
      "archive",
      target.lockVersion,
      {},
      NOW
    )).rejects.toMatchObject({
      code: "invalid_transition",
      issues: [expect.objectContaining({ path: ["publishedArticles", "archive-source", 3] })]
    });
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
    first = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      first.id,
      "request_changes",
      first.lockVersion,
      { note: "次の改訂を開始します。" },
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
      admin.identity,
      validArticle("self-approval"),
      NOW
    );
    await testEnv.CMS_DB.prepare(
      "UPDATE cms_article_revisions SET created_by_subject = ?1 WHERE id = ?2"
    ).bind(reviewer.identity.subject, article.currentRevision.id).run();
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
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

  it("keeps review content immutable and stores revision-linked comments", async () => {
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
      admin.identity,
      validArticle("review-boundary"),
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

    await expect(updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      validArticle("should-not-save"),
      NOW
    )).rejects.toMatchObject({ code: "article_locked" });
    await expect(updateCmsArticle(
      testEnv.CMS_DB,
      reviewer.identity,
      article.id,
      article.lockVersion,
      validArticle("reviewer-cannot-edit"),
      NOW
    )).rejects.toMatchObject({ code: "forbidden" });

    const quote = "記事本文";
    const startOffset = article.currentRevision.markdown.indexOf(quote);
    await expect(createCmsReviewComment(
      testEnv.CMS_DB,
      reviewer.identity,
      article.id,
      {
        anchor: {
          endOffset: startOffset + quote.length,
          prefix: "",
          quote: "別の記事",
          startOffset,
          suffix: ""
        },
        body: "一致しない選択です。",
        target: "body"
      },
      NOW
    )).rejects.toMatchObject({ code: "invalid_article" });
    const comment = await createCmsReviewComment(
      testEnv.CMS_DB,
      reviewer.identity,
      article.id,
      {
        anchor: {
          endOffset: startOffset + quote.length,
          prefix: article.currentRevision.markdown.slice(0, startOffset),
          quote,
          startOffset,
          suffix: article.currentRevision.markdown.slice(startOffset + quote.length)
        },
        body: "導入部の根拠を確認してください。",
        target: "body"
      },
      NOW
    );
    expect(comment).toMatchObject({
      anchor: { quote, startOffset },
      authorEmail: "reviewer@example.com",
      revisionId: article.currentRevision.id,
      revisionNumber: article.revisionNumber,
      status: "open",
      target: "body"
    });
    expect(await listCmsReviewComments(testEnv.CMS_DB, admin.identity, article.id))
      .toEqual([comment]);

    await expect(transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "approve",
      article.lockVersion,
      {},
      NOW
    )).rejects.toMatchObject({ code: "invalid_transition" });

    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      reviewer.identity,
      article.id,
      "request_changes",
      article.lockVersion,
      {},
      NOW
    );
    expect(article.reviewNote).toBe("未対応のレビューコメントが1件あります。");
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      {
        ...validArticle("review-boundary"),
        markdown: "## CMSで管理する\n\n記事本文へ根拠を追記し、D1のrevisionとして保存します。"
      },
      new Date("2026-07-18T00:01:00.000Z")
    );
    const resolved = await updateCmsReviewCommentStatus(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      comment.id,
      "resolve",
      new Date("2026-07-18T00:02:00.000Z")
    );
    expect(resolved).toMatchObject({
      resolvedByEmail: "owner@example.com",
      resolvedRevisionId: article.currentRevision.id,
      resolvedRevisionNumber: article.revisionNumber,
      status: "resolved"
    });
    article = await transitionCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      "request_review",
      article.lockVersion,
      {},
      new Date("2026-07-18T00:03:00.000Z")
    );
    const reopened = await updateCmsReviewCommentStatus(
      testEnv.CMS_DB,
      reviewer.identity,
      article.id,
      comment.id,
      "reopen",
      new Date("2026-07-18T00:04:00.000Z")
    );
    expect(reopened).toMatchObject({ resolvedAt: null, status: "open" });
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

  it("groups autosave checkpoints into editing sessions and preserves restore provenance", async () => {
    const admin = await bootstrapAdmin();
    const firstSession = "11111111-1111-4111-8111-111111111111";
    const restoreSession = "22222222-2222-4222-8222-222222222222";
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("version-history"),
      NOW,
      {},
      { editSessionId: firstSession }
    );
    const originalRevisionId = article.currentRevision.id;
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      { ...validArticle("version-history"), markdown: "## 自動保存\n\n入力途中です。" },
      new Date("2026-07-18T00:01:00.000Z"),
      {},
      { editSessionId: firstSession, saveReason: "autosave" }
    );
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      { ...validArticle("version-history"), markdown: "## 手動記録\n\n版として残します。" },
      new Date("2026-07-18T00:02:00.000Z"),
      {},
      { editSessionId: firstSession, saveReason: "manual" }
    );
    await expect(updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      validArticle("version-history"),
      new Date("2026-07-18T00:02:30.000Z"),
      {},
      {
        editSessionId: restoreSession,
        saveReason: "restored",
        sourceRevisionId: "33333333-3333-4333-8333-333333333333"
      }
    )).rejects.toMatchObject({ code: "invalid_article" });
    article = await updateCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.lockVersion,
      validArticle("version-history"),
      new Date("2026-07-18T00:03:00.000Z"),
      {},
      {
        editSessionId: restoreSession,
        saveReason: "restored",
        sourceRevisionId: originalRevisionId
      }
    );

    const versions = await listCmsArticleVersions(testEnv.CMS_DB, admin.identity, article.id);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({
      checkpointCount: 1,
      id: restoreSession,
      isCurrent: true,
      latestRevisionNumber: 4,
      reason: "restored",
      sourceRevisionId: originalRevisionId
    });
    expect(versions[1]).toMatchObject({
      checkpointCount: 3,
      firstRevisionNumber: 1,
      id: firstSession,
      latestRevisionNumber: 3,
      reason: "manual"
    });
    const checkpoints = await listCmsArticleVersionCheckpoints(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      firstSession
    );
    expect(checkpoints.nextBeforeRevisionNumber).toBeNull();
    expect(checkpoints.checkpoints.map((checkpoint) => checkpoint.number)).toEqual([3, 2, 1]);
    expect(checkpoints.checkpoints[0]).toMatchObject({ reason: "manual" });

    const restored = await getCmsArticleVersion(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      article.currentRevision.id
    );
    expect(restored).toMatchObject({
      isCurrent: true,
      reason: "restored",
      sourceRevisionId: originalRevisionId,
      visibility: "internal"
    });
  });

  it("paginates every checkpoint in a long editing session without gaps", async () => {
    const admin = await bootstrapAdmin();
    const editSessionId = "44444444-4444-4444-8444-444444444444";
    let article = await createCmsArticle(
      testEnv.CMS_DB,
      admin.identity,
      validArticle("long-version-history"),
      NOW,
      {},
      { editSessionId }
    );
    for (let index = 2; index <= 102; index += 1) {
      article = await updateCmsArticle(
        testEnv.CMS_DB,
        admin.identity,
        article.id,
        article.lockVersion,
        {
          ...validArticle("long-version-history"),
          markdown: `## 保存時点 ${index}\n\n長い編集セッションの内容です。`
        },
        new Date(NOW.getTime() + index * 1_000),
        {},
        { editSessionId, saveReason: "autosave" }
      );
    }

    const firstPage = await listCmsArticleVersionCheckpoints(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      editSessionId
    );
    expect(firstPage.checkpoints).toHaveLength(100);
    expect(firstPage.checkpoints[0]?.number).toBe(102);
    expect(firstPage.checkpoints.at(-1)?.number).toBe(3);
    expect(firstPage.nextBeforeRevisionNumber).toBe(3);

    const secondPage = await listCmsArticleVersionCheckpoints(
      testEnv.CMS_DB,
      admin.identity,
      article.id,
      editSessionId,
      firstPage.nextBeforeRevisionNumber ?? undefined
    );
    expect(secondPage.nextBeforeRevisionNumber).toBeNull();
    expect(secondPage.checkpoints.map((checkpoint) => checkpoint.number)).toEqual([2, 1]);
    expect([...firstPage.checkpoints, ...secondPage.checkpoints].map((checkpoint) => checkpoint.number))
      .toEqual(Array.from({ length: 102 }, (_, index) => 102 - index));
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

async function publishArticle(
  identity: Awaited<ReturnType<typeof bootstrapAdmin>>["identity"],
  initial: Awaited<ReturnType<typeof createCmsArticle>>,
  visibility: "public" | "unlisted"
) {
  let article = await transitionCmsArticle(
    testEnv.CMS_DB,
    identity,
    initial.id,
    "request_review",
    initial.lockVersion,
    {},
    NOW
  );
  article = await transitionCmsArticle(
    testEnv.CMS_DB,
    identity,
    article.id,
    "approve",
    article.lockVersion,
    {},
    NOW
  );
  return transitionCmsArticle(
    testEnv.CMS_DB,
    identity,
    article.id,
    "publish",
    article.lockVersion,
    { visibility },
    NOW
  );
}

async function resolveOpenReviewComments(
  identity: Awaited<ReturnType<typeof bootstrapAdmin>>["identity"],
  article: Awaited<ReturnType<typeof createCmsArticle>>
) {
  const comments = await listCmsReviewComments(testEnv.CMS_DB, identity, article.id);
  for (const comment of comments.filter((comment) => comment.status === "open")) {
    await updateCmsReviewCommentStatus(
      testEnv.CMS_DB,
      identity,
      article.id,
      comment.id,
      "resolve",
      NOW
    );
  }
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
