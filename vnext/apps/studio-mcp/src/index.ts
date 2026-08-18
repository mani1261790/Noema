import { createMcpHandler } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import {
  cmsArticleContentSchema,
  cmsCreateArticleRequestSchema,
  cmsPublicationStatusSchema,
  cmsReviewStatusSchema,
  cmsUpdateArticleRequestSchema,
  cmsVisibilitySchema,
  validateCmsArticleForReview,
  type CmsSession
} from "@noema/cms";
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
  getCmsArticle,
  listCmsArticles,
  resolveCmsSession,
  updateCmsArticle
} from "../../studio/worker/cms-repository";

const MCP_PATH = "/mcp";
const REQUEST_ID_SCHEMA = z.string().uuid();

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

const createDraftSchema = cmsCreateArticleRequestSchema.extend({
  requestId: REQUEST_ID_SCHEMA
}).strict();

const updateDraftSchema = cmsUpdateArticleRequestSchema.extend({
  articleId: z.string().uuid(),
  requestId: REQUEST_ID_SCHEMA
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
    session = await resolveCmsSession(
      env.CMS_DB,
      accessIdentity,
      env.CMS_BOOTSTRAP_ADMIN_EMAIL
    );
  } catch (error) {
    if (error instanceof CmsRepositoryError) {
      return response(403, error.code, error.message);
    }
    throw error;
  }

  const client = request.headers.get("user-agent")?.trim().slice(0, 200);
  const handler = createMcpHandler(
    () => createStudioMcpServer(env.CMS_DB, session, client),
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
  session: CmsSession,
  client?: string
): McpServer {
  const server = new McpServer({
    name: "noema-studio",
    version: "0.1.0"
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
    "studio_validate_draft",
    {
      title: "Validate Studio draft",
      description: "保存前の原稿を、Studioのレビュー依頼基準で検証します。D1は変更しません。",
      inputSchema: cmsArticleContentSchema,
      annotations: readOnlyAnnotations()
    },
    async ({ frontmatter, markdown }) => {
      const issues = validateCmsArticleForReview({ frontmatter, markdown });
      return toolSuccess({ issues, valid: issues.length === 0 });
    }
  );

  server.registerTool(
    "studio_create_draft",
    {
      title: "Create Studio draft",
      description: "Noema Studioに下書きを作成します。同じrequestIdの再送は重複作成しません。",
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
      description: "lockVersionを確認して既存記事へimmutable revisionを追加します。同じrequestIdの再送は重複更新しません。",
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
        }
      )
    }))
  );

  return server;
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
