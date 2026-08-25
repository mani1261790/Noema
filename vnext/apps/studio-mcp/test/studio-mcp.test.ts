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
import type {
  CmsDiscordNotificationQueue,
  CmsDiscordQueueMessage
} from "../../studio/worker/discord-milestone-notifications";
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
    displayName: "編集者",
    email: "editor@example.com",
    publicId: "11111111111111111111111111111111",
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
    displayName: "レビュー担当",
    email: "reviewer@example.com",
    publicId: "22222222222222222222222222222222",
    role: "reviewer",
    subject: "reviewer-subject"
  }
};

const ADMIN_SESSION: CmsSession = {
  capabilities: {
    canApprove: true,
    canComment: true,
    canEdit: true,
    canManageMembers: true,
    canPublish: true
  },
  identity: {
    displayName: "管理者",
    email: "admin@example.com",
    publicId: "33333333333333333333333333333333",
    role: "admin",
    subject: "admin-subject"
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
    testEnv.CMS_DB.prepare("DELETE FROM cms_discord_notification_outbox"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_analytics_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_analytics_daily"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_analytics_ingestion_daily"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_analytics_pipeline_runs"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_review_comments"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_audiences"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_references"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_series"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series_revision_items"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_series"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_asset_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_mcp_idempotency"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_audit_events"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_article_revisions"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_articles"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_assets"),
    testEnv.CMS_DB.prepare("DELETE FROM cms_asset_deletions"),
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
  await testEnv.CMS_DB.prepare(
    `INSERT INTO cms_members
      (subject, email, role, active, created_at, updated_at)
     VALUES (?1, ?2, 'admin', 1, ?3, ?3)`
  ).bind(
    ADMIN_SESSION.identity.subject,
    ADMIN_SESSION.identity.email,
    "2026-08-19T00:00:00.000Z"
  ).run();
});

describe("Studio MCP tools", () => {
  it("passes draft creation and review milestones to the Queue binding", async () => {
    const messages: CmsDiscordQueueMessage[] = [];
    const queue: CmsDiscordNotificationQueue = {
      async send(message) {
        messages.push(message);
      }
    };
    const connection = await connectClient(SESSION, queue);
    const created = articleFrom((await connection.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("mcp-notifications"),
        requestId: "00000000-0000-4000-8000-000000000001"
      }
    })).structuredContent);
    await connection.client.callTool({
      name: "studio_request_review",
      arguments: {
        articleId: created.id,
        expectedVersion: created.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000002"
      }
    });

    expect(messages).toHaveLength(2);
    const kinds = await testEnv.CMS_DB.prepare(
      "SELECT kind FROM cms_discord_notification_outbox ORDER BY created_at ASC"
    ).all<{ kind: string }>();
    expect(kinds.results.map((row) => row.kind)).toEqual([
      "article_created",
      "review_requested"
    ]);
    await connection.close();
  });

  it("exposes CMS editing tools without publication actions and returns the current identity", async () => {
    const connection = await connectClient();
    const tools = await connection.client.listTools();

    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      "studio_approve_article",
      "studio_archive_asset",
      "studio_create_draft",
      "studio_create_review_comment",
      "studio_create_series",
      "studio_delete_asset",
      "studio_delete_series",
      "studio_get_analytics_summary",
      "studio_get_article",
      "studio_get_article_version",
      "studio_get_series",
      "studio_list_article_version_checkpoints",
      "studio_list_article_versions",
      "studio_list_articles",
      "studio_list_assets",
      "studio_list_members",
      "studio_list_review_comments",
      "studio_list_series",
      "studio_list_series_versions",
      "studio_merge_series",
      "studio_preview_draft",
      "studio_rebuild_analytics_mart",
      "studio_reopen_review_comment",
      "studio_request_changes",
      "studio_request_review",
      "studio_resolve_review_comment",
      "studio_restore_article_version",
      "studio_restore_asset",
      "studio_restore_series_version",
      "studio_revoke_approval",
      "studio_update_asset",
      "studio_update_draft",
      "studio_update_profile",
      "studio_update_series",
      "studio_upload_asset",
      "studio_upsert_member",
      "studio_validate_draft",
      "studio_whoami",
      "studio_withdraw_review"
    ]);
    expect(tools.tools.map((tool) => tool.name)).not.toContain("studio_publish_article");
    expect(tools.tools.map((tool) => tool.name)).not.toContain("studio_archive_article");

    const updateDraft = tools.tools.find((tool) => tool.name === "studio_update_draft");
    const updateProperties = (updateDraft?.inputSchema as {
      properties?: Record<string, unknown>;
    }).properties ?? {};
    expect(updateProperties).not.toHaveProperty("editSessionId");
    expect(updateProperties).not.toHaveProperty("saveReason");
    expect(updateProperties).not.toHaveProperty("sourceRevisionId");

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

  it("returns the same read-only analytics summary as Studio", async () => {
    const date = new Date().toISOString().slice(0, 10);
    await testEnv.CMS_DB.prepare(
      `INSERT INTO cms_analytics_daily (
         event_date, article_id, article_slug, revision_number, event_type,
         event_count, updated_at
       ) VALUES (?1, 'analytics-article', 'analytics-foundation', 2, 'landing', 4, ?2)`
    ).bind(date, `${date}T01:00:00.000Z`).run();
    const connection = await connectClient();
    const result = await connection.client.callTool({
      name: "studio_get_analytics_summary",
      arguments: { days: 7 }
    });

    expect(result.structuredContent).toMatchObject({
      summary: {
        articles: [{ landing: 4, revisionNumber: 2, slug: "analytics-foundation" }],
        range: { days: 7 },
        totals: { landing: 4 }
      }
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
    expect(result.html).toContain('class="article-presentation"');
    expect(result.html).toContain('href="/editors/11111111111111111111111111111111"');
    expect(result.html).toContain("編集者");
    expect(result.html).not.toContain("editor@example.com");
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

  it("advertises and renders the Noema accordion Markdown extension", async () => {
    const connection = await connectClient();
    const tools = await connection.client.listTools();
    const createDraft = tools.tools.find((tool) => tool.name === "studio_create_draft");
    expect(createDraft?.description).toContain(":::accordion タイトル");
    expect(JSON.stringify(createDraft?.inputSchema)).toContain("アコーディオン");

    const preview = await connection.client.callTool({
      name: "studio_preview_draft",
      arguments: {
        ...validArticle("mcp-accordion-preview"),
        markdown: "## 本文\n\n:::accordion 詳しい説明\n\n補足です。\n\n:::"
      }
    });
    const result = preview.structuredContent as { html: string; valid: boolean };
    expect(result.html).toContain('<details class="article-accordion">');
    expect(result.html).toContain("<summary>詳しい説明</summary>");
    expect(result.valid).toBe(true);
    await connection.close();
  });

  it("creates, updates, lists, and restores a series without changing publication", async () => {
    const connection = await connectClient();
    const articles = await Promise.all(["series-first", "series-second", "series-third"].map(
      async (slug, index) => articleFrom((await connection.client.callTool({
        name: "studio_create_draft",
        arguments: {
          ...validArticle(slug),
          requestId: `00000000-0000-4000-8000-0000000001${index + 60}`
        }
      })).structuredContent)
    ));
    const first = articles[0];
    const second = articles[1];
    const third = articles[2];
    expect(first && second && third).toBeTruthy();

    const createdResult = await connection.client.callTool({
      name: "studio_create_series",
      arguments: {
        articleIds: [first!.id, second!.id],
        description: "MCPから作成したシリーズです。",
        slug: "mcp-series",
        title: "MCPシリーズ"
      }
    });
    const created = seriesFrom(createdResult.structuredContent);
    expect(created).toMatchObject({
      articleIds: [first!.id, second!.id],
      lockVersion: 1,
      revisionNumber: 1
    });

    const updatedResult = await connection.client.callTool({
      name: "studio_update_series",
      arguments: {
        articleIds: [second!.id, first!.id, third!.id],
        description: "記事を追加し、順番を変更しました。",
        expectedVersion: created.lockVersion,
        seriesId: created.id,
        slug: "mcp-series",
        title: "更新したMCPシリーズ"
      }
    });
    const updated = seriesFrom(updatedResult.structuredContent);
    expect(updated).toMatchObject({
      articleIds: [second!.id, first!.id, third!.id],
      lockVersion: 2,
      revisionNumber: 2
    });

    const stale = await connection.client.callTool({
      name: "studio_update_series",
      arguments: {
        articleIds: [first!.id],
        description: "古い版からの更新です。",
        expectedVersion: 1,
        seriesId: created.id,
        slug: "mcp-series",
        title: "競合する更新"
      }
    });
    expect(toolErrorCode(stale)).toBe("series_conflict");

    const versionsResult = await connection.client.callTool({
      name: "studio_list_series_versions",
      arguments: { seriesId: created.id }
    });
    const versions = (versionsResult.structuredContent as { versions: Array<{
      articleIds: string[];
      id: string;
      number: number;
    }> }).versions;
    expect(versions.map((version) => version.number)).toEqual([2, 1]);

    const restoredResult = await connection.client.callTool({
      name: "studio_restore_series_version",
      arguments: {
        expectedVersion: updated.lockVersion,
        seriesId: created.id,
        versionId: versions[1]!.id
      }
    });
    const restored = seriesFrom(restoredResult.structuredContent);
    expect(restored).toMatchObject({
      articleIds: [first!.id, second!.id],
      lockVersion: 3,
      revisionNumber: 3
    });
    expect(restoredResult.structuredContent).toMatchObject({
      restoredFromVersionId: versions[1]!.id
    });

    const listed = await connection.client.callTool({
      name: "studio_list_series",
      arguments: { query: "MCPシリーズ" }
    });
    expect(listed.structuredContent).toMatchObject({ count: 1 });
    const fetched = await connection.client.callTool({
      name: "studio_get_series",
      arguments: { seriesId: created.id }
    });
    expect(seriesFrom(fetched.structuredContent)).toEqual(restored);

    const mergeSource = seriesFrom((await connection.client.callTool({
      name: "studio_create_series",
      arguments: {
        articleIds: [third!.id],
        description: "統合後に削除されるシリーズです。",
        slug: "mcp-merge-source",
        title: "MCP統合元"
      }
    })).structuredContent);
    const mergedResult = await connection.client.callTool({
      name: "studio_merge_series",
      arguments: {
        articleIds: [first!.id, second!.id, third!.id],
        sourceExpectedVersion: mergeSource.lockVersion,
        sourceSeriesId: mergeSource.id,
        targetExpectedVersion: restored.lockVersion,
        targetSeriesId: restored.id
      }
    });
    const merged = seriesFrom(mergedResult.structuredContent);
    expect(merged).toMatchObject({
      articleIds: [first!.id, second!.id, third!.id],
      id: restored.id,
      lockVersion: 4
    });
    expect(mergedResult.structuredContent).toMatchObject({ deletedSourceSeriesId: mergeSource.id });

    const emptied = seriesFrom((await connection.client.callTool({
      name: "studio_update_series",
      arguments: {
        articleIds: [],
        description: merged.description,
        expectedVersion: merged.lockVersion,
        seriesId: merged.id,
        slug: merged.slug,
        title: merged.title
      }
    })).structuredContent);
    expect(emptied.articleIds).toEqual([]);
    const deleted = await connection.client.callTool({
      name: "studio_delete_series",
      arguments: { expectedVersion: emptied.lockVersion, seriesId: emptied.id }
    });
    expect(deleted.structuredContent).toEqual({ deleted: true, seriesId: emptied.id });
    const afterDelete = await connection.client.callTool({
      name: "studio_list_series",
      arguments: {}
    });
    expect(afterDelete.structuredContent).toMatchObject({ count: 0 });
    expect(articles.every((article) => article.publicationStatus === "unpublished")).toBe(true);
    const seriesAudits = await testEnv.CMS_DB.prepare(
      "SELECT action, metadata_json FROM cms_audit_events WHERE action LIKE 'series.%' ORDER BY created_at, action"
    ).all<{ action: string; metadata_json: string }>();
    expect(seriesAudits.results.map((row) => row.action).sort()).toEqual([
      "series.created",
      "series.created",
      "series.deleted",
      "series.merged",
      "series.restored",
      "series.updated",
      "series.updated"
    ]);
    expect(seriesAudits.results.map((row) => JSON.parse(row.metadata_json).tool).sort()).toEqual([
      "studio_create_series",
      "studio_create_series",
      "studio_delete_series",
      "studio_merge_series",
      "studio_restore_series_version",
      "studio_update_series",
      "studio_update_series"
    ]);
    await connection.close();
  });

  it("supports anchored review comments through correction, resolution, and approval", async () => {
    const editor = await connectClient();
    const created = articleFrom((await editor.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("mcp-review-parity"),
        requestId: "00000000-0000-4000-8000-000000000170"
      }
    })).structuredContent);
    const inReview = articleFrom((await editor.client.callTool({
      name: "studio_request_review",
      arguments: {
        articleId: created.id,
        expectedVersion: created.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000171"
      }
    })).structuredContent);

    const reviewer = await connectClient(REVIEWER_SESSION);
    const markdown = validArticle("mcp-review-parity").markdown;
    const quote = "記事本文";
    const startOffset = markdown.indexOf(quote);
    const commentResult = await reviewer.client.callTool({
      name: "studio_create_review_comment",
      arguments: {
        anchor: {
          endOffset: startOffset + quote.length,
          prefix: markdown.slice(0, startOffset),
          quote,
          startOffset,
          suffix: markdown.slice(startOffset + quote.length)
        },
        articleId: created.id,
        body: "本文の根拠をもう少し具体的にしてください。",
        target: "body"
      }
    });
    expect(commentResult.structuredContent).toMatchObject({
      comment: { anchor: { quote, startOffset }, articleId: created.id, status: "open", target: "body" }
    });
    const commentId = (commentResult.structuredContent as { comment: { id: string } }).comment.id;
    const listedComments = await editor.client.callTool({
      name: "studio_list_review_comments",
      arguments: { articleId: created.id }
    });
    expect(listedComments.structuredContent).toMatchObject({ count: 1 });

    const changesRequested = articleFrom((await reviewer.client.callTool({
      name: "studio_request_changes",
      arguments: {
        articleId: created.id,
        expectedVersion: inReview.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000172"
      }
    })).structuredContent);
    expect(changesRequested).toMatchObject({
      publicationStatus: "unpublished",
      reviewNote: "未対応のレビューコメントが1件あります。",
      reviewStatus: "changes_requested"
    });
    const correctedInput = validArticle("mcp-review-parity");
    correctedInput.markdown = "## MCPで管理する\n\n記事本文へ根拠を追記し、D1のrevisionとして保存します。";
    const corrected = articleFrom((await editor.client.callTool({
      name: "studio_update_draft",
      arguments: {
        ...correctedInput,
        articleId: created.id,
        expectedVersion: changesRequested.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000173"
      }
    })).structuredContent);
    const blockedReview = await editor.client.callTool({
      name: "studio_request_review",
      arguments: {
        articleId: created.id,
        expectedVersion: corrected.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000174"
      }
    });
    expect(toolErrorCode(blockedReview)).toBe("invalid_transition");
    const resolved = await editor.client.callTool({
      name: "studio_resolve_review_comment",
      arguments: { articleId: created.id, commentId }
    });
    expect(resolved.structuredContent).toMatchObject({
      comment: { resolvedRevisionNumber: corrected.revisionNumber, status: "resolved" }
    });
    const reviewedAgain = articleFrom((await editor.client.callTool({
      name: "studio_request_review",
      arguments: {
        articleId: created.id,
        expectedVersion: corrected.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000175"
      }
    })).structuredContent);
    const approved = articleFrom((await reviewer.client.callTool({
      name: "studio_approve_article",
      arguments: {
        articleId: created.id,
        expectedVersion: reviewedAgain.lockVersion,
        note: "確認しました。",
        requestId: "00000000-0000-4000-8000-000000000176"
      }
    })).structuredContent);
    const revoked = articleFrom((await reviewer.client.callTool({
      name: "studio_revoke_approval",
      arguments: {
        articleId: created.id,
        expectedVersion: approved.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000177"
      }
    })).structuredContent);
    expect(revoked).toMatchObject({
      publicationStatus: "unpublished",
      reviewStatus: "in_review"
    });
    const reopened = await reviewer.client.callTool({
      name: "studio_reopen_review_comment",
      arguments: { articleId: created.id, commentId }
    });
    expect(reopened.structuredContent).toMatchObject({
      comment: { resolvedAt: null, status: "open" }
    });
    const commentAudit = await testEnv.CMS_DB.prepare(
      "SELECT metadata_json FROM cms_audit_events WHERE action = 'article.comment'"
    ).first<{ metadata_json: string }>();
    expect(JSON.parse(commentAudit?.metadata_json ?? "{}")).toMatchObject({
      channel: "mcp",
      client: "Noema MCP test",
      tool: "studio_create_review_comment"
    });
    await Promise.all([editor.close(), reviewer.close()]);
  });

  it("allows only administrators to list and update CMS members", async () => {
    const editor = await connectClient();
    const forbidden = await editor.client.callTool({
      name: "studio_list_members",
      arguments: {}
    });
    expect(toolErrorCode(forbidden)).toBe("forbidden");
    await editor.close();

    const admin = await connectClient(ADMIN_SESSION);
    const updated = await admin.client.callTool({
      name: "studio_upsert_member",
      arguments: {
        active: true,
        email: "new-editor@example.com",
        role: "editor"
      }
    });
    expect(updated.structuredContent).toMatchObject({
      members: [{ active: true, email: "new-editor@example.com", role: "editor" }]
    });
    const listed = await admin.client.callTool({
      name: "studio_list_members",
      arguments: {}
    });
    expect(listed.structuredContent).toMatchObject({ count: 1 });
    const memberAudit = await testEnv.CMS_DB.prepare(
      "SELECT metadata_json FROM cms_audit_events WHERE action = 'member.updated'"
    ).first<{ metadata_json: string }>();
    expect(JSON.parse(memberAudit?.metadata_json ?? "{}")).toMatchObject({
      channel: "mcp",
      tool: "studio_upsert_member"
    });
    await admin.close();
  });

  it("lets a connection update only its own public display name", async () => {
    const connection = await connectClient();
    const updated = await connection.client.callTool({
      name: "studio_update_profile",
      arguments: { displayName: "山田 編集" }
    });
    expect(updated.structuredContent).toMatchObject({
      session: { identity: { displayName: "山田 編集", email: "editor@example.com" } }
    });

    const whoami = await connection.client.callTool({ name: "studio_whoami", arguments: {} });
    expect(whoami.structuredContent).toMatchObject({
      identity: { displayName: "山田 編集", email: "editor@example.com" }
    });
    const stored = await testEnv.CMS_DB.prepare(
      "SELECT display_name FROM cms_members WHERE subject = ?1"
    ).bind(SESSION.identity.subject).first<{ display_name: string }>();
    expect(stored?.display_name).toBe("山田 編集");
    await connection.close();
  });

  it("permanently deletes an unused asset and advertises the operation as destructive", async () => {
    const connection = await connectClient();
    const tools = await connection.client.listTools();
    const deleteTool = tools.tools.find((tool) => tool.name === "studio_delete_asset");
    expect(deleteTool?.annotations).toMatchObject({
      destructiveHint: true,
      readOnlyHint: false
    });
    const uploaded = await connection.client.callTool({
      name: "studio_upload_asset",
      arguments: {
        alt: "削除する画像",
        contentType: "image/png",
        dataBase64: ONE_PIXEL_PNG,
        fileName: "delete.png",
        requestId: "00000000-0000-4000-8000-000000000180"
      }
    });
    const asset = assetFrom(uploaded.structuredContent);
    const deleted = await connection.client.callTool({
      name: "studio_delete_asset",
      arguments: { assetId: asset.id }
    });
    expect(deleted.structuredContent).toEqual({ assetId: asset.id, deleted: true });
    expect(await testEnv.ARTICLE_ASSETS.get(asset.r2Key)).toBeNull();
    const listed = await connection.client.callTool({
      name: "studio_list_assets",
      arguments: {}
    });
    expect(listed.structuredContent).toMatchObject({ count: 0 });
    const deletionAudit = await testEnv.CMS_DB.prepare(
      "SELECT metadata_json FROM cms_audit_events WHERE action = 'asset.deleted'"
    ).first<{ metadata_json: string }>();
    expect(JSON.parse(deletionAudit?.metadata_json ?? "{}")).toMatchObject({
      channel: "mcp",
      tool: "studio_delete_asset"
    });
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

  it("reads article history and restores an old revision as a new immutable revision", async () => {
    const editor = await connectClient();
    const createdResult = await editor.client.callTool({
      name: "studio_create_draft",
      arguments: {
        ...validArticle("history-first"),
        requestId: "00000000-0000-4000-8000-000000000060"
      }
    });
    const created = articleDetailFrom(createdResult.structuredContent);
    const updatedResult = await editor.client.callTool({
      name: "studio_update_draft",
      arguments: {
        ...validArticle("history-second"),
        articleId: created.id,
        expectedVersion: created.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000061"
      }
    });
    const updated = articleDetailFrom(updatedResult.structuredContent);

    const historyResult = await editor.client.callTool({
      name: "studio_list_article_versions",
      arguments: { articleId: created.id }
    });
    const versions = articleVersionsFrom(historyResult.structuredContent);
    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.latestRevisionNumber)).toEqual([2, 1]);
    const firstVersion = versions[1];
    if (!firstVersion) throw new Error("Missing first version.");
    expect(firstVersion.latestRevisionId).toBe(created.currentRevision.id);

    const versionResult = await editor.client.callTool({
      name: "studio_get_article_version",
      arguments: {
        articleId: created.id,
        revisionId: firstVersion.latestRevisionId
      }
    });
    const version = articleVersionFrom(versionResult.structuredContent);
    expect(version.revision).toMatchObject({
      id: created.currentRevision.id,
      markdown: validArticle("history-first").markdown,
      number: 1
    });
    expect(version.isCurrent).toBe(false);

    const checkpointsResult = await editor.client.callTool({
      name: "studio_list_article_version_checkpoints",
      arguments: {
        articleId: created.id,
        versionId: firstVersion.id
      }
    });
    expect(checkpointsResult.structuredContent).toMatchObject({
      checkpoints: [{ id: created.currentRevision.id, number: 1 }],
      nextBeforeRevisionNumber: null
    });

    const reviewer = await connectClient(REVIEWER_SESSION);
    const forbiddenRestore = await reviewer.client.callTool({
      name: "studio_restore_article_version",
      arguments: {
        articleId: created.id,
        expectedVersion: updated.lockVersion,
        requestId: "00000000-0000-4000-8000-000000000062",
        revisionId: created.currentRevision.id
      }
    });
    expect(toolErrorCode(forbiddenRestore)).toBe("forbidden");
    await reviewer.close();

    const restoreArguments = {
      articleId: created.id,
      expectedVersion: updated.lockVersion,
      requestId: "00000000-0000-4000-8000-000000000063",
      revisionId: created.currentRevision.id
    };
    const restoredResult = await editor.client.callTool({
      name: "studio_restore_article_version",
      arguments: restoreArguments
    });
    const replayedRestore = await editor.client.callTool({
      name: "studio_restore_article_version",
      arguments: restoreArguments
    });
    const restored = articleDetailFrom(restoredResult.structuredContent);
    expect(restored).toMatchObject({
      id: created.id,
      lockVersion: 3,
      revisionNumber: 3,
      slug: "history-first"
    });
    expect(restored.currentRevision.markdown).toBe(validArticle("history-first").markdown);
    expect(articleDetailFrom(replayedRestore.structuredContent).revisionNumber).toBe(3);
    expect(restoredResult.structuredContent).toMatchObject({
      restoredFromRevisionId: created.currentRevision.id,
      restoredFromRevisionNumber: 1
    });

    const staleRestore = await editor.client.callTool({
      name: "studio_restore_article_version",
      arguments: {
        ...restoreArguments,
        requestId: "00000000-0000-4000-8000-000000000064"
      }
    });
    expect(toolErrorCode(staleRestore)).toBe("revision_conflict");

    const counts = await testEnv.CMS_DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM cms_article_revisions WHERE article_id = ?1) AS revisions,
        (SELECT COUNT(*) FROM cms_mcp_idempotency
          WHERE article_id = ?1 AND tool_name = 'studio_restore_article_version') AS restore_keys`
    ).bind(created.id).first<{ restore_keys: number; revisions: number }>();
    expect(counts).toEqual({ restore_keys: 1, revisions: 3 });

    const audit = await testEnv.CMS_DB.prepare(
      `SELECT metadata_json FROM cms_audit_events
       WHERE article_id = ?1 AND action = 'article.revised'
       ORDER BY created_at DESC LIMIT 1`
    ).bind(created.id).first<{ metadata_json: string }>();
    expect(JSON.parse(audit?.metadata_json ?? "{}")).toMatchObject({
      channel: "mcp",
      requestId: restoreArguments.requestId,
      saveReason: "restored",
      sourceRevisionId: created.currentRevision.id,
      tool: "studio_restore_article_version"
    });

    await editor.close();
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

    expect(tools.tools).toHaveLength(39);
    expect(tools.tools.some((tool) => tool.name === "studio_get_analytics_summary")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_rebuild_analytics_mart")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_create_draft")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_list_article_versions")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_get_article_version")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_list_article_version_checkpoints")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_restore_article_version")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_list_assets")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_request_review")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_request_changes")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_upload_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_update_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_archive_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_restore_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_preview_draft")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_approve_article")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_delete_asset")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_create_series")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_delete_series")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_merge_series")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_update_series")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_list_review_comments")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_withdraw_review")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_revoke_approval")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_resolve_review_comment")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_reopen_review_comment")).toBe(true);
    expect(tools.tools.some((tool) => tool.name === "studio_publish")).toBe(false);
    expect(tools.tools.some((tool) => tool.name === "studio_archive_article")).toBe(false);
    expect(tools.tools.some((tool) => tool.name === "studio_list_members")).toBe(true);
    await client.close();
  });
});

async function connectClient(
  session: CmsSession = SESSION,
  notificationQueue?: CmsDiscordNotificationQueue
) {
  const server = createStudioMcpServer(
    testEnv.CMS_DB,
    testEnv.ARTICLE_ASSETS,
    session,
    "Noema MCP test",
    notificationQueue
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
  publicationStatus: string;
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
    publicationStatus: string;
    revisionNumber: number;
    reviewNote: string | null;
    reviewStatus: string;
    slug: string;
  };
}

function seriesFrom(value: unknown): {
  articleIds: string[];
  id: string;
  lockVersion: number;
  revisionNumber: number;
  slug: string;
  title: string;
} {
  const series = (value as { series?: unknown } | undefined)?.series;
  if (!series || typeof series !== "object") throw new Error("Missing series result.");
  return series as {
    articleIds: string[];
    id: string;
    lockVersion: number;
    revisionNumber: number;
    slug: string;
    title: string;
  };
}

function articleDetailFrom(value: unknown): {
  currentRevision: { id: string; markdown: string; number: number };
  id: string;
  lockVersion: number;
  revisionNumber: number;
  slug: string;
} {
  const article = (value as { article?: unknown } | undefined)?.article;
  if (!article || typeof article !== "object") throw new Error("Missing article result.");
  return article as {
    currentRevision: { id: string; markdown: string; number: number };
    id: string;
    lockVersion: number;
    revisionNumber: number;
    slug: string;
  };
}

function articleVersionsFrom(value: unknown): Array<{
  id: string;
  latestRevisionId: string;
  latestRevisionNumber: number;
}> {
  const versions = (value as { versions?: unknown } | undefined)?.versions;
  if (!Array.isArray(versions)) throw new Error("Missing article versions result.");
  return versions as Array<{
    id: string;
    latestRevisionId: string;
    latestRevisionNumber: number;
  }>;
}

function articleVersionFrom(value: unknown): {
  isCurrent: boolean;
  revision: { id: string; markdown: string; number: number };
} {
  const version = (value as { version?: unknown } | undefined)?.version;
  if (!version || typeof version !== "object") throw new Error("Missing article version result.");
  return version as {
    isCurrent: boolean;
    revision: { id: string; markdown: string; number: number };
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
