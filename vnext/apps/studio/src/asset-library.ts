import type { CmsAsset } from "@noema/cms";

export type CmsAssetFilter = "all" | "used" | "unused" | "missing-alt" | "archived";

export const cmsAssetFilterOptions: Array<{ label: string; value: CmsAssetFilter }> = [
  { label: "すべて", value: "all" },
  { label: "使用中", value: "used" },
  { label: "未使用", value: "unused" },
  { label: "alt未設定", value: "missing-alt" },
  { label: "削除待ち", value: "archived" }
];

export function filterCmsAssets(
  assets: CmsAsset[],
  query: string,
  filter: CmsAssetFilter
): CmsAsset[] {
  const normalized = query.trim().toLocaleLowerCase("ja-JP");
  return assets.filter((asset) => {
    const matchesFilter = filter === "archived"
      ? asset.status === "archived"
      : asset.status === "active" && (
          filter === "all" ||
          (filter === "used" && asset.referenceCount > 0) ||
          (filter === "unused" && asset.referenceCount === 0) ||
          (filter === "missing-alt" && asset.alt.trim().length === 0)
        );
    if (!matchesFilter) return false;
    if (!normalized) return true;
    return [asset.originalName, asset.alt, asset.contentType, ...asset.tags]
      .join("\n")
      .toLocaleLowerCase("ja-JP")
      .includes(normalized);
  });
}

export function formatAssetBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("ja-JP", { maximumFractionDigits: 1 })} MB`;
}
