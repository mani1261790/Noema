import { describe, expect, it } from "vitest";
import {
  buildCmsBodyConflictBlocks,
  changedCmsMetadataFields,
  mergeCmsDraftOntoLatest,
  mergeCmsBodyConflictBlocks,
  mergeCmsConflictFrontmatter
} from "../src/cms-conflict";
import { createBlankArticle } from "../src/draft-storage";

describe("CMS conflict resolution", () => {
  it("splits body changes into selectable line blocks and preserves common text", () => {
    const latest = "## 共通\n\nCMSの段落\n\n末尾\n";
    const local = "## 共通\n\nブラウザの段落\n\n末尾\n";
    const blocks = buildCmsBodyConflictBlocks(local, latest);
    const choice = blocks.find((block) => block.kind === "choice");

    expect(choice).toMatchObject({
      latestText: "CMSの段落\n",
      localText: "ブラウザの段落\n"
    });
    expect(mergeCmsBodyConflictBlocks(blocks, {})).toBe(local);
    expect(mergeCmsBodyConflictBlocks(blocks, { [choice?.id ?? ""]: "latest" })).toBe(latest);
  });

  it("supports additions and deletions on either side", () => {
    const blocks = buildCmsBodyConflictBlocks("共通\nブラウザだけ\n", "共通\n");
    const choice = blocks.find((block) => block.kind === "choice");

    expect(choice).toMatchObject({ latestText: "", localText: "ブラウザだけ\n" });
    expect(mergeCmsBodyConflictBlocks(blocks, { [choice?.id ?? ""]: "latest" })).toBe("共通\n");
  });

  it("merges article information field by field", () => {
    const latest = { ...createBlankArticle("2026-08-20"), title: "CMSのタイトル", tags: ["CMS"] };
    const local = { ...latest, title: "ブラウザのタイトル", tags: ["ローカル"] };

    expect(changedCmsMetadataFields(local, latest)).toEqual(["title", "tags"]);
    expect(mergeCmsConflictFrontmatter(local, latest, { title: "latest" })).toMatchObject({
      title: "CMSのタイトル",
      tags: ["ローカル"]
    });
  });

  it("does not report object fields as changed when only their key order differs", () => {
    const latest = {
      ...createBlankArticle("2026-08-20"),
      heroImage: { alt: "説明", src: "/image.webp" }
    };
    const local = {
      ...latest,
      heroImage: { src: "/image.webp", alt: "説明" }
    };

    expect(changedCmsMetadataFields(local, latest)).toEqual([]);
  });

  it("removes an optional latest field when the browser-side field is absent", () => {
    const latest = { ...createBlankArticle("2026-08-20"), publishedAt: "2026-08-20" };
    const local = { ...latest, publishedAt: undefined };
    const merged = mergeCmsConflictFrontmatter(local, latest, {});

    expect(merged).not.toHaveProperty("publishedAt");
  });

  it("automatically merges non-overlapping browser and CMS changes", () => {
    const base = {
      body: "# 見出し\n\n## A\n\n元のA\n\n## B\n\n元のB\n",
      frontmatter: { ...createBlankArticle("2026-08-20"), title: "元のタイトル" },
      visibility: "public" as const
    };
    const result = mergeCmsDraftOntoLatest({
      base,
      local: {
        ...base,
        body: "# 見出し\n\n## A\n\nブラウザのA\n\n## B\n\n元のB\n"
      },
      latest: {
        ...base,
        body: "# 見出し\n\n## A\n\n元のA\n\n## B\n\nCMSのB\n",
        frontmatter: { ...base.frontmatter, description: "CMSで更新した概要" }
      }
    });

    expect(result).toMatchObject({ kind: "merged", conflicts: { body: false } });
    expect(result.draft.body).toContain("ブラウザのA");
    expect(result.draft.body).toContain("CMSのB");
    expect(result.draft.frontmatter.description).toBe("CMSで更新した概要");
  });

  it("keeps browser input recoverable when both sides edit the same line", () => {
    const base = {
      body: "## 共通\n\n元の本文\n\n## 末尾\n\n元の末尾\n",
      frontmatter: { ...createBlankArticle("2026-08-20"), title: "元のタイトル" },
      visibility: "public" as const
    };
    const result = mergeCmsDraftOntoLatest({
      base,
      local: {
        ...base,
        body: "## 共通\n\nブラウザの本文\n\n## 末尾\n\n元の末尾\n",
        frontmatter: { ...base.frontmatter, title: "ブラウザのタイトル" }
      },
      latest: {
        ...base,
        body: "## 共通\n\nCMSの本文\n\n## 末尾\n\nCMSの末尾\n",
        frontmatter: { ...base.frontmatter, title: "CMSのタイトル" }
      }
    });

    expect(result).toMatchObject({
      kind: "conflict",
      conflicts: { body: true, metadataFields: ["title"], visibility: false }
    });
    expect(result.draft.body).toContain("ブラウザの本文");
    expect(result.draft.body).toContain("CMSの末尾");
    expect(result.draft.frontmatter.title).toBe("ブラウザのタイトル");
  });

  it("uses the changed side for visibility and flags only competing choices", () => {
    const frontmatter = createBlankArticle("2026-08-20");
    const oneSided = mergeCmsDraftOntoLatest({
      base: { body: "", frontmatter, visibility: "public" },
      local: { body: "", frontmatter, visibility: "public" },
      latest: { body: "", frontmatter, visibility: "unlisted" }
    });
    const competing = mergeCmsDraftOntoLatest({
      base: { body: "", frontmatter, visibility: "public" },
      local: { body: "", frontmatter, visibility: "internal" },
      latest: { body: "", frontmatter, visibility: "unlisted" }
    });

    expect(oneSided).toMatchObject({ kind: "merged", draft: { visibility: "unlisted" } });
    expect(competing).toMatchObject({
      kind: "conflict",
      conflicts: { visibility: true },
      draft: { visibility: "internal" }
    });
  });
});
