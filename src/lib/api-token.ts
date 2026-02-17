import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@prisma/client";

export type ApiTokenPayload = {
  sub: string;
  email?: string | null;
  role: Role;
};

function getSecret() {
  const secret = process.env.API_JWT_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("API_JWT_SECRET or NEXTAUTH_SECRET must be configured.");
  }
  return new TextEncoder().encode(secret);
}

export async function issueApiToken(payload: ApiTokenPayload): Promise<string> {
  return new SignJWT({ email: payload.email ?? null, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(getSecret());
}

export async function verifyApiToken(token: string): Promise<ApiTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const role = payload.role;
    if (typeof payload.sub !== "string" || (role !== "ADMIN" && role !== "MEMBER")) {
      return null;
    }

    return {
      sub: payload.sub,
      role,
      email: typeof payload.email === "string" ? payload.email : null
    };
  } catch {
    return null;
  }
}
