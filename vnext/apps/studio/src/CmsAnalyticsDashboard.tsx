import { useEffect, useState } from "react";
import {
  type CmsAnalyticsDays,
  type CmsAnalyticsSummary
} from "@noema/cms";
import { fetchCmsAnalyticsSummary, type CmsClientError } from "./cms-client";
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

export function CmsAnalyticsDashboard({ connection }: CmsAnalyticsDashboardProps) {
  const [days, setDays] = useState<CmsAnalyticsDays>(30);
  const [retry, setRetry] = useState(0);
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
            <section className="studio-analytics__kpis" aria-label="主要指標">
              <article><span>50%到達率</span><strong>{formatPercent(state.summary.totals.article50Rate)}</strong><small>{state.summary.totals.article50} / {state.summary.totals.landing}表示</small></article>
              <article><span>読了率</span><strong>{formatPercent(state.summary.totals.qualifiedReadRate)}</strong><small>本文末尾到達 ÷ 記事への到達</small></article>
              <article><span>次記事移動率</span><strong>{formatPercent(state.summary.totals.onwardRate)}</strong><small>シリーズ・関連記事クリック ÷ 読了</small></article>
              <article><span>アシスタント利用率</span><strong>{formatPercent(state.summary.totals.assistantUseRate)}</strong><small>{state.summary.totals.assistantOpen}開始 ÷ {state.summary.totals.landing}表示</small></article>
              <article><span>アシスタント成功率</span><strong>{formatPercent(state.summary.totals.assistantSuccessRate)}</strong><small>回答成功 ÷ 質問開始</small></article>
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
            <p className="studio-analytics__privacy">質問本文、APIキー、会話内容、IPアドレス、永続的な利用者IDは分析データへ保存していません。</p>
          </>
        ) : null}
      </div>
    </main>
  );
}
