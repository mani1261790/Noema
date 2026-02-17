import { NextResponse } from "next/server";
import { getCurrentSession } from "@/lib/auth";
import { issueApiToken } from "@/lib/api-token";

export async function POST() {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = await issueApiToken({
    sub: session.user.id,
    email: session.user.email,
    role: session.user.role
  });

  return NextResponse.json({ token, expiresInSeconds: 28800 });
}
