import rss from "@astrojs/rss";
import { getCollection } from "astro:content";

export const prerender = true;

export async function GET(context: { site?: URL }) {
  const articles = await getCollection("articles", ({ data }) => data.status === "published");
  return rss({
    title: "Noema",
    description: "AIでできることと、その仕組みを、直感と具体例からひもとく技術メディアです。",
    site: context.site ?? new URL("https://noema-learn.uk"),
    items: articles
      .sort((a, b) => (b.data.publishedAt ?? b.data.updatedAt).localeCompare(a.data.publishedAt ?? a.data.updatedAt))
      .map((article) => ({
        title: article.data.title,
        description: article.data.description,
        pubDate: new Date(`${article.data.publishedAt ?? article.data.updatedAt}T00:00:00Z`),
        link: `/articles/${article.data.slug}`,
        categories: article.data.tags
      })),
    customData: "<language>ja</language>"
  });
}
