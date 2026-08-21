import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CmsPublicationJourney, getCmsJourneyStatus } from "../src/CmsPublicationJourney";

describe("getCmsJourneyStatus", () => {
  it("maps CMS state to the four visible stages", () => {
    expect(getCmsJourneyStatus("draft", "unpublished")).toMatchObject({ label: "下書き", step: 0 });
    expect(getCmsJourneyStatus("changes_requested", "unpublished")).toMatchObject({ label: "要修正", step: 0 });
    expect(getCmsJourneyStatus("in_review", "unpublished")).toMatchObject({ label: "レビュー中", step: 1 });
    expect(getCmsJourneyStatus("approved", "unpublished")).toMatchObject({ label: "承認済み", step: 2 });
    expect(getCmsJourneyStatus("approved", "published")).toMatchObject({ label: "公開中", step: 3 });
  });

  it("distinguishes a live revision from its new working draft", () => {
    expect(getCmsJourneyStatus("draft", "published")).toEqual({
      detail: "現在の公開版はそのまま",
      label: "公開中・新しい版は下書き",
      step: 0
    });
  });

  it("distinguishes the live revision from a newer approved revision", () => {
    expect(getCmsJourneyStatus("approved", "published", false)).toEqual({
      detail: "現在の公開版はそのまま",
      label: "公開中・新しい版は承認済み",
      step: 2
    });
  });

  it("shows an archived article as completed without marking publish as current", () => {
    const html = renderToStaticMarkup(createElement(CmsPublicationJourney, {
      publicationStatus: "archived",
      reviewStatus: "approved"
    }));

    expect(html).toContain("公開終了");
    expect(html.match(/is-complete/g)).toHaveLength(4);
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain("is-current");
  });
});
