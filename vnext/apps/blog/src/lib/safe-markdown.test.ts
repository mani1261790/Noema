import { createSatteriMarkdownProcessor } from "@astrojs/markdown-satteri";
import { extractArticleHeadingSlugs } from "@noema/content";
import { markdownToHtml } from "satteri";
import { describe, expect, it } from "vitest";
import {
  articleMarkdownFeatures,
  hardenArticleHtml,
  hardenArticleMarkdown,
} from "./safe-markdown";

const render = (source: string) =>
  markdownToHtml(source, {
    features: articleMarkdownFeatures,
    mdastPlugins: [hardenArticleMarkdown],
    hastPlugins: [hardenArticleHtml],
  }).html;

describe("hardenArticleMarkdown", () => {
  it("renders raw HTML as text instead of executable markup", () => {
    const html = render("before <script>alert(1)</script> after");

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("does not escape HTML examples in code fences", () => {
    const html = render("```html\n<script>alert(1)</script>\n```");

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<pre>");
  });

  it.each([
    "[direct](javascript:alert(1))",
    "[encoded](java&#x73;cript:alert(1))",
    "[mixed](JaVaScRiPt:alert(1))",
    "[data](data:text/html;base64,PHNjcmlwdD4=)",
    "<javascript:alert(1)>",
    "[reference][danger]\n\n[danger]: vbscript:msgbox(1)",
  ])("makes an unsafe link destination inert: %s", (source) => {
    const html = render(source);

    expect(html).not.toMatch(/(?:href|src)=["'](?:javascript|vbscript|data):/i);
  });

  it("removes images with unsafe destinations", () => {
    const html = render("![説明](data:image/svg+xml,<svg></svg>)");

    expect(html).not.toContain("<img");
    expect(html).toContain("説明");
  });

  it("applies the image policy after resolving reference definitions", () => {
    const html = render("![説明][image]\n\n[image]: mailto:editor@example.com");

    expect(html).not.toContain("<img");
    expect(html).toContain("説明");
  });

  it("preserves safe site and https destinations", () => {
    const html = render(
      "[site](/articles/example) [external](https://example.com) ![図](/images/example.png)",
    );

    expect(html).toContain('href="/articles/example"');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('src="/images/example.png"');
  });

  it("keeps Astro heading IDs aligned with the shared validator", async () => {
    const source = "## Foo -- bar\n\n## foo---bar";
    const renderer = await createSatteriMarkdownProcessor({
      features: articleMarkdownFeatures,
      mdastPlugins: [hardenArticleMarkdown],
      hastPlugins: [hardenArticleHtml],
      syntaxHighlight: false,
    });
    const result = await renderer.render(source);

    expect(result.metadata.headings.map((heading) => heading.slug)).toEqual(
      extractArticleHeadingSlugs(source),
    );
  });
});
