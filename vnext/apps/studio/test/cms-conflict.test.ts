import { describe, expect, it } from "vitest";
import {
  buildCmsBodyConflictBlocks,
  changedCmsMetadataFields,
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
});
