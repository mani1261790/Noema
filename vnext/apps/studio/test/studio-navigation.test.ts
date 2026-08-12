import { describe, expect, it } from "vitest";
import { readStudioView, studioViewHref } from "../src/studio-navigation";

describe("Studio navigation", () => {
  it("gives every Studio page a stable URL", () => {
    expect(studioViewHref("articles")).toBe("/articles");
    expect(studioViewHref("editor")).toBe("/editor");
    expect(studioViewHref("assets")).toBe("/assets");
    expect(studioViewHref("team")).toBe("/team");
  });

  it("restores a Studio page from browser history", () => {
    expect(readStudioView("/assets", "articles")).toBe("assets");
    expect(readStudioView("/editor/", "articles")).toBe("editor");
  });

  it("keeps the safe initial page for an unknown route", () => {
    expect(readStudioView("/unknown", "articles")).toBe("articles");
    expect(readStudioView("", "editor")).toBe("editor");
  });
});
