import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { verifyApiToken } from "@/lib/api-token";

export type RequestUser = {
  id: string;
  email?: string | null;
  role: Role;
};

export async function getRequestUser(request: Request): Promise<RequestUser | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    const payload = await verifyApiToken(token);
    if (!payload) return null;
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role
    };
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role
  };
}

export function isAdmin(user: RequestUser | null): boolean {
  return user?.role === Role.ADMIN;
}
