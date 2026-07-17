import type { CmsVisibility } from "@noema/cms";
import { describe, expect, it } from "vitest";
import {
  isCmsPublicationVisible,
  parseCmsPublishedArticleRow,
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
