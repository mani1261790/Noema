import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownEditor } from "../src/MarkdownEditor";

describe("MarkdownEditor", () => {
  it("renders one-based line numbers beside every Markdown source line", () => {
    const html = renderToStaticMarkup(createElement(MarkdownEditor, {
      "aria-label": "Markdown本文",
      onChange: () => undefined,
      value: "1行目\n\n3行目"
    }));

    expect(html).toContain("studio-markdown-editor__line-numbers");
    expect(html).toContain(">1\n2\n3</div>");
    expect(html).toContain('wrap="off"');
    expect(html).toContain("1行目\n\n3行目");
  });
});
