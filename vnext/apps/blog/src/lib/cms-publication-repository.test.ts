import type { CmsVisibility } from "@noema/cms";
import { describe, expect, it } from "vitest";
import {
  getCmsArticleLinkAvailability,
  getCmsPublishedSeriesByArticleSlug,
  getCmsPublishedSeriesBySlug,
  getCmsPublishedEditorProfile,
  getCmsPublishedArticleRedirect,
  isCmsPublicationVisible,
  listCmsPublishedEditors,
  listCmsPublishedSeries,
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
      editor_display_name: "山田 編集",
      editor_public_id: "0123456789abcdef0123456789abcdef",
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
    expect(result.publishedAt).toBe("2026-07-18T01:02:03.000Z");
    expect(result.revisionNumber).toBe(4);
    expect(result.updatedAt).toBe("2026-07-17T05:06:07.000Z");
    expect(result.visibility).toBe("unlisted");
    expect(result.editor).toEqual({
      displayName: "山田 編集",
      href: "/editors/0123456789abcdef0123456789abcdef",
      publicId: "0123456789abcdef0123456789abcdef",
    });
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

describe("article link availability", () => {
  it("only marks destinations available when their published visibility is readable from the source", async () => {
    const rows = [
      { publication_status: "published", published_slug: "public-target", published_visibility: "public", slug: "public-target" },
      { publication_status: "published", published_slug: "unlisted-target", published_visibility: "unlisted", slug: "unlisted-target" },
      { publication_status: "unpublished", published_slug: null, published_visibility: null, slug: "future-target" },
    ];
    const db = {
      prepare(query: string) {
        const statement: CmsPublicationStatement = {
          bind() { return statement; },
          async first<T>() { return null as T | null; },
          async all<T>() {
            return { results: (query.includes("cms_article_slug_redirects")
              ? [{ old_slug: "historical-target", publication_status: "published", published_visibility: "public" }]
              : rows) as T[] };
          },
        };
        return statement;
      },
    } satisfies CmsPublicationDatabase;

    await expect(getCmsArticleLinkAvailability(
      db,
      ["public-target", "unlisted-target", "future-target", "historical-target", "missing-target"],
      "public",
    )).resolves.toEqual(new Map([
      ["public-target", "available"],
      ["unlisted-target", "unavailable"],
      ["future-target", "unavailable"],
      ["historical-target", "available"],
      ["missing-target", "unavailable"],
    ]));

    const unlistedSource = await getCmsArticleLinkAvailability(db, ["unlisted-target"], "unlisted");
    expect(unlistedSource.get("unlisted-target")).toBe("available");
  });
});

describe("published article redirects", () => {
  it("redirects a historical slug only while its article remains published", async () => {
    const db = {
      prepare() {
        const statement: CmsPublicationStatement = {
          bind() { return statement; },
          async first<T>() { return { published_slug: "new-slug" } as T; },
          async all<T>() { return { results: [] as T[] }; },
        };
        return statement;
      },
    } satisfies CmsPublicationDatabase;

    await expect(getCmsPublishedArticleRedirect(db, "old-slug")).resolves.toBe("new-slug");
  });

  it("rejects noncanonical historical slugs without querying the database", async () => {
    let prepared = false;
    const db = { prepare() { prepared = true; throw new Error("unexpected query"); } } as unknown as CmsPublicationDatabase;
    await expect(getCmsPublishedArticleRedirect(db, "../private")).resolves.toBeNull();
    expect(prepared).toBe(false);
  });
});

describe("published editor profiles", () => {
  it("uses the latest profile or public article revision for editor sitemap freshness", async () => {
    const db = {
      prepare(query: string) {
        expect(query).toContain("m.updated_at > MAX(r.created_at)");
        const statement: CmsPublicationStatement = {
          bind() { return statement; },
          async first<T>() { return null as T | null; },
          async all<T>() {
            return { results: [{
              display_name: "山田 編集",
              public_id: "0123456789abcdef0123456789abcdef",
              updated_at: "2026-08-28T01:02:03.000Z",
            }] as T[] };
          },
        };
        return statement;
      },
    } satisfies CmsPublicationDatabase;

    await expect(listCmsPublishedEditors(db)).resolves.toEqual([{
      displayName: "山田 編集",
      href: "/editors/0123456789abcdef0123456789abcdef",
      publicId: "0123456789abcdef0123456789abcdef",
      updatedAt: "2026-08-28",
    }]);
  });

  it("lists only public articles saved by the selected editor", async () => {
    const row = {
      editor_display_name: "山田 編集",
      editor_public_id: "0123456789abcdef0123456789abcdef",
      frontmatter_json: JSON.stringify(validFrontmatter),
      published_at: "2026-07-18T01:02:03.000Z",
      published_slug: "cms-published-article",
      published_visibility: "public",
      revision_created_at: "2026-07-17T05:06:07.000Z",
      revision_number: 4,
    };
    const db = {
      prepare(query: string) {
        const statement: CmsPublicationStatement = {
          bind() { return statement; },
          async first<T>() {
            return (query.includes("FROM cms_members")
              ? { display_name: "山田 編集", public_id: "0123456789abcdef0123456789abcdef", subject: "editor-subject" }
              : null) as T | null;
          },
          async all<T>() { return { results: [row] as T[] }; },
        };
        return statement;
      },
    } satisfies CmsPublicationDatabase;

    const profile = await getCmsPublishedEditorProfile(db, "0123456789abcdef0123456789abcdef");
    expect(profile).toMatchObject({ displayName: "山田 編集" });
    expect(profile?.articles.map((article) => article.slug)).toEqual(["cms-published-article"]);
  });

  it("rejects public IDs outside the opaque identifier contract", async () => {
    let prepared = false;
    const db = { prepare() { prepared = true; throw new Error("unexpected query"); } } as unknown as CmsPublicationDatabase;
    expect(await getCmsPublishedEditorProfile(db, "editor@example.com")).toBeNull();
    expect(prepared).toBe(false);
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
              ? { description: "順番に学ぶシリーズです。", id: "series-id", slug: "learning-path", title: "学習シリーズ", updated_at: "2026-07-21T00:00:00.000Z" }
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
      href: "/series/learning-path",
      slug: "learning-path",
      title: "学習シリーズ",
      updatedAt: "2026-07-21",
    });
    expect(result?.items.map((item) => [item.slug, item.href])).toEqual([
      ["first", "/articles/first"],
      ["current", "/articles/current"],
      ["next", "/articles/next"],
    ]);
  });

  it("groups public articles into ordered public series", async () => {
    const rows = [
      ["series-a", "first", "2026-07-18"],
      ["series-a", "second", "2026-07-19"],
      ["series-b", "other", "2026-07-20"],
    ].map(([seriesId, slug, date], index) => ({
      series_description: `${seriesId}の説明`,
      series_id: seriesId,
      series_slug: seriesId,
      series_title: `${seriesId}のタイトル`,
      series_updated_at: seriesId === "series-a"
        ? "2026-07-21T03:02:03.000Z"
        : "2026-07-22T03:02:03.000Z",
      frontmatter_json: JSON.stringify({ ...validFrontmatter, slug, title: `${slug}の記事` }),
      published_at: `${date}T01:02:03.000Z`,
      published_slug: slug,
      published_visibility: "public",
      revision_created_at: `${date}T00:02:03.000Z`,
      revision_number: index + 1,
    }));
    const db = {
      prepare() {
        const statement: CmsPublicationStatement = {
          bind() { return statement; },
          async first<T>() { return null as T | null; },
          async all<T>() { return { results: rows as T[] }; },
        };
        return statement;
      },
    } satisfies CmsPublicationDatabase;

    const result = await listCmsPublishedSeries(db);
    expect(result.map((series) => [series.slug, series.href, series.updatedAt, series.items.map((item) => item.slug)])).toEqual([
      ["series-a", "/series/series-a", "2026-07-21", ["first", "second"]],
      ["series-b", "/series/series-b", "2026-07-22", ["other"]],
    ]);
  });

  it("loads a public series by canonical slug and rejects invalid slugs", async () => {
    let calls = 0;
    const row = {
      series_description: "順番に学ぶシリーズです。",
      series_id: "series-id",
      series_slug: "learning-path",
      series_title: "学習シリーズ",
      series_updated_at: "2026-07-21T03:02:03.000Z",
      frontmatter_json: JSON.stringify({ ...validFrontmatter, slug: "first" }),
      published_at: "2026-07-18T01:02:03.000Z",
      published_slug: "first",
      published_visibility: "public",
      revision_created_at: "2026-07-17T05:06:07.000Z",
      revision_number: 1,
    };
    const db = {
      prepare() {
        calls += 1;
        const statement: CmsPublicationStatement = {
          bind() { return statement; },
          async first<T>() { return null as T | null; },
          async all<T>() { return { results: [row] as T[] }; },
        };
        return statement;
      },
    } satisfies CmsPublicationDatabase;

    await expect(getCmsPublishedSeriesBySlug(db, "learning-path")).resolves.toMatchObject({
      href: "/series/learning-path",
      slug: "learning-path",
      updatedAt: "2026-07-21",
    });
    await expect(getCmsPublishedSeriesBySlug(db, "../private")).resolves.toBeNull();
    expect(calls).toBe(1);
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
