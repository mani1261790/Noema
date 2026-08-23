import { describe, expect, it } from "vitest";
import {
  readStudioEditorArticleId,
  readStudioView,
  resolveInitialStudioEditorArticleId,
  studioEditorHref,
  studioViewHref
} from "../src/studio-navigation";

describe("Studio navigation", () => {
  it("gives every Studio page a stable URL", () => {
    expect(studioViewHref("articles")).toBe("/articles");
    expect(studioViewHref("analytics")).toBe("/analytics");
    expect(studioViewHref("editor")).toBe("/editor");
    expect(studioViewHref("assets")).toBe("/assets");
    expect(studioViewHref("team")).toBe("/team");
  });

  it("restores a Studio page from browser history", () => {
    expect(readStudioView("/assets")).toBe("assets");
    expect(readStudioView("/analytics/")).toBe("analytics");
    expect(readStudioView("/editor/")).toBe("editor");
    expect(readStudioView("/series")).toBe("articles");
  });

  it("deep-links the editor to the selected CMS article", () => {
    expect(studioEditorHref("11111111-1111-4111-8111-111111111111")).toBe(
      "/editor?article=11111111-1111-4111-8111-111111111111"
    );
    expect(readStudioEditorArticleId(
      "/editor",
      "?article=11111111-1111-4111-8111-111111111111"
    )).toBe("11111111-1111-4111-8111-111111111111");
    expect(readStudioEditorArticleId("/articles", "?article=article-id")).toBeNull();
    expect(readStudioEditorArticleId("/editor", "?article=")).toBeNull();
    expect(readStudioEditorArticleId("/editor", `?article=${"a".repeat(129)}`)).toBeNull();
  });

  it("uses the article library as the safe landing page", () => {
    expect(readStudioView("/")).toBe("articles");
    expect(readStudioView("")).toBe("articles");
    expect(readStudioView("/unknown")).toBe("articles");
  });
});

describe("initial editor article", () => {
  it("prefers an unsaved recovery reference", () => {
    expect(resolveInitialStudioEditorArticleId({
      pathname: "/editor",
      recoveryArticleId: "recovery-id",
      rememberedArticleId: "remembered-id",
      search: "?article=url-id"
    })).toBe("recovery-id");
  });

  it("uses the URL before the remembered article", () => {
    expect(resolveInitialStudioEditorArticleId({
      pathname: "/editor",
      recoveryArticleId: null,
      rememberedArticleId: "remembered-id",
      search: "?article=url-id"
    })).toBe("url-id");
  });

  it("restores the remembered article on a plain editor reload", () => {
    expect(resolveInitialStudioEditorArticleId({
      pathname: "/editor",
      recoveryArticleId: null,
      rememberedArticleId: "remembered-id",
      search: ""
    })).toBe("remembered-id");
  });

  it("does not restore an editor article on another Studio view", () => {
    expect(resolveInitialStudioEditorArticleId({
      pathname: "/articles",
      recoveryArticleId: "recovery-id",
      rememberedArticleId: "remembered-id",
      search: "?article=url-id"
    })).toBeNull();
  });
});
