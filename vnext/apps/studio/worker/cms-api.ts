import {
  cmsArticleActionSchema,
  cmsCreateArticleRequestSchema,
  cmsMemberMutationSchema,
  cmsUpdateArticleRequestSchema,
  type CmsIdentity
} from "@noema/cms";
import {
  CmsRepositoryError,
  createCmsArticle,
  getCmsArticle,
  listCmsArticles,
  listCmsMembers,
  resolveCmsSession,
  transitionCmsArticle,
  updateCmsArticle,
  upsertCmsMemberInvitation
} from "./cms-repository";
import type { AccessIdentity } from "./access";

const CMS_API_PREFIX = "/api/cms";
const MAX_CMS_REQUEST_BYTES = 1_200_000;

export interface CmsApiEnvironment {
  CMS_BOOTSTRAP_ADMIN_EMAIL?: string;
  CMS_DB: D1Database;
}

export async function handleCmsApiRequest(
  request: Request,
  env: CmsApiEnvironment,
  accessIdentity: AccessIdentity
): Promise<Response> {
  try {
    const session = await resolveCmsSession(
      env.CMS_DB,
      accessIdentity,
      env.CMS_BOOTSTRAP_ADMIN_EMAIL
    );
    const { pathname } = new URL(request.url);

    if (pathname === `${CMS_API_PREFIX}/session`) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return cmsJson(session);
    }

    if (pathname === `${CMS_API_PREFIX}/articles`) {
      if (request.method === "GET") {
        return cmsJson({ articles: await listCmsArticles(env.CMS_DB, session.identity) });
      }
      if (request.method === "POST") {
        const body = await readCmsJson(request);
        if (!body.ok) return body.response;
        const parsed = cmsCreateArticleRequestSchema.safeParse(body.value);
        if (!parsed.success) return invalidRequest(parsed.error.issues);
        const article = await createCmsArticle(
          env.CMS_DB,
          session.identity,
          parsed.data
        );
        return cmsJson({ article }, 201, article.lockVersion);
      }
      return methodNotAllowed("GET, POST");
    }

    if (pathname === `${CMS_API_PREFIX}/members`) {
      if (request.method === "GET") {
        return cmsJson({ members: await listCmsMembers(env.CMS_DB, session.identity) });
      }
      if (request.method === "PUT") {
        const body = await readCmsJson(request);
        if (!body.ok) return body.response;
        const parsed = cmsMemberMutationSchema.safeParse(body.value);
        if (!parsed.success) return invalidRequest(parsed.error.issues);
        const members = await upsertCmsMemberInvitation(
          env.CMS_DB,
          session.identity,
          parsed.data
        );
        return cmsJson({ members });
      }
      return methodNotAllowed("GET, PUT");
    }

    const route = parseArticleRoute(pathname);
    if (!route) return cmsError(404, "api_not_found", "APIが見つかりません。");

    if (route.kind === "article") {
      if (request.method === "GET") {
        const article = await getCmsArticle(env.CMS_DB, session.identity, route.id);
        return cmsJson({ article }, 200, article.lockVersion);
      }
      if (request.method === "PUT") {
        const body = await readCmsJson(request);
        if (!body.ok) return body.response;
        const parsed = cmsUpdateArticleRequestSchema.safeParse(body.value);
        if (!parsed.success) return invalidRequest(parsed.error.issues);
        const precondition = requireIfMatch(request, parsed.data.expectedVersion);
        if (precondition) return precondition;
        const article = await updateCmsArticle(
          env.CMS_DB,
          session.identity,
          route.id,
          parsed.data.expectedVersion,
          parsed.data
        );
        return cmsJson({ article }, 200, article.lockVersion);
      }
      return methodNotAllowed("GET, PUT");
    }

    if (request.method !== "POST") return methodNotAllowed("POST");
    const body = await readCmsJson(request);
    if (!body.ok) return body.response;
    const parsed = cmsArticleActionSchema.safeParse(body.value);
    if (!parsed.success) return invalidRequest(parsed.error.issues);
    const precondition = requireIfMatch(request, parsed.data.expectedVersion);
    if (precondition) return precondition;
    const article = await transitionCmsArticle(
      env.CMS_DB,
      session.identity,
      route.id,
      parsed.data.action,
      parsed.data.expectedVersion,
      { note: parsed.data.note, visibility: parsed.data.visibility }
    );
    return cmsJson({ article }, 200, article.lockVersion);
  } catch (error) {
    return cmsRepositoryError(error);
  }
}

type ArticleRoute =
  | { id: string; kind: "article" }
  | { id: string; kind: "actions" };

function parseArticleRoute(pathname: string): ArticleRoute | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 4 || segments[0] !== "api" || segments[1] !== "cms" || segments[2] !== "articles") {
    return null;
  }
  const id = segments[3];
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (segments.length === 4) return { id, kind: "article" };
  if (segments.length === 5 && segments[4] === "actions") {
    return { id, kind: "actions" };
  }
  return null;
}

type JsonReadResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

async function readCmsJson(request: Request): Promise<JsonReadResult> {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      response: cmsError(
        415,
        "unsupported_media_type",
        "Content-Typeにはapplication/jsonを指定してください。"
      )
    };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_CMS_REQUEST_BYTES)) {
    return {
      ok: false,
      response: cmsError(413, "request_body_too_large", "記事データが上限を超えています。")
    };
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader) {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        size += result.value.byteLength;
        if (size > MAX_CMS_REQUEST_BYTES) {
          await reader.cancel().catch(() => undefined);
          return {
            ok: false,
            response: cmsError(413, "request_body_too_large", "記事データが上限を超えています。")
          };
        }
        chunks.push(result.value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false
    }).decode(bytes)) as unknown;
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: cmsError(400, "invalid_json", "JSON request bodyを確認してください。")
    };
  }
}

function requireIfMatch(request: Request, expectedVersion: number): Response | null {
  const value = request.headers.get("if-match");
  if (value === null) {
    return cmsError(
      428,
      "precondition_required",
      "更新前の記事versionをIf-Matchで指定してください。"
    );
  }
  if (value !== cmsEtag(expectedVersion)) {
    return cmsError(
      412,
      "revision_conflict",
      "別の編集者が記事を更新しました。最新版を読み込んでください。"
    );
  }
  return null;
}

function cmsRepositoryError(error: unknown): Response {
  if (!(error instanceof CmsRepositoryError)) {
    console.error(JSON.stringify({
      event: "studio.cms.request_failed",
      message: error instanceof Error ? error.message : String(error)
    }));
    return cmsError(503, "cms_unavailable", "CMSを一時的に利用できません。", true);
  }

  const status = {
    article_not_found: 404,
    cms_not_configured: 503,
    forbidden: 403,
    invalid_article: 400,
    invalid_transition: 409,
    last_admin_required: 409,
    member_not_registered: 403,
    revision_conflict: 412,
    self_approval_forbidden: 409,
    slug_conflict: 409
  }[error.code];
  return cmsError(status, error.code, error.message, false, error.issues);
}

function invalidRequest(issues: readonly { message: string; path: PropertyKey[] }[]): Response {
  return cmsError(
    400,
    "invalid_request",
    "入力内容を確認してください。",
    false,
    issues.map((issue) => ({
      message: issue.message,
      path: issue.path.map((part) => typeof part === "symbol" ? String(part) : part)
    }))
  );
}

function methodNotAllowed(allow: string): Response {
  const response = cmsError(405, "method_not_allowed", "HTTP methodを確認してください。");
  response.headers.set("allow", allow);
  return response;
}

function cmsJson(
  value: unknown,
  status = 200,
  lockVersion?: number
): Response {
  const headers = cmsHeaders();
  if (lockVersion !== undefined) headers.set("etag", cmsEtag(lockVersion));
  return Response.json(value, { headers, status });
}

function cmsError(
  status: number,
  code: string,
  message: string,
  retryable = false,
  issues?: Array<{ message: string; path: Array<string | number> }>
): Response {
  return cmsJson({
    error: {
      code,
      ...(issues && issues.length > 0 ? { issues } : {}),
      message,
      retryable
    }
  }, status);
}

function cmsHeaders(): Headers {
  return new Headers({
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
}

function cmsEtag(version: number): string {
  return `"cms-v${version}"`;
}

export function isCmsMutation(request: Request): boolean {
  return !new Set(["GET", "HEAD", "OPTIONS"]).has(request.method);
}

export function isCmsPath(pathname: string): boolean {
  return pathname === CMS_API_PREFIX || pathname.startsWith(`${CMS_API_PREFIX}/`);
}

export type { CmsIdentity };
