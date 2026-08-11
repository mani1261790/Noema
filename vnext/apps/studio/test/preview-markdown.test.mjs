import assert from "node:assert/strict";
import test from "node:test";
import {
  createPreviewMarkdown,
  resolvePreviewImageReference,
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

test("uses the authenticated Studio route for uploaded draft images", () => {
  assert.equal(
    resolvePreviewImageReference(
      "/media/articles/00000000-0000-4000-8000-000000000000.png",
      publicSiteUrl
    ),
    "/api/cms/assets/articles/00000000-0000-4000-8000-000000000000.png"
  );
});

test("highlights known fenced code and safely renders unknown languages", () => {
  const markdown = createPreviewMarkdown(publicSiteUrl);
  const known = markdown.render("```ts\nconst answer: number = 42;\n```");
  const unknown = markdown.render("```not-a-language\n<tag>\n```");

  assert.match(known, /class="hljs-keyword"/);
  assert.match(known, /class="hljs-number"/);
  assert.match(unknown, /&lt;tag&gt;/);
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

  assert.match(
    rendered,
    /href="https:\/\/blog\.example\/articles\/example" target="_blank" rel="noreferrer"/
  );
  assert.match(rendered, /href="#section">見出し<\/a>/);
  assert.match(
    rendered,
    /href="https:\/\/example\.com\/" target="_blank" rel="noreferrer"/
  );
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
