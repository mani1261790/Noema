export interface ArticleShareData {
  title: string;
  url: string;
}

export interface NativeShareNavigator {
  share?: (data: ArticleShareData) => Promise<void>;
}

export type NativeShareOutcome = "shared" | "dismissed" | "failed" | "unavailable";

export function createArticleShareData({
  canonicalUrl,
  fallbackUrl,
  title,
}: {
  canonicalUrl?: string;
  fallbackUrl: string;
  title: string;
}): ArticleShareData {
  return {
    title: title.replace(/\s+\|\s+Noema$/u, "").trim(),
    url: canonicalUrl || fallbackUrl,
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
