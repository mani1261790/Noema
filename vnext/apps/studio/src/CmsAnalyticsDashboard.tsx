import { useEffect, useState } from "react";
import {
  CMS_ANALYTICS_READER_SERIES_SHARE_CAMPAIGN,
  CMS_ANALYTICS_READER_SHARE_CAMPAIGN,
  CMS_GOOGLE_SEARCH_CONSOLE_INDEX_URL,
  CMS_GOOGLE_SEARCH_CONSOLE_LINKS_URL,
  CMS_GOOGLE_SEARCH_CONSOLE_SITEMAPS_URL,
  cmsAnalyticsMetricCatalog,
  type CmsAnalyticsDays,
  type CmsAnalyticsOnwardPath,
  type CmsAnalyticsSummary
} from "@noema/cms";
import {
  fetchCmsAnalyticsSummary,
  rebuildCmsAnalyticsMart,
  type CmsClientError
} from "./cms-client";
import { describeRateComparison } from "./analytics-period-comparison";
import { DISTRIBUTION_CAMPAIGN, distributionMediumOptions } from "./CmsDistributionLink";
import type { CmsLibraryConnection } from "./CmsArticleLibrary";

interface CmsAnalyticsDashboardProps {
  connection: CmsLibraryConnection;
}

type AnalyticsState =
  | { kind: "loading" }
  | { error: CmsClientError; kind: "error" }
  | { kind: "ready"; summary: CmsAnalyticsSummary };

const percentFormatter = new Intl.NumberFormat("ja-JP", {
  maximumFractionDigits: 1,
  style: "percent"
});

function formatPercent(value: number | null): string {
  return value === null ? "—" : percentFormatter.format(value);
}

function sourceLabel(source: CmsAnalyticsSummary["sources"][number]): string {
  if (source.source) return [source.source, source.medium].filter(Boolean).join(" / ");
  if (source.referrerHost) return source.referrerHost;
  return "直接・不明";
}

const navigationLabels: Record<CmsAnalyticsOnwardPath["navigationKind"], string> = {
  related: "関連記事",
  series_next: "シリーズ次"
};

const acquisitionChannelLabels: Record<
  CmsAnalyticsSummary["acquisitionChannels"][number]["channel"],
  string
> = {
  campaign: "UTM付き施策",
  direct: "直接・不明",
  organic_search: "自然検索",
  referral: "その他の外部サイト"
};

export function AnalyticsAcquisition({
  channels,
  organicArticles
}: {
  channels: CmsAnalyticsSummary["acquisitionChannels"];
  organicArticles: CmsAnalyticsSummary["organicSearchArticles"];
}) {
  return (
    <section className="studio-analytics__section" aria-labelledby="studio-analytics-acquisition-heading">
      <div className="studio-analytics__section-heading">
        <div><p className="studio-library__eyebrow">獲得チャネル</p><h2 id="studio-analytics-acquisition-heading">検索流入が読了につながったか</h2></div>
      </div>
      <p>UTM（medium=organicを除く）、既知の検索エンジン、その他の外部サイト、直接・不明を分けます。検索語や読者IDは保存せず、率は読者単位の転換率ではありません。</p>
      {channels.length === 0 ? <p>この期間の獲得チャネルデータはまだありません。</p> : (
        <div className="studio-analytics__table-wrap">
          <table>
            <caption className="sr-only">獲得チャネル別の記事到達、50%到達、読了、次記事移動</caption>
            <thead><tr><th scope="col">獲得チャネル</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">次記事</th><th scope="col">移動率</th></tr></thead>
            <tbody>{channels.map((channel) => (
              <tr key={channel.channel}>
                <th scope="row">{acquisitionChannelLabels[channel.channel]}</th>
                <td>{channel.landing}</td><td>{formatPercent(channel.article50Rate)}</td>
                <td>{formatPercent(channel.qualifiedReadRate)}</td><td>{channel.navigationClick}</td><td>{formatPercent(channel.onwardRate)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <h3>自然検索の記事別成果</h3>
      <p>検索エンジンから始まった匿名イベントだけを、公開revision別に集計します。</p>
      {organicArticles.length === 0 ? <p>この期間の自然検索流入はまだありません。</p> : (
        <div className="studio-analytics__table-wrap">
          <table>
            <caption className="sr-only">自然検索の記事別到達、50%到達、読了、次記事移動</caption>
            <thead><tr><th scope="col">記事</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">次記事</th><th scope="col">移動率</th></tr></thead>
            <tbody>{organicArticles.map((article) => (
              <tr key={`${article.articleId}:${article.revisionNumber}`}>
                <th scope="row"><strong>{article.title}</strong><small>{article.slug}・rev.{article.revisionNumber}</small></th>
                <td>{article.landing}</td><td>{formatPercent(article.article50Rate)}</td>
                <td>{formatPercent(article.qualifiedReadRate)}</td><td>{article.navigationClick}</td><td>{formatPercent(article.onwardRate)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function distributionMediumLabel(medium: string): string {
  return distributionMediumOptions.find((option) => option.value === medium)?.label ?? (medium || "—");
}

function distributionRate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function aggregateDistributionSources(
  sources: CmsAnalyticsSummary["sources"]
): CmsAnalyticsSummary["sources"] {
  const metrics = new Map<string, CmsAnalyticsSummary["sources"][number]>();
  for (const source of sources) {
    if (source.campaign !== DISTRIBUTION_CAMPAIGN) continue;
    const key = [source.source, source.medium, source.content].join("\u0000");
    const metric = metrics.get(key) ?? {
      ...source,
      article50: 0,
      article50Rate: null,
      articleEnd: 0,
      landing: 0,
      navigationClick: 0,
      referrerHost: "",
      updatesClick: 0,
      qualifiedReadRate: null,
      updatesGuideRate: null
    };
    metric.article50 += source.article50;
    metric.articleEnd += source.articleEnd;
    metric.landing += source.landing;
    metric.navigationClick += source.navigationClick;
    metric.updatesClick += source.updatesClick;
    metrics.set(key, metric);
  }
  return [...metrics.values()].map((metric) => ({
    ...metric,
    article50Rate: distributionRate(metric.article50, metric.landing),
    qualifiedReadRate: distributionRate(metric.articleEnd, metric.landing),
    updatesGuideRate: distributionRate(metric.updatesClick, metric.articleEnd)
  })).sort((a, b) => b.landing - a.landing || b.articleEnd - a.articleEnd);
}

export function AnalyticsDistribution({
  articles,
  sources
}: {
  articles: CmsAnalyticsSummary["articles"];
  sources: CmsAnalyticsSummary["sources"];
}) {
  const articleTitles = new Map<string, string>();
  for (const article of articles) {
    if (!articleTitles.has(article.slug)) articleTitles.set(article.slug, article.title);
  }
  const distributionSources = aggregateDistributionSources(sources);

  return (
    <section className="studio-analytics__section" aria-labelledby="studio-analytics-distribution-heading">
      <div className="studio-analytics__section-heading">
        <div><p className="studio-library__eyebrow">外部配信</p><h2 id="studio-analytics-distribution-heading">配信元ごとに、どの記事が読まれたか</h2></div>
      </div>
      <p>Studioで作った配信用リンクだけを、配信元・方法・記事で比較します。率は匿名イベント数の比で、読者単位の転換率ではありません。</p>
      {distributionSources.length === 0 ? (
        <p>この期間の配信用リンクからの到達はまだありません。公開済み記事の編集画面でリンクを作り、配信後に確認してください。</p>
      ) : (
        <div className="studio-analytics__table-wrap">
          <table>
            <caption className="sr-only">配信元、配信方法、記事ごとの到達、50%到達、読了、次記事移動、更新案内</caption>
            <thead><tr><th scope="col">配信元</th><th scope="col">配信方法</th><th scope="col">記事</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">次記事</th><th scope="col">更新案内率</th></tr></thead>
            <tbody>{distributionSources.map((source) => {
              const articleTitle = articleTitles.get(source.content);
              return (
                <tr key={`${source.source}\u0000${source.medium}\u0000${source.content}\u0000${source.referrerHost}`}>
                  <th scope="row">{source.source || "—"}</th>
                  <td>{distributionMediumLabel(source.medium)}</td>
                  <td className="studio-analytics__article-cell">
                    {articleTitle ? <><strong>{articleTitle}</strong><small>{source.content}</small></> : (source.content || "—")}
                  </td>
                  <td>{source.landing}</td><td>{formatPercent(source.article50Rate)}</td>
                  <td>{formatPercent(source.qualifiedReadRate)}</td><td>{source.navigationClick}</td><td>{formatPercent(source.updatesGuideRate)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

interface ReaderShareOverview {
  article50: number;
  articleEnd: number;
  articleId: string;
  campaign: string;
  landing: number;
  methodLandings: Map<string, number>;
  navigationClick: number;
  revisionNumber: number;
  shareActions: number;
  slug: string;
  title: string;
}

function readerShareMethodLabel(method: string): string {
  if (method === "native") return "共有シート";
  if (method === "copy") return "URLコピー";
  return method || "不明";
}

function readerShareCampaignLabel(campaign: string): string {
  if (campaign === CMS_ANALYTICS_READER_SHARE_CAMPAIGN) return "記事";
  if (campaign === CMS_ANALYTICS_READER_SERIES_SHARE_CAMPAIGN) return "シリーズ";
  return campaign || "不明";
}

function aggregateReaderShares(
  articles: CmsAnalyticsSummary["articles"],
  inbound: CmsAnalyticsSummary["readerShareArticles"]
): ReaderShareOverview[] {
  const metrics = new Map<string, ReaderShareOverview>();
  for (const article of articles) {
    if (article.share === 0) continue;
    const key = `${article.articleId}:${article.revisionNumber}:${CMS_ANALYTICS_READER_SHARE_CAMPAIGN}`;
    metrics.set(key, {
      article50: 0,
      articleEnd: 0,
      articleId: article.articleId,
      campaign: CMS_ANALYTICS_READER_SHARE_CAMPAIGN,
      landing: 0,
      methodLandings: new Map(),
      navigationClick: 0,
      revisionNumber: article.revisionNumber,
      shareActions: article.share,
      slug: article.slug,
      title: article.title
    });
  }
  for (const article of inbound) {
    const key = `${article.articleId}:${article.revisionNumber}:${article.campaign}`;
    const metric = metrics.get(key) ?? {
      article50: 0,
      articleEnd: 0,
      articleId: article.articleId,
      campaign: article.campaign,
      landing: 0,
      methodLandings: new Map<string, number>(),
      navigationClick: 0,
      revisionNumber: article.revisionNumber,
      shareActions: 0,
      slug: article.slug,
      title: article.title
    };
    metric.article50 += article.article50;
    metric.articleEnd += article.articleEnd;
    metric.landing += article.landing;
    metric.navigationClick += article.navigationClick;
    metric.methodLandings.set(
      article.method,
      (metric.methodLandings.get(article.method) ?? 0) + article.landing
    );
    metrics.set(key, metric);
  }
  return [...metrics.values()].sort((a, b) => (
    b.landing - a.landing || b.shareActions - a.shareActions || a.slug.localeCompare(b.slug) || a.campaign.localeCompare(b.campaign)
  ));
}

export function AnalyticsReaderShares({
  articles,
  inbound
}: {
  articles: CmsAnalyticsSummary["articles"];
  inbound: CmsAnalyticsSummary["readerShareArticles"];
}) {
  const shares = aggregateReaderShares(articles, inbound);
  return (
    <section className="studio-analytics__section" aria-labelledby="studio-analytics-reader-shares-heading">
      <div className="studio-analytics__section-heading">
        <div><p className="studio-library__eyebrow">読者からの共有</p><h2 id="studio-analytics-reader-shares-heading">共有が、新しい記事到達につながったか</h2></div>
      </div>
      <p>記事の共有操作と、記事またはシリーズの計測URLから始まった記事到達を公開revision別に並べます。同じ読者を結合しないため、共有操作から到達への転換率は計算しません。</p>
      {shares.length === 0 ? (
        <p>この期間の共有操作と、共有リンクからの記事到達はまだありません。</p>
      ) : (
        <div className="studio-analytics__table-wrap">
          <table>
            <caption className="sr-only">共有元と記事ごとの共有操作、共有リンク経由の到達、50%到達、読了、次記事移動</caption>
            <thead><tr><th scope="col">記事</th><th scope="col">共有元</th><th scope="col">共有操作</th><th scope="col">共有リンク経由</th><th scope="col">到達方法</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">次記事</th><th scope="col">移動率</th></tr></thead>
            <tbody>{shares.map((article) => (
              <tr key={`${article.articleId}:${article.revisionNumber}:${article.campaign}`}>
                <th scope="row"><strong>{article.title}</strong><small>{article.slug}・rev.{article.revisionNumber}</small></th>
                <td>{readerShareCampaignLabel(article.campaign)}</td>
                <td>{article.shareActions}</td>
                <td>{article.landing}</td>
                <td>{article.methodLandings.size === 0 ? "—" : [...article.methodLandings.entries()]
                  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                  .map(([method, landing]) => `${readerShareMethodLabel(method)} ${landing}`)
                  .join(" / ")}</td>
                <td>{formatPercent(distributionRate(article.article50, article.landing))}</td>
                <td>{formatPercent(distributionRate(article.articleEnd, article.landing))}</td>
                <td>{article.navigationClick}</td>
                <td>{formatPercent(distributionRate(article.navigationClick, article.articleEnd))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function AnalyticsOnwardPaths({
  paths,
  truncated
}: {
  paths: CmsAnalyticsOnwardPath[];
  truncated: boolean;
}) {
  return (
    <section className="studio-analytics__section" aria-labelledby="studio-analytics-onward-heading">
      <div className="studio-analytics__section-heading">
        <div><p className="studio-library__eyebrow">記事間の経路</p><h2 id="studio-analytics-onward-heading">次にどの記事へ進んだか</h2></div>
      </div>
      <p>読者やセッションを結合せず、シリーズ次記事と関連記事のクリックを出発revision・移動先ごとに集計します。</p>
      {truncated ? <p role="status">経路が多いため、クリック数の多い上位200件を表示しています。</p> : null}
      {paths.length === 0 ? <p>この期間の次記事移動はまだありません。</p> : (
        <div className="studio-analytics__table-wrap">
          <table>
            <caption className="sr-only">出発記事、導線、移動先記事ごとのクリック数</caption>
            <thead><tr><th scope="col">出発記事</th><th scope="col">導線</th><th scope="col">移動先</th><th scope="col">クリック</th></tr></thead>
            <tbody>{paths.map((path) => (
              <tr key={`${path.sourceArticleId}:${path.sourceRevisionNumber}:${path.navigationKind}:${path.targetSlug}`}>
                <th scope="row"><strong>{path.sourceTitle}</strong><small>{path.sourceSlug}・rev.{path.sourceRevisionNumber}</small></th>
                <td>{navigationLabels[path.navigationKind]}</td>
                <td className="studio-analytics__article-cell"><strong>{path.targetTitle}</strong><small>{path.targetSlug}</small></td>
                <td>{path.clickCount}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const healthLabels = {
  attention: "要確認",
  collecting: "基準収集中",
  healthy: "正常",
  no_data: "データなし"
} as const;

const checkLabels = {
  not_evaluated: "未評価",
  pass: "正常",
  warn: "要確認"
} as const;

const sourceNames = {
  cloudflare_web_analytics: "Cloudflare Web Analytics",
  google_search_console: "Google Search Console",
  noema_reader_events: "Noema読者イベント"
} as const;

const sourceStatusLabels = {
  active: "接続中",
  external: "外部で確認",
  not_configured: "未接続"
} as const;

function sourceAccessLinks(
  source: CmsAnalyticsSummary["health"]["sources"][number]
): ReadonlyArray<{ label: string; url: string }> {
  if (source.status !== "external" || !source.accessUrl) return [];
  if (source.id === "cloudflare_web_analytics") {
    return [{ label: "Web Analyticsで確認", url: source.accessUrl }];
  }
  if (source.id === "google_search_console") {
    return [
      { label: "検索実績", url: source.accessUrl },
      { label: "インデックス状況", url: CMS_GOOGLE_SEARCH_CONSOLE_INDEX_URL },
      { label: "サイトマップ", url: CMS_GOOGLE_SEARCH_CONSOLE_SITEMAPS_URL },
      { label: "外部リンク", url: CMS_GOOGLE_SEARCH_CONSOLE_LINKS_URL }
    ];
  }
  return [];
}

export function AnalyticsSources({
  sources
}: {
  sources: CmsAnalyticsSummary["health"]["sources"];
}) {
  return (
    <div className="studio-analytics__lineage" aria-label="分析sourceの接続状態">
      {sources.map((source) => {
        const accessLinks = sourceAccessLinks(source);
        return (
          <article key={source.id}>
            <div>
              <strong>{sourceNames[source.id]}</strong>
              <span>{sourceStatusLabels[source.status]}</span>
            </div>
            <p>{source.role}</p>
            {accessLinks.length > 0 ? (
              <div className="studio-analytics__source-links">
                {accessLinks.map((link) => (
                  <a
                    className="studio-analytics__source-link"
                    href={link.url}
                    key={link.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {link.label}<span className="sr-only">（新しいタブ）</span>
                  </a>
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

const entryLabels: Record<CmsAnalyticsSummary["entries"][number]["entryKind"], string> = {
  article: "別の記事",
  article_index: "記事一覧",
  article_search: "記事検索・絞り込み",
  direct: "直接",
  external: "外部サイト",
  home: "ホーム",
  other_internal: "その他のNoema内",
  series: "シリーズ",
  topic: "テーマ",
  unknown: "未分類（計測開始前）"
};

export function CmsAnalyticsDashboard({ connection }: CmsAnalyticsDashboardProps) {
  const [days, setDays] = useState<CmsAnalyticsDays>(30);
  const [retry, setRetry] = useState(0);
  const [rebuildState, setRebuildState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [state, setState] = useState<AnalyticsState>({ kind: "loading" });

  useEffect(() => {
    if (connection.kind !== "ready") return;
    const controller = new AbortController();
    setState({ kind: "loading" });
    void fetchCmsAnalyticsSummary(days, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok
        ? { kind: "ready", summary: result.value }
        : { error: result.error, kind: "error" });
    });
    return () => controller.abort();
  }, [connection.kind, days, retry]);

  const rebuild = async (summary: CmsAnalyticsSummary) => {
    const from = summary.health.reprocessableFrom > summary.range.from
      ? summary.health.reprocessableFrom
      : summary.range.from;
    setRebuildState("running");
    const result = await rebuildCmsAnalyticsMart(from, summary.range.through);
    if (!result.ok) {
      setRebuildState("error");
      return;
    }
    setRebuildState("done");
    setRetry((value) => value + 1);
  };

  if (connection.kind === "checking") {
    return (
      <main className="studio-library studio-analytics">
        <div className="studio-library__inner studio-library-state" role="status">
          <h1 id="studio-analytics-heading" tabIndex={-1}>分析結果を確認しています</h1>
        </div>
      </main>
    );
  }
  if (connection.kind === "unavailable") {
    return (
      <main className="studio-library studio-analytics">
        <div className="studio-library__inner studio-library-state is-error" role="alert">
          <h1 id="studio-analytics-heading" tabIndex={-1}>分析結果を表示できません</h1>
          <p>{connection.message}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="studio-library studio-analytics">
      <div className="studio-library__inner">
        <header className="studio-library__heading studio-analytics__heading">
          <div>
            <p className="studio-library__eyebrow">読者行動</p>
            <h1 id="studio-analytics-heading" tabIndex={-1}>分析</h1>
            <p>個人を識別せず、公開revisionごとの読了・次記事移動・更新案内・アシスタント利用を確認します。</p>
          </div>
          <label>
            表示期間
            <select value={days} onChange={(event) => setDays(Number(event.target.value) as CmsAnalyticsDays)}>
              <option value={7}>7日間</option>
              <option value={30}>30日間</option>
              <option value={90}>90日間</option>
            </select>
          </label>
        </header>

        {state.kind === "loading" ? <p role="status">集計を読み込んでいます…</p> : null}
        {state.kind === "error" ? (
          <div className="studio-library-state is-error" role="alert">
            <p>{state.error.message}</p>
            <button className="dads-button" data-size="md" data-type="outline" onClick={() => setRetry((value) => value + 1)} type="button">もう一度確認</button>
          </div>
        ) : null}
        {state.kind === "ready" ? (
          <>
            <section
              className={`studio-analytics__health is-${state.summary.health.status}`}
              aria-labelledby="studio-analytics-health-heading"
            >
              <div className="studio-analytics__health-summary">
                <div>
                  <p className="studio-library__eyebrow">データ品質</p>
                  <h2 id="studio-analytics-health-heading">判断可能性</h2>
                </div>
                <strong>{healthLabels[state.summary.health.status]}</strong>
              </div>
              <dl className="studio-analytics__health-meta">
                <div><dt>受理イベント</dt><dd>{state.summary.health.acceptedEvents}</dd></div>
                <div><dt>重複除外</dt><dd>{state.summary.health.duplicateEvents}</dd></div>
                <div><dt>イベント契約</dt><dd>v{state.summary.health.eventContractVersion}</dd></div>
                <div><dt>獲得分類</dt><dd>v{state.summary.health.acquisitionChannelVersion}</dd></div>
                <div><dt>正本保持</dt><dd>{state.summary.health.retention.eventFactsDays}日</dd></div>
                <div><dt>集計保持</dt><dd>{state.summary.health.retention.reportingMartDays}日</dd></div>
              </dl>
              <ul className="studio-analytics__checks">
                {state.summary.health.checks.map((check) => (
                  <li className={`is-${check.status}`} key={check.id}>
                    <div><strong>{check.label}</strong><span>{checkLabels[check.status]}</span></div>
                    <p>{check.detail}</p>
                  </li>
                ))}
              </ul>
              <AnalyticsSources sources={state.summary.health.sources} />
              <p className="studio-analytics__health-note">
                完全coverageは{state.summary.health.rawCoverageFrom}から、入口別coverageは{state.summary.health.entryCoverageFrom}から。現在再処理できるのは{state.summary.health.reprocessableFrom}以降。最終判定 {state.summary.health.generatedAt}
              </p>
              {connection.role === "admin" && state.summary.health.checks.some((check) => (
                check.id === "mart_reconciliation" && check.status === "warn"
              )) ? (
                <div className="studio-analytics__repair">
                  <button
                    className="dads-button"
                    data-size="md"
                    data-type="outline"
                    disabled={rebuildState === "running"}
                    onClick={() => void rebuild(state.summary)}
                    type="button"
                  >
                    {rebuildState === "running" ? "再集計しています…" : "正本から再集計"}
                  </button>
                  <span role="status">
                    {rebuildState === "done" ? "再集計が完了しました。" : null}
                    {rebuildState === "error" ? "再集計できませんでした。もう一度確認してください。" : null}
                  </span>
                </div>
              ) : null}
            </section>

            <section className="studio-analytics__kpi-summary" aria-labelledby="studio-analytics-kpis-heading">
              <div className="studio-analytics__kpi-heading">
                <div>
                  <p className="studio-library__eyebrow">主要指標</p>
                  <h2 id="studio-analytics-kpis-heading">直前の同期間と比べる</h2>
                </div>
                <p className={`studio-analytics__comparison-note is-${state.summary.comparison.status}`}>
                  {state.summary.comparison.status === "available"
                    ? `${state.summary.comparison.range.from}〜${state.summary.comparison.range.through}と比較しています。率の差はパーセントポイントです。`
                    : `比較可能日は${state.summary.comparison.availableOn}です。計測開始前を0として扱わないため、必要な日数が揃うまで増減は表示しません。`}
                </p>
              </div>
              <div className="studio-analytics__kpis">
                <article>
                  <span>50%到達率</span><strong>{formatPercent(state.summary.totals.article50Rate)}</strong>
                  <small className="studio-analytics__comparison">{describeRateComparison(state.summary.totals.article50Rate, state.summary.comparison.totals?.article50Rate ?? null, days)}</small>
                  <small>{state.summary.totals.article50} / {state.summary.totals.landing}表示</small>
                </article>
                <article>
                  <span>読了率</span><strong>{formatPercent(state.summary.totals.qualifiedReadRate)}</strong>
                  <small className="studio-analytics__comparison">{describeRateComparison(state.summary.totals.qualifiedReadRate, state.summary.comparison.totals?.qualifiedReadRate ?? null, days)}</small>
                  <small>本文末尾到達 ÷ 記事への到達</small>
                </article>
                <article>
                  <span>次記事移動率</span><strong>{formatPercent(state.summary.totals.onwardRate)}</strong>
                  <small className="studio-analytics__comparison">{describeRateComparison(state.summary.totals.onwardRate, state.summary.comparison.totals?.onwardRate ?? null, days)}</small>
                  <small>シリーズ・関連記事クリック ÷ 読了</small>
                </article>
                <article>
                  <span>発見導線クリック率</span><strong>{formatPercent(state.summary.totals.discoveryRate)}</strong>
                  <small className="studio-analytics__comparison">{describeRateComparison(state.summary.totals.discoveryRate, state.summary.comparison.totals?.discoveryRate ?? null, days)}</small>
                  <small>{state.summary.totals.discoveryClick}一覧・テーマクリック ÷ {state.summary.totals.articleEnd}読了</small>
                </article>
                <article>
                  <span>更新案内クリック率</span><strong>{formatPercent(state.summary.totals.updatesGuideRate)}</strong>
                  <small className="studio-analytics__comparison">{describeRateComparison(state.summary.totals.updatesGuideRate, state.summary.comparison.totals?.updatesGuideRate ?? null, days)}</small>
                  <small>{state.summary.totals.updatesClick}クリック ÷ {state.summary.totals.articleEnd}読了</small>
                </article>
                <article>
                  <span>RSS行動率</span><strong>{formatPercent(state.summary.totals.updatesActionRate)}</strong>
                  <small className="studio-analytics__comparison">{describeRateComparison(state.summary.totals.updatesActionRate, state.summary.comparison.totals?.updatesActionRate ?? null, days)}</small>
                  <small>{state.summary.totals.updatesAction}コピー・開く ÷ {state.summary.totals.updatesClick}更新案内クリック</small>
                </article>
                <article>
                  <span>アシスタント利用率</span><strong>{formatPercent(state.summary.totals.assistantUseRate)}</strong>
                  <small className="studio-analytics__comparison">{describeRateComparison(state.summary.totals.assistantUseRate, state.summary.comparison.totals?.assistantUseRate ?? null, days)}</small>
                  <small>{state.summary.totals.assistantOpen}開始 ÷ {state.summary.totals.landing}表示</small>
                </article>
                <article>
                  <span>アシスタント成功率</span><strong>{formatPercent(state.summary.totals.assistantSuccessRate)}</strong>
                  <small className="studio-analytics__comparison">{describeRateComparison(state.summary.totals.assistantSuccessRate, state.summary.comparison.totals?.assistantSuccessRate ?? null, days)}</small>
                  <small>回答成功 ÷ 質問開始</small>
                </article>
              </div>
            </section>

            <AnalyticsAcquisition
              channels={state.summary.acquisitionChannels}
              organicArticles={state.summary.organicSearchArticles}
            />

            <AnalyticsDistribution
              articles={state.summary.articles}
              sources={state.summary.sources}
            />

            <AnalyticsReaderShares
              articles={state.summary.articles}
              inbound={state.summary.readerShareArticles}
            />

            <section className="studio-analytics__section" aria-labelledby="studio-analytics-articles-heading">
              <div className="studio-analytics__section-heading">
                <div><p className="studio-library__eyebrow">公開revision別</p><h2 id="studio-analytics-articles-heading">記事の読了と回遊</h2></div>
                <span>{state.summary.range.from}〜{state.summary.range.through}</span>
              </div>
              {state.summary.articles.length === 0 ? <p>この期間の読者行動はまだありません。</p> : (
                <div className="studio-analytics__table-wrap">
                  <table>
                    <caption className="sr-only">公開revision別の記事到達、読了、次記事移動、発見導線、更新案内、RSS行動、共有、アシスタント利用</caption>
                    <thead><tr><th scope="col">記事</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">シリーズ次</th><th scope="col">関連記事</th><th scope="col">移動率</th><th scope="col">シリーズ一覧</th><th scope="col">テーマ</th><th scope="col">全記事</th><th scope="col">発見率</th><th scope="col">更新案内率</th><th scope="col">RSS行動率</th><th scope="col">共有</th><th scope="col">AI開始</th><th scope="col">AI成功率</th></tr></thead>
                    <tbody>{state.summary.articles.map((article) => (
                      <tr key={`${article.articleId}:${article.revisionNumber}`}>
                        <th scope="row"><strong>{article.title}</strong><small>{article.slug}・rev.{article.revisionNumber}</small></th>
                        <td>{article.landing}</td><td>{formatPercent(article.article50Rate)}</td>
                        <td>{formatPercent(article.qualifiedReadRate)}</td><td>{article.seriesNext}</td>
                        <td>{article.relatedClick}</td><td>{formatPercent(article.onwardRate)}</td>
                        <td>{article.seriesIndex}</td><td>{article.topicIndex}</td><td>{article.articleIndex}</td><td>{formatPercent(article.discoveryRate)}</td>
                        <td>{formatPercent(article.updatesGuideRate)}</td><td>{formatPercent(article.updatesActionRate)}</td>
                        <td>{article.share}</td><td>{article.assistantOpen}</td><td>{formatPercent(article.assistantSuccessRate)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            <AnalyticsOnwardPaths
              paths={state.summary.onwardPaths}
              truncated={state.summary.onwardPathsTruncated}
            />

            <section className="studio-analytics__section" aria-labelledby="studio-analytics-sources-heading">
              <div className="studio-analytics__section-heading"><div><p className="studio-library__eyebrow">流入別</p><h2 id="studio-analytics-sources-heading">どの入口が読了につながったか</h2></div></div>
              {state.summary.sources.length === 0 ? <p>この期間の流入データはまだありません。</p> : (
                <div className="studio-analytics__table-wrap">
                  <table>
                    <caption className="sr-only">流入元別の記事到達、50%到達、読了、回遊、更新案内</caption>
                    <thead><tr><th scope="col">流入元</th><th scope="col">キャンペーン</th><th scope="col">内容</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">次記事</th><th scope="col">更新案内率</th></tr></thead>
                    <tbody>{state.summary.sources.map((source) => (
                      <tr key={`${source.source}\u0000${source.medium}\u0000${source.campaign}\u0000${source.content}\u0000${source.referrerHost}`}>
                        <th scope="row">{sourceLabel(source)}</th><td>{source.campaign || "—"}</td><td>{source.content || "—"}</td>
                        <td>{source.landing}</td><td>{formatPercent(source.article50Rate)}</td><td>{formatPercent(source.qualifiedReadRate)}</td><td>{source.navigationClick}</td><td>{formatPercent(source.updatesGuideRate)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="studio-analytics__section" aria-labelledby="studio-analytics-entries-heading">
              <div className="studio-analytics__section-heading">
                <div><p className="studio-library__eyebrow">サイト内の入口</p><h2 id="studio-analytics-entries-heading">どのページから記事へ入ったか</h2></div>
              </div>
              <p>外部流入のUTMとは分けて、ホーム、記事一覧、検索・絞り込み、シリーズ、テーマ、別の記事からの到達を確認します。検索語や絞り込み値は保存しません。</p>
              {state.summary.entries.length === 0 ? <p>入口別の読者行動はまだありません。</p> : (
                <div className="studio-analytics__table-wrap">
                  <table>
                    <caption className="sr-only">サイト内の入口別の記事到達、50%到達、読了、次記事移動、更新案内</caption>
                    <thead><tr><th scope="col">入口</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">次記事</th><th scope="col">更新案内率</th></tr></thead>
                    <tbody>{state.summary.entries.map((entry) => (
                      <tr key={entry.entryKind}>
                        <th scope="row">{entryLabels[entry.entryKind]}</th>
                        <td>{entry.landing}</td><td>{formatPercent(entry.article50Rate)}</td>
                        <td>{formatPercent(entry.qualifiedReadRate)}</td><td>{entry.navigationClick}</td><td>{formatPercent(entry.updatesGuideRate)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            <details className="studio-analytics__daily">
              <summary>日別集計を見る</summary>
              <div className="studio-analytics__table-wrap">
                <table>
                  <caption className="sr-only">日別の記事到達、読了、次記事移動、発見導線、更新案内、RSS行動</caption>
                  <thead><tr><th scope="col">日付</th><th scope="col">到達</th><th scope="col">読了</th><th scope="col">次記事</th><th scope="col">発見導線</th><th scope="col">更新案内</th><th scope="col">RSS行動</th></tr></thead>
                  <tbody>{state.summary.daily.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.landing}</td><td>{day.articleEnd}</td><td>{day.navigationClick}</td><td>{day.discoveryClick}</td><td>{day.updatesClick}</td><td>{day.updatesAction}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
            <details className="studio-analytics__daily">
              <summary>指標定義を見る</summary>
              <div className="studio-analytics__metric-catalog">
                {cmsAnalyticsMetricCatalog.map((metric) => (
                  <article key={metric.id}>
                    <h3>{metric.label}</h3>
                    <code>{metric.numerator} ÷ {metric.denominator}</code>
                    <p>{metric.decision}</p>
                    <small>{metric.caveat}</small>
                  </article>
                ))}
              </div>
            </details>
            <p className="studio-analytics__privacy">質問本文、APIキー、会話内容、IPアドレス、永続的な利用者IDは分析データへ保存していません。</p>
          </>
        ) : null}
      </div>
    </main>
  );
}
