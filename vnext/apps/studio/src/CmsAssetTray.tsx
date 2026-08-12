import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CmsAsset } from "@noema/cms";
import { filterCmsAssets } from "./asset-library";
import { StudioSurfaceHeader } from "./StudioSurfaceHeader";

export const noemaAssetDragType = "application/x-noema-asset";

export function CmsAssetTray({
  assets,
  busy,
  canEdit,
  onClose,
  onInsert,
  onManage,
  onUpload
}: {
  assets: CmsAsset[];
  busy: boolean;
  canEdit: boolean;
  onClose: () => void;
  onInsert: (asset: CmsAsset) => void;
  onManage: () => void;
  onUpload: (files: File[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const visibleAssets = useMemo(
    () => filterCmsAssets(assets, deferredQuery, "all"),
    [assets, deferredQuery]
  );

  useEffect(() => {
    searchInput.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <aside aria-labelledby="studio-asset-tray-heading" className="studio-asset-tray" id="studio-asset-tray">
      <StudioSurfaceHeader
        description="画像を本文へドラッグ"
        onClose={onClose}
        title="Assets"
        titleId="studio-asset-tray-heading"
      />
      <label htmlFor="studio-asset-tray-search">画像を検索</label>
      <input
        id="studio-asset-tray-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="ファイル名、説明、タグ"
        ref={searchInput}
        className="studio-control"
        type="search"
        value={query}
      />
      <input
        accept="image/png,image/jpeg,image/webp,image/gif"
        hidden
        multiple
        onChange={(event) => {
          if (event.target.files) void onUpload([...event.target.files]);
          event.target.value = "";
        }}
        ref={fileInput}
        type="file"
      />
      <div className="studio-asset-tray__actions">
        <button className="dads-button" data-size="sm" data-type="outline" disabled={!canEdit || busy} onClick={() => fileInput.current?.click()} type="button">画像を追加</button>
        <button className="dads-button" data-size="sm" data-type="outline" onClick={onManage} type="button">すべて管理</button>
      </div>
      {visibleAssets.length > 0 ? (
        <ul className="studio-asset-tray__grid">
          {visibleAssets.map((asset) => {
            const usable = canEdit && Boolean(asset.alt.trim());
            return (
              <li key={asset.id}>
                <article
                  className={`studio-asset-tray__card ${usable ? "is-draggable" : ""}`}
                  draggable={usable}
                  onDragStart={(event) => {
                    if (!usable) return;
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(noemaAssetDragType, asset.id);
                    event.dataTransfer.setData("text/plain", `![${asset.alt}](${asset.markdownUrl})`);
                  }}
                >
                  <img alt="" loading="lazy" src={asset.previewUrl} />
                  <strong title={asset.originalName}>{asset.originalName}</strong>
                  {asset.alt.trim() ? <small>{asset.alt}</small> : <small className="is-warning">画像の説明が未設定</small>}
                  <button className="dads-button" data-size="sm" data-type="outline" disabled={!usable || busy} onClick={() => onInsert(asset)} type="button">
                    カーソル位置へ挿入
                  </button>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="studio-asset-tray__empty">{assets.length === 0 ? "画像を追加すると、ここから本文へ移せます。" : "条件に合う画像がありません。"}</p>
      )}
    </aside>
  );
}
