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
  ARTICLE_SUBMISSIONS_PATH,
  PUBLICATION_CAPABILITIES_PATH,
  PUBLICATION_DISABLED_CODE,
  type PublicationCapabilitiesResponse,
  type StudioApiErrorCode,
  type StudioApiErrorResponse
} from "./contracts";

type StudioApiEnvironment = AccessEnvironment &
  Partial<Pick<Env, "STUDIO_ALLOWED_ORIGIN">>;
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

  if (pathname === PUBLICATION_CAPABILITIES_PATH) {
    if (request.method !== "GET") {
      return methodNotAllowed("GET");
    }

    const authentication = await authenticate(request, env, dependencies);

    if (!authentication.ok) {
      return authentication.response;
    }

    const response = {
      identity: authentication.identity,
      publication: {
        baseBranch: "develop",
        code: PUBLICATION_DISABLED_CODE,
        enabled: false,
        reviewKind: "draft_pull_request",
        state: "disabled",
        submissionMode: "create_only"
      }
    } satisfies PublicationCapabilitiesResponse;

    return jsonResponse(response);
  }

  if (pathname === ARTICLE_SUBMISSIONS_PATH) {
    if (request.method !== "POST") {
      return methodNotAllowed("POST");
    }

    const allowedOrigin = readAllowedOrigin(env.STUDIO_ALLOWED_ORIGIN);

    if (!allowedOrigin) {
      console.warn({
        event: "studio.publication.configuration_missing",
        issues: ["STUDIO_ALLOWED_ORIGIN"]
      });
      return errorResponse(
        503,
        "publication_unavailable",
        "公開連携は現在利用できません。"
      );
    }

    if (!hasAllowedOrigin(request, allowedOrigin)) {
      return errorResponse(
        403,
        "same_origin_required",
        "同一オリジンからのリクエストだけを受け付けます。"
      );
    }

    const authentication = await authenticate(request, env, dependencies);

    if (!authentication.ok) {
      return authentication.response;
    }

    return errorResponse(
      503,
      PUBLICATION_DISABLED_CODE,
      "GitHubへのレビュー依頼はまだ設定されていません。"
    );
  }

  return errorResponse(404, "api_not_found", "APIが見つかりません。");
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

async function authenticate(
  request: Request,
  env: AccessEnvironment,
  dependencies: StudioApiDependencies
): Promise<AuthenticationResult> {
  const configuration = readAccessConfiguration(env);

  if (!configuration.ok) {
    console.warn({
      event: "studio.publication.configuration_missing",
      issues: configuration.issues
    });
    return {
      ok: false,
      response: errorResponse(
        503,
        "publication_unavailable",
        "公開連携は現在利用できません。"
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
    const verifyAccessToken =
      dependencies.verifyAccessToken ?? verifyCloudflareAccessToken;
    const identity = await verifyAccessToken(token, configuration.value);
    return { identity, ok: true };
  } catch (error) {
    if (error instanceof AccessTokenRejectedError) {
      console.warn({
        event: "studio.publication.access_denied",
        reason: "token_rejected"
      });
      return {
        ok: false,
        response: errorResponse(
          401,
          "access_authentication_failed",
          "Cloudflare Accessの認証を確認できませんでした。"
        )
      };
    }

    console.warn({
      event: "studio.publication.access_verification_unavailable",
      reason: "verifier_unavailable"
    });
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
  const origin = request.headers.get("origin");
  const destinationOrigin = new URL(request.url).origin;
  return origin === allowedOrigin && destinationOrigin === allowedOrigin;
}

function readAllowedOrigin(value: string | undefined): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(value.trim());
    const isLocalHttp =
      url.protocol === "http:" &&
      ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);

    if (
      (url.protocol !== "https:" && !isLocalHttp) ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function methodNotAllowed(allowedMethod: "GET" | "POST"): Response {
  return errorResponse(
    405,
    "method_not_allowed",
    "このHTTPメソッドは利用できません。",
    false,
    { allow: allowedMethod }
  );
}

function errorResponse(
  status: number,
  code: StudioApiErrorCode,
  message: string,
  retryable = false,
  additionalHeaders: HeadersInit = {}
): Response {
  const response = {
    error: { code, message, retryable }
  } satisfies StudioApiErrorResponse;

  return jsonResponse(response, status, additionalHeaders);
}

function jsonResponse(
  value: unknown,
  status = 200,
  additionalHeaders: HeadersInit = {}
): Response {
  const headers = new Headers(additionalHeaders);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");

  return new Response(JSON.stringify(value), { headers, status });
}
