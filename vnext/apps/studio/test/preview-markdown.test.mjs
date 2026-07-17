import assert from "node:assert/strict";
import test from "node:test";
import {
  createPreviewMarkdown,
  resolvePublicSiteReference
} from "../src/preview-markdown.ts";

const publicSiteUrl = "https://blog.example/preview";

test("resolves only root-relative public-site references", () => {
  assert.equal(
    resolvePublicSiteReference("/images/article.png", publicSiteUrl),
    "https://blog.example/images/article.png"
  );

  for (const reference of [
    "#section",
    "image.png",
    "../image.png",
    "https://cdn.example/image.png",
    "mailto:editor@example.com",
    "tel:+81123456789",
    "//cdn.example/image.png"
  ]) {
    assert.equal(resolvePublicSiteReference(reference, publicSiteUrl), reference);
  }
});

test("rewrites inline and reference images without replacing the default image renderer", () => {
  const markdown = createPreviewMarkdown(publicSiteUrl);
  const inline = markdown.render('![強調 *された* alt](/images/a.png "A & B")');
  const reference = markdown.render("![図][image]\n\n[image]: /images/b.png \"Title\"");

  assert.match(inline, /src="https:\/\/blog\.example\/images\/a\.png"/);
  assert.match(inline, /alt="強調 された alt"/);
  assert.match(inline, /title="A &amp; B"/);
  assert.match(reference, /src="https:\/\/blog\.example\/images\/b\.png"/);
  assert.match(reference, /alt="図"/);
});

test("rewrites internal links while preserving fragments and external links", () => {
  const markdown = createPreviewMarkdown(publicSiteUrl);
  const rendered = markdown.render([
    "[記事](/articles/example)",
    "[見出し](#section)",
    "[外部](https://example.com/)",
    "[メール](mailto:editor@example.com)",
    "[電話](tel:+81123456789)",
    "[CDN](//cdn.example/path)"
  ].join(" "));

  assert.match(rendered, /href="https:\/\/blog\.example\/articles\/example"/);
  assert.match(rendered, /href="#section"/);
  assert.match(rendered, /href="https:\/\/example\.com\/"/);
  assert.match(rendered, /href="mailto:editor@example\.com"/);
  assert.match(rendered, /href="tel:\+81123456789"/);
  assert.match(rendered, /href="\/\/cdn\.example\/path"/);
});

test("keeps raw HTML disabled while applying preview URL rules", () => {
  const rendered = createPreviewMarkdown(publicSiteUrl).render(
    '<img src="/images/a.png" onerror="alert(1)">'
  );

  assert.match(rendered, /&lt;img/);
  assert.doesNotMatch(rendered, /<img/);
});
