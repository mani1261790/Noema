import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  readImageMetadata,
  supportedImageContentTypes,
  type SupportedImageContentType,
} from "@noema/content/image-metadata";
import {
  getPublishedArticleAssetMetadata,
  isArticleAssetKey,
  recordCmsAssetDimensions,
} from "../../lib/cms-publication-assets";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const key = params.key ?? "";
  if (!isArticleAssetKey(key)) return notFound();
  const assetPath = `/media/${key}`;
  const metadata = await getPublishedArticleAssetMetadata(env.CMS_DB, assetPath);
  if (!metadata) return notFound();

  const object = await env.ARTICLE_ASSETS.get(key);
  if (!object) return notFound();
  const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";
  let body: BodyInit = object.body;
  if (!metadata.dimensions) {
    const buffer = await object.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    body = buffer;
    const parsed = readImageMetadata(bytes, supportedContentType(contentType));
    if (parsed) {
      try {
        await recordCmsAssetDimensions(env.CMS_DB, key, parsed);
      } catch (error) {
        console.error("Unable to persist CMS asset dimensions.", error);
      }
    }
  }
  return new Response(body, {
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-type": contentType,
      "x-content-type-options": "nosniff"
    }
  });
};

function supportedContentType(value: string): SupportedImageContentType | undefined {
  return supportedImageContentTypes.includes(value as SupportedImageContentType)
    ? value as SupportedImageContentType
    : undefined;
}

function notFound(): Response {
  return new Response("Not found", {
    headers: { "cache-control": "public, max-age=60" },
    status: 404
  });
}
