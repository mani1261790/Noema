import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsArticleDetail } from "@noema/cms";
import {
  canStartPublishedRevision,
  CmsPublishedRevisionStarter
} from "../src/CmsPublishedRevisionStarter";

const publishedArticle = {
  publicationStatus: "published",
  publishedRevisionNumber: 4,
  reviewStatus: "approved",
  revisionNumber: 4
} as CmsArticleDetail;

describe("CmsPublishedRevisionStarter", () => {
  it("offers one clear path from the live revision to a new draft revision", () => {
    const html = renderToStaticMarkup(createElement(CmsPublishedRevisionStarter, {
      article: publishedArticle,
      busy: false,
      canEdit: true,
      onStart: () => undefined
    }));

    expect(html).toContain("revision 4 は現在公開中です");
    expect(html).toContain("読者向けの内容を変えずに");
    expect(html).toContain("新しいrevision 5を作る");
  });

  it("stays hidden without edit permission or when a newer draft already exists", () => {
    expect(canStartPublishedRevision(publishedArticle, false)).toBe(false);
    expect(canStartPublishedRevision({
      ...publishedArticle,
      publishedRevisionNumber: 3,
      reviewStatus: "draft"
    }, true)).toBe(false);
  });
});
