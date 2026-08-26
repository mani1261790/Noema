export type StudioView = "analytics" | "articles" | "assets" | "editor" | "team";

const studioViewPaths: Record<StudioView, string> = {
  analytics: "/analytics",
  articles: "/articles",
  assets: "/assets",
  editor: "/editor",
  team: "/team"
};

export function studioViewHref(view: StudioView): string {
  return studioViewPaths[view];
}

export function studioEditorHref(articleId: string | null = null): string {
  if (!articleId) return studioViewPaths.editor;
  return `${studioViewPaths.editor}?article=${encodeURIComponent(articleId)}`;
}

export function readStudioEditorArticleId(pathname: string, search: string): string | null {
  if (readStudioView(pathname) !== "editor") return null;
  const articleId = new URLSearchParams(search).get("article")?.trim() ?? "";
  return articleId.length > 0 && articleId.length <= 128 ? articleId : null;
}

export function resolveInitialStudioEditorArticleId({
  pathname,
  recoveryArticleId,
  rememberedArticleId,
  search
}: {
  pathname: string;
  recoveryArticleId: string | null;
  rememberedArticleId: string | null;
  search: string;
}): string | null {
  if (readStudioView(pathname) !== "editor") return null;
  return recoveryArticleId
    ?? readStudioEditorArticleId(pathname, search)
    ?? rememberedArticleId;
}

export function readStudioView(pathname: string): StudioView {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  const match = Object.entries(studioViewPaths).find(([, value]) => value === path);
  return match ? (match[0] as StudioView) : "articles";
}

export function writeStudioHistory(
  view: StudioView,
  mode: "push" | "replace" = "push",
  articleId: string | null = null
): void {
  const method = mode === "replace" ? "replaceState" : "pushState";
  const href = view === "editor" ? studioEditorHref(articleId) : studioViewHref(view);
  window.history[method]({ articleId, noemaStudio: true, view }, "", href);
}
