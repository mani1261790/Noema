import type { CmsAnalyticsEntryKind } from "@noema/cms";

const ARTICLE_PATH = /^\/articles\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/u;
const SERIES_PATH = /^\/series(?:\/|$)/u;
const TOPIC_PATH = /^\/topics(?:\/|$)/u;

/**
 * Reduce the referrer to a small, non-identifying discovery surface.
 * Raw same-site paths are never sent to analytics.
 */
export function classifyArticleEntry(
  referrer: string,
  currentOrigin: string
): CmsAnalyticsEntryKind {
  if (!referrer) return "direct";
  try {
    const url = new URL(referrer);
    if (url.origin !== currentOrigin) return "external";
    const path = url.pathname;
    if (path === "/" || path === "") return "home";
    if (path === "/articles" || path === "/articles/") return "article_index";
    if (SERIES_PATH.test(path)) return "series";
    if (TOPIC_PATH.test(path)) return "topic";
    if (ARTICLE_PATH.test(path)) return "article";
    return "other_internal";
  } catch {
    return "direct";
  }
}
