import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { listPublicArticleSummaries } from "../lib/cms-publications";
import { createNoemaRssItems } from "../lib/rss";

export const GET: APIRoute = async ({ site }) => {
  const articles = await listPublicArticleSummaries();
  const canonicalSite = site ?? new URL("https://noema-learn.uk");
  return rss({
    title: "Noema",
    description: "AIでできることと、その仕組みを、直感と具体例からひもとく技術メディアです。",
    site: canonicalSite,
    items: createNoemaRssItems(articles, canonicalSite),
    customData: "<language>ja</language>"
  });
};
