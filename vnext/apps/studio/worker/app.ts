import {
  STUDIO_ARTICLE_MAX_SERIALIZED_BYTES,
  articleSubmissionPullRequestSchema,
  type ArticleSubmissionErrorCode,
  type ArticleSubmissionError
} from "@noema/studio-publication";
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
  ARTICLE_SUBMISSION_CANCELLATIONS_PATH,
  ARTICLE_SUBMISSIONS_PATH,
  PUBLICATION_CAPABILITIES_PATH,
  PUBLICATION_DISABLED_CODE,
  type ArticleSubmissionApiResponse,
  type PublicationCapabilitiesResponse,
  type StudioApiErrorCode,
  type StudioApiErrorResponse
} from "./contracts";
import { NOEMA_PUBLICATION_REPOSITORY } from "./publication-coordinator";
import {
  createGitHubPublicationAdapter,
  type StudioPublicationStepResult
} from "./publication-runtime";
import {
  handleCmsApiRequest,
  isCmsMutation,
  isCmsPath
} from "./cms-api";

type StudioApiEnvironment = AccessEnvironment &
  Partial<
    Pick<
      Env,
      | "GITHUB_APP_CLIENT_ID"
      | "GITHUB_APP_INSTALLATION_ID"
      | "GITHUB_APP_PRIVATE_KEY"
      | "CMS_BOOTSTRAP_ADMIN_EMAIL"
      | "CMS_DB"
      | "ARTICLE_ASSETS"
      | "PUBLICATION_COORDINATOR"
      | "STUDIO_ALLOWED_ORIGIN"
    >
  >;
type StudioEnvironment = Env & StudioApiEnvironment;

type AccessTokenVerifier = (
  token: string,
  configuration: AccessConfiguration
) => Promise<AccessIdentity>;

export interface StudioApiDependencies {
  publicationRuntime?: StudioPublicationApiRuntime | null;
  verifyAccessToken?: AccessTokenVerifier;
}

export interface StudioPublicationApiRuntime {
  advanceCreate(
    rawRequest: unknown,
    principalId: string
  ): Promise<StudioPublicationStepResult>;
  advanceCancellation(
    rawRequest: unknown,
    principalId: string
  ): Promise<StudioPublicationStepResult>;
}

const MAX_PUBLICATION_STEPS = 12;
const MAX_ARTICLE_SUBMISSION_REQUEST_BYTES =
  STUDIO_ARTICLE_MAX_SERIALIZED_BYTES * 4;
const MAX_CANCELLATION_REQUEST_BYTES = 16 * 1024;

type AuthenticationResult =
  | { identity: AccessIdentity; ok: true }
  | { ok: false; response: Response };

export async function handleStudioApiRequest(
  request: Request,
  env: StudioApiEnvironment,
  dependencies: StudioApiDependencies = {}
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (isCmsPath(pathname)) {
    if (!env.CMS_DB) {
      return errorResponse(
        503,
        "publication_unavailable",
        "CMSは現在利用できません。"
      );
    }

    if (isCmsMutation(request)) {
      const allowedOrigin = readAllowedOrigin(env.STUDIO_ALLOWED_ORIGIN);
      if (!allowedOrigin) {
        return errorResponse(
          503,
          "publication_unavailable",
          "CMSは現在利用できません。"
        );
      }
      if (!hasAllowedOrigin(request, allowedOrigin)) {
        return errorResponse(
          403,
          "same_origin_required",
          "同一オリジンからのリクエストだけを受け付けます。"
        );
      }
    }

    const authentication = await authenticate(request, env, dependencies);
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

  if (pathname === PUBLICATION_CAPABILITIES_PATH) {
    if (request.method !== "GET") {
      return methodNotAllowed("GET");
    }

    const authentication = await authenticate(request, env, dependencies);

    if (!authentication.ok) {
      return authentication.response;
    }

    const runtime = resolvePublicationRuntime(request, env, dependencies);
    const response = {
      identity: {
        email: authentication.identity.email,
        subject: authentication.identity.subject
      },
      publication: runtime
        ? {
            baseBranch: "develop",
            enabled: true,
            reviewKind: "draft_pull_request",
            state: "enabled",
            submissionMode: "create_only"
          }
        : {
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

  if (
    pathname === ARTICLE_SUBMISSIONS_PATH ||
    pathname === ARTICLE_SUBMISSION_CANCELLATIONS_PATH
  ) {
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

    const runtime = resolvePublicationRuntime(request, env, dependencies);
    if (!runtime) {
      return errorResponse(
        503,
        PUBLICATION_DISABLED_CODE,
        "GitHubへのレビュー依頼はまだ設定されていません。"
      );
    }

    if (!hasJsonContentType(request)) {
      return errorResponse(
        415,
        "unsupported_media_type",
        "Content-Typeにはapplication/jsonを指定してください。"
      );
    }

    const body = await readBoundedJsonBody(
      request,
      pathname === ARTICLE_SUBMISSIONS_PATH
        ? MAX_ARTICLE_SUBMISSION_REQUEST_BYTES
        : MAX_CANCELLATION_REQUEST_BYTES
    );
    if (!body.ok) return body.response;

    return runPublicationSteps(
      runtime,
      pathname === ARTICLE_SUBMISSIONS_PATH ? "create" : "cancel",
      body.value,
      authentication.identity.subject
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

function resolvePublicationRuntime(
  request: Request,
  env: StudioApiEnvironment,
  dependencies: StudioApiDependencies
): StudioPublicationApiRuntime | null {
  const allowedOrigin = readAllowedOrigin(env.STUDIO_ALLOWED_ORIGIN);
  if (!allowedOrigin || new URL(request.url).origin !== allowedOrigin) return null;
  if ("publicationRuntime" in dependencies) {
    return dependencies.publicationRuntime ?? null;
  }

  const configured = createGitHubPublicationAdapter(env);
  const namespace = env.PUBLICATION_COORDINATOR;
  if (!configured.ok || !namespace) return null;

  try {
    const stub = namespace.getByName(NOEMA_PUBLICATION_REPOSITORY);
    return {
      advanceCreate: (rawRequest, principalId) =>
        stub.advanceCreate(rawRequest, principalId),
      advanceCancellation: (rawRequest, principalId) =>
        stub.advanceCancellation(rawRequest, principalId)
    };
  } catch {
    return null;
  }
}

function hasJsonContentType(request: Request): boolean {
  const contentType = request.headers.get("content-type");
  if (!contentType) return false;
  return contentType.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

async function readBoundedJsonBody(
  request: Request,
  maximumBytes: number
): Promise<JsonBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^[0-9]+$/.test(contentLength)) {
      return {
        ok: false,
        response: errorResponse(
          400,
          "invalid_json",
          "JSON request bodyを確認してください。"
        )
      };
    }
    if (Number(contentLength) > maximumBytes) {
      return requestBodyTooLarge();
    }
  }

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maximumBytes) {
          try {
            await reader.cancel();
          } catch {
            // The measured byte limit remains authoritative even if cancellation fails.
          }
          return requestBodyTooLarge();
        }
        chunks.push(value);
      }
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false
    }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: errorResponse(
        400,
        "invalid_json",
        "JSON request bodyを確認してください。"
      )
    };
  }
}

function requestBodyTooLarge(): JsonBodyResult {
  return {
    ok: false,
    response: errorResponse(
      413,
      "request_body_too_large",
      "request bodyが上限を超えています。"
    )
  };
}

async function runPublicationSteps(
  runtime: StudioPublicationApiRuntime,
  operation: "create" | "cancel",
  rawRequest: unknown,
  principalId: string
): Promise<Response> {
  for (let step = 0; step < MAX_PUBLICATION_STEPS; step += 1) {
    let rawResult: unknown;
    try {
      rawResult =
        operation === "create"
          ? await runtime.advanceCreate(rawRequest, principalId)
          : await runtime.advanceCancellation(rawRequest, principalId);
    } catch (error) {
      return errorResponse(
        503,
        "publication_unavailable",
        "公開連携を一時的に利用できません。",
        !isDurableObjectOverload(error)
      );
    }

    const result = normalizePublicationStepResult(rawResult);
    if (result === null) {
      return errorResponse(
        503,
        "publication_unavailable",
        "公開連携を安全に確認できませんでした。"
      );
    }

    if (!result.ok) return submissionErrorResponse(result.error);
    if (result.kind === "continue") continue;

    const response = { result } satisfies ArticleSubmissionApiResponse;
    return jsonResponse(
      response,
      result.outcome === "existing_pull_request" ? 202 : 200
    );
  }

  return errorResponse(
    503,
    "publication_unavailable",
    "公開状態の再確認が必要です。",
    true
  );
}

function normalizePublicationStepResult(
  value: unknown
): StudioPublicationStepResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;

  if (value.ok === false) {
    if (
      value.kind !== "error" ||
      !hasExactKeys(value, ["error", "kind", "ok"]) ||
      !isRecord(value.error)
    ) {
      return null;
    }
    const error = normalizeSubmissionError(value.error);
    return error ? { error, kind: "error", ok: false } : null;
  }

  if (value.kind === "continue") {
    return hasExactKeys(value, ["kind", "ok"])
      ? { kind: "continue", ok: true }
      : null;
  }
  if (value.kind !== "done" || typeof value.outcome !== "string") return null;

  if (value.outcome === "cancelled") {
    return hasExactKeys(value, ["kind", "ok", "outcome"])
      ? { kind: "done", ok: true, outcome: "cancelled" }
      : null;
  }

  const parsedPullRequest = articleSubmissionPullRequestSchema.safeParse(
    value.pullRequest
  );
  if (!parsedPullRequest.success) return null;

  if (
    value.outcome === "existing_pull_request" ||
    value.outcome === "closed_unmerged"
  ) {
    if (!hasExactKeys(value, ["kind", "ok", "outcome", "pullRequest"])) {
      return null;
    }
    return {
      kind: "done",
      ok: true,
      outcome: value.outcome,
      pullRequest: parsedPullRequest.data
    };
  }

  if (
    value.outcome === "merged" &&
    typeof value.finalContentSha256 === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(value.finalContentSha256) &&
    hasExactKeys(value, [
      "finalContentSha256",
      "kind",
      "ok",
      "outcome",
      "pullRequest"
    ])
  ) {
    return {
      finalContentSha256: value.finalContentSha256,
      kind: "done",
      ok: true,
      outcome: "merged",
      pullRequest: parsedPullRequest.data
    };
  }

  return null;
}

function normalizeSubmissionError(
  value: Record<string, unknown>
): ArticleSubmissionError | null {
  const allowedKeys = value.issues
    ? ["code", "issues", "message", "retryable"]
    : ["code", "message", "retryable"];
  if (
    !hasExactKeys(value, allowedKeys) ||
    !isArticleSubmissionErrorCode(value.code) ||
    typeof value.message !== "string" ||
    value.message.length < 1 ||
    value.message.length > 500 ||
    typeof value.retryable !== "boolean"
  ) {
    return null;
  }

  if (value.issues === undefined) {
    return {
      code: value.code,
      message: value.message,
      retryable: value.retryable
    };
  }
  if (!Array.isArray(value.issues) || value.issues.length > 100) return null;

  const issues: NonNullable<ArticleSubmissionError["issues"]> = [];
  for (const issue of value.issues) {
    if (
      !isRecord(issue) ||
      !hasExactKeys(issue, ["message", "path"]) ||
      typeof issue.message !== "string" ||
      issue.message.length < 1 ||
      issue.message.length > 500 ||
      !Array.isArray(issue.path) ||
      issue.path.length > 20 ||
      !issue.path.every(
        (segment) =>
          (typeof segment === "string" && segment.length <= 200) ||
          (typeof segment === "number" && Number.isSafeInteger(segment))
      )
    ) {
      return null;
    }
    issues.push({ message: issue.message, path: issue.path });
  }
  return {
    code: value.code,
    issues,
    message: value.message,
    retryable: value.retryable
  };
}

function isArticleSubmissionErrorCode(
  value: unknown
): value is ArticleSubmissionErrorCode {
  switch (value) {
    case "invalid_submission_request":
    case "invalid_submission_cancellation_request":
    case "invalid_submission_context":
    case "invalid_submission_plan":
    case "submission_planning_failed":
    case "observation_unavailable":
    case "invalid_submission_snapshot":
    case "article_already_exists":
    case "open_submission_exists":
    case "submission_id_reused":
    case "submission_cancellation_forbidden":
    case "submission_artifact_conflict":
    case "submission_artifact_missing":
    case "submission_merge_pending":
      return true;
    default:
      return false;
  }
}

function isDurableObjectOverload(error: unknown): boolean {
  return isRecord(error) && error.overloaded === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function submissionErrorResponse(error: ArticleSubmissionError): Response {
  const response = {
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.issues ? { issues: error.issues } : {})
    }
  } satisfies StudioApiErrorResponse;

  return jsonResponse(response, submissionErrorStatus(error.code));
}

function submissionErrorStatus(code: ArticleSubmissionError["code"]): number {
  switch (code) {
    case "invalid_submission_request":
    case "invalid_submission_cancellation_request":
      return 400;
    case "submission_cancellation_forbidden":
      return 403;
    case "article_already_exists":
    case "open_submission_exists":
    case "submission_id_reused":
    case "submission_artifact_conflict":
    case "submission_artifact_missing":
      return 409;
    case "invalid_submission_context":
    case "invalid_submission_plan":
    case "submission_planning_failed":
    case "observation_unavailable":
    case "invalid_submission_snapshot":
    case "submission_merge_pending":
      return 503;
  }
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
