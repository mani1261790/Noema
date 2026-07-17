import {
  createRemoteJWKSet,
  errors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey
} from "jose";

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

const TEAM_DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/i;
const AUDIENCE_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type AccessEnvironment = Partial<
  Pick<Env, "ACCESS_POLICY_AUD" | "ACCESS_TEAM_DOMAIN">
>;

export interface AccessConfiguration {
  audience: string;
  issuer: string;
  jwksUrl: URL;
  teamDomain: string;
}

export interface AccessIdentity {
  email: string;
  subject: string;
}

export class AccessTokenRejectedError extends Error {
  override readonly name = "AccessTokenRejectedError";

  constructor(cause?: unknown) {
    super("The Cloudflare Access token was rejected.", { cause });
  }
}

export class AccessVerificationUnavailableError extends Error {
  override readonly name = "AccessVerificationUnavailableError";

  constructor(cause?: unknown) {
    super("Cloudflare Access token verification is unavailable.", { cause });
  }
}

export type AccessConfigurationResult =
  | { ok: true; value: AccessConfiguration }
  | { issues: readonly string[]; ok: false };

const remoteKeySets = new Map<string, JWTVerifyGetKey>();

export function readAccessConfiguration(
  env: AccessEnvironment
): AccessConfigurationResult {
  const teamDomain =
    typeof env.ACCESS_TEAM_DOMAIN === "string"
      ? normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN)
      : null;
  const audience =
    typeof env.ACCESS_POLICY_AUD === "string"
      ? env.ACCESS_POLICY_AUD.trim()
      : "";
  const issues: string[] = [];

  if (!teamDomain) {
    issues.push("ACCESS_TEAM_DOMAIN");
  }

  if (!AUDIENCE_PATTERN.test(audience)) {
    issues.push("ACCESS_POLICY_AUD");
  }

  if (issues.length > 0 || !teamDomain) {
    return { issues, ok: false };
  }

  const issuer = `https://${teamDomain}`;

  return {
    ok: true,
    value: {
      audience,
      issuer,
      jwksUrl: new URL(`${issuer}/cdn-cgi/access/certs`),
      teamDomain
    }
  };
}

function normalizeTeamDomain(value: string): string | null {
  const candidate = value.trim();

  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(
      candidate.includes("://") ? candidate : `https://${candidate}`
    );
    const hostname = url.hostname.toLowerCase();

    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      !TEAM_DOMAIN_PATTERN.test(hostname)
    ) {
      return null;
    }

    return hostname;
  } catch {
    return null;
  }
}

export async function verifyAccessToken(
  token: string,
  configuration: AccessConfiguration,
  keySet: JWTVerifyGetKey = getRemoteKeySet(configuration)
): Promise<AccessIdentity> {
  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(token, keySet, {
      algorithms: ["RS256"],
      audience: configuration.audience,
      issuer: configuration.issuer,
      requiredClaims: ["email", "exp", "iat", "nbf", "sub", "type"]
    }));
  } catch (error) {
    if (isTokenRejection(error)) {
      throw new AccessTokenRejectedError(error);
    }

    throw new AccessVerificationUnavailableError(error);
  }

  if (
    payload.type !== "app" ||
    typeof payload.sub !== "string" ||
    payload.sub.trim().length === 0 ||
    typeof payload.email !== "string" ||
    payload.email.trim().length === 0
  ) {
    throw new AccessTokenRejectedError();
  }

  return {
    email: payload.email.trim(),
    subject: payload.sub.trim()
  };
}

function isTokenRejection(error: unknown): boolean {
  return (
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JOSENotSupported ||
    error instanceof errors.JWKSMultipleMatchingKeys ||
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWSSignatureVerificationFailed ||
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JWTExpired ||
    error instanceof errors.JWTInvalid
  );
}

function getRemoteKeySet(configuration: AccessConfiguration): JWTVerifyGetKey {
  const existing = remoteKeySets.get(configuration.teamDomain);

  if (existing) {
    return existing;
  }

  const keySet = createRemoteJWKSet(configuration.jwksUrl);
  remoteKeySets.set(configuration.teamDomain, keySet);
  return keySet;
}
