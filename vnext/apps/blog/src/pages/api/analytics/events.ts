import type { APIRoute } from "astro";
import { cmsAnalyticsEventRequestSchema } from "@noema/cms";
import { env } from "cloudflare:workers";
import {
  allowCmsAnalyticsEvent,
  recordCmsAnalyticsEvent
} from "../../../lib/analytics";

export const prerender = false;

const MAX_ANALYTICS_REQUEST_BYTES = 4_096;

function json(payload: unknown, status: number): Response {
  return Response.json(payload, {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    },
    status
  });
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ANALYTICS_REQUEST_BYTES) {
      await reader.cancel();
      throw new RangeError("analytics_request_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

export const POST: APIRoute = async ({ request, url }) => {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== url.origin) || (fetchSite && fetchSite !== "same-origin")) {
    return json({ error: "same_origin_required" }, 403);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return json({ error: "json_required" }, 415);
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_ANALYTICS_REQUEST_BYTES) {
    return json({ error: "request_too_large" }, 413);
  }

  let value: unknown;
  try {
    value = await readBoundedJson(request);
  } catch (error) {
    return json({
      error: error instanceof RangeError ? "request_too_large" : "invalid_json"
    }, error instanceof RangeError ? 413 : 400);
  }
  const parsed = cmsAnalyticsEventRequestSchema.safeParse(value);
  if (!parsed.success) return json({ error: "invalid_event" }, 400);

  try {
    if (!await allowCmsAnalyticsEvent(env.ANALYTICS_RATE_LIMITER, request)) {
      return json({ error: "rate_limited" }, 429);
    }
    const outcome = await recordCmsAnalyticsEvent(
      env.CMS_DB,
      env.READER_ANALYTICS,
      parsed.data
    );
    if (outcome === "unknown_article") {
      console.info(JSON.stringify({ event: "blog.analytics.unknown_slug" }));
    }
    return new Response(null, {
      headers: { "cache-control": "no-store" },
      status: 204
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "blog.analytics.write_failed",
      message: error instanceof Error ? error.message : String(error)
    }));
    return json({ error: "analytics_unavailable" }, 503);
  }
};
