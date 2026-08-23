import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { Buffer } from "node:buffer";
import {
  cmsArticleContentSchema,
  cmsAnalyticsDaysSchema,
  cmsAnalyticsRebuildRequestSchema,
  cmsAssetStatusSchema,
  cmsCreateArticleRequestSchema,
  cmsCreateSeriesRequestSchema,
  cmsMemberMutationSchema,
  cmsPublicationStatusSchema,
  cmsReviewCommentRequestSchema,
  cmsReviewStatusSchema,
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
  createCmsReviewComment,
  completeCmsAssetDeletions,
  findIdempotentCmsAssetUpload,
  getCmsArticle,
  getCmsArticleVersion,
  listCmsArticles,
  listCmsArticleVersionCheckpoints,
  listCmsArticleVersions,
  listCmsAssets,
  listCmsMembers,
  listCmsReviewComments,
  queueCmsAssetDeletion,
  registerIdempotentCmsAssetUpload,
  resolveExistingCmsSession,
  transitionCmsArticle,
  updateIdempotentCmsAssetMetadata,
  updateIdempotentCmsAssetStatus,
  updateCmsArticle,
  updateCmsReviewCommentStatus,
  upsertCmsMemberInvitation
} from "../../studio/worker/cms-repository";
import {
  createCmsSeries,
  getCmsSeries,
  listCmsSeries,
  listCmsSeriesVersions,
  updateCmsSeries
} from "../../studio/worker/cms-series-repository";
import {
  listCmsAnalyticsSummary,
  rebuildCmsAnalyticsMart
} from "../../studio/worker/analytics-repository";

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

const analyticsSummarySchema = z.object({
  days: cmsAnalyticsDaysSchema.default(30)
}).strict();

const getArticleSchema = z.object({
  articleId: z.string().uuid()
}).strict();

const getSeriesSchema = z.object({
  seriesId: z.string().uuid()
}).strict();

const listSeriesSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  query: z.string().trim().max(200).optional()
}).strict();

const createSeriesSchema = cmsCreateSeriesRequestSchema;

const updateSeriesSchema = cmsCreateSeriesRequestSchema.extend({
  expectedVersion: z.number().int().positive(),
  seriesId: z.string().uuid()
}).strict();

const restoreSeriesVersionSchema = z.object({
  expectedVersion: z.number().int().positive(),
  seriesId: z.string().uuid(),
  versionId: z.string().uuid()
}).strict();

const createReviewCommentSchema = cmsReviewCommentRequestSchema.extend({
  articleId: z.string().uuid()
}).strict();

const reviewCommentStatusSchema = z.object({
  articleId: z.string().uuid(),
  commentId: z.string().uuid()
}).strict();

const upsertMemberSchema = cmsMemberMutationSchema;

const deleteAssetSchema = z.object({
  assetId: z.string().uuid()
}).strict();

const listArticleVersionsSchema = getArticleSchema;

const getArticleVersionSchema = getArticleSchema.extend({
  revisionId: z.string().uuid()
}).strict();

const listArticleVersionCheckpointsSchema = getArticleSchema.extend({
  beforeRevisionNumber: z.number().int().positive().optional(),
  versionId: z.string().uuid()
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

const updateDraftSchema = cmsArticleContentSchema.extend({
  articleId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  requestId: REQUEST_ID_SCHEMA
}).strict();

const restoreArticleVersionSchema = z.object({
  articleId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  requestId: REQUEST_ID_SCHEMA,
  revisionId: z.string().uuid()
}).strict();

const requestReviewSchema = z.object({
  articleId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  note: z.string().trim().max(500).optional(),
  requestId: REQUEST_ID_SCHEMA
}).strict();

const requestChangesSchema = requestReviewSchema;

const approveArticleSchema = requestReviewSchema.extend({
  note: z.string().trim().min(1).max(500)
}).strict();

const workflowActionSchema = z.object({
  articleId: z.string().uuid(),
  expectedVersion: z.number().int().nonnegative(),
  requestId: REQUEST_ID_SCHEMA
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
    instructions: `Noemaの記事を作成・更新する前にstudio_validate_draftとstudio_preview_draftを使ってください。レビュー修正ではstudio_list_review_commentsでstatus=openの指摘とanchorの引用・オフセット・前後文脈を確認し、studio_get_articleで現在本文を取得して該当箇所を修正します。本文更新後にstudio_resolve_review_commentで各指摘を対応済みにし、未対応が0件になってからレビューを再依頼してください。履歴を戻すときはstudio_list_article_versionsとstudio_get_article_versionで内容を確認し、studio_get_articleのlockVersionをexpectedVersionとしてstudio_restore_article_versionを実行してください。シリーズはstudio_list_seriesまたはstudio_get_seriesで最新版とlockVersionを確認してから更新し、並び順はarticleIdsの順序で指定します。復元は過去の履歴を変更・削除せず、新しいimmutable revisionを追加します。公開、公開取り下げ、公開記事のアーカイブはMCPでは実行できません。${articleMarkdownGuidance}`
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
    "studio_get_analytics_summary",
    {
      title: "Get Studio analytics summary",
      description: "個人を識別しない読者行動の日次集計を7日、30日、90日の期間で返します。",
      inputSchema: analyticsSummarySchema,
      annotations: readOnlyAnnotations()
    },
    async ({ days }) => executeTool(async () => ({
      summary: await listCmsAnalyticsSummary(db, session.identity, days)
    }))
  );

  server.registerTool(
    "studio_rebuild_analytics_mart",
    {
      title: "Rebuild Studio analytics mart",
      description: "完全なイベント正本が残る連続35日以内を対象に、日次分析マートを再構築します。admin専用です。",
      inputSchema: cmsAnalyticsRebuildRequestSchema,
      annotations: destructiveWriteAnnotations(false)
    },
    async (range) => executeTool(async () => ({
      rebuild: await rebuildCmsAnalyticsMart(db, session.identity, range)
    }))
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
    "studio_list_series",
    {
      title: "List Studio series",
      description: "記事シリーズを検索し、現在の並び順、記事状態、lockVersionを返します。",
      inputSchema: listSeriesSchema,
      annotations: readOnlyAnnotations()
    },
    async (input) => executeTool(async () => {
      const query = input.query?.toLocaleLowerCase("ja") ?? "";
      const series = (await listCmsSeries(db, session.identity))
        .filter((item) => !query || [item.title, item.slug, item.description]
          .some((value) => value.toLocaleLowerCase("ja").includes(query)))
        .slice(0, input.limit);
      return { count: series.length, series };
    })
  );

  server.registerTool(
    "studio_get_series",
    {
      title: "Get Studio series",
      description: "シリーズIDから現在の内容、記事順、lockVersionを取得します。",
      inputSchema: getSeriesSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ seriesId }) => executeTool(async () => ({
      series: await getCmsSeries(db, session.identity, seriesId)
    }))
  );

  server.registerTool(
    "studio_list_series_versions",
    {
      title: "List Studio series versions",
      description: "シリーズのimmutableな変更履歴を新しい順に返します。過去のタイトル、説明、記事順を確認できます。",
      inputSchema: getSeriesSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ seriesId }) => executeTool(async () => {
      const versions = await listCmsSeriesVersions(db, session.identity, seriesId);
      return { count: versions.length, versions };
    })
  );

  server.registerTool(
    "studio_create_series",
    {
      title: "Create Studio series",
      description: "1件以上の記事を指定順でまとめたシリーズを作成します。公開状態は変更しません。",
      inputSchema: createSeriesSchema,
      annotations: writeAnnotations(false)
    },
    async (content) => executeTool(async () => ({
      series: await createCmsSeries(db, session.identity, content, {
        channel: "mcp",
        client,
        tool: "studio_create_series"
      })
    }))
  );

  server.registerTool(
    "studio_update_series",
    {
      title: "Update Studio series",
      description: "lockVersionで競合検知しながらシリーズ名、説明、slug、記事順を更新します。公開状態は変更しません。",
      inputSchema: updateSeriesSchema,
      annotations: writeAnnotations(false)
    },
    async ({ expectedVersion, seriesId, ...content }) => executeTool(async () => ({
      series: await updateCmsSeries(
        db,
        session.identity,
        seriesId,
        expectedVersion,
        content,
        undefined,
        { channel: "mcp", client, tool: "studio_update_series" }
      )
    }))
  );

  server.registerTool(
    "studio_restore_series_version",
    {
      title: "Restore Studio series version",
      description: "指定した過去版のシリーズ内容と記事順を、新しいimmutable revisionとして復元します。",
      inputSchema: restoreSeriesVersionSchema,
      annotations: writeAnnotations(false)
    },
    async ({ expectedVersion, seriesId, versionId }) => executeTool(async () => {
      const versions = await listCmsSeriesVersions(db, session.identity, seriesId);
      const version = versions.find((item) => item.id === versionId);
      if (!version) {
        throw new CmsRepositoryError("series_not_found", "復元するシリーズ履歴が見つかりません。");
      }
      return {
        restoredFromVersionId: version.id,
        series: await updateCmsSeries(
          db,
          session.identity,
          seriesId,
          expectedVersion,
          {
            articleIds: version.articleIds,
            description: version.description,
            slug: version.slug,
            title: version.title
          },
          version.id,
          { channel: "mcp", client, tool: "studio_restore_series_version" }
        )
      };
    })
  );

  server.registerTool(
    "studio_list_article_versions",
    {
      title: "List Studio article versions",
      description: "記事の保存履歴を新しい順に返します。現在・承認済み・公開中の版と復元元を確認できます。",
      inputSchema: listArticleVersionsSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ articleId }) => executeTool(async () => {
      const versions = await listCmsArticleVersions(db, session.identity, articleId);
      return { count: versions.length, versions };
    })
  );

  server.registerTool(
    "studio_get_article_version",
    {
      title: "Get Studio article version",
      description: "記事の指定revisionから本文、frontmatter、公開範囲、版の状態を読み取ります。",
      inputSchema: getArticleVersionSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ articleId, revisionId }) => executeTool(async () => ({
      version: await getCmsArticleVersion(db, session.identity, articleId, revisionId)
    }))
  );

  server.registerTool(
    "studio_list_article_version_checkpoints",
    {
      title: "List Studio article version checkpoints",
      description: "同じ編集セッションにまとまった自動保存checkpointを新しい順に返します。続きを読む場合はnextBeforeRevisionNumberを指定します。",
      inputSchema: listArticleVersionCheckpointsSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ articleId, beforeRevisionNumber, versionId }) => executeTool(async () => {
      const page = await listCmsArticleVersionCheckpoints(
        db,
        session.identity,
        articleId,
        versionId,
        beforeRevisionNumber
      );
      return {
        checkpoints: page.checkpoints,
        nextBeforeRevisionNumber: page.nextBeforeRevisionNumber
      };
    })
  );

  server.registerTool(
    "studio_list_review_comments",
    {
      title: "List Studio review comments",
      description: "記事のレビューコメントを未対応優先で返します。本文コメントにはrevision固定の選択範囲、引用、前後文脈、対応状態が含まれます。",
      inputSchema: getArticleSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ articleId }) => executeTool(async () => {
      const comments = await listCmsReviewComments(db, session.identity, articleId);
      return { comments, count: comments.length };
    })
  );

  server.registerTool(
    "studio_create_review_comment",
    {
      title: "Create Studio review comment",
      description: "レビュー中の記事へコメントを追加します。本文の特定箇所には、現在Markdownと一致するstartOffset、endOffset、quote、前後文脈をanchorに指定します。",
      inputSchema: createReviewCommentSchema,
      annotations: writeAnnotations(false)
    },
    async ({ articleId, ...comment }) => executeTool(async () => ({
      comment: await createCmsReviewComment(
        db,
        session.identity,
        articleId,
        comment,
        new Date(),
        { channel: "mcp", client, tool: "studio_create_review_comment" }
      )
    }))
  );

  server.registerTool(
    "studio_resolve_review_comment",
    {
      title: "Resolve Studio review comment",
      description: "本文を修正・保存した後、レビューコメントを現在revisionで対応済みにします。未対応コメントが残っている間はレビューを再依頼できません。",
      inputSchema: reviewCommentStatusSchema,
      annotations: writeAnnotations(true)
    },
    async ({ articleId, commentId }) => executeTool(async () => ({
      comment: await updateCmsReviewCommentStatus(
        db,
        session.identity,
        articleId,
        commentId,
        "resolve",
        new Date(),
        { channel: "mcp", client, tool: "studio_resolve_review_comment" }
      )
    }))
  );

  server.registerTool(
    "studio_reopen_review_comment",
    {
      title: "Reopen Studio review comment",
      description: "対応済みの指摘をレビュー担当者が未対応へ戻し、再修正が必要なことを記録します。",
      inputSchema: reviewCommentStatusSchema,
      annotations: writeAnnotations(true)
    },
    async ({ articleId, commentId }) => executeTool(async () => ({
      comment: await updateCmsReviewCommentStatus(
        db,
        session.identity,
        articleId,
        commentId,
        "reopen",
        new Date(),
        { channel: "mcp", client, tool: "studio_reopen_review_comment" }
      )
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
    "studio_delete_asset",
    {
      title: "Delete Studio asset",
      description: "記事から参照されていない画像をCMSとR2から完全に削除します。この操作は取り消せません。通常はstudio_archive_assetを優先してください。",
      inputSchema: deleteAssetSchema,
      annotations: destructiveWriteAnnotations()
    },
    async ({ assetId }) => executeTool(async () => {
      const deletion = await queueCmsAssetDeletion(
        db,
        session.identity,
        assetId,
        new Date(),
        { channel: "mcp", client, tool: "studio_delete_asset" }
      );
      try {
        await bucket.delete(deletion.r2Key);
      } catch (error) {
        console.error({
          assetId,
          error: error instanceof Error ? error.message : String(error),
          event: "studio_mcp_asset_delete_failed"
        });
        throw new CmsRepositoryError(
          "asset_delete_failed",
          "R2から画像を削除できませんでした。削除処理は保持しているため、もう一度お試しください。"
        );
      }
      await completeCmsAssetDeletions(db, [deletion]);
      return { assetId, deleted: true };
    })
  );

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
    "studio_restore_article_version",
    {
      title: "Restore Studio article version",
      description: "指定revisionの内容を、競合検知と監査記録付きの新しいimmutable revisionとして復元します。既存履歴や公開中の版は削除・上書きしません。",
      inputSchema: restoreArticleVersionSchema,
      annotations: writeAnnotations(true)
    },
    async ({ articleId, expectedVersion, requestId, revisionId }) => executeTool(async () => {
      const version = await getCmsArticleVersion(db, session.identity, articleId, revisionId);
      const visibility = version.visibility
        ?? (await getCmsArticle(db, session.identity, articleId)).visibility;
      const article = await updateCmsArticle(
        db,
        session.identity,
        articleId,
        expectedVersion,
        {
          frontmatter: { ...version.revision.frontmatter, status: "draft" },
          markdown: version.revision.markdown,
          visibility
        },
        new Date(),
        {
          channel: "mcp",
          client,
          idempotency: { requestId, toolName: "studio_restore_article_version" }
        },
        { saveReason: "restored", sourceRevisionId: version.revision.id }
      );
      return {
        article,
        restoredFromRevisionId: version.revision.id,
        restoredFromRevisionNumber: version.revision.number
      };
    })
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

  registerArticleWorkflowTool(server, db, session, client, {
    action: "withdraw_review",
    description: "レビュー依頼を取り下げて下書きへ戻します。公開状態は変更しません。",
    name: "studio_withdraw_review",
    title: "Withdraw Studio review"
  });

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

  registerArticleWorkflowTool(server, db, session, client, {
    action: "revoke_approval",
    description: "記事の承認を取り消してレビュー中へ戻します。公開状態は変更しません。",
    name: "studio_revoke_approval",
    title: "Revoke Studio approval"
  });

  server.registerTool(
    "studio_list_members",
    {
      title: "List Studio members",
      description: "管理権限がある場合に、CMSメンバーと招待状態を返します。",
      inputSchema: z.object({}).strict(),
      annotations: readOnlyAnnotations()
    },
    async () => executeTool(async () => {
      const members = await listCmsMembers(db, session.identity);
      return { count: members.length, members };
    })
  );

  server.registerTool(
    "studio_upsert_member",
    {
      title: "Create or update Studio member",
      description: "管理権限がある場合に、メールアドレス単位でCMSメンバーの役割と有効状態を設定します。最後の管理者は無効化できません。",
      inputSchema: upsertMemberSchema,
      annotations: destructiveWriteAnnotations(true)
    },
    async (member) => executeTool(async () => {
      const members = await upsertCmsMemberInvitation(
        db,
        session.identity,
        member,
        new Date(),
        { channel: "mcp", client, tool: "studio_upsert_member" }
      );
      return { members };
    })
  );

  return server;
}

function registerArticleWorkflowTool(
  server: McpServer,
  db: D1Database,
  session: CmsSession,
  client: string | undefined,
  config: {
    action: "revoke_approval" | "withdraw_review";
    description: string;
    name: "studio_revoke_approval" | "studio_withdraw_review";
    title: string;
  }
): void {
  server.registerTool(
    config.name,
    {
      title: config.title,
      description: config.description,
      inputSchema: workflowActionSchema,
      annotations: writeAnnotations(true)
    },
    async ({ articleId, expectedVersion, requestId }) => executeTool(async () => ({
      article: await transitionCmsArticle(
        db,
        session.identity,
        articleId,
        config.action,
        expectedVersion,
        {},
        new Date(),
        {
          channel: "mcp",
          client,
          idempotency: { requestId, toolName: config.name }
        }
      )
    }))
  );
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

function destructiveWriteAnnotations(idempotent = false) {
  return {
    destructiveHint: true,
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
