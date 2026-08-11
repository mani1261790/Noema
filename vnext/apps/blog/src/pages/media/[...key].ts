import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  isArticleAssetKey,
  isAssetReferencedByPublishedArticle
} from "../../lib/cms-publication-assets";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? "";
  if (!isArticleAssetKey(key)) return notFound();
  const assetPath = `/media/${key}`;
  if (!await isAssetReferencedByPublishedArticle(env.CMS_DB, assetPath)) return notFound();

  const object = await env.ARTICLE_ASSETS.get(key);
  if (!object) return notFound();
  return new Response(object.body, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "x-content-type-options": "nosniff"
    }
  });
};

function notFound(): Response {
  return new Response("Not found", {
    headers: { "cache-control": "public, max-age=60" },
    status: 404
  });
}
