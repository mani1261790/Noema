import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { handleReaderPush, type ReaderPushEnvironment } from "../../../lib/push-api";
export const ALL: APIRoute = async ({ request }) => {
  try { return await handleReaderPush(request, env as ReaderPushEnvironment); }
  catch { return Response.json({ error: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
};
