import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { listPublicArticleSummaries } from "../lib/cms-publications";

export const GET: APIRoute = async ({ site }) => {
  const articles = await listPublicArticleSummaries();
  return rss({
    title: "Noema",
    description: "AIでできることと、その仕組みを、直感と具体例からひもとく技術メディアです。",
    site: site ?? new URL("https://noema-learn.uk"),
    items: articles
      .sort((a, b) => (b.publishedAt ?? b.updatedAt).localeCompare(a.publishedAt ?? a.updatedAt))
      .map((article) => ({
        title: article.title,
        description: article.description,
        pubDate: new Date(`${article.publishedAt ?? article.updatedAt}T00:00:00Z`),
        link: `/articles/${article.slug}`,
        categories: article.tags
      })),
    customData: "<language>ja</language>"
  });
};
