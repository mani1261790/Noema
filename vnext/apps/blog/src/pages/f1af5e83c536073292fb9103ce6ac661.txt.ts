import type { APIRoute } from "astro";
import { NOEMA_INDEXNOW_KEY } from "@noema/content/indexnow";

export const GET: APIRoute = () => new Response(NOEMA_INDEXNOW_KEY, {
  headers: { "content-type": "text/plain; charset=utf-8" }
});
