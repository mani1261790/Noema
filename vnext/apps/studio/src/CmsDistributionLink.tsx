import { useRef, useState } from "react";
import { NOEMA_PUBLIC_ORIGIN } from "@noema/content/indexnow";

const ARTICLE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DISTRIBUTION_SOURCE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
export const DISTRIBUTION_CAMPAIGN = "article_distribution";

export const distributionMediumOptions = [
  { label: "ソーシャル投稿", value: "social" },
  { label: "コミュニティ", value: "community" },
  { label: "メール", value: "email" },
  { label: "提携・紹介", value: "partner" }
] as const;

export type DistributionMedium = typeof distributionMediumOptions[number]["value"];

export function normalizeDistributionSource(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, "-");
}

export function distributionSourceError(value: string): string | null {
  const normalized = normalizeDistributionSource(value);
  if (!normalized) return "配信元を入力してください。";
  if (normalized.length > 64) return "配信元は64文字以内で入力してください。";
  if (!DISTRIBUTION_SOURCE_PATTERN.test(normalized)) {
    return "配信元は半角英小文字・数字・ピリオド・ハイフン・アンダースコアで入力してください。";
  }
  return null;
}

export function buildMeasuredDistributionUrl({
  articleSlug,
  medium,
  source
}: {
  articleSlug: string;
  medium: DistributionMedium;
  source: string;
}): string | null {
  if (!ARTICLE_SLUG_PATTERN.test(articleSlug) || distributionSourceError(source)) return null;
  const url = new URL(`/articles/${articleSlug}`, NOEMA_PUBLIC_ORIGIN);
  url.searchParams.set("utm_source", normalizeDistributionSource(source));
  url.searchParams.set("utm_medium", medium);
  url.searchParams.set("utm_campaign", DISTRIBUTION_CAMPAIGN);
  url.searchParams.set("utm_content", articleSlug);
  return url.toString();
}

export function CmsDistributionLink({ articleSlug }: { articleSlug: string }) {
  const [source, setSource] = useState("");
  const [medium, setMedium] = useState<DistributionMedium>("social");
  const [status, setStatus] = useState("");
  const linkInput = useRef<HTMLInputElement>(null);
  const validationError = source.length > 0 ? distributionSourceError(source) : null;
  const distributionUrl = buildMeasuredDistributionUrl({ articleSlug, medium, source });

  const copyDistributionUrl = async () => {
    if (!distributionUrl) return;
    if (!navigator.clipboard) {
      linkInput.current?.focus();
      linkInput.current?.select();
      setStatus("リンクを選択しました。コピー操作で取得してください。");
      return;
    }
    try {
      await navigator.clipboard.writeText(distributionUrl);
      setStatus("配信用リンクをコピーしました。");
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setStatus("自動でコピーできませんでした。選択したリンクをコピーしてください。");
    }
  };

  return (
    <section aria-labelledby="studio-distribution-link-heading" className="studio-distribution-link">
      <div>
        <h3 id="studio-distribution-link-heading">配信用リンク</h3>
        <p>外部で記事を案内するときのリンクを作ります。配信元と方法をそろえると、分析画面で読了や次記事移動を比較できます。</p>
      </div>
      <div className="studio-distribution-link__fields">
        <label htmlFor="studio-distribution-source">
          <span>配信元</span>
          <input
            aria-describedby="studio-distribution-source-support"
            aria-invalid={validationError ? "true" : undefined}
            id="studio-distribution-source"
            onChange={(event) => {
              setSource(event.currentTarget.value);
              setStatus("");
            }}
            placeholder="例: bluesky、discord-community"
            type="text"
            value={source}
          />
        </label>
        <label htmlFor="studio-distribution-medium">
          <span>配信方法</span>
          <select
            id="studio-distribution-medium"
            onChange={(event) => {
              setMedium(event.currentTarget.value as DistributionMedium);
              setStatus("");
            }}
            value={medium}
          >
            {distributionMediumOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
      <p
        id="studio-distribution-source-support"
        className={validationError ? "is-error" : undefined}
        role={validationError ? "alert" : undefined}
      >
        {validationError ?? "英字は小文字に、空白はハイフンにそろえます。例: x、bluesky、discord-community"}
      </p>
      <label className="studio-distribution-link__result" htmlFor="studio-distribution-result">
        <span>作成されるリンク</span>
        <input
          id="studio-distribution-result"
          readOnly
          ref={linkInput}
          type="url"
          value={distributionUrl ?? ""}
        />
      </label>
      <button
        className="dads-button"
        data-size="sm"
        data-type="outline"
        disabled={!distributionUrl}
        onClick={() => void copyDistributionUrl()}
        type="button"
      >
        配信用リンクをコピー
      </button>
      <p className="studio-distribution-link__privacy">入力内容はStudioに保存しません。記事が開かれたときも、配信元・方法・施策名・公開記事のURL名だけを匿名イベントへ含め、投稿文や読者IDは記録しません。</p>
      <p className="studio-distribution-link__status" role="status" aria-live="polite">{status}</p>
    </section>
  );
}
