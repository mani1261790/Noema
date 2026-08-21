import type { CmsVisibility } from "@noema/cms";
import { describe, expect, it } from "vitest";
import {
  getCmsPublishedSeriesByArticleSlug,
  isCmsPublicationVisible,
  parseCmsPublishedArticleRow,
  type CmsPublicationDatabase,
  type CmsPublicationStatement,
} from "./cms-publication-repository";

const validFrontmatter = {
  title: "CMSから公開する記事",
  description: "D1の公開済みリビジョンを表示する記事です。",
  slug: "cms-published-article",
  status: "draft",
  updatedAt: "2000-01-01",
  authors: ["Noema編集部"],
  topics: ["development-environment"],
  tags: ["CMS"],
  approach: "development",
  outcome: "CMSの公開フローを理解できる",
  prerequisites: [],
  estimatedMinutes: 8,
  heroImage: null,
  sources: [],
};

describe("CMS publication visibility", () => {
  it.each([
    ["public", true, true],
    ["unlisted", false, true],
    ["restricted", false, false],
    ["internal", false, false],
  ] satisfies Array<[CmsVisibility, boolean, boolean]>) (
    "%s visibility: listing=%s direct=%s",
    (visibility, listing, direct) => {
      expect(isCmsPublicationVisible(visibility, "listing")).toBe(listing);
      expect(isCmsPublicationVisible(visibility, "direct")).toBe(direct);
    },
  );

  it("uses the immutable published revision and server timestamps", () => {
    const result = parseCmsPublishedArticleRow({
      frontmatter_json: JSON.stringify(validFrontmatter),
      markdown: "## 本文\n\n公開済みの本文です。",
      published_at: "2026-07-18T01:02:03.000Z",
      published_slug: "cms-published-article",
      published_visibility: "unlisted",
      revision_created_at: "2026-07-17T05:06:07.000Z",
      revision_number: 4,
    }, "direct");

    expect(result.data.status).toBe("published");
    expect(result.data.publishedAt).toBe("2026-07-18");
    expect(result.data.updatedAt).toBe("2026-07-17");
    expect(result.data.slug).toBe("cms-published-article");
    expect(result.revisionNumber).toBe(4);
    expect(result.visibility).toBe("unlisted");
  });

  it("fails closed when a restricted row reaches the public parser", () => {
    expect(() => parseCmsPublishedArticleRow({
      frontmatter_json: JSON.stringify(validFrontmatter),
      published_at: "2026-07-18T01:02:03.000Z",
      published_slug: "cms-published-article",
      published_visibility: "restricted",
      revision_created_at: "2026-07-17T05:06:07.000Z",
      revision_number: 1,
    }, "direct")).toThrow(/invalid for this audience/);
  });

  it("rejects a slug that diverges from the pinned revision", () => {
    expect(() => parseCmsPublishedArticleRow({
      frontmatter_json: JSON.stringify(validFrontmatter),
      published_at: "2026-07-18T01:02:03.000Z",
      published_slug: "different-slug",
      published_visibility: "public",
      revision_created_at: "2026-07-17T05:06:07.000Z",
      revision_number: 1,
    }, "listing")).toThrow(/does not match/);
  });
});

describe("published article series", () => {
  it("returns only the published public sequence and locates the current article", async () => {
    const rows = ["first", "current", "next"].map((slug, index) => ({
      frontmatter_json: JSON.stringify({
        ...validFrontmatter,
        slug,
        title: `${index + 1}番目の記事`,
      }),
      published_at: `2026-07-${18 + index}T01:02:03.000Z`,
      published_slug: slug,
      published_visibility: "public",
      revision_created_at: `2026-07-${17 + index}T05:06:07.000Z`,
      revision_number: index + 1,
    }));
    const db = {
      prepare(query: string) {
        const statement: CmsPublicationStatement = {
          bind() { return statement; },
          async first<T>() {
            const value = query.includes("current_article")
              ? { description: "順番に学ぶシリーズです。", id: "series-id", slug: "learning-path", title: "学習シリーズ" }
              : null;
            return value as T | null;
          },
          async all<T>() { return { results: rows as T[] }; },
        };
        return statement;
      },
    } satisfies CmsPublicationDatabase;

    const result = await getCmsPublishedSeriesByArticleSlug(db, "current");

    expect(result).toMatchObject({
      currentIndex: 1,
      description: "順番に学ぶシリーズです。",
      slug: "learning-path",
      title: "学習シリーズ",
    });
    expect(result?.items.map((item) => [item.slug, item.href])).toEqual([
      ["first", "/articles/first"],
      ["current", "/articles/current"],
      ["next", "/articles/next"],
    ]);
  });

  it("does not expose series data for an invalid or non-member article", async () => {
    let prepared = false;
    const db = {
      prepare() {
        prepared = true;
        const statement: CmsPublicationStatement = {
          bind() { return statement; },
          async first<T>() { return null as T | null; },
          async all<T>() { return { results: [] as T[] }; },
        };
        return statement;
      },
    } satisfies CmsPublicationDatabase;
    expect(await getCmsPublishedSeriesByArticleSlug(db, "../private")).toBeNull();
    expect(prepared).toBe(false);
    expect(await getCmsPublishedSeriesByArticleSlug(db, "not-a-member")).toBeNull();
  });
});
