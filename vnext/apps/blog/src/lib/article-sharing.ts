import {
  CMS_ANALYTICS_READER_SERIES_SHARE_CAMPAIGN,
  CMS_ANALYTICS_READER_SHARE_CAMPAIGN,
  CMS_ANALYTICS_READER_SHARE_MEDIUM,
  CMS_ANALYTICS_READER_SHARE_SOURCE,
} from "@noema/cms";

export interface ArticleShareData {
  title: string;
  url: string;
}

export type ArticleShareMethod = "native" | "copy";

export interface NativeShareNavigator {
  share?: (data: ArticleShareData) => Promise<void>;
}

export type NativeShareOutcome = "shared" | "dismissed" | "failed" | "unavailable";

function createShareData({
  campaign,
  canonicalUrl,
  fallbackUrl,
  method,
  title,
}: {
  campaign: string;
  canonicalUrl?: string;
  fallbackUrl: string;
  method: ArticleShareMethod;
  title: string;
}): ArticleShareData {
  const shareUrl = new URL(canonicalUrl || fallbackUrl);
  shareUrl.search = "";
  shareUrl.hash = "";
  shareUrl.searchParams.set("utm_source", CMS_ANALYTICS_READER_SHARE_SOURCE);
  shareUrl.searchParams.set("utm_medium", CMS_ANALYTICS_READER_SHARE_MEDIUM);
  shareUrl.searchParams.set("utm_campaign", campaign);
  shareUrl.searchParams.set("utm_content", method);

  return {
    title: title.replace(/\s+\|\s+Noema$/u, "").trim(),
    url: shareUrl.toString(),
  };
}

export function createArticleShareData(
  input: Omit<Parameters<typeof createShareData>[0], "campaign">,
): ArticleShareData {
  return createShareData({
    ...input,
    campaign: CMS_ANALYTICS_READER_SHARE_CAMPAIGN,
  });
}

export function createSeriesShareData(
  input: Omit<Parameters<typeof createShareData>[0], "campaign">,
): ArticleShareData {
  return createShareData({
    ...input,
    campaign: CMS_ANALYTICS_READER_SERIES_SHARE_CAMPAIGN,
  });
}

function hasSingleParameter(url: URL, name: string, expected: string): boolean {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] === expected;
}

export function addSeriesShareAttributionToArticleUrl({
  articleUrl,
  seriesLandingUrl,
}: {
  articleUrl: string;
  seriesLandingUrl: string;
}): string {
  const landing = new URL(seriesLandingUrl);
  const method = landing.searchParams.get("utm_content");
  const isSeriesLanding = /^\/series\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/u.test(landing.pathname)
    && hasSingleParameter(landing, "utm_source", CMS_ANALYTICS_READER_SHARE_SOURCE)
    && hasSingleParameter(landing, "utm_medium", CMS_ANALYTICS_READER_SHARE_MEDIUM)
    && hasSingleParameter(landing, "utm_campaign", CMS_ANALYTICS_READER_SERIES_SHARE_CAMPAIGN)
    && (method === "native" || method === "copy")
    && landing.searchParams.getAll("utm_content").length === 1;
  if (!isSeriesLanding) return articleUrl;

  const article = new URL(articleUrl, landing.origin);
  const isCanonicalArticle = article.origin === landing.origin
    && /^\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/u.test(article.pathname)
    && article.search === ""
    && article.hash === "";
  if (!isCanonicalArticle) return articleUrl;

  article.searchParams.set("utm_source", CMS_ANALYTICS_READER_SHARE_SOURCE);
  article.searchParams.set("utm_medium", CMS_ANALYTICS_READER_SHARE_MEDIUM);
  article.searchParams.set("utm_campaign", CMS_ANALYTICS_READER_SERIES_SHARE_CAMPAIGN);
  article.searchParams.set("utm_content", method);
  return article.toString();
}

export function supportsNativeSharing(
  navigatorLike: NativeShareNavigator,
): navigatorLike is NativeShareNavigator & Required<Pick<NativeShareNavigator, "share">> {
  return typeof navigatorLike.share === "function";
}

function isShareDismissal(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "name" in error
    && error.name === "AbortError";
}

export async function shareArticle(
  navigatorLike: NativeShareNavigator,
  data: ArticleShareData,
): Promise<NativeShareOutcome> {
  if (!supportsNativeSharing(navigatorLike)) return "unavailable";

  try {
    await navigatorLike.share.call(navigatorLike, data);
    return "shared";
  } catch (error) {
    return isShareDismissal(error) ? "dismissed" : "failed";
  }
}
