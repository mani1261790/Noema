import {
  cmsAssetMutationSchema,
  cmsArticleActionSchema,
  cmsCreateArticleRequestSchema,
  cmsMemberMutationSchema,
  cmsUpdateArticleRequestSchema,
  type CmsIdentity
} from "@noema/cms";
import {
  CmsRepositoryError,
  completeCmsAssetDeletions,
  createCmsArticle,
  getCmsArticleVersion,
  getCmsArticle,
  listCmsAssets,
  listPendingCmsAssetDeletions,
  listCmsArticles,
  listCmsArticleVersions,
  listCmsArticleVersionCheckpoints,
  listCmsMembers,
  resolveCmsSession,
  registerCmsAsset,
  queueCmsAssetDeletion,
  transitionCmsArticle,
  updateCmsArticle,
  updateCmsAsset,
  upsertCmsMemberInvitation
} from "./cms-repository";
import type { AccessIdentity } from "./access";

const CMS_API_PREFIX = "/api/cms";
const MAX_CMS_REQUEST_BYTES = 1_200_000;
const MAX_CMS_ASSET_BYTES = 8 * 1024 * 1024;
const CMS_ASSET_PREFIX = `${CMS_API_PREFIX}/assets/`;

const imageTypes = new Map([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export interface CmsApiEnvironment {
  ARTICLE_ASSETS?: R2Bucket;
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

    if (pathname === `${CMS_API_PREFIX}/assets`) {
      if (!env.ARTICLE_ASSETS) {
        return cmsError(503, "asset_storage_unavailable", "画像保存は現在利用できません。", true);
      }
      if (request.method === "GET") {
        await flushPendingCmsAssetDeletions(env.CMS_DB, env.ARTICLE_ASSETS);
        await registerLegacyAssets(env.CMS_DB, env.ARTICLE_ASSETS, session.identity);
        return cmsJson({ assets: await listCmsAssets(env.CMS_DB, session.identity) });
      }
      if (request.method === "POST") {
        if (!session.capabilities.canEdit) {
          return cmsError(403, "forbidden", "画像を追加する権限がありません。");
        }
        return uploadCmsAsset(request, env.CMS_DB, env.ARTICLE_ASSETS, session.identity);
      }
      return methodNotAllowed("GET, POST");
    }

    const assetId = parseAssetMetadataRoute(pathname);
    if (assetId) {
      if (request.method === "DELETE") {
        if (!session.capabilities.canEdit) {
          return cmsError(403, "forbidden", "画像を削除する権限がありません。");
        }
        if (!env.ARTICLE_ASSETS) {
          return cmsError(503, "asset_storage_unavailable", "画像保存は現在利用できません。", true);
        }
        const deletion = await queueCmsAssetDeletion(env.CMS_DB, session.identity, assetId);
        try {
          await env.ARTICLE_ASSETS.delete(deletion.r2Key);
        } catch (error) {
          console.error(JSON.stringify({
            assetId,
            event: "studio.cms.asset_delete_failed",
            message: error instanceof Error ? error.message : String(error)
          }));
          throw new CmsRepositoryError(
            "asset_delete_failed",
            "R2から画像を削除できませんでした。削除処理は保持しているため、もう一度お試しください。"
          );
        }
        await completeCmsAssetDeletions(env.CMS_DB, [deletion]);
        return cmsJson({ deleted: true });
      }
      if (request.method !== "PATCH") return methodNotAllowed("PATCH, DELETE");
      const body = await readCmsJson(request);
      if (!body.ok) return body.response;
      const parsed = cmsAssetMutationSchema.safeParse(body.value);
      if (!parsed.success) return invalidRequest(parsed.error.issues);
      return cmsJson({
        asset: await updateCmsAsset(env.CMS_DB, session.identity, assetId, parsed.data)
      });
    }

    if (pathname.startsWith(CMS_ASSET_PREFIX)) {
      if (request.method !== "GET") return methodNotAllowed("GET");
      if (!env.ARTICLE_ASSETS) {
        return cmsError(503, "asset_storage_unavailable", "画像保存は現在利用できません。", true);
      }
      return readCmsAsset(pathname.slice(CMS_ASSET_PREFIX.length), env.ARTICLE_ASSETS);
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
        const { editSessionId, ...content } = parsed.data;
        const article = await createCmsArticle(
          env.CMS_DB,
          session.identity,
          content,
          undefined,
          {},
          { editSessionId }
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
        const {
          editSessionId,
          expectedVersion,
          saveReason,
          sourceRevisionId,
          ...content
        } = parsed.data;
        const article = await updateCmsArticle(
          env.CMS_DB,
          session.identity,
          route.id,
          expectedVersion,
          content,
          undefined,
          {},
          { editSessionId, saveReason, sourceRevisionId }
        );
        return cmsJson({ article }, 200, article.lockVersion);
      }
      return methodNotAllowed("GET, PUT");
    }

    if (route.kind === "versions") {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return cmsJson({
        versions: await listCmsArticleVersions(env.CMS_DB, session.identity, route.id)
      });
    }

    if (route.kind === "version") {
      if (request.method !== "GET") return methodNotAllowed("GET");
      return cmsJson({
        version: await getCmsArticleVersion(
          env.CMS_DB,
          session.identity,
          route.id,
          route.revisionId
        )
      });
    }

    if (route.kind === "checkpoints") {
      if (request.method !== "GET") return methodNotAllowed("GET");
      const before = new URL(request.url).searchParams.get("before");
      const beforeRevisionNumber = before === null ? undefined : Number(before);
      if (
        before !== null &&
        (!/^[1-9]\d*$/u.test(before) || !Number.isSafeInteger(beforeRevisionNumber))
      ) {
        return cmsError(400, "invalid_checkpoint_cursor", "履歴の読込位置を確認してください。");
      }
      return cmsJson(await listCmsArticleVersionCheckpoints(
        env.CMS_DB,
        session.identity,
        route.id,
        route.versionId,
        beforeRevisionNumber
      ));
    }

    if (route.kind !== "actions") {
      return cmsError(404, "api_not_found", "APIが見つかりません。");
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

async function uploadCmsAsset(
  request: Request,
  db: D1Database,
  bucket: R2Bucket,
  identity: CmsIdentity
): Promise<Response> {
  const mediaType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!mediaType.startsWith("multipart/form-data;")) {
    return cmsError(415, "unsupported_media_type", "画像をmultipart/form-dataで送信してください。");
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CMS_ASSET_BYTES + 64 * 1024) {
    return cmsError(413, "asset_too_large", "画像は8MB以下にしてください。");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return cmsError(400, "invalid_asset_request", "画像データを読み取れませんでした。");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return cmsError(400, "invalid_asset_request", "画像ファイルを選択してください。");
  }
  if (file.size === 0 || file.size > MAX_CMS_ASSET_BYTES) {
    return cmsError(413, "asset_too_large", "画像は8MB以下にしてください。");
  }
  const extension = imageTypes.get(file.type.toLowerCase());
  if (!extension) {
    return cmsError(415, "unsupported_asset_type", "PNG、JPEG、WebP、GIFの画像を選択してください。");
  }

  const id = crypto.randomUUID();
  const key = `articles/${id}.${extension}`;
  await bucket.put(key, file.stream(), {
    httpMetadata: { contentType: file.type.toLowerCase() },
    customMetadata: { originalName: file.name.slice(0, 200) }
  });
  try {
    const asset = await registerCmsAsset(db, identity, {
      byteSize: file.size,
      contentType: file.type.toLowerCase(),
      id,
      originalName: file.name,
      r2Key: key
    });
    return cmsJson({ asset }, 201);
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
}

async function registerLegacyAssets(
  db: D1Database,
  bucket: R2Bucket,
  identity: CmsIdentity
): Promise<void> {
  const completed = await db.prepare(
    "SELECT 1 AS present FROM cms_asset_imports WHERE id = 'legacy-r2-assets-v1'"
  ).first<number>("present");
  if (completed) return;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      cursor,
      include: ["customMetadata", "httpMetadata"],
      limit: 500,
      prefix: "articles/"
    });
    for (const object of page.objects) {
      if (!isCmsAssetKey(object.key)) continue;
      const id = object.key.match(/^articles\/([0-9a-f-]{36})\./iu)?.[1];
      if (!id) continue;
      await registerCmsAsset(db, identity, {
        byteSize: object.size,
        contentType: object.httpMetadata?.contentType ?? contentTypeFromKey(object.key),
        id,
        originalName: object.customMetadata?.originalName ?? object.key.split("/").at(-1) ?? object.key,
        r2Key: object.key
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  await db.prepare(
    "INSERT INTO cms_asset_imports (id, completed_at) VALUES ('legacy-r2-assets-v1', ?1) ON CONFLICT(id) DO NOTHING"
  ).bind(new Date().toISOString()).run();
}

async function flushPendingCmsAssetDeletions(
  db: D1Database,
  bucket: R2Bucket
): Promise<void> {
  const pending = await listPendingCmsAssetDeletions(db);
  if (pending.length === 0) return;
  await bucket.delete(pending.map((deletion) => deletion.r2Key));
  await completeCmsAssetDeletions(db, pending);
}

async function readCmsAsset(key: string, bucket: R2Bucket): Promise<Response> {
  if (!isCmsAssetKey(key)) return cmsError(404, "asset_not_found", "画像が見つかりません。");
  const object = await bucket.get(key);
  if (!object) return cmsError(404, "asset_not_found", "画像が見つかりません。");
  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
    "x-content-type-options": "nosniff"
  });
  return new Response(object.body, { headers });
}

function isCmsAssetKey(key: string): boolean {
  return /^articles\/[0-9a-f-]{36}\.(?:gif|jpe?g|png|webp)$/i.test(key);
}

function parseAssetMetadataRoute(pathname: string): string | null {
  const match = pathname.match(/^\/api\/cms\/assets\/([0-9a-f-]{36})$/iu);
  return match?.[1] ?? null;
}

function contentTypeFromKey(key: string): string {
  if (/\.gif$/iu.test(key)) return "image/gif";
  if (/\.png$/iu.test(key)) return "image/png";
  if (/\.webp$/iu.test(key)) return "image/webp";
  return "image/jpeg";
}

type ArticleRoute =
  | { id: string; kind: "article" }
  | { id: string; kind: "actions" }
  | { id: string; kind: "versions" }
  | { id: string; kind: "version"; revisionId: string }
  | { id: string; kind: "checkpoints"; versionId: string };

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
  if (segments.length === 5 && segments[4] === "versions") {
    return { id, kind: "versions" };
  }
  if (
    segments.length === 6 &&
    segments[4] === "versions" &&
    /^[0-9a-f-]{36}$/i.test(segments[5] ?? "")
  ) {
    return { id, kind: "version", revisionId: segments[5] ?? "" };
  }
  if (
    segments.length === 7 &&
    segments[4] === "versions" &&
    /^[0-9a-f-]{36}$/i.test(segments[5] ?? "") &&
    segments[6] === "checkpoints"
  ) {
    return { id, kind: "checkpoints", versionId: segments[5] ?? "" };
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
    asset_conflict: 409,
    asset_delete_failed: 503,
    asset_in_use: 409,
    asset_not_found: 404,
    cms_not_configured: 503,
    forbidden: 403,
    idempotency_conflict: 409,
    invalid_article: 400,
    invalid_asset: 400,
    invalid_transition: 409,
    last_admin_required: 409,
    member_not_registered: 403,
    revision_conflict: 412,
    self_approval_forbidden: 409,
    slug_conflict: 409
  }[error.code];
  return cmsError(
    status,
    error.code,
    error.message,
    error.code === "asset_delete_failed",
    error.issues
  );
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
