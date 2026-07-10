import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { topicLabels } from "@noema/content";

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://noema-learn.uk");
  const articles = await getCollection("articles", ({ data }) => data.status === "published");
  const paths = [
    "/",
    "/articles",
    "/about",
    "/privacy",
    "/terms",
    ...Object.keys(topicLabels).map((slug) => `/topics/${slug}`),
    ...articles.map((article) => `/articles/${article.data.slug}`)
  ];
  const urls = paths
    .map((path) => `  <url><loc>${new URL(path, base).toString()}</loc></url>`)
    .join("\n");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { "content-type": "application/xml; charset=utf-8" }
  });
};
