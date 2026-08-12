import { describe, expect, it } from "vitest";
import { getCmsJourneyStatus } from "../src/CmsPublicationJourney";

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
});
