import { betterAuth } from "better-auth";
import type { CmsSession } from "@noema/cms";
import type { AccessIdentity } from "./access";
import { resolveCmsSession } from "./cms-repository";

const AUTH_API_PREFIX = "/api/auth";
const PASSWORD_PATH = "/api/studio-auth/password";
const PUBLIC_AUTH_ROUTES = new Set([
  `${AUTH_API_PREFIX}/get-session`,
  `${AUTH_API_PREFIX}/sign-in/email`,
  `${AUTH_API_PREFIX}/sign-out`
]);

export interface StudioAuthEnvironment {
  BETTER_AUTH_SECRET?: string;
  CMS_BOOTSTRAP_ADMIN_EMAIL?: string;
  CMS_DB: D1Database;
  STUDIO_ALLOWED_ORIGIN?: string;
}

export interface StudioAuthIdentity extends AccessIdentity {
  method: "access" | "noema";
}

export type StudioAuthConfiguration =
  | { ok: true; origin: string; secret: string }
  | { ok: false };

export function isStudioAuthPath(pathname: string): boolean {
  return pathname === PASSWORD_PATH || PUBLIC_AUTH_ROUTES.has(pathname);
}

export function readStudioAuthConfiguration(
  env: Pick<StudioAuthEnvironment, "BETTER_AUTH_SECRET" | "STUDIO_ALLOWED_ORIGIN">
): StudioAuthConfiguration {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) return { ok: false };
  if (!env.STUDIO_ALLOWED_ORIGIN) return { ok: false };
  try {
    const url = new URL(env.STUDIO_ALLOWED_ORIGIN);
    const localHttp = url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash
    ) return { ok: false };
    return { ok: true, origin: url.origin, secret };
  } catch {
    return { ok: false };
  }
}

export function createStudioAuth(
  env: StudioAuthEnvironment,
  configuration: Extract<StudioAuthConfiguration, { ok: true }>
) {
  return betterAuth({
    account: { modelName: "studio_auth_account" },
    advanced: {
      cookiePrefix: "noema_studio",
      useSecureCookies: configuration.origin.startsWith("https://")
    },
    basePath: AUTH_API_PREFIX,
    baseURL: configuration.origin,
    database: env.CMS_DB,
    emailAndPassword: {
      enabled: true,
      maxPasswordLength: 128,
      minPasswordLength: 12
    },
    rateLimit: {
      enabled: true,
      max: 60,
      modelName: "studio_auth_rate_limit",
      storage: "database",
      window: 60
    },
    secret: configuration.secret,
    session: {
      expiresIn: 60 * 60 * 12,
      modelName: "studio_auth_session",
      updateAge: 60 * 60
    },
    trustedOrigins: [configuration.origin],
    user: { modelName: "studio_auth_user" },
    verification: { modelName: "studio_auth_verification" }
  });
}

export async function resolveNoemaIdentity(
  request: Request,
  env: StudioAuthEnvironment,
  configuration: Extract<StudioAuthConfiguration, { ok: true }>
): Promise<StudioAuthIdentity | null> {
  const auth = createStudioAuth(env, configuration);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null;
  const member = await env.CMS_DB.prepare(
    `SELECT m.subject, m.email
     FROM cms_auth_identities AS identity
     INNER JOIN cms_members AS m ON m.subject = identity.cms_subject
     WHERE identity.user_id = ?1 AND m.active = 1`
  ).bind(session.user.id).first<{ email: string; subject: string }>();
  return member ? { ...member, method: "noema" } : null;
}

export async function handleStudioAuthRequest(
  request: Request,
  env: StudioAuthEnvironment,
  configuration: Extract<StudioAuthConfiguration, { ok: true }>,
  accessIdentity: AccessIdentity | null
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const auth = createStudioAuth(env, configuration);

  if (PUBLIC_AUTH_ROUTES.has(pathname)) {
    const response = await auth.handler(request);
    if (pathname === `${AUTH_API_PREFIX}/sign-in/email` && !response.ok) {
      if (response.status === 429) {
        return authError(429, "rate_limited", "試行回数が多すぎます。時間をおいて再試行してください。", true);
      }
      return authError(401, "invalid_credentials", "メールアドレスまたはパスワードが正しくありません。");
    }
    return withPrivateHeaders(response);
  }
  if (pathname !== PASSWORD_PATH) return authError(404, "auth_not_found", "認証APIが見つかりません。");
  if (request.method !== "POST") return methodNotAllowed("POST");
  if (!accessIdentity) {
    return authError(401, "access_recovery_required", "初回のパスワード設定にはメールコードでの本人確認が必要です。");
  }

  const body = await readPasswordBody(request);
  if (!body.ok) return body.response;
  let cmsSession: CmsSession;
  try {
    cmsSession = await resolveCmsSession(
      env.CMS_DB,
      accessIdentity,
      env.CMS_BOOTSTRAP_ADMIN_EMAIL
    );
  } catch {
    return authError(403, "member_not_registered", "有効なCMSメンバーだけがパスワードを設定できます。");
  }

  const existing = await env.CMS_DB.prepare(
    "SELECT user_id FROM cms_auth_identities WHERE cms_subject = ?1"
  ).bind(cmsSession.identity.subject).first<{ user_id: string }>();
  if (existing) {
    return authError(409, "password_already_configured", "パスワードは設定済みです。");
  }

  const orphanedUser = await env.CMS_DB.prepare(
    `SELECT user.id
     FROM studio_auth_user AS user
     LEFT JOIN cms_auth_identities AS identity ON identity.user_id = user.id
     WHERE user.email = ?1 COLLATE NOCASE AND identity.user_id IS NULL`
  ).bind(cmsSession.identity.email).first<{ id: string }>();
  if (orphanedUser) {
    // Recover from an interrupted first-time setup before creating a new credential.
    await env.CMS_DB.prepare("DELETE FROM studio_auth_user WHERE id = ?1")
      .bind(orphanedUser.id)
      .run();
  }

  const signUpRequest = new Request(`${configuration.origin}${AUTH_API_PREFIX}/sign-up/email`, {
    body: JSON.stringify({
      email: cmsSession.identity.email,
      name: cmsSession.identity.email.split("@", 1)[0],
      password: body.password
    }),
    headers: {
      "content-type": "application/json",
      origin: configuration.origin,
      "user-agent": request.headers.get("user-agent") ?? "Noema Studio"
    },
    method: "POST"
  });
  const response = await auth.handler(signUpRequest);
  if (!response.ok) return normalizeAuthFailure(response);

  const payload = await response.clone().json() as { user?: { id?: unknown } };
  const userId = typeof payload.user?.id === "string" ? payload.user.id : null;
  if (!userId) return authError(503, "auth_unavailable", "パスワード設定を完了できませんでした。", true);

  try {
    const timestamp = new Date().toISOString();
    await env.CMS_DB.batch([
      env.CMS_DB.prepare(
        "INSERT INTO cms_auth_identities (user_id, cms_subject, linked_at) VALUES (?1, ?2, ?3)"
      ).bind(userId, cmsSession.identity.subject, timestamp),
      env.CMS_DB.prepare(
        "UPDATE cms_members SET password_login_ready_at = ?1, updated_at = ?1 WHERE subject = ?2"
      ).bind(timestamp, cmsSession.identity.subject)
    ]);
  } catch {
    await env.CMS_DB.prepare("DELETE FROM studio_auth_user WHERE id = ?1").bind(userId).run();
    return authError(409, "auth_identity_conflict", "このCMSメンバーのパスワード設定を完了できませんでした。");
  }

  return withPrivateHeaders(response);
}

async function readPasswordBody(request: Request): Promise<
  | { ok: true; password: string }
  | { ok: false; response: Response }
> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (mediaType !== "application/json") {
    return { ok: false, response: authError(415, "unsupported_media_type", "JSONで送信してください。") };
  }
  try {
    const body = await request.json() as { password?: unknown };
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 128) {
      return { ok: false, response: authError(400, "invalid_password", "パスワードは12文字以上128文字以下で入力してください。") };
    }
    return { ok: true, password: body.password };
  } catch {
    return { ok: false, response: authError(400, "invalid_request", "リクエストを読み取れませんでした。") };
  }
}

async function normalizeAuthFailure(response: Response): Promise<Response> {
  if (response.status === 422 || response.status === 400) {
    return authError(400, "password_rejected", "パスワードを設定できませんでした。入力内容を確認してください。");
  }
  if (response.status === 429) {
    return authError(429, "rate_limited", "試行回数が多すぎます。時間をおいて再試行してください。", true);
  }
  return authError(503, "auth_unavailable", "パスワード設定を一時的に利用できません。", true);
}

function methodNotAllowed(allow: string): Response {
  const response = authError(405, "method_not_allowed", "この操作には対応していません。");
  response.headers.set("allow", allow);
  return response;
}

function withPrivateHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { headers, status: response.status });
}

function authError(status: number, code: string, message: string, retryable = false): Response {
  return Response.json({ error: { code, message, retryable } }, {
    headers: {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff"
    },
    status
  });
}
