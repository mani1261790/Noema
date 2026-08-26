import type { APIRoute } from "astro";
import { topicLabels } from "@noema/content";
import { listPublicArticleSummaries, listPublishedEditors, listPublishedSeries } from "../lib/cms-publications";

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://noema-learn.uk");
  const [articles, editors, seriesList] = await Promise.all([
    listPublicArticleSummaries(),
    listPublishedEditors(),
    listPublishedSeries()
  ]);
  const publicTopics = new Set(articles.flatMap((article) => article.topics));
  const paths = [
    "/",
    "/articles",
    "/series",
    "/about",
    "/privacy",
    "/terms",
    ...Object.keys(topicLabels).filter((slug) => publicTopics.has(slug as keyof typeof topicLabels)).map((slug) => `/topics/${slug}`),
    ...seriesList.map((series) => series.href),
    ...articles.map((article) => `/articles/${article.slug}`),
    ...editors.map((editor) => editor.href)
  ];
  const urls = paths
    .map((path) => `  <url><loc>${new URL(path, base).toString()}</loc></url>`)
    .join("\n");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: { "content-type": "application/xml; charset=utf-8" }
  });
};
