import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CmsAsset } from "@noema/cms";
import { AssetDetails } from "../src/CmsAssetLibrary";

const asset: CmsAsset = {
  alt: "Studioの画面",
  byteSize: 2048,
  contentType: "image/png",
  createdAt: "2026-08-21T00:00:00.000Z",
  createdByEmail: "owner@example.com",
  height: null,
  id: "asset-1",
  markdownUrl: "/media/articles/asset-1.png",
  originalName: "studio.png",
  previewUrl: "/api/cms/assets/articles/asset-1.png",
  referenceCount: 0,
  status: "active",
  tags: ["Studio"],
  updatedAt: "2026-08-21T00:00:00.000Z",
  width: null
};

const props: ComponentProps<typeof AssetDetails> = {
  asset,
  busy: false,
  canEdit: true,
  onDelete: async () => undefined,
  onUpdate: async () => undefined
};

describe("CmsAssetLibrary", () => {
  it("presents permanent deletion instead of archiving", () => {
    const html = renderToStaticMarkup(createElement(AssetDetails, props));

    expect(html).toContain("完全に削除");
    expect(html).toContain("R2上のファイルが消え、元に戻せません");
    expect(html).not.toContain(">アーカイブ</button>");
  });

  it("disables deletion while the image is referenced", () => {
    const html = renderToStaticMarkup(createElement(AssetDetails, {
      ...props,
      asset: { ...asset, referenceCount: 2 }
    }));

    expect(html).toMatch(/disabled=""[^>]*>完全に削除<\/button>/);
    expect(html).toContain("記事から画像を外して保存してください");
  });
});
