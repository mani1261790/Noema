import { describe, expect, it } from "vitest";
import {
  articleJsonLd,
  breadcrumbJsonLd,
  canonicalPathname,
  canonicalUrl,
  collectionPageJsonLd,
  organizationJsonLd,
  resolveOpenGraphImageDimensions,
  serializeJsonLd,
  serializeSitemap,
  websiteJsonLd,
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

  it("provides a unique domain fallback when the preferred site name is unavailable", () => {
    expect(websiteJsonLd()).toEqual({
      "@id": "https://noema-learn.uk/#website",
      "@type": "WebSite",
      name: "Noema",
      alternateName: "noema-learn.uk",
      url: "https://noema-learn.uk/",
    });
  });

  it("uses canonical URLs, exact CMS timestamps, and the article image in BlogPosting data", () => {
    expect(articleJsonLd({
      authors: [{ name: "編集者", url: "/editors/example/" }],
      description: "記事の説明",
      headline: "記事タイトル",
      image: {
        height: 675,
        src: "/media/articles/example.webp",
        width: 1200,
      },
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
      image: [{
        "@type": "ImageObject",
        contentUrl: "https://noema-learn.uk/media/articles/example.webp",
        height: 675,
        url: "https://noema-learn.uk/media/articles/example.webp",
        width: 1200,
      }],
      mainEntityOfPage: "https://noema-learn.uk/articles/example",
      isPartOf: {
        "@id": "https://noema-learn.uk/#website",
        "@type": "WebSite",
        alternateName: "noema-learn.uk",
        name: "Noema",
        url: "https://noema-learn.uk/",
      },
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

  it("uses known dimensions for custom Open Graph images and preserves the default image size", () => {
    expect(resolveOpenGraphImageDimensions({ hasCustomImage: false })).toEqual({
      height: 630,
      width: 1200,
    });
    expect(resolveOpenGraphImageDimensions({
      hasCustomImage: true,
      height: 900,
      width: 1600,
    })).toEqual({ height: 900, width: 1600 });
    expect(resolveOpenGraphImageDimensions({
      hasCustomImage: true,
      width: 1600,
    })).toBeNull();
  });

  it("keeps URL-only article images compatible when dimensions are unavailable", () => {
    const jsonLd = articleJsonLd({
      authors: [{ name: "編集者" }],
      description: "記事の説明",
      headline: "記事タイトル",
      image: {
        src: "/media/articles/example.webp",
      },
      pathname: "/articles/example/",
      publishedAt: "2026-08-20T01:02:03.000Z",
      updatedAt: "2026-08-26T04:05:06.000Z",
    });

    expect(jsonLd.image).toEqual([
      "https://noema-learn.uk/media/articles/example.webp",
    ]);
  });

  it("describes a collection page with an ordered list of canonical items", () => {
    expect(collectionPageJsonLd({
      description: "記事をテーマから探せます。",
      items: [
        { name: "最初の記事", pathname: "/articles/first/" },
        { name: "次の記事", pathname: "/articles/next" },
      ],
      name: "記事を読む",
      pathname: "/articles/",
    })).toEqual({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      description: "記事をテーマから探せます。",
      inLanguage: "ja",
      mainEntity: {
        "@type": "ItemList",
        itemListElement: [
          {
            "@type": "ListItem",
            name: "最初の記事",
            position: 1,
            url: "https://noema-learn.uk/articles/first",
          },
          {
            "@type": "ListItem",
            name: "次の記事",
            position: 2,
            url: "https://noema-learn.uk/articles/next",
          },
        ],
        numberOfItems: 2,
      },
      name: "記事を読む",
      url: "https://noema-learn.uk/articles",
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
