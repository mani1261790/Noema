import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { Buffer } from "node:buffer";
import {
  cmsArticleContentSchema,
  cmsAssetStatusSchema,
  cmsCreateArticleRequestSchema,
  cmsPublicationStatusSchema,
  cmsReviewStatusSchema,
  cmsUpdateArticleRequestSchema,
  cmsVisibilitySchema,
  validateCmsArticleForReview,
  type CmsAsset,
  type CmsSession
} from "@noema/cms";
import { renderArticlePresentation } from "@noema/content/article-presentation";
import { articleMarkdownGuidance } from "@noema/content";
import { z } from "zod";
import {
  ACCESS_JWT_HEADER,
  AccessTokenRejectedError,
  AccessVerificationUnavailableError,
  readAccessConfiguration,
  verifyAccessToken,
  type AccessConfiguration,
  type AccessIdentity
} from "../../studio/worker/access";
import {
  CmsRepositoryError,
  createCmsArticle,
  findIdempotentCmsAssetUpload,
  getCmsArticle,
  listCmsArticles,
  listCmsAssets,
  registerIdempotentCmsAssetUpload,
  resolveExistingCmsSession,
  transitionCmsArticle,
  updateIdempotentCmsAssetMetadata,
  updateIdempotentCmsAssetStatus,
  updateCmsArticle
} from "../../studio/worker/cms-repository";

const MCP_PATH = "/mcp";
const REQUEST_ID_SCHEMA = z.string().uuid();
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_ASSET_BASE64_LENGTH = Math.ceil(MAX_ASSET_BYTES / 3) * 4;
const MAX_MCP_REQUEST_BYTES = MAX_ASSET_BASE64_LENGTH + 128 * 1024;
const MAX_PREVIEW_MARKDOWN_CHARS = 64 * 1024;
const MAX_PREVIEW_HTML_CHARS = 2 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = [
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;
const IMAGE_EXTENSIONS = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
} as const satisfies Record<(typeof SUPPORTED_IMAGE_TYPES)[number], string>;

const listArticlesSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  publicationStatus: cmsPublicationStatusSchema.optional(),
  query: z.string().trim().max(200).optional(),
  reviewStatus: cmsReviewStatusSchema.optional(),
  visibility: cmsVisibilitySchema.optional()
}).strict();

const getArticleSchema = z.object({
  articleId: z.string().uuid()
}).strict();

const listAssetsSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
  query: z.string().trim().max(200).optional(),
  status: cmsAssetStatusSchema.default("active")
}).strict();

const uploadAssetSchema = z.object({
  alt: z.string().trim().min(1).max(500),
  contentType: z.enum(SUPPORTED_IMAGE_TYPES),
  dataBase64: z.string()
    .min(4)
    .max(MAX_ASSET_BASE64_LENGTH)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u),
  fileName: z.string().trim().min(1).max(200),
  requestId: REQUEST_ID_SCHEMA,
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([])
}).strict();

const updateAssetSchema = z.object({
  alt: z.string().trim().min(1).max(500),
  assetId: z.string().uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  requestId: REQUEST_ID_SCHEMA,
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([])
}).strict();

const assetStatusSchema = z.object({
  assetId: z.string().uuid(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  requestId: REQUEST_ID_SCHEMA
}).strict();

const createDraftSchema = cmsCreateArticleRequestSchema.extend({
  requestId: REQUEST_ID_SCHEMA
}).strict();

const updateDraftSchema = cmsUpdateArticleRequestSchema.extend({
  articleId: z.string().uuid(),
  requestId: REQUEST_ID_SCHEMA
}).strict();

const requestReviewSchema = z.object({
  articleId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  note: z.string().trim().max(500).optional(),
  requestId: REQUEST_ID_SCHEMA
}).strict();

const requestChangesSchema = requestReviewSchema.extend({
  note: z.string().trim().min(1).max(500)
}).strict();

const approveArticleSchema = requestReviewSchema.extend({
  note: z.string().trim().min(1).max(500)
}).strict();

const previewDraftSchema = cmsArticleContentSchema.extend({
  markdown: z.string().max(MAX_PREVIEW_MARKDOWN_CHARS)
}).strict();

type AccessTokenVerifier = (
  token: string,
  configuration: AccessConfiguration
) => Promise<AccessIdentity>;

export interface StudioMcpDependencies {
  verifyAccessToken: AccessTokenVerifier;
}

const defaultDependencies: StudioMcpDependencies = { verifyAccessToken };

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleStudioMcpRequest(request, env, ctx);
  }
} satisfies ExportedHandler<Env>;

export async function handleStudioMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  dependencies: StudioMcpDependencies = defaultDependencies
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== MCP_PATH) return response(404, "not_found", "Not found.");
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_MCP_REQUEST_BYTES) {
    return response(413, "request_too_large", "MCP request is too large.");
  }

  const configuration = readAccessConfiguration({
    ACCESS_POLICY_AUD: env.MCP_ACCESS_POLICY_AUD,
    ACCESS_TEAM_DOMAIN: env.ACCESS_TEAM_DOMAIN
  });
  if (!configuration.ok) {
    console.error({
      event: "studio_mcp_configuration_invalid",
      fields: configuration.issues
    });
    return response(503, "configuration_error", "MCP authentication is unavailable.");
  }

  const token = request.headers.get(ACCESS_JWT_HEADER)?.trim();
  if (!token) return response(401, "unauthorized", "Authentication is required.");

  let accessIdentity: AccessIdentity;
  try {
    accessIdentity = await dependencies.verifyAccessToken(token, configuration.value);
  } catch (error) {
    if (error instanceof AccessTokenRejectedError) {
      return response(401, "unauthorized", "Authentication was rejected.");
    }
    if (error instanceof AccessVerificationUnavailableError) {
      console.error({
        error: error.message,
        event: "studio_mcp_access_verification_unavailable"
      });
      return response(503, "authentication_unavailable", "Authentication is temporarily unavailable.");
    }
    throw error;
  }

  let session: CmsSession;
  try {
    session = await resolveExistingCmsSession(env.CMS_DB, accessIdentity);
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      return response(403, error.code, error.message);
    }
    throw error;
  }

  const client = request.headers.get("user-agent")?.trim().slice(0, 200);
  const handler = createMcpHandler(
    () => createStudioMcpServer(env.CMS_DB, env.ARTICLE_ASSETS, session, client),
    {
      allowedHostnames: ["mcp.noema-learn.uk"],
      corsOptions: false,
      legacy: "stateless",
      onerror(error) {
        console.error({ error: error.message, event: "studio_mcp_protocol_error" });
      },
      route: MCP_PATH
    }
  );

  return handler(request, env, ctx);
}

export function createStudioMcpServer(
  db: D1Database,
  bucket: R2Bucket,
  session: CmsSession,
  client?: string
): McpServer {
  const server = new McpServer({
    name: "noema-studio",
    version: "0.1.0"
  }, {
    instructions: `Noemaの記事を作成・更新する前にstudio_validate_draftとstudio_preview_draftを使ってください。${articleMarkdownGuidance}`
  });

  server.registerTool(
    "studio_whoami",
    {
      title: "Studio identity",
      description: "現在のNoema Studioのidentity、role、capabilityを返します。",
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations()
    },
    async () => toolSuccess({
      capabilities: session.capabilities,
      identity: session.identity
    })
  );

  server.registerTool(
    "studio_list_articles",
    {
      title: "List Studio articles",
      description: "Noema Studioの記事を検索し、状態で絞り込みます。",
      inputSchema: listArticlesSchema,
      annotations: readOnlyAnnotations()
    },
    async (input) => executeTool(async () => {
      const query = input.query?.toLocaleLowerCase("ja") ?? "";
      const articles = (await listCmsArticles(db, session.identity))
        .filter((article) => !input.publicationStatus || article.publicationStatus === input.publicationStatus)
        .filter((article) => !input.reviewStatus || article.reviewStatus === input.reviewStatus)
        .filter((article) => !input.visibility || article.visibility === input.visibility)
        .filter((article) => !query || [article.title, article.slug, article.updatedByEmail]
          .some((value) => value.toLocaleLowerCase("ja").includes(query)))
        .slice(0, input.limit);
      return { articles, count: articles.length };
    })
  );

  server.registerTool(
    "studio_get_article",
    {
      title: "Get Studio article",
      description: "記事IDからcurrent draftとrevision情報を取得します。",
      inputSchema: getArticleSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ articleId }) => executeTool(async () => ({
      article: await getCmsArticle(db, session.identity, articleId)
    }))
  );

  server.registerTool(
    "studio_list_assets",
    {
      title: "List Studio assets",
      description: "Studioの画像Assetを検索し、記事へ挿入できるMarkdown URLを返します。",
      inputSchema: listAssetsSchema,
      annotations: readOnlyAnnotations()
    },
    async (input) => executeTool(async () => {
      const query = input.query?.toLocaleLowerCase("ja") ?? "";
      const assets = (await listCmsAssets(db, session.identity))
        .filter((asset) => asset.status === input.status)
        .filter((asset) => !query || [asset.alt, asset.originalName, ...asset.tags]
          .some((value) => value.toLocaleLowerCase("ja").includes(query)))
        .slice(0, input.limit);
      return { assets, count: assets.length };
    })
  );

  server.registerTool(
    "studio_upload_asset",
    {
      title: "Upload Studio asset",
      description: "8MB以下の画像をStudioへ冪等アップロードし、記事挿入用Markdownを返します。",
      inputSchema: uploadAssetSchema,
      annotations: writeAnnotations(true)
    },
    async ({ alt, contentType, dataBase64, fileName, requestId, tags }) =>
      executeTool(async () => {
        const bytes = decodeImage(dataBase64, contentType);
        const inputSha256 = await assetUploadChecksum({
          alt,
          bytes,
          contentType,
          fileName,
          tags
        });
        const replay = await findIdempotentCmsAssetUpload(
          db,
          session.identity,
          requestId,
          inputSha256
        );
        if (replay) return uploadedAssetResult(replay);

        const assetId = crypto.randomUUID();
        const r2Key = `articles/${assetId}.${IMAGE_EXTENSIONS[contentType]}`;
        await bucket.put(r2Key, bytes, {
          httpMetadata: { contentType },
          customMetadata: { originalName: fileName.slice(0, 200) }
        });
        try {
          const registration = await registerIdempotentCmsAssetUpload(
            db,
            session.identity,
            {
              alt,
              byteSize: bytes.byteLength,
              contentType,
              id: assetId,
              inputSha256,
              originalName: fileName,
              r2Key,
              tags
            },
            requestId,
            client
          );
          if (!registration.created) await discardAsset(bucket, r2Key);
          return uploadedAssetResult(registration.asset);
        } catch (error) {
          await discardAsset(bucket, r2Key);
          throw error;
        }
      })
  );

  server.registerTool(
    "studio_update_asset",
    {
      title: "Update Studio asset",
      description: "activeな画像のaltと管理用タグを競合検知付きで更新します。状態は変更しません。",
      inputSchema: updateAssetSchema,
      annotations: writeAnnotations(true)
    },
    async ({ alt, assetId, expectedUpdatedAt, requestId, tags }) =>
      executeTool(async () => {
        const normalizedExpectedUpdatedAt = new Date(expectedUpdatedAt).toISOString();
        return {
          asset: await updateIdempotentCmsAssetMetadata(
            db,
            session.identity,
            assetId,
            normalizedExpectedUpdatedAt,
            { alt, tags },
            requestId,
            await assetMetadataChecksum({
              alt,
              assetId,
              expectedUpdatedAt: normalizedExpectedUpdatedAt,
              tags
            }),
            client
          )
        };
      })
  );

  registerAssetStatusTool(server, db, session, client, {
    description: "未使用のactive画像を競合検知付きでアーカイブします。R2オブジェクトは削除しません。",
    name: "studio_archive_asset",
    targetStatus: "archived",
    title: "Archive Studio asset"
  });

  registerAssetStatusTool(server, db, session, client, {
    description: "アーカイブ済み画像を競合検知付きでactiveへ復元します。",
    name: "studio_restore_asset",
    targetStatus: "active",
    title: "Restore Studio asset"
  });

  server.registerTool(
    "studio_validate_draft",
    {
      title: "Validate Studio draft",
      description: `保存前の原稿を、Studioのレビュー依頼基準で検証します。D1は変更しません。${articleMarkdownGuidance}`,
      inputSchema: cmsArticleContentSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ frontmatter, markdown }) => {
      const issues = validateCmsArticleForReview({ frontmatter, markdown });
      return toolSuccess({ issues, valid: issues.length === 0 });
    }
  );

  server.registerTool(
    "studio_preview_draft",
    {
      title: "Preview Studio draft",
      description: `保存せずに公開サイトとStudioプレビューが共有する記事レンダラーで、記事HTMLと検証結果を返します。${articleMarkdownGuidance}`,
      inputSchema: previewDraftSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ frontmatter, markdown, visibility }) => executeTool(async () => {
      const html = renderArticlePresentation(frontmatter, markdown);
      if (html.length > MAX_PREVIEW_HTML_CHARS) {
        throw new CmsRepositoryError(
          "invalid_article",
          "プレビュー結果が大きすぎます。原稿を分割して確認してください。"
        );
      }
      const issues = validateCmsArticleForReview({ frontmatter, markdown });
      return {
        html,
        issues,
        mediaType: "text/html",
        title: frontmatter.title,
        valid: issues.length === 0,
        visibility
      };
    })
  );

  server.registerTool(
    "studio_create_draft",
    {
      title: "Create Studio draft",
      description: `Noema Studioに下書きを作成します。同じrequestIdの再送は重複作成しません。${articleMarkdownGuidance}`,
      inputSchema: createDraftSchema,
      annotations: writeAnnotations(true)
    },
    async ({ requestId, ...content }) => executeTool(async () => ({
      article: await createCmsArticle(
        db,
        session.identity,
        content,
        new Date(),
        {
          channel: "mcp",
          client,
          idempotency: { requestId, toolName: "studio_create_draft" }
        }
      )
    }))
  );

  server.registerTool(
    "studio_update_draft",
    {
      title: "Update Studio draft",
      description: `lockVersionを確認して既存記事へimmutable revisionを追加します。同じrequestIdの再送は重複更新しません。${articleMarkdownGuidance}`,
      inputSchema: updateDraftSchema,
      annotations: writeAnnotations(true)
    },
    async ({ articleId, expectedVersion, requestId, ...content }) => executeTool(async () => ({
      article: await updateCmsArticle(
        db,
        session.identity,
        articleId,
        expectedVersion,
        content,
        new Date(),
        {
          channel: "mcp",
          client,
          idempotency: { requestId, toolName: "studio_update_draft" }
        },
        { saveReason: "manual" }
      )
    }))
  );

  server.registerTool(
    "studio_request_review",
    {
      title: "Request Studio review",
      description: "下書きを検証してレビュー依頼へ進めます。承認や公開は行いません。",
      inputSchema: requestReviewSchema,
      annotations: writeAnnotations(true)
    },
    async ({ articleId, expectedVersion, note, requestId }) => executeTool(async () => ({
      article: await transitionCmsArticle(
        db,
        session.identity,
        articleId,
        "request_review",
        expectedVersion,
        { note },
        new Date(),
        {
          channel: "mcp",
          client,
          idempotency: { requestId, toolName: "studio_request_review" }
        }
      )
    }))
  );

  server.registerTool(
    "studio_request_changes",
    {
      title: "Request Studio changes",
      description: "レビュー中の記事へ具体的な修正指摘を記録します。承認や公開は行いません。",
      inputSchema: requestChangesSchema,
      annotations: writeAnnotations(true)
    },
    async ({ articleId, expectedVersion, note, requestId }) => executeTool(async () => ({
      article: await transitionCmsArticle(
        db,
        session.identity,
        articleId,
        "request_changes",
        expectedVersion,
        { note },
        new Date(),
        {
          channel: "mcp",
          client,
          idempotency: { requestId, toolName: "studio_request_changes" }
        }
      )
    }))
  );

  server.registerTool(
    "studio_approve_article",
    {
      title: "Approve Studio article",
      description: "レビュー中の最新版を、承認理由を記録して承認します。公開は行いません。",
      inputSchema: approveArticleSchema,
      annotations: writeAnnotations(true)
    },
    async ({ articleId, expectedVersion, note, requestId }) => executeTool(async () => ({
      article: await transitionCmsArticle(
        db,
        session.identity,
        articleId,
        "approve",
        expectedVersion,
        { note },
        new Date(),
        {
          channel: "mcp",
          client,
          idempotency: { requestId, toolName: "studio_approve_article" }
        }
      )
    }))
  );

  return server;
}

function registerAssetStatusTool(
  server: McpServer,
  db: D1Database,
  session: CmsSession,
  client: string | undefined,
  config: {
    description: string;
    name: "studio_archive_asset" | "studio_restore_asset";
    targetStatus: "active" | "archived";
    title: string;
  }
): void {
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: assetStatusSchema,
      annotations: writeAnnotations(true)
    },
    async ({ assetId, expectedUpdatedAt, requestId }) => executeTool(async () => {
      const normalizedExpectedUpdatedAt = new Date(expectedUpdatedAt).toISOString();
      return {
        asset: await updateIdempotentCmsAssetStatus(
          db,
          session.identity,
          assetId,
          normalizedExpectedUpdatedAt,
          config.targetStatus,
          requestId,
          await assetStatusChecksum({
            assetId,
            expectedUpdatedAt: normalizedExpectedUpdatedAt,
            targetStatus: config.targetStatus
          }),
          client
        )
      };
    })
  );
}

function readOnlyAnnotations() {
  return {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true
  } as const;
}

function writeAnnotations(idempotent: boolean) {
  return {
    destructiveHint: false,
    idempotentHint: idempotent,
    openWorldHint: false,
    readOnlyHint: false
  } as const;
}

async function executeTool(
  operation: () => Promise<Record<string, unknown>>
) {
  try {
    return toolSuccess(await operation());
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: { code: error.code, issues: error.issues, message: error.message }
          })
        }],
        isError: true
      };
    }
    console.error({
      error: error instanceof Error ? error.message : String(error),
      event: "studio_mcp_tool_failed"
    });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          error: { code: "internal_error", message: "Studio MCP tool failed." }
        })
      }],
      isError: true
    };
  }
}

function toolSuccess(result: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result
  };
}

function decodeImage(
  dataBase64: string,
  contentType: (typeof SUPPORTED_IMAGE_TYPES)[number]
): Uint8Array {
  const decoded = Buffer.from(dataBase64, "base64");
  if (
    decoded.byteLength === 0 ||
    decoded.byteLength > MAX_ASSET_BYTES ||
    decoded.toString("base64") !== dataBase64 ||
    !matchesImageSignature(decoded, contentType)
  ) {
    throw new CmsRepositoryError(
      "invalid_asset",
      "画像データ、形式、または8MBの容量制限を確認してください。"
    );
  }
  return decoded;
}

function matchesImageSignature(
  bytes: Uint8Array,
  contentType: (typeof SUPPORTED_IMAGE_TYPES)[number]
): boolean {
  switch (contentType) {
    case "image/gif":
      return bytes.byteLength >= 14 &&
        ["GIF87a", "GIF89a"].includes(String.fromCharCode(...bytes.subarray(0, 6))) &&
        bytes.lastIndexOf(0x3b) >= 13;
    case "image/jpeg":
      return bytes.byteLength >= 4 &&
        bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
        hasJpegEndMarker(bytes);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) &&
        endsWith(bytes, [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    case "image/webp":
      return bytes.byteLength >= 12 &&
        startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]) &&
        readLittleEndianUint32(bytes, 4) === bytes.byteLength - 8;
  }
}

function hasJpegEndMarker(bytes: Uint8Array): boolean {
  for (let index = bytes.byteLength - 2; index >= 2; index -= 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return true;
  }
  return false;
}

async function discardAsset(bucket: R2Bucket, r2Key: string): Promise<void> {
  try {
    await bucket.delete(r2Key);
  } catch (error) {
    console.error({
      error: error instanceof Error ? error.message : String(error),
      event: "studio_mcp_asset_cleanup_failed",
      r2Key
    });
  }
}

function endsWith(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.byteLength >= signature.length &&
    signature.every((value, index) =>
      bytes[bytes.byteLength - signature.length + index] === value
    );
}

function readLittleEndianUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return bytes.byteLength >= signature.length &&
    signature.every((value, index) => bytes[index] === value);
}

async function assetUploadChecksum(input: {
  alt: string;
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  tags: string[];
}): Promise<string> {
  const contentSha256 = await sha256Hex(new Uint8Array(input.bytes));
  return sha256Hex(new TextEncoder().encode(JSON.stringify({
    alt: input.alt,
    contentSha256,
    contentType: input.contentType,
    fileName: input.fileName,
    tags: input.tags
  })));
}

function assetMetadataChecksum(input: {
  alt: string;
  assetId: string;
  expectedUpdatedAt: string;
  tags: string[];
}): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(input)));
}

function assetStatusChecksum(input: {
  assetId: string;
  expectedUpdatedAt: string;
  targetStatus: "active" | "archived";
}): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(input)));
}

async function sha256Hex(value: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function uploadedAssetResult(asset: CmsAsset): Record<string, unknown> {
  const markdownAlt = asset.alt
    .replace(/\s+/gu, " ")
    .replace(/\\/gu, "\\\\")
    .replace(/\[/gu, "\\[")
    .replace(/\]/gu, "\\]");
  return {
    asset,
    markdown: `![${markdownAlt}](${asset.markdownUrl})`
  };
}

function response(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: {
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      }
    }
  );
}
