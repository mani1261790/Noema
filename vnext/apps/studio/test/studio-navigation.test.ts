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
    expect(readStudioView("/assets")).toBe("assets");
    expect(readStudioView("/editor/")).toBe("editor");
  });

  it("uses the article library as the safe landing page", () => {
    expect(readStudioView("/")).toBe("articles");
    expect(readStudioView("")).toBe("articles");
    expect(readStudioView("/unknown")).toBe("articles");
  });
});
