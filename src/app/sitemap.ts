import type { MetadataRoute } from "next";
import { getCatalog } from "@/lib/notebooks";
import { toAbsoluteUrl } from "@/lib/site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getCatalog();
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    {
      url: toAbsoluteUrl("/"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1
    },
    {
      url: toAbsoluteUrl("/learn"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.9
    }
  ];

  for (const chapter of catalog.chapters) {
    for (const notebook of chapter.notebooks) {
      pages.push({
        url: toAbsoluteUrl(`/learn/${encodeURIComponent(notebook.id)}`),
        lastModified: now,
        changeFrequency: "monthly",
        priority: 0.8
      });
    }
  }

  return pages;
}
