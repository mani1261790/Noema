import type { APIRoute } from "astro";
import staticPageLastModified from "virtual:noema-static-page-revisions";
import { listPublicArticleSummaries, listPublishedEditors, listPublishedSeries } from "../lib/cms-publications";
import { serializeSitemap } from "../lib/seo";
import { buildSitemapEntries } from "../lib/sitemap";

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL("https://noema-learn.uk");
  const [articles, editors, seriesList] = await Promise.all([
    listPublicArticleSummaries(),
    listPublishedEditors(),
    listPublishedSeries()
  ]);
  const entries = buildSitemapEntries({
    articles,
    editors,
    seriesList,
    staticPageLastModified,
  });

  return new Response(serializeSitemap(entries, base), {
    headers: { "content-type": "application/xml; charset=utf-8" }
  });
};
