import { ImageResponse } from "@cloudflare/pages-plugin-vercel-og/api";
import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { topicLabels } from "@noema/content";
import { getPublishedArticleBySlug } from "../../../lib/cms-publications";
import { createArticleOgMarkup, ARTICLE_OG_HEIGHT, ARTICLE_OG_WIDTH } from "../../../lib/article-og";

export const GET: APIRoute = async ({ params, request }) => {
  const article = params.slug ? await getPublishedArticleBySlug(params.slug) : null;
  if (!article) return new Response("Article image not found.", { status: 404, headers: { "Cache-Control": "no-store" } });
  try {
    const font = await env.ASSETS.fetch(new Request(new URL("/og/noema-og-japanese-bold.ttf", request.url)));
    if (!font.ok) throw new Error(`OG font: ${font.status}`);
    const image = new ImageResponse(createArticleOgMarkup({
      title: article.data.title,
      topic: topicLabels[article.data.topics[0]] ?? "AIと技術",
    }), {
      fonts: [{ data: await font.arrayBuffer(), name: "Noto Sans JP", weight: 700, style: "normal" }],
      width: ARTICLE_OG_WIDTH, height: ARTICLE_OG_HEIGHT,
    });
    // Materialize while inside the error boundary: rendering can reject while reading the stream.
    // The package inherits the Workers runtime Response but omits its methods in its declarations.
    const bytes = await (image as unknown as Response).arrayBuffer();
    return new Response(bytes, { headers: {
      "Content-Type": "image/png", "X-Content-Type-Options": "nosniff",
      "Cache-Control": article.visibility === "unlisted" ? "private, no-store" : "public, max-age=3600",
    } });
  } catch (error) {
    console.error("Article Open Graph image generation failed.", error);
    const fallback = await env.ASSETS.fetch(new Request(new URL("/og/default.png", request.url)));
    return new Response(fallback.body, { status: fallback.status, headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  }
};
