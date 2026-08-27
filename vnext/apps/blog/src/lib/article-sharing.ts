export interface ArticleShareData {
  title: string;
  url: string;
}

export type ArticleShareMethod = "native" | "copy";

export interface NativeShareNavigator {
  share?: (data: ArticleShareData) => Promise<void>;
}

export type NativeShareOutcome = "shared" | "dismissed" | "failed" | "unavailable";

export function createArticleShareData({
  canonicalUrl,
  fallbackUrl,
  method,
  title,
}: {
  canonicalUrl?: string;
  fallbackUrl: string;
  method: ArticleShareMethod;
  title: string;
}): ArticleShareData {
  const shareUrl = new URL(canonicalUrl || fallbackUrl);
  shareUrl.search = "";
  shareUrl.hash = "";
  shareUrl.searchParams.set("utm_source", "noema_reader");
  shareUrl.searchParams.set("utm_medium", "share");
  shareUrl.searchParams.set("utm_campaign", "article_share");
  shareUrl.searchParams.set("utm_content", method);

  return {
    title: title.replace(/\s+\|\s+Noema$/u, "").trim(),
    url: shareUrl.toString(),
  };
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
