import { SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { AccessTokenRejectedError } from "../worker/access";
import { handleStudioApiRequest } from "../worker/app";

const ORIGIN = "https://studio.example.com";

describe("Studio CMS routing", () => {
  it("returns a JSON 404 for removed and unknown APIs", async () => {
    const response = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/publication-capabilities`),
      { ACCESS_POLICY_AUD: "audience", ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com" }
    );
    const body = await response.json() as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error.code).toBe("api_not_found");
  });

  it("fails closed when CMS or Access configuration is unavailable", async () => {
    const missingCms = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/cms/session`),
      { ACCESS_POLICY_AUD: "audience", ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com" }
    );
    const missingAccess = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/cms/session`),
      { CMS_DB: {} as D1Database }
    );

    expect(missingCms.status).toBe(503);
    await expect(missingCms.json()).resolves.toMatchObject({
      error: { code: "cms_unavailable", retryable: true }
    });
    expect(missingAccess.status).toBe(503);
    await expect(missingAccess.json()).resolves.toMatchObject({
      error: { code: "access_verification_unavailable", retryable: true }
    });
  });

  it("requires the Access assertion and does not trust its cookie alone", async () => {
    const verifyAccessToken = vi.fn();
    const response = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/cms/session`, {
        headers: { cookie: "CF_Authorization=must-not-be-trusted" }
      }),
      {
        ACCESS_POLICY_AUD: "audience",
        ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
        CMS_DB: {} as D1Database
      },
      { verifyAccessToken }
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "access_authentication_required", retryable: false }
    });
    expect(verifyAccessToken).not.toHaveBeenCalled();
  });

  it("separates rejected Access tokens from verifier outages without leaking details", async () => {
    const environment = {
      ACCESS_POLICY_AUD: "audience",
      ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
      CMS_DB: {} as D1Database
    };
    const request = () => new Request(`${ORIGIN}/api/cms/session`, {
      headers: { "cf-access-jwt-assertion": "sensitive-token" }
    });
    const rejected = await handleStudioApiRequest(request(), environment, {
      verifyAccessToken: vi.fn().mockRejectedValue(
        new AccessTokenRejectedError(new Error("sensitive rejection detail"))
      )
    });
    const unavailable = await handleStudioApiRequest(request(), environment, {
      verifyAccessToken: vi.fn().mockRejectedValue(new Error("sensitive outage detail"))
    });
    const rejectedBody = await rejected.text();
    const unavailableBody = await unavailable.text();

    expect(rejected.status).toBe(401);
    expect(rejectedBody).toContain("access_authentication_failed");
    expect(unavailable.status).toBe(503);
    expect(unavailableBody).toContain("access_verification_unavailable");
    expect(unavailableBody).toContain('"retryable":true');
    expect(`${rejectedBody}${unavailableBody}`).not.toContain("sensitive");
  });

  it("keeps API responses out of the SPA fallback", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/unknown`);
    const body = await response.clone().json() as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error.code).toBe("api_not_found");
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
