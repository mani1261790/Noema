import { useEffect, useState } from "react";
import {
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

const entryLabels: Record<CmsAnalyticsSummary["entries"][number]["entryKind"], string> = {
  article: "別の記事",
  article_index: "記事一覧・検索",
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
            <p>個人を識別せず、公開revisionごとの読了・次記事移動・アシスタント利用を確認します。</p>
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
              <div className="studio-analytics__lineage" aria-label="分析sourceの接続状態">
                {state.summary.health.sources.map((source) => (
                  <article key={source.id}>
                    <div>
                      <strong>{sourceNames[source.id]}</strong>
                      <span>{source.status === "active" ? "接続中" : "未接続"}</span>
                    </div>
                    <p>{source.role}</p>
                  </article>
                ))}
              </div>
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

            <section className="studio-analytics__section" aria-labelledby="studio-analytics-articles-heading">
              <div className="studio-analytics__section-heading">
                <div><p className="studio-library__eyebrow">公開revision別</p><h2 id="studio-analytics-articles-heading">記事の読了と回遊</h2></div>
                <span>{state.summary.range.from}〜{state.summary.range.through}</span>
              </div>
              {state.summary.articles.length === 0 ? <p>この期間の読者行動はまだありません。</p> : (
                <div className="studio-analytics__table-wrap">
                  <table>
                    <caption className="sr-only">公開revision別の記事到達、読了、回遊、共有、アシスタント利用</caption>
                    <thead><tr><th scope="col">記事</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">シリーズ次</th><th scope="col">関連記事</th><th scope="col">移動率</th><th scope="col">共有</th><th scope="col">AI開始</th><th scope="col">AI成功率</th></tr></thead>
                    <tbody>{state.summary.articles.map((article) => (
                      <tr key={`${article.articleId}:${article.revisionNumber}`}>
                        <th scope="row"><strong>{article.title}</strong><small>{article.slug}・rev.{article.revisionNumber}</small></th>
                        <td>{article.landing}</td><td>{formatPercent(article.article50Rate)}</td>
                        <td>{formatPercent(article.qualifiedReadRate)}</td><td>{article.seriesNext}</td>
                        <td>{article.relatedClick}</td><td>{formatPercent(article.onwardRate)}</td>
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
                    <caption className="sr-only">流入元別の記事到達、50%到達、読了、回遊</caption>
                    <thead><tr><th scope="col">流入元</th><th scope="col">キャンペーン</th><th scope="col">内容</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">次記事</th></tr></thead>
                    <tbody>{state.summary.sources.map((source) => (
                      <tr key={`${source.source}\u0000${source.medium}\u0000${source.campaign}\u0000${source.content}\u0000${source.referrerHost}`}>
                        <th scope="row">{sourceLabel(source)}</th><td>{source.campaign || "—"}</td><td>{source.content || "—"}</td>
                        <td>{source.landing}</td><td>{formatPercent(source.article50Rate)}</td><td>{formatPercent(source.qualifiedReadRate)}</td><td>{source.navigationClick}</td>
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
              <p>外部流入のUTMとは分けて、ホーム、記事一覧、シリーズ、テーマ、別の記事からの到達を確認します。</p>
              {state.summary.entries.length === 0 ? <p>入口別の読者行動はまだありません。</p> : (
                <div className="studio-analytics__table-wrap">
                  <table>
                    <caption className="sr-only">サイト内の入口別の記事到達、50%到達、読了、次記事移動</caption>
                    <thead><tr><th scope="col">入口</th><th scope="col">到達</th><th scope="col">50%率</th><th scope="col">読了率</th><th scope="col">次記事</th></tr></thead>
                    <tbody>{state.summary.entries.map((entry) => (
                      <tr key={entry.entryKind}>
                        <th scope="row">{entryLabels[entry.entryKind]}</th>
                        <td>{entry.landing}</td><td>{formatPercent(entry.article50Rate)}</td>
                        <td>{formatPercent(entry.qualifiedReadRate)}</td><td>{entry.navigationClick}</td>
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
                  <caption className="sr-only">日別の記事到達、読了、回遊</caption>
                  <thead><tr><th scope="col">日付</th><th scope="col">到達</th><th scope="col">読了</th><th scope="col">次記事</th></tr></thead>
                  <tbody>{state.summary.daily.map((day) => <tr key={day.date}><th scope="row">{day.date}</th><td>{day.landing}</td><td>{day.articleEnd}</td><td>{day.navigationClick}</td></tr>)}</tbody>
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
