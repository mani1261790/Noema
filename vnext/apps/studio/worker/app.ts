import {
  ACCESS_JWT_HEADER,
  AccessTokenRejectedError,
  readAccessConfiguration,
  verifyAccessToken as verifyCloudflareAccessToken,
  type AccessConfiguration,
  type AccessEnvironment,
  type AccessIdentity
} from "./access";
import {
  handleCmsApiRequest,
  isCmsPath
} from "./cms-api";
import {
  handleStudioAuthRequest,
  isStudioAuthPath,
  readStudioAuthConfiguration,
  resolveNoemaIdentity,
  type StudioAuthEnvironment
} from "./studio-auth";

type StudioApiEnvironment = AccessEnvironment & Partial<Pick<
  Env,
  "ARTICLE_ASSETS" | "CMS_BOOTSTRAP_ADMIN_EMAIL" | "CMS_DB" | "STUDIO_ALLOWED_ORIGIN"
>> & Pick<StudioAuthEnvironment, "BETTER_AUTH_SECRET">;
type StudioEnvironment = Env & StudioApiEnvironment;

type AccessTokenVerifier = (
  token: string,
  configuration: AccessConfiguration
) => Promise<AccessIdentity>;

export interface StudioApiDependencies {
  verifyAccessToken?: AccessTokenVerifier;
}

type AuthenticationResult =
  | { identity: AccessIdentity; ok: true }
  | { ok: false; response: Response };

export async function handleStudioApiRequest(
  request: Request,
  env: StudioApiEnvironment,
  dependencies: StudioApiDependencies = {}
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (!isCmsPath(pathname) && !isStudioAuthPath(pathname)) {
    return errorResponse(404, "api_not_found", "APIが見つかりません。");
  }
  if (!env.CMS_DB) {
    return errorResponse(503, "cms_unavailable", "CMSは現在利用できません。", true);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const allowedOrigin = readAllowedOrigin(env.STUDIO_ALLOWED_ORIGIN);
    if (!allowedOrigin) {
      return errorResponse(503, "cms_unavailable", "CMSは現在利用できません。", true);
    }
    if (!hasAllowedOrigin(request, allowedOrigin)) {
      return errorResponse(
        403,
        "same_origin_required",
        "同一オリジンからのリクエストだけを受け付けます。"
      );
    }
  }

  const authConfiguration = readStudioAuthConfiguration(env);
  if (isStudioAuthPath(pathname)) {
    if (!authConfiguration.ok) {
      return errorResponse(503, "auth_unavailable", "Noemaの認証は現在利用できません。", true);
    }
    let accessIdentity: AccessIdentity | null = null;
    if (request.headers.has(ACCESS_JWT_HEADER)) {
      const accessAuthentication = await authenticateAccess(request, env, dependencies);
      if (accessAuthentication.ok) accessIdentity = accessAuthentication.identity;
    }
    return handleStudioAuthRequest(
      request,
      {
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        CMS_BOOTSTRAP_ADMIN_EMAIL: env.CMS_BOOTSTRAP_ADMIN_EMAIL,
        CMS_DB: env.CMS_DB,
        STUDIO_ALLOWED_ORIGIN: env.STUDIO_ALLOWED_ORIGIN
      },
      authConfiguration,
      accessIdentity
    );
  }

  if (authConfiguration.ok) {
    try {
      const identity = await resolveNoemaIdentity(
        request,
        {
          BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
          CMS_BOOTSTRAP_ADMIN_EMAIL: env.CMS_BOOTSTRAP_ADMIN_EMAIL,
          CMS_DB: env.CMS_DB,
          STUDIO_ALLOWED_ORIGIN: env.STUDIO_ALLOWED_ORIGIN
        },
        authConfiguration
      );
      if (identity) {
        return handleCmsApiRequest(
          request,
          {
            ARTICLE_ASSETS: env.ARTICLE_ASSETS,
            CMS_BOOTSTRAP_ADMIN_EMAIL: env.CMS_BOOTSTRAP_ADMIN_EMAIL,
            CMS_DB: env.CMS_DB
          },
          identity
        );
      }
    } catch {
      // Access remains the recovery path while members migrate.
    }
  }

  const authentication = await authenticateAccess(request, env, dependencies);
  if (!authentication.ok) return authentication.response;
  return handleCmsApiRequest(
    request,
    {
      ARTICLE_ASSETS: env.ARTICLE_ASSETS,
      CMS_BOOTSTRAP_ADMIN_EMAIL: env.CMS_BOOTSTRAP_ADMIN_EMAIL,
      CMS_DB: env.CMS_DB
    },
    authentication.identity
  );
}

export async function handleStudioRequest(
  request: Request,
  env: StudioEnvironment
): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return handleStudioApiRequest(request, env);
  }
  return env.ASSETS.fetch(request);
}

async function authenticateAccess(
  request: Request,
  env: AccessEnvironment,
  dependencies: StudioApiDependencies
): Promise<AuthenticationResult> {
  const configuration = readAccessConfiguration(env);
  if (!configuration.ok) {
    return {
      ok: false,
      response: errorResponse(
        503,
        "access_verification_unavailable",
        "Cloudflare Accessの認証確認を一時的に利用できません。",
        true
      )
    };
  }

  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (!token) {
    return {
      ok: false,
      response: errorResponse(
        401,
        "access_authentication_required",
        "Cloudflare Accessでの認証が必要です。"
      )
    };
  }

  try {
    const verifier = dependencies.verifyAccessToken ?? verifyCloudflareAccessToken;
    return {
      identity: await verifier(token, configuration.value),
      ok: true
    };
  } catch (error) {
    if (error instanceof AccessTokenRejectedError) {
      return {
        ok: false,
        response: errorResponse(
          401,
          "access_authentication_failed",
          "Cloudflare Accessの認証を確認できませんでした。"
        )
      };
    }
    return {
      ok: false,
      response: errorResponse(
        503,
        "access_verification_unavailable",
        "Cloudflare Accessの認証確認を一時的に利用できません。",
        true
      )
    };
  }
}

function hasAllowedOrigin(request: Request, allowedOrigin: string): boolean {
  return request.headers.get("origin") === allowedOrigin &&
    new URL(request.url).origin === allowedOrigin;
}

function readAllowedOrigin(value: string | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    const localHttp = url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !localHttp) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable = false
): Response {
  return Response.json(
    { error: { code, message, retryable } },
    {
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-content-type-options": "nosniff"
      },
      status
    }
  );
}
