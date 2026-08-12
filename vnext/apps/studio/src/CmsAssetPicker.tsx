import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CmsAsset } from "@noema/cms";
import { filterCmsAssets } from "./asset-library";

export function CmsAssetPicker({
  assets,
  busy,
  mode,
  onClose,
  onInsert,
  onUpload
}: {
  assets: CmsAsset[];
  busy: boolean;
  mode: "body" | "hero";
  onClose: () => void;
  onInsert: (asset: CmsAsset, alt: string) => void;
  onUpload: (files: File[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const deferredQuery = useDeferredValue(query);
  const dialog = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const visibleAssets = useMemo(
    () => filterCmsAssets(assets, deferredQuery, "all"),
    [assets, deferredQuery]
  );
  const selected = assets.find((asset) => asset.id === selectedId) ?? null;

  useEffect(() => { search.current?.focus(); }, []);
  useEffect(() => {
    if (selectedId && visibleAssets.some((asset) => asset.id === selectedId)) return;
    setSelectedId(visibleAssets[0]?.id ?? null);
  }, [selectedId, visibleAssets]);
  useEffect(() => { setAlt(selected?.alt ?? ""); }, [selected]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hidden);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="studio-dialog-backdrop">
      <section aria-labelledby="asset-picker-heading" aria-modal="true" className="studio-dialog studio-asset-picker" ref={dialog} role="dialog">
        <header>
          <div>
            <p className="studio-library__eyebrow">Assets</p>
            <h2 id="asset-picker-heading">{mode === "hero" ? "記事画像を選択" : "本文へ画像を挿入"}</h2>
          </div>
          <button aria-label="画像選択を閉じる" onClick={onClose} type="button">閉じる</button>
        </header>
        <div className="studio-asset-picker__controls">
          <label htmlFor="asset-picker-search">画像を検索</label>
          <input id="asset-picker-search" onChange={(event) => setQuery(event.target.value)} placeholder="ファイル名、説明、タグ" ref={search} type="search" value={query} />
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
          <button className="dads-button" data-size="md" data-type="outline" disabled={busy} onClick={() => fileInput.current?.click()} type="button">新しい画像を追加</button>
        </div>
        <div className="studio-asset-picker__body">
          {visibleAssets.length > 0 ? (
            <ul className="studio-asset-picker__grid" aria-label="挿入する画像">
              {visibleAssets.map((asset) => (
                <li key={asset.id}>
                  <button aria-pressed={selectedId === asset.id} onClick={() => setSelectedId(asset.id)} type="button">
                    <img alt="" src={asset.previewUrl} />
                    <span>{asset.originalName}</span>
                    {!asset.alt ? <small>alt未設定</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="studio-asset-picker__empty">利用できる画像がありません。新しい画像を追加してください。</p>}
          {selected ? (
            <aside className="studio-asset-picker__selection">
              <img alt={selected.alt || "選択中の画像"} src={selected.previewUrl} />
              <label htmlFor="asset-picker-alt">{mode === "hero" ? "記事画像の説明" : "この記事での画像の説明"}</label>
              <textarea id="asset-picker-alt" onChange={(event) => setAlt(event.target.value)} rows={3} value={alt} />
              <p>記事の文脈に合わせて変更できます。</p>
              <button className="dads-button" data-size="md" data-type="solid-fill" disabled={busy || !alt.trim()} onClick={() => onInsert(selected, alt.trim())} type="button">
                {mode === "hero" ? "記事画像に設定" : "カーソル位置に挿入"}
              </button>
            </aside>
          ) : null}
        </div>
      </section>
    </div>
  );
}
