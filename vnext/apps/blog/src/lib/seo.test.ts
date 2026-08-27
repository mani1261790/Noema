import { describe, expect, it } from "vitest";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  canonicalPathname,
  canonicalUrl,
  organizationJsonLd,
  serializeJsonLd,
  serializeSitemap,
} from "./seo";

describe("SEO helpers", () => {
  it("normalizes internal canonical URLs without changing the root URL", () => {
    expect(canonicalPathname("/")).toBe("/");
    expect(canonicalPathname("/articles/example///")).toBe("/articles/example");
    expect(canonicalUrl("/articles/?keyword=git#search").toString()).toBe(
      "https://noema-learn.uk/articles",
    );
  });

  it("creates a complete canonical breadcrumb trail", () => {
    expect(breadcrumbJsonLd([
      { href: "/", label: "ホーム" },
      { href: "/articles/", label: "記事" },
      { label: "テスト記事" },
    ], "/articles/test/")).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", item: "https://noema-learn.uk/", name: "ホーム", position: 1 },
        { "@type": "ListItem", item: "https://noema-learn.uk/articles", name: "記事", position: 2 },
        { "@type": "ListItem", item: "https://noema-learn.uk/articles/test", name: "テスト記事", position: 3 },
      ],
    });
  });

  it("identifies the preferred crawlable organization logo", () => {
    expect(organizationJsonLd()).toEqual({
      "@id": "https://noema-learn.uk/#organization",
      "@type": "Organization",
      name: "Noema",
      url: "https://noema-learn.uk/",
      logo: {
        "@type": "ImageObject",
        url: "https://noema-learn.uk/images/brand/noema-logo-512.png",
        contentUrl: "https://noema-learn.uk/images/brand/noema-logo-512.png",
        width: 512,
        height: 512,
      },
    });
  });

  it("uses canonical URLs, exact CMS timestamps, and the article image in BlogPosting data", () => {
    expect(articleJsonLd({
      authors: [{ name: "編集者", url: "/editors/example/" }],
      description: "記事の説明",
      headline: "記事タイトル",
      image: "/media/articles/example.webp",
      pathname: "/articles/example/",
      publishedAt: "2026-08-20T01:02:03.000Z",
      updatedAt: "2026-08-26T04:05:06.000Z",
    })).toMatchObject({
      "@type": "BlogPosting",
      author: [{
        "@type": "Person",
        name: "編集者",
        url: "https://noema-learn.uk/editors/example",
      }],
      dateModified: "2026-08-26T04:05:06.000Z",
      datePublished: "2026-08-20T01:02:03.000Z",
      image: ["https://noema-learn.uk/media/articles/example.webp"],
      mainEntityOfPage: "https://noema-learn.uk/articles/example",
      publisher: {
        logo: {
          contentUrl: "https://noema-learn.uk/images/brand/noema-logo-512.png",
          height: 512,
          url: "https://noema-learn.uk/images/brand/noema-logo-512.png",
          width: 512,
        },
      },
    });
  });

  it("serializes canonical sitemap URLs with accurate last-modified dates", () => {
    expect(serializeSitemap([
      { pathname: "/" },
      { lastModified: "2026-08-26", pathname: "/articles/example/" },
    ])).toContain(
      "<url><loc>https://noema-learn.uk/articles/example</loc><lastmod>2026-08-26</lastmod></url>",
    );
  });

  it("escapes JSON-LD script termination characters", () => {
    expect(serializeJsonLd({ name: "</script>" })).toBe('{"name":"\\u003c/script>"}');
  });
});
