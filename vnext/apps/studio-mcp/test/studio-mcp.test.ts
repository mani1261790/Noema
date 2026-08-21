import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration
} from "cloudflare:test";
import {
  Client,
  StreamableHTTPClientTransport,
  type FetchLike
} from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CmsSession } from "@noema/cms";
import { AccessTokenRejectedError } from "../../studio/worker/access";
import {
  createStudioMcpServer,
  handleStudioMcpRequest
} from "../src/index";

const testEnv = env as Env & { CMS_TEST_MIGRATIONS: D1Migration[] };
const ONE_PIXEL_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const SESSION: CmsSession = {
  capabilities: {
    canApprove: false,
    canComment: true,
    canEdit: true,
    canManageMembers: false,
    canPublish: false
  },
  identity: {
    email: "editor@example.com",
    role: "editor",
    subject: "editor-subject"
  }
};

const REVIEWER_SESSION: CmsSession = {
  capabilities: {
    canApprove: true,
    canComment: true,
    canEdit: false,
    canManageMembers: false,
    canPublish: false
  },
  identity: {
    email: "reviewer@example.com",
    role: "reviewer",
    subject: "reviewer-subject"
  }
};

beforeAll(async () => {
  await applyD1Migrations(testEnv.CMS_DB, testEnv.CMS_TEST_MIGRATIONS);
});

beforeEach(async () => {
  const storedAssets = await testEnv.ARTICLE_ASSETS.list();
  if (storedAssets.objects.length > 0) {
    await testEnv.ARTICLE_ASSETS.delete(storedAssets.objects.map((asset) => asset.key));
  }
  await testEnv.CMS_DB.batch([
    testEnv.CMS_DB.prepare("DELETE FROM cms_review_comments"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_audiences"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_references"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_asset_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_assets"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_imports"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_members"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_member_invitations")
  ]);
  await testEnv.CMS_DB.prepare(
    `INSERT INTO cms_members
      (subject, email, role, active, created_at, updated_at)
     VALUES (?1, ?2, 'editor', 1, ?3, ?3)`
  ).bind(
    SESSION.identity.subject,
    SESSION.identity.email,
    "2026-08-19T00:00:00.000Z"
  ).run();
  await testEnv.CMS_DB.prepare(
    `INSERT INTO cms_members
      (subject, email, role, active, created_at, updated_at)
     VALUES (?1, ?2, 'reviewer', 1, ?3, ?3)`
  ).bind(
    REVIEWER_SESSION.identity.subject,
    REVIEWER_SESSION.identity.email,
    "2026-08-19T00:00:00.000Z"
  ).run();
});

describe("Studio MCP tools", () => {
  it("exposes only draft-safe tools and returns the current CMS identity", async () => {
    const connection = await connectClient();
    const tools = await connection.client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "studio_approve_article",
      "studio_archive_asset",
      "studio_create_draft",
      "studio_get_article",
      "studio_list_articles",
      "studio_list_assets",
      "studio_preview_draft",
      "studio_request_changes",
      "studio_request_review",
      "studio_restore_asset",
      "studio_update_asset",
      "studio_update_draft",
      "studio_upload_asset",
      "studio_validate_draft",
      "studio_whoami"
    ]);

    const result = await connection.client.callTool({
      name: "studio_whoami",
      arguments: {}
    });
    expect(result.structuredContent).toEqual({
      capabilities: SESSION.capabilities,
      identity: SESSION.identity
    });

    await connection.close();
  });

  it("uploads an image idempotently and inserts its Markdown into a draft", async () => {
    const connection = await connectClient();
    const uploadArguments = {
      alt: "透明な1ピクセルのテスト画像",
      contentType: "image/png",
      dataBase64: ONE_PIXEL_PNG,
      fileName: "transparent.png",
      requestId: "00000000-0000-4000-8000-000000000030",
      tags: ["MCP", "テスト"]
    };
    const [uploaded, replayedUpload] = await Promise.all([
      connection.client.callTool({
        name: "studio_upload_asset",
        arguments: uploadArguments
      }),
      connection.client.callTool({
        name: "studio_upload_asset",
        arguments: uploadArguments
      })
    ]);
    const asset = assetFrom(uploaded.structuredContent);
    expect(assetFrom(replayedUpload.structuredContent).id).toBe(asset.id);
    expect(uploaded.structuredContent).toMatchObject({
      markdown: `![${uploadArguments.alt}](${asset.markdownUrl})`
    });

    const stored = await testEnv.ARTICLE_ASSETS.get(asset.r2Key);
    expect(stored).not.toBeNull();
    expect(stored?.httpMetadata?.contentType).toBe("image/png");
    expect(await testEnv.ARTICLE_ASSETS.list()).toMatchObject({
      objects: [{ key: asset.r2Key }]
    });

    const listed = await connection.client.callTool({
      name: "studio_list_assets",
      arguments: { query: "テスト" }
    });
    expect(listed.structuredContent).toMatchObject({
      assets: [{ id: asset.id, referenceCount: 0 }],
      count: 1
    });

    const draftInput = validArticle("mcp-asset-draft");
    const createdResult = await connection.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...draftInput,
        requestId: "00000000-0000-4000-8000-000000000031"
      }
    });
    const created = articleFrom(createdResult.structuredContent);
    const markdown = (uploaded.structuredContent as { markdown: string }).markdown;
    const updated = await connection.client.callTool({
      name: "studio_update_draft",
      arguments: {
        ...draftInput,
        articleId: created.id,
        expectedVersion: created.lockVersion,
        markdown: `${draftInput.markdown}\n\n${markdown}`,
        requestId: "00000000-0000-4000-8000-000000000032"
      }
    });
    expect(articleFrom(updated.structuredContent).lockVersion).toBe(2);

    const referenceCount = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_asset_references WHERE asset_id = ?1 AND article_id = ?2 AND location = 'markdown'"
    ).bind(asset.id, created.id).first<number>("count");
    expect(referenceCount).toBe(1);

    const updateAssetArguments = {
      alt: "更新した透明画像の説明",
      assetId: asset.id,
      expectedUpdatedAt: asset.updatedAt.replace(/Z$/u, "+00:00"),
      requestId: "00000000-0000-4000-8000-000000000035",
      tags: ["更新済み"]
    };
    const updatedAssetResult = await connection.client.callTool({
      name: "studio_update_asset",
      arguments: updateAssetArguments
    });
    const replayedAssetUpdate = await connection.client.callTool({
      name: "studio_update_asset",
      arguments: updateAssetArguments
    });
    const updatedAsset = assetFrom(updatedAssetResult.structuredContent);
    expect(updatedAssetResult.structuredContent).toMatchObject({
      asset: { alt: updateAssetArguments.alt, tags: ["更新済み"] }
    });
    expect(assetFrom(replayedAssetUpdate.structuredContent).updatedAt)
      .toBe(updatedAsset.updatedAt);

    const changedAssetUpdate = await connection.client.callTool({
      name: "studio_update_asset",
      arguments: { ...updateAssetArguments, alt: "別の説明" }
    });
    expect(toolErrorCode(changedAssetUpdate)).toBe("idempotency_conflict");
    const staleAssetUpdate = await connection.client.callTool({
      name: "studio_update_asset",
      arguments: {
        ...updateAssetArguments,
        requestId: "00000000-0000-4000-8000-000000000036"
      }
    });
    expect(toolErrorCode(staleAssetUpdate)).toBe("asset_conflict");

    const counts = await testEnv.CMS_DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM cms_assets) AS assets,
        (SELECT COUNT(*) FROM cms_mcp_asset_idempotency) AS idempotency_keys,
        (SELECT COUNT(*) FROM cms_audit_events WHERE action = 'asset.updated') AS update_audits,
        (SELECT COUNT(*) FROM cms_audit_events WHERE action = 'asset.uploaded') AS upload_audits`
    ).first<{
      assets: number;
      idempotency_keys: number;
      update_audits: number;
      upload_audits: number;
    }>();
    expect(counts).toEqual({
      assets: 1,
      idempotency_keys: 2,
      update_audits: 1,
      upload_audits: 1
    });
    const audit = await testEnv.CMS_DB.prepare(
      "SELECT metadata_json FROM cms_audit_events WHERE action = 'asset.uploaded'"
    ).first<{ metadata_json: string }>();
    expect(JSON.parse(audit?.metadata_json ?? "{}")).toMatchObject({
      assetId: asset.id,
      channel: "mcp",
      client: "Noema MCP test",
      contentType: "image/png",
      originalName: "transparent.png",
      requestId: uploadArguments.requestId,
      tool: "studio_upload_asset"
    });
    expect(audit?.metadata_json).not.toContain(ONE_PIXEL_PNG);

    await connection.close();
  });

  it("rejects invalid image bytes and conflicting upload retries", async () => {
    const connection = await connectClient();
    const invalid = await connection.client.callTool({
      name: "studio_upload_asset",
      arguments: {
        alt: "PNGではないデータ",
        contentType: "image/png",
        dataBase64: "bm90IGEgcG5n",
        fileName: "invalid.png",
        requestId: "00000000-0000-4000-8000-000000000033"
      }
    });
    expect(toolErrorCode(invalid)).toBe("invalid_asset");

    const requestId = "00000000-0000-4000-8000-000000000034";
    await connection.client.callTool({
      name: "studio_upload_asset",
      arguments: {
        alt: "最初の説明",
        contentType: "image/png",
        dataBase64: ONE_PIXEL_PNG,
        fileName: "first.png",
        requestId
      }
    });
    const conflict = await connection.client.callTool({
      name: "studio_upload_asset",
      arguments: {
        alt: "異なる説明",
        contentType: "image/png",
        dataBase64: ONE_PIXEL_PNG,
        fileName: "first.png",
        requestId
      }
    });
    expect(toolErrorCode(conflict)).toBe("idempotency_conflict");
    expect((await testEnv.ARTICLE_ASSETS.list()).objects).toHaveLength(1);
    await connection.close();
  });

  it("accepts JPEG and GIF data with bytes after the end marker", async () => {
    const connection = await connectClient();
    const uploads = await Promise.all([
      connection.client.callTool({
        name: "studio_upload_asset",
        arguments: {
          alt: "末尾にパディングがあるJPEG",
          contentType: "image/jpeg",
          dataBase64: "/9j/2wAA/9kAAA==",
          fileName: "padded.jpg",
          requestId: "00000000-0000-4000-8000-000000000037"
        }
      }),
      connection.client.callTool({
        name: "studio_upload_asset",
        arguments: {
          alt: "末尾にパディングがあるGIF",
          contentType: "image/gif",
          dataBase64: "R0lGODlhAAAAAAAAADsAAA==",
          fileName: "padded.gif",
          requestId: "00000000-0000-4000-8000-000000000038"
        }
      })
    ]);

    expect(uploads.every((upload) => !upload.isError)).toBe(true);
    expect((await testEnv.ARTICLE_ASSETS.list()).objects).toHaveLength(2);
    await connection.close();
  });

  it("archives and restores an unused asset idempotently without deleting R2 data", async () => {
    const connection = await connectClient();
    const uploaded = await connection.client.callTool({
      name: "studio_upload_asset",
      arguments: {
        alt: "状態変更するテスト画像",
        contentType: "image/png",
        dataBase64: ONE_PIXEL_PNG,
        fileName: "status.png",
        requestId: "00000000-0000-4000-8000-000000000040"
      }
    });
    const asset = assetFrom(uploaded.structuredContent);
    const archiveArguments = {
      assetId: asset.id,
      expectedUpdatedAt: asset.updatedAt.replace(/Z$/u, "+00:00"),
      requestId: "00000000-0000-4000-8000-000000000041"
    };
    const archived = await connection.client.callTool({
      name: "studio_archive_asset",
      arguments: archiveArguments
    });
    const replayedArchive = await connection.client.callTool({
      name: "studio_archive_asset",
      arguments: archiveArguments
    });
    expect(archived.structuredContent).toMatchObject({ asset: { status: "archived" } });
    expect(replayedArchive.structuredContent).toEqual(archived.structuredContent);

    const changedArchive = await connection.client.callTool({
      name: "studio_archive_asset",
      arguments: { ...archiveArguments, expectedUpdatedAt: "2026-08-19T00:00:00.000Z" }
    });
    expect(toolErrorCode(changedArchive)).toBe("idempotency_conflict");

    const archivedAsset = assetFrom(archived.structuredContent);
    const restoreArguments = {
      assetId: asset.id,
      expectedUpdatedAt: archivedAsset.updatedAt,
      requestId: "00000000-0000-4000-8000-000000000042"
    };
    const restored = await connection.client.callTool({
      name: "studio_restore_asset",
      arguments: restoreArguments
    });
    const replayedRestore = await connection.client.callTool({
      name: "studio_restore_asset",
      arguments: restoreArguments
    });
    expect(restored.structuredContent).toMatchObject({ asset: { status: "active" } });
    expect(replayedRestore.structuredContent).toEqual(restored.structuredContent);

    const restoredAsset = assetFrom(restored.structuredContent);
    const invalidRestore = await connection.client.callTool({
      name: "studio_restore_asset",
      arguments: {
        assetId: asset.id,
        expectedUpdatedAt: restoredAsset.updatedAt,
        requestId: "00000000-0000-4000-8000-000000000047"
      }
    });
    expect(toolErrorCode(invalidRestore)).toBe("invalid_transition");

    const staleArchive = await connection.client.callTool({
      name: "studio_archive_asset",
      arguments: {
        assetId: asset.id,
        expectedUpdatedAt: asset.updatedAt,
        requestId: "00000000-0000-4000-8000-000000000043"
      }
    });
    expect(toolErrorCode(staleArchive)).toBe("asset_conflict");
    expect(await testEnv.ARTICLE_ASSETS.get(asset.r2Key)).not.toBeNull();

    const counts = await testEnv.CMS_DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM cms_audit_events
          WHERE action IN ('asset.archived', 'asset.restored')) AS audits,
        (SELECT COUNT(*) FROM cms_mcp_asset_idempotency
          WHERE tool_name IN ('studio_archive_asset', 'studio_restore_asset')) AS idempotency_keys`
    ).first<{ audits: number; idempotency_keys: number }>();
    expect(counts).toEqual({ audits: 2, idempotency_keys: 2 });
    await connection.close();
  });

  it("does not archive an asset referenced by an article", async () => {
    const connection = await connectClient();
    const uploaded = await connection.client.callTool({
      name: "studio_upload_asset",
      arguments: {
        alt: "記事で使用するテスト画像",
        contentType: "image/png",
        dataBase64: ONE_PIXEL_PNG,
        fileName: "referenced.png",
        requestId: "00000000-0000-4000-8000-000000000044"
      }
    });
    const asset = assetFrom(uploaded.structuredContent);
    await connection.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("mcp-referenced-asset"),
        markdown: `## 使用中\n\n![画像](${asset.markdownUrl})`,
        requestId: "00000000-0000-4000-8000-000000000045"
      }
    });

    const archived = await connection.client.callTool({
      name: "studio_archive_asset",
      arguments: {
        assetId: asset.id,
        expectedUpdatedAt: asset.updatedAt,
        requestId: "00000000-0000-4000-8000-000000000046"
      }
    });
    expect(toolErrorCode(archived)).toBe("asset_in_use");
    await connection.close();
  });

  it("renders a bounded read-only preview with the public Markdown renderer", async () => {
    const connection = await connectClient();
    const preview = await connection.client.callTool({
      name: "studio_preview_draft",
      arguments: {
        ...validArticle("mcp-preview"),
        markdown: "## 安全な見出し\n\n<script>alert('xss')</script>\n\n[危険](javascript:alert(1))\n\n$$x^2$$"
      }
    });
    const result = preview.structuredContent as {
      html: string;
      mediaType: string;
      valid: boolean;
    };
    expect(result.mediaType).toBe("text/html");
    expect(result.html).toContain('<h2 id="安全な見出し">');
    expect(result.html).toContain("katex");
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain('href="javascript:');
    expect(result.valid).toBe(false);
    const auditCount = await testEnv.CMS_DB.prepare(
      "SELECT COUNT(*) AS count FROM cms_audit_events"
    ).first<number>("count");
    expect(auditCount).toBe(0);
    await connection.close();
  });

  it("supports an idempotent review request and reviewer change request", async () => {
    const editor = await connectClient();
    const createdResult = await editor.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("mcp-review-workflow"),
        requestId: "00000000-0000-4000-8000-000000000010"
      }
    });
    const created = articleFrom(createdResult.structuredContent);
    const reviewArguments = {
      articleId: created.id,
      expectedVersion: created.lockVersion,
      note: "構成と技術内容のレビューをお願いします。",
      requestId: "00000000-0000-4000-8000-000000000011"
    };
    const requested = await editor.client.callTool({
      name: "studio_request_review",
      arguments: reviewArguments
    });
    const replayedRequest = await editor.client.callTool({
      name: "studio_request_review",
      arguments: reviewArguments
    });
    expect(articleFrom(requested.structuredContent)).toMatchObject({
      lockVersion: 2,
      reviewNote: reviewArguments.note,
      reviewStatus: "in_review"
    });
    expect(articleFrom(replayedRequest.structuredContent).lockVersion).toBe(2);

    const editorChangeRequest = await editor.client.callTool({
      name: "studio_request_changes",
      arguments: {
        articleId: created.id,
        expectedVersion: 2,
        note: "編集者にはレビュー権限がありません。",
        requestId: "00000000-0000-4000-8000-000000000012"
      }
    });
    expect(toolErrorCode(editorChangeRequest)).toBe("forbidden");
    await editor.close();

    const reviewer = await connectClient(REVIEWER_SESSION);
    const emptyNote = await reviewer.client.callTool({
      name: "studio_request_changes",
      arguments: {
        articleId: created.id,
        expectedVersion: 2,
        note: "",
        requestId: "00000000-0000-4000-8000-000000000013"
      }
    });
    expect(emptyNote.isError).toBe(true);

    const changesArguments = {
      articleId: created.id,
      expectedVersion: 2,
      note: "結論の根拠となる出典を追記してください。",
      requestId: "00000000-0000-4000-8000-000000000014"
    };
    const changed = await reviewer.client.callTool({
      name: "studio_request_changes",
      arguments: changesArguments
    });
    const replayedChanges = await reviewer.client.callTool({
      name: "studio_request_changes",
      arguments: changesArguments
    });
    expect(articleFrom(changed.structuredContent)).toMatchObject({
      lockVersion: 3,
      reviewNote: changesArguments.note,
      reviewStatus: "changes_requested"
    });
    expect(articleFrom(replayedChanges.structuredContent).lockVersion).toBe(3);

    const changedInput = await reviewer.client.callTool({
      name: "studio_request_changes",
      arguments: { ...changesArguments, note: "別の指摘です。" }
    });
    expect(toolErrorCode(changedInput)).toBe("idempotency_conflict");
    const staleVersion = await reviewer.client.callTool({
      name: "studio_request_changes",
      arguments: {
        ...changesArguments,
        requestId: "00000000-0000-4000-8000-000000000015"
      }
    });
    expect(toolErrorCode(staleVersion)).toBe("revision_conflict");

    const auditRows = await testEnv.CMS_DB.prepare(
      `SELECT action, metadata_json
       FROM cms_audit_events
       WHERE action IN ('article.request_review', 'article.request_changes')
       ORDER BY action`
    ).all<{ action: string; metadata_json: string }>();
    expect(auditRows.results).toHaveLength(2);
    for (const row of auditRows.results) {
      expect(JSON.parse(row.metadata_json)).toMatchObject({
        channel: "mcp",
        client: "Noema MCP test"
      });
    }
    expect(auditRows.results.map((row) => JSON.parse(row.metadata_json).tool).sort())
      .toEqual(["studio_request_changes", "studio_request_review"]);

    const actionIdempotencyCount = await testEnv.CMS_DB.prepare(
      `SELECT COUNT(*) AS count
       FROM cms_mcp_idempotency
       WHERE tool_name IN ('studio_request_review', 'studio_request_changes')`
    ).first<number>("count");
    expect(actionIdempotencyCount).toBe(2);
    await reviewer.close();
  });

  it("approves a reviewed revision idempotently without publishing it", async () => {
    const editor = await connectClient();
    const createdResult = await editor.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("mcp-approval"),
        requestId: "00000000-0000-4000-8000-000000000050"
      }
    });
    const created = articleFrom(createdResult.structuredContent);
    const requested = await editor.client.callTool({
      name: "studio_request_review",
      arguments: {
        articleId: created.id,
        expectedVersion: created.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000051"
      }
    });
    const inReview = articleFrom(requested.structuredContent);
    const forbidden = await editor.client.callTool({
      name: "studio_approve_article",
      arguments: {
        articleId: created.id,
        expectedVersion: inReview.lockVersion,
        note: "編集者自身による承認はできません。",
        requestId: "00000000-0000-4000-8000-000000000052"
      }
    });
    expect(toolErrorCode(forbidden)).toBe("forbidden");
    await editor.close();

    const reviewer = await connectClient(REVIEWER_SESSION);
    const approveArguments = {
      articleId: created.id,
      expectedVersion: inReview.lockVersion,
      note: "構成、根拠、画像説明を確認しました。",
      requestId: "00000000-0000-4000-8000-000000000053"
    };
    const approved = await reviewer.client.callTool({
      name: "studio_approve_article",
      arguments: approveArguments
    });
    const replayedApproval = await reviewer.client.callTool({
      name: "studio_approve_article",
      arguments: approveArguments
    });
    expect(articleFrom(approved.structuredContent)).toMatchObject({
      lockVersion: 3,
      reviewNote: approveArguments.note,
      reviewStatus: "approved"
    });
    expect(replayedApproval.structuredContent).toEqual(approved.structuredContent);
    expect(approved.structuredContent).toMatchObject({
      article: { publicationStatus: "unpublished" }
    });

    const changedApproval = await reviewer.client.callTool({
      name: "studio_approve_article",
      arguments: { ...approveArguments, note: "異なる承認理由です。" }
    });
    expect(toolErrorCode(changedApproval)).toBe("idempotency_conflict");
    const staleApproval = await reviewer.client.callTool({
      name: "studio_approve_article",
      arguments: {
        ...approveArguments,
        requestId: "00000000-0000-4000-8000-000000000054"
      }
    });
    expect(toolErrorCode(staleApproval)).toBe("revision_conflict");

    const audit = await testEnv.CMS_DB.prepare(
      "SELECT metadata_json FROM cms_audit_events WHERE action = 'article.approve'"
    ).first<{ metadata_json: string }>();
    expect(JSON.parse(audit?.metadata_json ?? "{}")).toMatchObject({
      channel: "mcp",
      client: "Noema MCP test",
      requestId: approveArguments.requestId,
      tool: "studio_approve_article"
    });
    await reviewer.close();
  });

  it("rejects reviewer self-approval and an empty approval reason", async () => {
    const editor = await connectClient();
    const createdResult = await editor.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("mcp-self-approval"),
        requestId: "00000000-0000-4000-8000-000000000055"
      }
    });
    const created = articleFrom(createdResult.structuredContent);
    await testEnv.CMS_DB.prepare(
      `UPDATE cms_article_revisions
       SET created_by_subject = ?1
       WHERE article_id = ?2 AND revision_number = 1`
    ).bind(REVIEWER_SESSION.identity.subject, created.id).run();
    const requested = await editor.client.callTool({
      name: "studio_request_review",
      arguments: {
        articleId: created.id,
        expectedVersion: created.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000056"
      }
    });
    const inReview = articleFrom(requested.structuredContent);
    await editor.close();

    const reviewer = await connectClient(REVIEWER_SESSION);
    const forbiddenEdit = await reviewer.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("reviewer-edit-forbidden"),
        requestId: "00000000-0000-4000-8000-000000000059"
      }
    });
    expect(toolErrorCode(forbiddenEdit)).toBe("forbidden");
    const emptyReason = await reviewer.client.callTool({
      name: "studio_approve_article",
      arguments: {
        articleId: created.id,
        expectedVersion: inReview.lockVersion,
        note: "",
        requestId: "00000000-0000-4000-8000-000000000057"
      }
    });
    expect(emptyReason.isError).toBe(true);
    const selfApproval = await reviewer.client.callTool({
      name: "studio_approve_article",
      arguments: {
        articleId: created.id,
        expectedVersion: inReview.lockVersion,
        note: "自分で保存した原稿を承認します。",
        requestId: "00000000-0000-4000-8000-000000000058"
      }
    });
    expect(toolErrorCode(selfApproval)).toBe("self_approval_forbidden");
    await reviewer.close();
  });

  it("accepts only one of two concurrent review requests for the same revision", async () => {
    const firstEditor = await connectClient();
    const secondEditor = await connectClient();
    const createdResult = await firstEditor.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("mcp-concurrent-review"),
        requestId: "00000000-0000-4000-8000-000000000020"
      }
    });
    const created = articleFrom(createdResult.structuredContent);

    const results = await Promise.all([
      firstEditor.client.callTool({
        name: "studio_request_review",
        arguments: {
          articleId: created.id,
          expectedVersion: created.lockVersion,
          note: "最初のレビュー依頼です。",
          requestId: "00000000-0000-4000-8000-000000000021"
        }
      }),
      secondEditor.client.callTool({
        name: "studio_request_review",
        arguments: {
          articleId: created.id,
          expectedVersion: created.lockVersion,
          note: "同時に送られた別のレビュー依頼です。",
          requestId: "00000000-0000-4000-8000-000000000022"
        }
      })
    ]);

    const succeeded = results.filter((result) => !result.isError);
    const failed = results.filter((result) => result.isError);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(articleFrom(succeeded[0]?.structuredContent)).toMatchObject({
      lockVersion: 2,
      reviewStatus: "in_review"
    });
    expect(toolErrorCode(failed[0])).toBe("revision_conflict");

    const counts = await testEnv.CMS_DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM cms_audit_events
          WHERE action = 'article.request_review') AS audits,
        (SELECT COUNT(*) FROM cms_mcp_idempotency
          WHERE tool_name = 'studio_request_review') AS idempotency_keys`
    ).first<{ audits: number; idempotency_keys: number }>();
    expect(counts).toEqual({ audits: 1, idempotency_keys: 1 });

    await Promise.all([firstEditor.close(), secondEditor.close()]);
  });

  it("validates without mutating and creates or updates once across retries", async () => {
    const connection = await connectClient();
    const input = validArticle("mcp-draft");
    const validation = await connection.client.callTool({
      name: "studio_validate_draft",
      arguments: input
    });
    expect(validation.structuredContent).toMatchObject({ valid: true });

    const createArguments = {
      ...input,
      requestId: "00000000-0000-4000-8000-000000000001"
    };
    const [created, replayedCreate] = await Promise.all([
      connection.client.callTool({
        name: "studio_create_draft",
        arguments: createArguments
      }),
      connection.client.callTool({
        name: "studio_create_draft",
        arguments: createArguments
      })
    ]);
    const createdArticle = articleFrom(created.structuredContent);
    expect(articleFrom(replayedCreate.structuredContent).id).toBe(createdArticle.id);

    const updateArguments = {
      ...validArticle("mcp-draft-updated"),
      articleId: createdArticle.id,
      expectedVersion: createdArticle.lockVersion,
      requestId: "00000000-0000-4000-8000-000000000002"
    };
    const updated = await connection.client.callTool({
      name: "studio_update_draft",
      arguments: updateArguments
    });
    const replayedUpdate = await connection.client.callTool({
      name: "studio_update_draft",
      arguments: updateArguments
    });
    expect(articleFrom(updated.structuredContent)).toMatchObject({
      id: createdArticle.id,
      lockVersion: 2,
      revisionNumber: 2,
      slug: "mcp-draft-updated"
    });
    expect(articleFrom(replayedUpdate.structuredContent).revisionNumber).toBe(2);

    const staleUpdate = await connection.client.callTool({
      name: "studio_update_draft",
      arguments: {
        ...validArticle("stale-update"),
        articleId: createdArticle.id,
        expectedVersion: createdArticle.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000004"
      }
    });
    expect(staleUpdate.isError).toBe(true);
    expect(JSON.parse(
      staleUpdate.content[0]?.type === "text" ? staleUpdate.content[0].text : "{}"
    )).toMatchObject({ error: { code: "revision_conflict" } });

    const counts = await testEnv.CMS_DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM cms_articles) AS articles,
        (SELECT COUNT(*) FROM cms_article_revisions) AS revisions,
        (SELECT COUNT(*) FROM cms_mcp_idempotency) AS idempotency_keys`
    ).first<{ articles: number; idempotency_keys: number; revisions: number }>();
    expect(counts).toEqual({ articles: 1, idempotency_keys: 2, revisions: 2 });

    const audit = await testEnv.CMS_DB.prepare(
      "SELECT metadata_json FROM cms_audit_events WHERE action = 'article.revised'"
    ).first<{ metadata_json: string }>();
    expect(JSON.parse(audit?.metadata_json ?? "{}")).toMatchObject({
      channel: "mcp",
      client: "Noema MCP test",
      requestId: updateArguments.requestId,
      saveReason: "manual",
      tool: "studio_update_draft"
    });

    await connection.close();
  });

  it("rejects reuse of an idempotency key with different input", async () => {
    const connection = await connectClient();
    const requestId = "00000000-0000-4000-8000-000000000003";
    await connection.client.callTool({
      name: "studio_create_draft",
      arguments: { ...validArticle("first-draft"), requestId }
    });
    const conflict = await connection.client.callTool({
      name: "studio_create_draft",
      arguments: { ...validArticle("different-draft"), requestId }
    });

    expect(conflict.isError).toBe(true);
    expect(JSON.parse(conflict.content[0]?.type === "text" ? conflict.content[0].text : "{}"))
      .toMatchObject({ error: { code: "idempotency_conflict" } });
    await connection.close();
  });
});

describe("Studio MCP HTTP boundary", () => {
  it("keeps non-MCP paths closed and requires an Access assertion", async () => {
    const ctx = createExecutionContext();
    const notFound = await handleStudioMcpRequest(
      new Request("https://mcp.noema-learn.uk/"),
      testEnv,
      ctx
    );
    const unauthorized = await handleStudioMcpRequest(
      new Request("https://mcp.noema-learn.uk/mcp"),
      testEnv,
      ctx
    );
    expect(notFound.status).toBe(404);
    expect(unauthorized.status).toBe(401);
  });

  it("rejects an oversized MCP request before parsing or authentication", async () => {
    const result = await handleStudioMcpRequest(
      new Request("https://mcp.noema-learn.uk/mcp", {
        headers: { "content-length": String(12 * 1024 * 1024) },
        method: "POST"
      }),
      testEnv,
      createExecutionContext()
    );
    expect(result.status).toBe(413);
    await expect(result.json()).resolves.toMatchObject({
      error: { code: "request_too_large" }
    });
  });

  it("rejects an invalid Access assertion before MCP dispatch", async () => {
    const result = await handleStudioMcpRequest(
      new Request("https://mcp.noema-learn.uk/mcp", {
        headers: { "cf-access-jwt-assertion": "invalid-token" },
        method: "POST"
      }),
      testEnv,
      createExecutionContext(),
      {
        verifyAccessToken: async () => {
          throw new AccessTokenRejectedError();
        }
      }
    );
    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toMatchObject({
      error: { code: "unauthorized" }
    });
  });

  it("does not provision a CMS member from MCP authentication", async () => {
    await testEnv.CMS_DB.prepare("DELETE FROM cms_members").run();
    await testEnv.CMS_DB.prepare(
      `INSERT INTO cms_member_invitations
        (email, role, active, invited_by_subject, created_at, updated_at)
       VALUES (?1, 'admin', 1, 'studio-admin', ?2, ?2)`
    ).bind(SESSION.identity.email, "2026-08-19T00:00:00.000Z").run();

    const result = await handleStudioMcpRequest(
      new Request("https://mcp.noema-learn.uk/mcp", {
        headers: { "cf-access-jwt-assertion": "test-token" },
        method: "POST"
      }),
      testEnv,
      createExecutionContext(),
      { verifyAccessToken: async () => SESSION.identity }
    );

    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toMatchObject({
      error: { code: "member_not_registered" }
    });
    const counts = await testEnv.CMS_DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM cms_members) AS members,
        (SELECT COUNT(*) FROM cms_member_invitations) AS invitations`
    ).first<{ invitations: number; members: number }>();
    expect(counts).toEqual({ invitations: 1, members: 0 });
  });

  it("serves tool discovery over authenticated Streamable HTTP", async () => {
    const fetch: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      request.headers.set("cf-access-jwt-assertion", "test-token");
      request.headers.set("host", "mcp.noema-learn.uk");
      return handleStudioMcpRequest(
        request,
        testEnv,
        createExecutionContext(),
        { verifyAccessToken: async () => SESSION.identity }
      );
    };
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.noema-learn.uk/mcp"),
      { fetch }
    );
    const client = new Client({ name: "http-test", version: "0.1.0" });
    await client.connect(transport);
    const tools = await client.listTools();

    expect(tools.tools).toHaveLength(15);
    expect(tools.tools.some((tool) => tool.name === "studio_create_draft")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_list_assets")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_request_review")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_request_changes")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_upload_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_update_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_archive_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_restore_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_preview_draft")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_approve_article")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_delete_asset")).toBe(false);
    expect(tools.tools.some((tool) => tool.name === "studio_publish")).toBe(false);
    expect(tools.tools.some((tool) => tool.name === "studio_archive_article")).toBe(false);
    expect(tools.tools.some((tool) => tool.name === "studio_list_members")).toBe(false);
    await client.close();
  });
});

async function connectClient(session: CmsSession = SESSION) {
  const server = createStudioMcpServer(
    testEnv.CMS_DB,
    testEnv.ARTICLE_ASSETS,
    session,
    "Noema MCP test"
  );
  const client = new Client({ name: "noema-test", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport)
  ]);
  return {
    client,
    async close() {
      await Promise.all([client.close(), server.close()]);
    }
  };
}

function assetFrom(value: unknown): {
  id: string;
  markdownUrl: string;
  r2Key: string;
  updatedAt: string;
} {
  const asset = (value as { asset?: unknown } | undefined)?.asset;
  if (!asset || typeof asset !== "object") throw new Error("Missing asset result.");
  const result = asset as {
    id?: unknown;
    markdownUrl?: unknown;
    updatedAt?: unknown;
  };
  if (
    typeof result.id !== "string" ||
    typeof result.markdownUrl !== "string" ||
    typeof result.updatedAt !== "string"
  ) throw new Error("Invalid asset result.");
  const match = result.markdownUrl.match(/^\/media\/(articles\/.+)$/u);
  if (!match?.[1]) throw new Error("Missing asset R2 key.");
  return {
    id: result.id,
    markdownUrl: result.markdownUrl,
    r2Key: match[1],
    updatedAt: result.updatedAt
  };
}

function articleFrom(value: unknown): {
  id: string;
  lockVersion: number;
  revisionNumber: number;
  reviewNote: string | null;
  reviewStatus: string;
  slug: string;
} {
  const article = (value as { article?: unknown } | undefined)?.article;
  if (!article || typeof article !== "object") throw new Error("Missing article result.");
  return article as {
    id: string;
    lockVersion: number;
    revisionNumber: number;
    reviewNote: string | null;
    reviewStatus: string;
    slug: string;
  };
}

function toolErrorCode(value: { content?: unknown; isError?: boolean }): string | undefined {
  if (!value.isError || !Array.isArray(value.content)) return undefined;
  const text = value.content.find((item) =>
    item && typeof item === "object" && (item as { type?: unknown }).type === "text"
  ) as { text?: unknown } | undefined;
  if (typeof text?.text !== "string") return undefined;
  return (JSON.parse(text.text) as { error?: { code?: string } }).error?.code;
}

function validArticle(slug: string) {
  return {
    frontmatter: {
      title: "MCP記事",
      description: "Studio MCPで管理する記事の説明です。",
      slug,
      status: "draft" as const,
      updatedAt: "2026-08-19",
      authors: ["Noema編集部"],
      topics: ["development-environment" as const],
      tags: ["MCP"],
      approach: "development" as const,
      outcome: "MCPから安全に下書きを保存できる",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    },
    markdown: "## MCPで管理する\n\n記事本文をD1のrevisionとして保存します。",
    visibility: "internal" as const
  };
}
