import type MarkdownIt from "markdown-it";
import { extractArticleHeadings, isSafeHttpUrl } from "@noema/content/article-markdown";
import {
  renderArticleMarkdown,
  renderArticleMarkdownWith,
} from "@noema/content/article-renderer";
import type { ArticleFrontmatter } from "@noema/content";

export interface ArticlePresentationSeriesItem {
  href: string;
  title: string;
}

export interface ArticlePresentationSeries {
  currentIndex: number;
  description: string;
  items: ArticlePresentationSeriesItem[];
  title: string;
}

export interface ArticlePresentationOptions {
  editor?: { href: string; name: string } | null;
  markdownRenderer?: MarkdownIt;
  resolveImageReference?: (reference: string) => string;
  resolveLinkReference?: (reference: string) => string;
  series?: ArticlePresentationSeries | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function attribute(value: string): string {
  return escapeHtml(value);
}

function resolveReference(
  reference: string,
  resolver?: (reference: string) => string,
): string {
  return resolver ? resolver(reference) : reference;
}

function formatJapaneseDate(value?: string): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-");
  return year && month && day ? `${year}年${Number(month)}月${Number(day)}日` : value;
}

function renderSeriesIntro(
  series: ArticlePresentationSeries,
  resolveLinkReference?: (reference: string) => string,
): string {
  const first = series.items[0];
  const previous = series.items[series.currentIndex - 1];
  const quickLinks = series.currentIndex > 0
    ? `<div class="article-series__quick-links">${
        series.currentIndex > 1 && first
          ? `<a href="${attribute(resolveReference(first.href, resolveLinkReference))}"><small>シリーズの入口</small><strong>最初から読む</strong><span>${escapeHtml(first.title)}</span></a>`
          : ""
      }${
        previous
          ? `<a href="${attribute(resolveReference(previous.href, resolveLinkReference))}"><small>ひとつ前</small><strong>前の記事へ</strong><span>${escapeHtml(previous.title)}</span></a>`
          : ""
      }</div>`
    : "";
  const items = series.items.map((item, index) => index === series.currentIndex
    ? `<li class="is-current"><span aria-current="page"><small>第${index + 1}回・現在の記事</small><strong>${escapeHtml(item.title)}</strong></span></li>`
    : `<li><a href="${attribute(resolveReference(item.href, resolveLinkReference))}"><small>第${index + 1}回</small><strong>${escapeHtml(item.title)}</strong></a></li>`
  ).join("");

  return `<nav class="article-series" aria-labelledby="article-series-heading"><div class="article-series__heading"><div><p>このシリーズ</p><h2 id="article-series-heading">${escapeHtml(series.title)}</h2><span>第${series.currentIndex + 1}回 / 全${series.items.length}回</span></div><p>${escapeHtml(series.description)}</p></div>${quickLinks}<details class="article-series__contents"><summary>シリーズ全体を見る</summary><ol>${items}</ol></details></nav>`;
}

function renderSeriesEnd(
  series: ArticlePresentationSeries,
  resolveLinkReference?: (reference: string) => string,
): string {
  const current = series.items[series.currentIndex];
  const previous = series.items[series.currentIndex - 1];
  const next = series.items[series.currentIndex + 1];
  const previousLink = previous
    ? `<a href="${attribute(resolveReference(previous.href, resolveLinkReference))}"><small>前の記事</small><strong>${escapeHtml(previous.title)}</strong></a>`
    : "<span></span>";
  const nextLink = next
    ? `<a class="is-next" data-analytics-navigation="series_next" href="${attribute(resolveReference(next.href, resolveLinkReference))}"><small>次の記事</small><strong>${escapeHtml(next.title)}</strong></a>`
    : `<a class="is-next" href="${attribute(resolveReference("/articles", resolveLinkReference))}"><small>シリーズを読み終えました</small><strong>ほかの記事を見る</strong></a>`;
  return `<nav class="article-series-end" aria-label="${attribute(`${series.title}の前後の記事`)}"><p><span>${escapeHtml(series.title)}</span><strong>${escapeHtml(current?.title ?? "")}</strong></p><div>${previousLink}${nextLink}</div></nav>`;
}

export function renderArticlePresentation(
  frontmatter: ArticleFrontmatter,
  markdown: string,
  options: ArticlePresentationOptions = {},
): string {
  const renderedMarkdown = options.markdownRenderer
    ? renderArticleMarkdownWith(options.markdownRenderer, markdown)
    : renderArticleMarkdown(markdown);
  const headings = extractArticleHeadings(markdown);
  const publishedAt = formatJapaneseDate(frontmatter.publishedAt);
  const updatedAt = formatJapaneseDate(frontmatter.updatedAt) ?? frontmatter.updatedAt;
  const tags = frontmatter.tags.length > 0
    ? `<ul class="article-header__tags" aria-label="タグ">${frontmatter.tags.map((tag) => {
        const href = resolveReference(`/articles?tag=${encodeURIComponent(tag)}#search`, options.resolveLinkReference);
        return `<li><a href="${attribute(href)}">${escapeHtml(tag)}</a></li>`;
      }).join("")}</ul>`
    : "";
  const attribution = options.editor
    ? `<div><dt>編集者</dt><dd><a href="${attribute(resolveReference(options.editor.href, options.resolveLinkReference))}">${escapeHtml(options.editor.name)}</a></dd></div>`
    : `<div><dt>編集者</dt><dd>${escapeHtml(frontmatter.authors.join("、"))}</dd></div>`;
  const hero = frontmatter.heroImage
    ? `<figure class="article-hero-image"><img src="${attribute(resolveReference(frontmatter.heroImage.src, options.resolveImageReference))}" alt="${attribute(frontmatter.heroImage.alt)}"></figure>`
    : "";
  const toc = headings.length > 0
    ? `<nav class="dads-toc article-toc article-toc--desktop" data-border="solid" aria-label="この記事の内容"><h2 class="dads-toc__heading">この記事の内容</h2><ol class="dads-list article-toc__list">${headings.map((item) => `<li><a class="dads-link" href="#${attribute(item.slug)}">${escapeHtml(item.text)}</a></li>`).join("")}</ol></nav><details class="dads-disclosure article-toc article-toc--mobile"><summary class="dads-disclosure__summary article-toc__summary"><span>この記事の内容</span><svg class="dads-disclosure__icon" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle class="dads-disclosure__icon-circle" cx="12" cy="12" r="10" fill="currentColor"></circle><path class="dads-disclosure__icon-triangle" d="m8 10 4 5 4-5H8Z" fill="white"></path></svg></summary><nav class="dads-disclosure__content" aria-label="記事内目次"><ol class="dads-list article-toc__list">${headings.map((item) => `<li><a class="dads-link" href="#${attribute(item.slug)}">${escapeHtml(item.text)}</a></li>`).join("")}</ol></nav></details>`
    : "";
  const sources = frontmatter.sources.length > 0
    ? `<section class="article-sources" aria-labelledby="article-sources-heading"><h2 id="article-sources-heading">参考資料</h2><ul class="dads-list">${frontmatter.sources.map((source) => {
        const label = escapeHtml(source.title);
        const link = isSafeHttpUrl(source.url)
          ? `<a class="dads-link" href="${attribute(source.url)}" target="_blank" rel="noreferrer">${label}<span class="noema-visually-hidden">（新しいタブで開きます）</span></a>`
          : `<span>${label}</span>`;
        return `<li>${link}<span>（${escapeHtml(formatJapaneseDate(source.checkedAt) ?? source.checkedAt)}確認）</span></li>`;
      }).join("")}</ul></section>`
    : "";
  const seriesIntro = options.series ? renderSeriesIntro(options.series, options.resolveLinkReference) : "";
  const seriesEnd = options.series ? renderSeriesEnd(options.series, options.resolveLinkReference) : "";

  return `<div class="article-presentation"><header class="article-header"><h1>${escapeHtml(frontmatter.title)}</h1><p>${escapeHtml(frontmatter.description)}</p><dl class="article-meta">${attribution}<div><dt class="noema-visually-hidden">読了時間</dt><dd>読了 ${frontmatter.estimatedMinutes}分</dd></div>${publishedAt ? `<div><dt>公開</dt><dd><time datetime="${attribute(frontmatter.publishedAt ?? "")}">${escapeHtml(publishedAt)}</time></dd></div>` : ""}<div><dt>更新</dt><dd><time datetime="${attribute(frontmatter.updatedAt)}">${escapeHtml(updatedAt)}</time></dd></div></dl>${tags}</header>${hero}${seriesIntro}<section class="article-outcome"><h2>この記事でできるようになること</h2><p>${escapeHtml(frontmatter.outcome)}</p></section>${toc}<article class="article-body">${renderedMarkdown}</article>${sources}${seriesEnd}</div>`;
}
