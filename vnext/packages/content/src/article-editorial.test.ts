import { describe, expect, it } from "vitest";
import { articleEditorialWarnings } from "./article-editorial";

describe("editorial warnings", () => {
  it("detects prose and text-fence equations with original line numbers", () => {
    const markdown = "## 平均\n\nx₁ = 2\n\n```text\nx = 1 + 2\n```\n\n平均 = 6 ÷ 3";
    expect(articleEditorialWarnings({ title: "統計①", markdown }).map(w => [w.code, w.path])).toEqual([
      ["title-numbering", ["frontmatter", "title"]],
      ["plain-math", ["markdown", 3]],
      ["plain-math", ["markdown", 6]],
      ["plain-math", ["markdown", 9]]
    ]);
  });
  it("excludes TeX, real code, URLs, prices and inline commands", () => {
    const markdown = '## 例\n\n$x = 2$\n\n$$\nx_1 = 3\n$$\n\n```js\nconst x = 2;\n```\n\n`x=2`、https://example.com/?x=2、価格は$20、500円です。';
    expect(articleEditorialWarnings({ title: "Python 3とショートカット10個", markdown })).toEqual([]);
  });
  it.each(["構造⓪", "第12回 入門", "入門 Part 2", "第３章 入門"])("warns for %s", title => {
    expect(articleEditorialWarnings({ title, markdown: "本文" })[0]?.code).toBe("title-numbering");
  });
  it("reports the correct line in lists and multiline paragraphs", () => {
    expect(articleEditorialWarnings({ title: "数式", markdown: '## 式\n\n説明\nx = 3\n\n- 例\n- √2 を使う' }).map(w => w.path)).toEqual([["markdown", 4], ["markdown", 7]]);
  });
});
