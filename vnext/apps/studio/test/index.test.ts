import { SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccessTokenRejectedError,
  type AccessEnvironment,
  type AccessIdentity
} from "../worker/access";
import { handleStudioApiRequest } from "../worker/app";
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
    const verify = vi.fn().mockResolvedValue(IDENTITY);
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
