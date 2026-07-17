import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STUDIO_ARTICLE_MAX_MARKDOWN_BYTES,
  prepareArticleSubmission
} from "@noema/studio-publication";
import {
  AccessTokenRejectedError,
  type AccessEnvironment,
  type AccessIdentity
} from "../worker/access";
import {
  handleStudioApiRequest,
  type StudioPublicationApiRuntime
} from "../worker/app";
import type {
  PublicationCapabilitiesResponse,
  StudioApiErrorCode,
  StudioApiErrorResponse
} from "../worker/contracts";

const ORIGIN = "https://studio.example.com";
const TOKEN = "test-access-token";
const IDENTITY: AccessIdentity = {
  email: "author@example.com",
  subject: "author-123"
};
const CONFIGURED_ENV = {
  ACCESS_POLICY_AUD: "noema-studio-test-audience",
  ACCESS_TEAM_DOMAIN: "noema.cloudflareaccess.com",
  STUDIO_ALLOWED_ORIGIN: ORIGIN
} satisfies AccessEnvironment & { STUDIO_ALLOWED_ORIGIN: string };

const CONTINUE_RESULT = { ok: true, kind: "continue" } as const;
const OPEN_PULL_REQUEST_RESULT = {
  ok: true,
  kind: "done",
  outcome: "existing_pull_request",
  pullRequest: {
    number: 42,
    url: "https://github.com/mani1261790/Noema/pull/42",
    state: "open",
    draft: true,
    baseBranch: "develop",
    headBranch:
      "studio/submissions/287f0d8b-c79f-4b20-9c3d-683b0c4e643e",
    containsInitialCommit: true,
    mergeCommitSha: null,
    mergeCommitReachableFromBase: false
  }
} as const;

function publicationRuntime(
  createResults: unknown[] = [OPEN_PULL_REQUEST_RESULT],
  cancellationResults: unknown[] = [
    { ok: true, kind: "done", outcome: "cancelled" }
  ]
): StudioPublicationApiRuntime & {
  advanceCancellation: ReturnType<typeof vi.fn>;
  advanceCreate: ReturnType<typeof vi.fn>;
} {
  return {
    advanceCreate: vi.fn().mockImplementation(async () => createResults.shift()),
    advanceCancellation: vi
      .fn()
      .mockImplementation(async () => cancellationResults.shift())
  } as StudioPublicationApiRuntime & {
    advanceCancellation: ReturnType<typeof vi.fn>;
    advanceCreate: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Studio publication API", () => {
  it("fails closed when Access configuration is missing", async () => {
    const verify = vi.fn();
    const response = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/publication-capabilities`, {
        headers: { "cf-access-jwt-assertion": TOKEN }
      }),
      { ACCESS_POLICY_AUD: "", ACCESS_TEAM_DOMAIN: "" },
      { verifyAccessToken: verify }
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expectApiError(response, 503, "publication_unavailable");
    expect(verify).not.toHaveBeenCalled();
  });

  it("does not trust the Access cookie without the assertion header", async () => {
    const verify = vi.fn();
    const response = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/publication-capabilities`, {
        headers: { cookie: `CF_Authorization=${TOKEN}` }
      }),
      CONFIGURED_ENV,
      { verifyAccessToken: verify }
    );

    await expectApiError(response, 401, "access_authentication_required");
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns a generic failure for a rejected JWT", async () => {
    const verify = vi
      .fn()
      .mockRejectedValue(
        new AccessTokenRejectedError(new Error("sensitive detail"))
      );
    const response = await handleStudioApiRequest(
      authenticatedRequest("/api/publication-capabilities"),
      CONFIGURED_ENV,
      { verifyAccessToken: verify }
    );
    const body = await response.clone().text();

    await expectApiError(response, 401, "access_authentication_failed");
    expect(body).not.toContain("sensitive detail");
    expect(body).not.toContain(TOKEN);
  });

  it("marks verifier outages as retryable service failures", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("network unavailable"));
    const response = await handleStudioApiRequest(
      authenticatedRequest("/api/publication-capabilities"),
      CONFIGURED_ENV,
      { verifyAccessToken: verify }
    );

    await expectApiError(
      response,
      503,
      "access_verification_unavailable",
      true
    );
  });

  it("returns only minimal identity and disabled publication capabilities", async () => {
    const verify = vi.fn().mockResolvedValue({
      ...IDENTITY,
      token: "must-not-cross-the-http-boundary"
    });
    const response = await handleStudioApiRequest(
      authenticatedRequest("/api/publication-capabilities"),
      CONFIGURED_ENV,
      { verifyAccessToken: verify }
    );
    const body = (await response.json()) as PublicationCapabilitiesResponse;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      identity: IDENTITY,
      publication: {
        baseBranch: "develop",
        code: "github_app_not_configured",
        enabled: false,
        reviewKind: "draft_pull_request",
        state: "disabled",
        submissionMode: "create_only"
      }
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain("must-not-cross-the-http-boundary");
  });

  it("keeps capabilities disabled for a malformed GitHub private key", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const response = await handleStudioApiRequest(
      authenticatedRequest("/api/publication-capabilities"),
      {
        ...CONFIGURED_ENV,
        GITHUB_APP_CLIENT_ID: "Iv1.test-client-id",
        GITHUB_APP_INSTALLATION_ID: "12345678",
        GITHUB_APP_PRIVATE_KEY:
          "-----BEGIN RSA PRIVATE KEY-----\nYWJj\n-----END RSA PRIVATE KEY-----",
        PUBLICATION_COORDINATOR: {} as Env["PUBLICATION_COORDINATOR"]
      },
      { verifyAccessToken: verify }
    );
    const body = (await response.json()) as PublicationCapabilitiesResponse;

    expect(body.publication.enabled).toBe(false);
  });

  it("enables publication capabilities only when a runtime is configured", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime = publicationRuntime();
    const response = await handleStudioApiRequest(
      authenticatedRequest("/api/publication-capabilities"),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );
    const body = (await response.json()) as PublicationCapabilitiesResponse;

    expect(body.publication).toEqual({
      baseBranch: "develop",
      enabled: true,
      reviewKind: "draft_pull_request",
      state: "enabled",
      submissionMode: "create_only"
    });
  });

  it("keeps capabilities disabled on workers.dev and preview origins", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime = publicationRuntime();
    const response = await handleStudioApiRequest(
      new Request(
        "https://noema-studio.example.workers.dev/api/publication-capabilities",
        { headers: { "cf-access-jwt-assertion": TOKEN } }
      ),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );
    const body = (await response.json()) as PublicationCapabilitiesResponse;

    expect(body.publication).toEqual({
      baseBranch: "develop",
      code: "github_app_not_configured",
      enabled: false,
      reviewKind: "draft_pull_request",
      state: "disabled",
      submissionMode: "create_only"
    });
  });

  it("runs one serialized publication step at a time until a Draft PR is ready", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime = publicationRuntime([
      CONTINUE_RESULT,
      OPEN_PULL_REQUEST_RESULT
    ]);
    const requestBody = {
      version: 1,
      operation: "create_article",
      submissionId: "287f0d8b-c79f-4b20-9c3d-683b0c4e643e"
    };
    const response = await handleStudioApiRequest(
      authenticatedJsonRequest("/api/article-submissions", requestBody),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ result: OPEN_PULL_REQUEST_RESULT });
    expect(runtime.advanceCreate).toHaveBeenCalledTimes(2);
    expect(runtime.advanceCreate).toHaveBeenNthCalledWith(
      1,
      requestBody,
      IDENTITY.subject
    );
    expect(runtime.advanceCreate).toHaveBeenNthCalledWith(
      2,
      requestBody,
      IDENTITY.subject
    );
  });

  it("routes cancellation with only the authenticated principal and request body", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime = publicationRuntime();
    const requestBody = {
      version: 1,
      operation: "cancel_article_submission",
      submissionId: "287f0d8b-c79f-4b20-9c3d-683b0c4e643e"
    };
    const response = await handleStudioApiRequest(
      authenticatedJsonRequest(
        "/api/article-submission-cancellations",
        requestBody
      ),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );

    expect(response.status).toBe(200);
    expect(runtime.advanceCancellation).toHaveBeenCalledWith(
      requestBody,
      IDENTITY.subject
    );
    expect(runtime.advanceCreate).not.toHaveBeenCalled();
  });

  it("fails closed on malformed or diagnostic-rich runtime results", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const diagnosticRuntime = publicationRuntime([], [
      {
        ok: true,
        kind: "done",
        outcome: "cancelled",
        claim: { principalId: "must-not-leak" }
      }
    ]);
    const malformedRuntime = publicationRuntime([undefined]);
    const cancellation = await handleStudioApiRequest(
      authenticatedJsonRequest("/api/article-submission-cancellations", {
        version: 1,
        operation: "cancel_article_submission",
        submissionId: "287f0d8b-c79f-4b20-9c3d-683b0c4e643e"
      }),
      CONFIGURED_ENV,
      { publicationRuntime: diagnosticRuntime, verifyAccessToken: verify }
    );
    const create = await handleStudioApiRequest(
      authenticatedJsonRequest("/api/article-submissions", {}),
      CONFIGURED_ENV,
      { publicationRuntime: malformedRuntime, verifyAccessToken: verify }
    );
    const cancellationBody = await cancellation.clone().text();

    await expectApiError(cancellation, 503, "publication_unavailable");
    await expectApiError(create, 503, "publication_unavailable");
    expect(cancellationBody).not.toContain("must-not-leak");
  });

  it("does not encourage retries when the Durable Object is overloaded", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime: StudioPublicationApiRuntime = {
      advanceCreate: vi.fn().mockRejectedValue({ overloaded: true }),
      advanceCancellation: vi.fn().mockRejectedValue({ overloaded: true })
    };
    const response = await handleStudioApiRequest(
      authenticatedJsonRequest("/api/article-submissions", {}),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );

    await expectApiError(response, 503, "publication_unavailable", false);
  });

  it("rejects wrong media types and malformed JSON before the runtime", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime = publicationRuntime();
    const wrongType = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/article-submissions`, {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": TOKEN,
          "content-type": "text/plain",
          origin: ORIGIN
        },
        body: "{}"
      }),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );
    const invalidJson = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/article-submissions`, {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": TOKEN,
          "content-type": "application/json",
          origin: ORIGIN
        },
        body: "{"
      }),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );

    await expectApiError(wrongType, 415, "unsupported_media_type");
    await expectApiError(invalidJson, 400, "invalid_json");
    expect(runtime.advanceCreate).not.toHaveBeenCalled();
  });

  it("rejects malformed UTF-8 and accepts JSON media type casing and parameters", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime = publicationRuntime();
    const invalidUtf8 = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/article-submissions`, {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": TOKEN,
          "content-type": "application/json",
          origin: ORIGIN
        },
        body: new Uint8Array([0x7b, 0xff, 0x7d])
      }),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );
    const accepted = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/article-submissions`, {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": TOKEN,
          "content-type": "Application/JSON; Charset=UTF-8",
          origin: ORIGIN
        },
        body: "{}"
      }),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );

    await expectApiError(invalidUtf8, 400, "invalid_json");
    expect(accepted.status).toBe(202);
  });

  it("enforces the request limit for declared and streamed body sizes", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime = publicationRuntime();
    const declared = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/article-submissions`, {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": TOKEN,
          "content-length": "1100000",
          "content-type": "application/json",
          origin: ORIGIN
        },
        body: "{}"
      }),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );
    const streamed = await handleStudioApiRequest(
      authenticatedJsonRequest(
        "/api/article-submissions",
        "x".repeat(1_100_000),
        true
      ),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );
    const cancelRejectingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_100_000));
      },
      cancel() {
        throw new Error("simulated cancellation failure");
      }
    });
    const cancelRejecting = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/article-submissions`, {
        method: "POST",
        headers: {
          "cf-access-jwt-assertion": TOKEN,
          "content-type": "application/json",
          origin: ORIGIN
        },
        body: cancelRejectingStream
      }),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );

    await expectApiError(declared, 413, "request_body_too_large");
    await expectApiError(streamed, 413, "request_body_too_large");
    await expectApiError(cancelRejecting, 413, "request_body_too_large");
    expect(runtime.advanceCreate).not.toHaveBeenCalled();
  });

  it("accepts a schema-valid request at the JSON escaping worst case", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const runtime = publicationRuntime();
    const urlPrefix = "https://example.com/";
    const requestBody = {
      version: 1,
      operation: "create_article",
      submissionId: "8feec5e6-5c3a-4c78-9c78-1ed9d708457d",
      frontmatter: {
        title: "JSON escaping upper-bound verification",
        description: "Schema-valid request bodies must reach the publication runtime.",
        slug: "json-escaping-upper-bound",
        status: "draft",
        updatedAt: "2026-07-17",
        authors: ["Noema編集部"],
        topics: ["development-environment"],
        tags: [],
        approach: "development",
        outcome: "HTTP and schema size contracts remain aligned",
        prerequisites: [],
        estimatedMinutes: 10,
        heroImage: null,
        sources: Array.from({ length: 20 }, (_, index) => ({
          title: `Source ${index}`,
          url: `${urlPrefix}${"\\".repeat(2048 - urlPrefix.length)}`,
          checkedAt: "2026-07-17"
        }))
      },
      markdown: "\\".repeat(STUDIO_ARTICLE_MAX_MARKDOWN_BYTES)
    };
    const prepared = await prepareArticleSubmission(requestBody, {
      principalId: IDENTITY.subject
    });
    expect(prepared.ok).toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(requestBody)).byteLength).toBeGreaterThan(
      320 * 1024
    );

    const response = await handleStudioApiRequest(
      authenticatedJsonRequest("/api/article-submissions", requestBody),
      CONFIGURED_ENV,
      { publicationRuntime: runtime, verifyAccessToken: verify }
    );

    expect(response.status).toBe(202);
    expect(runtime.advanceCreate).toHaveBeenCalled();
  });

  it("keeps article submission disabled without external calls", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const externalFetch = vi.fn();
    vi.stubGlobal("fetch", externalFetch);

    const response = await handleStudioApiRequest(
      authenticatedRequest("/api/article-submissions", "POST", {
        origin: ORIGIN
      }),
      CONFIGURED_ENV,
      { verifyAccessToken: verify }
    );

    await expectApiError(response, 503, "github_app_not_configured");
    expect(externalFetch).not.toHaveBeenCalled();
  });

  it("rejects cross-origin article submission before publication", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const response = await handleStudioApiRequest(
      authenticatedRequest("/api/article-submissions", "POST", {
        origin: "https://attacker.example"
      }),
      CONFIGURED_ENV,
      { verifyAccessToken: verify }
    );

    await expectApiError(response, 403, "same_origin_required");
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([undefined, "null"])(
    "rejects a missing or opaque Origin (%s)",
    async (origin) => {
      const verify = vi.fn().mockResolvedValue(IDENTITY);
      const headers: HeadersInit = origin === undefined ? {} : { origin };
      const response = await handleStudioApiRequest(
        authenticatedRequest("/api/article-submissions", "POST", headers),
        CONFIGURED_ENV,
        { verifyAccessToken: verify }
      );

      await expectApiError(response, 403, "same_origin_required");
      expect(verify).not.toHaveBeenCalled();
    }
  );

  it("rejects a same-origin workers.dev bypass", async () => {
    const alternateOrigin = "https://noema-studio.example.workers.dev";
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const request = new Request(
      `${alternateOrigin}/api/article-submissions`,
      {
        headers: {
          "cf-access-jwt-assertion": TOKEN,
          origin: ORIGIN
        },
        method: "POST"
      }
    );
    const response = await handleStudioApiRequest(
      request,
      CONFIGURED_ENV,
      { verifyAccessToken: verify }
    );

    await expectApiError(response, 403, "same_origin_required");
    expect(verify).not.toHaveBeenCalled();
  });

  it("fails closed before authentication when the allowed origin is absent", async () => {
    const verify = vi.fn().mockResolvedValue(IDENTITY);
    const response = await handleStudioApiRequest(
      authenticatedRequest("/api/article-submissions", "POST", {
        origin: ORIGIN
      }),
      { ...CONFIGURED_ENV, STUDIO_ALLOWED_ORIGIN: "" },
      { verifyAccessToken: verify }
    );

    await expectApiError(response, 503, "publication_unavailable");
    expect(verify).not.toHaveBeenCalled();
  });

  it("returns JSON errors for unknown APIs and unsupported methods", async () => {
    const unknown = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/unknown`),
      CONFIGURED_ENV
    );
    const wrongMethod = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/article-submissions`),
      CONFIGURED_ENV
    );

    await expectApiError(unknown, 404, "api_not_found");
    expect(unknown.headers.get("content-type")).toContain("application/json");
    await expectApiError(wrongMethod, 405, "method_not_allowed");
    expect(wrongMethod.headers.get("allow")).toBe("POST");
  });
});

describe("Studio Worker routing", () => {
  it("keeps API responses out of the SPA fallback", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/publication-capabilities`, {
      headers: { "cf-access-jwt-assertion": TOKEN }
    });

    await expectApiError(response.clone(), 503, "publication_unavailable");
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("<html");
  });

  it("continues to serve the Studio SPA for non-API navigation", async () => {
    const response = await SELF.fetch(`${ORIGIN}/`);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Noema Studio");
  });
});

function authenticatedRequest(
  path: string,
  method = "GET",
  headers: HeadersInit = {}
): Request {
  const requestHeaders = new Headers(headers);
  requestHeaders.set("cf-access-jwt-assertion", TOKEN);

  return new Request(`${ORIGIN}${path}`, {
    headers: requestHeaders,
    method
  });
}

function authenticatedJsonRequest(
  path: string,
  value: unknown,
  raw = false
): Request {
  return new Request(`${ORIGIN}${path}`, {
    body: raw ? String(value) : JSON.stringify(value),
    headers: {
      "cf-access-jwt-assertion": TOKEN,
      "content-type": "application/json; charset=utf-8",
      origin: ORIGIN
    },
    method: "POST"
  });
}

async function expectApiError(
  response: Response,
  status: number,
  code: StudioApiErrorCode,
  retryable = false
): Promise<void> {
  const body = (await response.json()) as StudioApiErrorResponse;

  expect(response.status).toBe(status);
  expect(body.error.code).toBe(code);
  expect(body.error.retryable).toBe(retryable);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}
