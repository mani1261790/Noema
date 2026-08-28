import type { ArticleSummary } from "@noema/content";
import { describe, expect, it } from "vitest";
import { buildSitemapEntries } from "./sitemap";

const article = {
  approach: "development",
  authors: ["Noema編集部"],
  description: "記事の説明",
  excerpt: "記事の要約",
  heroImage: null,
  href: "/articles/example",
  publishedAt: "2026-08-25",
  slug: "example",
  tags: ["SEO"],
  title: "記事タイトル",
  topics: ["development-environment"],
  updatedAt: "2026-08-26",
} satisfies ArticleSummary;

describe("sitemap entries", () => {
  it("includes accurate freshness dates for static, editor, collection, and article pages", () => {
    const dataArticle = {
      ...article,
      href: "/articles/data-example",
      slug: "data-example",
      topics: ["development-environment", "data-models"],
    } satisfies ArticleSummary;
    const entries = buildSitemapEntries({
      articles: [article, dataArticle],
      editors: [{
        displayName: "Noema編集部",
        href: "/editors/editor-id",
        publicId: "editor-id",
        updatedAt: "2026-08-28",
      }],
      seriesList: [{
        description: "シリーズの説明",
        href: "/series/example-series",
        id: "series-id",
        items: [article],
        slug: "example-series",
        title: "シリーズ名",
        updatedAt: "2026-08-27",
      }],
      staticPageLastModified: {
        "/about": "2026-08-26",
        "/privacy": "2026-08-28",
        "/updates": "2026-08-28",
      },
    });

    expect(entries).toEqual(expect.arrayContaining([
      { pathname: "/", lastModified: "2026-08-27" },
      { pathname: "/updates", lastModified: "2026-08-28" },
      { pathname: "/about", lastModified: "2026-08-26" },
      { pathname: "/privacy", lastModified: "2026-08-28" },
      { pathname: "/topics/data-models", lastModified: "2026-08-26" },
      { pathname: "/series/example-series", lastModified: "2026-08-27" },
      { pathname: "/articles/example", lastModified: "2026-08-26" },
      { pathname: "/editors/editor-id", lastModified: "2026-08-28" },
    ]));
    expect(entries.some((entry) => entry.pathname === "/terms")).toBe(false);
    expect(entries.some((entry) => entry.pathname === "/topics/development-environment")).toBe(false);
  });
});
