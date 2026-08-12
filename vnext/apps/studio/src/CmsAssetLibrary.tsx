import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CmsAsset, CmsAssetStatus } from "@noema/cms";
import {
  cmsAssetFilterOptions,
  filterCmsAssets,
  formatAssetBytes,
  type CmsAssetFilter
} from "./asset-library";
import type { CmsLibraryConnection } from "./CmsArticleLibrary";

interface CmsAssetLibraryProps {
  assets: CmsAsset[];
  busy: boolean;
  canEdit: boolean;
  connection: CmsLibraryConnection;
  onRetry: () => void;
  onUpdate: (asset: CmsAsset, input: { alt: string; status: CmsAssetStatus; tags: string[] }) => Promise<void>;
  onUpload: (files: File[]) => Promise<void>;
}

export function CmsAssetLibrary({
  assets,
  busy,
  canEdit,
  connection,
  onRetry,
  onUpdate,
  onUpload
}: CmsAssetLibraryProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CmsAssetFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const fileInput = useRef<HTMLInputElement>(null);
  const visibleAssets = useMemo(
    () => filterCmsAssets(assets, deferredQuery, filter),
    [assets, deferredQuery, filter]
  );
  const selected = assets.find((asset) => asset.id === selectedId) ?? null;

  useEffect(() => {
    if (selected && visibleAssets.some((asset) => asset.id === selected.id)) return;
    setSelectedId(visibleAssets[0]?.id ?? null);
  }, [selected, visibleAssets]);

  const upload = async (files: FileList | File[]) => {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (images.length > 0) await onUpload(images);
  };

  return (
    <main
      aria-busy={busy || connection.kind === "checking"}
      aria-labelledby="studio-asset-library-heading"
      className="studio-assets"
      id="studio-assets-main"
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void upload(event.dataTransfer.files);
      }}
    >
      <div className="studio-assets__inner">
        <header className="studio-assets__heading">
          <div>
            <p className="studio-library__eyebrow">Assets</p>
            <h1 id="studio-asset-library-heading" tabIndex={-1}>画像を管理</h1>
            <p>記事で使う画像を探し、再利用できます。画像の説明はここで一度整えます。</p>
          </div>
          <input
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            multiple
            onChange={(event) => {
              if (event.target.files) void upload(event.target.files);
              event.target.value = "";
            }}
            ref={fileInput}
            type="file"
          />
          <button
            className="dads-button"
            data-size="lg"
            data-type="solid-fill"
            disabled={!canEdit || busy}
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            画像をアップロード
          </button>
        </header>

        {dragging ? <div className="studio-assets__drop" role="status">ここに画像をドロップして追加</div> : null}

        {connection.kind === "unavailable" ? (
          <section className="studio-library-state is-error" role="alert">
            <h2>画像を読み込めません</h2>
            <p>{connection.message}</p>
            <button className="dads-button" data-size="md" data-type="outline" onClick={onRetry} type="button">もう一度確認</button>
          </section>
        ) : (
          <>
            <section className="studio-assets__controls" aria-label="画像を検索・絞り込み">
              <label htmlFor="asset-search">画像を検索</label>
              <input
                id="asset-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ファイル名、説明、タグで検索"
                type="search"
                value={query}
              />
              <div className="studio-assets__filters" aria-label="画像の状態" role="group">
                {cmsAssetFilterOptions.map((option) => (
                  <button
                    aria-pressed={filter === option.value}
                    key={option.value}
                    onClick={() => setFilter(option.value)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <div className="studio-assets__workspace">
              <section aria-label="画像一覧" className="studio-assets__results">
                <p className="studio-assets__count" aria-live="polite">{visibleAssets.length}件の画像</p>
                {visibleAssets.length > 0 ? (
                  <ul className="studio-assets__grid">
                    {visibleAssets.map((asset) => (
                      <li key={asset.id}>
                        <button
                          aria-pressed={asset.id === selectedId}
                          className="studio-asset-card"
                          onClick={() => setSelectedId(asset.id)}
                          type="button"
                        >
                          <img alt="" loading="lazy" src={asset.previewUrl} />
                          <span className="studio-asset-card__name">{asset.originalName}</span>
                          <span className="studio-asset-card__meta">
                            {asset.referenceCount > 0 ? `使用中 ${asset.referenceCount}件` : "未使用"}
                            {!asset.alt.trim() ? " · alt未設定" : ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="studio-assets__empty">
                    <h2>{assets.length === 0 ? "最初の画像を追加しましょう" : "条件に合う画像がありません"}</h2>
                    <p>{assets.length === 0 ? "画像をアップロードすると、どの記事からでも再利用できます。" : "検索語を短くするか、別の状態を選んでください。"}</p>
                    {query || filter !== "all" ? <button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>検索条件をクリア</button> : null}
                  </div>
                )}
              </section>
              {selected ? (
                <AssetDetails asset={selected} busy={busy} canEdit={canEdit} onUpdate={onUpdate} />
              ) : null}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function AssetDetails({
  asset,
  busy,
  canEdit,
  onUpdate
}: {
  asset: CmsAsset;
  busy: boolean;
  canEdit: boolean;
  onUpdate: CmsAssetLibraryProps["onUpdate"];
}) {
  const [alt, setAlt] = useState(asset.alt);
  const [tags, setTags] = useState(asset.tags.join(", "));

  useEffect(() => {
    setAlt(asset.alt);
    setTags(asset.tags.join(", "));
  }, [asset]);

  const tagValues = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  const dirty = alt.trim() !== asset.alt || JSON.stringify(tagValues) !== JSON.stringify(asset.tags);

  return (
    <aside aria-labelledby="asset-details-heading" className="studio-asset-details">
      <img alt={asset.alt || "選択中の画像プレビュー"} src={asset.previewUrl} />
      <div className="studio-asset-details__heading">
        <h2 id="asset-details-heading">{asset.originalName}</h2>
        <span className={`is-${asset.status}`}>{asset.status === "active" ? "利用可能" : "アーカイブ"}</span>
      </div>
      <dl>
        <div><dt>形式</dt><dd>{asset.contentType.replace("image/", "").toUpperCase()}</dd></div>
        <div><dt>容量</dt><dd>{formatAssetBytes(asset.byteSize)}</dd></div>
        <div><dt>利用</dt><dd>{asset.referenceCount > 0 ? `${asset.referenceCount}か所` : "未使用"}</dd></div>
        <div><dt>追加</dt><dd>{new Date(asset.createdAt).toLocaleString("ja-JP")}</dd></div>
      </dl>
      <label htmlFor="asset-alt">標準の画像説明（alt）</label>
      <textarea
        id="asset-alt"
        onChange={(event) => setAlt(event.target.value)}
        placeholder="画像が伝えている内容を簡潔に記述"
        rows={3}
        value={alt}
      />
      {!alt.trim() ? <p className="studio-asset-details__warning">記事へ挿入する前に画像の説明を設定してください。</p> : null}
      <label htmlFor="asset-tags">管理用タグ</label>
      <input id="asset-tags" onChange={(event) => setTags(event.target.value)} placeholder="UI, Cloudflare" value={tags} />
      <p className="studio-asset-details__support">複数のタグはカンマで区切ります。</p>
      <div className="studio-asset-details__actions">
        <button
          className="dads-button"
          data-size="md"
          data-type="solid-fill"
          disabled={!canEdit || busy || !dirty}
          onClick={() => void onUpdate(asset, { alt: alt.trim(), status: asset.status, tags: tagValues })}
          type="button"
        >
          画像情報を保存
        </button>
        <button
          className="dads-button"
          data-size="md"
          data-type="outline"
          disabled={!canEdit || busy || asset.referenceCount > 0}
          onClick={() => void onUpdate(asset, {
            alt: asset.alt,
            status: asset.status === "active" ? "archived" : "active",
            tags: asset.tags
          })}
          type="button"
        >
          {asset.status === "active" ? "アーカイブ" : "復元"}
        </button>
      </div>
      {asset.referenceCount > 0 ? <p className="studio-asset-details__support">使用中の画像はアーカイブできません。</p> : null}
    </aside>
  );
}
