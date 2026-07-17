import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AccessTokenRejectedError,
  AccessVerificationUnavailableError,
  readAccessConfiguration,
  verifyAccessToken,
  type AccessConfiguration,
  type AccessEnvironment
} from "../worker/access";

const TEAM_DOMAIN = "noema.cloudflareaccess.com";
const ISSUER = `https://${TEAM_DOMAIN}`;
const AUDIENCE = "noema-studio-test-audience";
const SUBJECT = "author-123";
const EMAIL = "author@example.com";
const KEY_ID = "noema-test-key";

let privateKey: CryptoKey;
let keySet: JWTVerifyGetKey;

beforeAll(async () => {
  const generated = await generateKeyPair("RS256", { extractable: true });
  privateKey = generated.privateKey;
  const publicJwk = await exportJWK(generated.publicKey);
  publicJwk.alg = "RS256";
  publicJwk.kid = KEY_ID;
  publicJwk.use = "sig";
  keySet = createLocalJWKSet({ keys: [publicJwk] });
});

describe("readAccessConfiguration", () => {
  it("normalizes a valid Cloudflare Access configuration", () => {
    const env = {
      ACCESS_POLICY_AUD: ` ${AUDIENCE} `,
      ACCESS_TEAM_DOMAIN: ` https://${TEAM_DOMAIN.toUpperCase()}/ `
    } satisfies AccessEnvironment;

    expect(readAccessConfiguration(env)).toEqual({
      ok: true,
      value: {
        audience: AUDIENCE,
        issuer: ISSUER,
        jwksUrl: new URL(`${ISSUER}/cdn-cgi/access/certs`),
        teamDomain: TEAM_DOMAIN
      }
    });
  });

  it("fails closed for missing or malformed values", () => {
    expect(
      readAccessConfiguration({
        ACCESS_POLICY_AUD: "",
        ACCESS_TEAM_DOMAIN: "https://example.com/path"
      })
    ).toEqual({
      issues: ["ACCESS_TEAM_DOMAIN", "ACCESS_POLICY_AUD"],
      ok: false
    });

    expect(readAccessConfiguration({})).toEqual({
      issues: ["ACCESS_TEAM_DOMAIN", "ACCESS_POLICY_AUD"],
      ok: false
    });
  });
});

describe("verifyAccessToken", () => {
  it("accepts a locally signed human application token", async () => {
    await expect(
      verifyAccessToken(await signToken(), configuration(), keySet)
    ).resolves.toEqual({ email: EMAIL, subject: SUBJECT });
  });

  it("rejects a token signed by another key", async () => {
    const generated = await generateKeyPair("RS256");

    await expect(
      verifyAccessToken(
        await signToken({ signingKey: generated.privateKey }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);
  });

  it("rejects an unsupported critical token header", async () => {
    await expect(
      verifyAccessToken(
        await signToken({ unknownCriticalHeader: true }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);
  });

  it("rejects malformed compact JWT input", async () => {
    await expect(
      verifyAccessToken("not-a-jwt", configuration(), keySet)
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);
  });

  it("rejects an expired token", async () => {
    await expect(
      verifyAccessToken(
        await signToken({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);
  });

  it("rejects a token without an expiration claim", async () => {
    await expect(
      verifyAccessToken(
        await signToken({ omitExpiration: true }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);
  });

  it("rejects issuer and audience mismatches", async () => {
    await expect(
      verifyAccessToken(
        await signToken({ issuer: "https://other.cloudflareaccess.com" }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);

    await expect(
      verifyAccessToken(
        await signToken({ audience: "another-application" }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);
  });

  it("rejects a not-yet-valid token", async () => {
    await expect(
      verifyAccessToken(
        await signToken({ notBefore: Math.floor(Date.now() / 1000) + 60 }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);
  });

  it("rejects service and identity-less tokens", async () => {
    await expect(
      verifyAccessToken(
        await signToken({ tokenType: "org" }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);

    await expect(
      verifyAccessToken(
        await signToken({ subject: "", tokenType: "app" }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);

    await expect(
      verifyAccessToken(
        await signToken({ email: "", tokenType: "app" }),
        configuration(),
        keySet
      )
    ).rejects.toBeInstanceOf(AccessTokenRejectedError);
  });

  it("classifies a verifier transport failure as unavailable", async () => {
    const unavailableKeySet: JWTVerifyGetKey = async () => {
      throw new TypeError("network unavailable");
    };

    await expect(
      verifyAccessToken(
        await signToken(),
        configuration(),
        unavailableKeySet
      )
    ).rejects.toBeInstanceOf(AccessVerificationUnavailableError);
  });
});

function configuration(): AccessConfiguration {
  return {
    audience: AUDIENCE,
    issuer: ISSUER,
    jwksUrl: new URL(`${ISSUER}/cdn-cgi/access/certs`),
    teamDomain: TEAM_DOMAIN
  };
}

interface TokenOptions {
  audience?: string;
  email?: string;
  expiresAt?: number;
  issuer?: string;
  notBefore?: number;
  omitExpiration?: boolean;
  signingKey?: CryptoKey;
  subject?: string;
  tokenType?: string;
  unknownCriticalHeader?: boolean;
}

async function signToken(options: TokenOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const protectedHeader = options.unknownCriticalHeader
    ? {
        alg: "RS256",
        crit: ["noema-unknown"],
        kid: KEY_ID,
        "noema-unknown": true,
        typ: "JWT"
      }
    : { alg: "RS256", kid: KEY_ID, typ: "JWT" };
  let token = new SignJWT({
    email: options.email ?? EMAIL,
    type: options.tokenType ?? "app"
  })
    .setProtectedHeader(protectedHeader)
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setSubject(options.subject ?? SUBJECT)
    .setIssuedAt(now)
    .setNotBefore(options.notBefore ?? now - 1);

  if (!options.omitExpiration) {
    token = token.setExpirationTime(options.expiresAt ?? now + 300);
  }

  return token.sign(
    options.signingKey ?? privateKey,
    options.unknownCriticalHeader
      ? { crit: { "noema-unknown": true } }
      : undefined
  );
}
