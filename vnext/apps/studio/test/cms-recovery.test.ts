import { describe, expect, it } from "vitest";
import type { CmsArticleDetail } from "@noema/cms";
import { resolveCmsRecoveryState } from "../src/cms-recovery";
import { createBlankArticle, type StudioDraftCmsArticle } from "../src/draft-storage";

const frontmatter = {
  ...createBlankArticle("2026-07-18"),
  title: "復旧する記事",
  slug: "recovery-article"
};

function article(lockVersion: number): CmsArticleDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    lockVersion,
    publicationStatus: "unpublished",
    revisionNumber: lockVersion,
    reviewStatus: "draft",
    slug: frontmatter.slug,
    title: frontmatter.title,
    updatedAt: "2026-07-18T00:00:00.000Z",
    updatedByEmail: "editor@example.com",
    visibility: "public",
    currentRevision: {
      createdAt: "2026-07-18T00:00:00.000Z",
      createdByEmail: "editor@example.com",
      frontmatter,
      id: "22222222-2222-4222-8222-222222222222",
      markdown: "## CMSの本文",
      number: lockVersion
    },
    publishedRevisionNumber: null,
    publishedSlug: null,
    publishedVisibility: null,
    reviewNote: null
  };
}

function reference(lockVersion: number): StudioDraftCmsArticle {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    lockVersion,
    visibility: "public"
  };
}

describe("resolveCmsRecoveryState", () => {
  it("reattaches unchanged content even when only workflow metadata advanced", () => {
    expect(resolveCmsRecoveryState({
      article: article(5),
      localBody: "## CMSの本文",
      localFrontmatter: frontmatter,
      localVisibility: "public",
      reference: reference(4)
    }).saveState).toBe("saved");
  });

  it("marks local changes dirty when the base article has not advanced", () => {
    expect(resolveCmsRecoveryState({
      article: article(4),
      localBody: "## ブラウザで変更した本文",
      localFrontmatter: frontmatter,
      localVisibility: "public",
      reference: reference(4)
    })).toMatchObject({ conflict: false, saveState: "dirty" });
  });

  it("blocks automatic saving when local content and the CMS article both changed", () => {
    expect(resolveCmsRecoveryState({
      article: article(5),
      localBody: "## ブラウザで変更した本文",
      localFrontmatter: frontmatter,
      localVisibility: "public",
      reference: reference(4)
    })).toMatchObject({ conflict: true, saveState: "conflict" });
  });
});
