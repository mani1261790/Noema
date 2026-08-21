export type StudioView = "articles" | "assets" | "editor" | "team";

const studioViewPaths: Record<StudioView, string> = {
  articles: "/articles",
  assets: "/assets",
  editor: "/editor",
  team: "/team"
};

export function studioViewHref(view: StudioView): string {
  return studioViewPaths[view];
}

export function readStudioView(pathname: string): StudioView {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, "") : pathname;
  const match = Object.entries(studioViewPaths).find(([, value]) => value === path);
  return match ? (match[0] as StudioView) : "articles";
}

export function writeStudioHistory(view: StudioView, mode: "push" | "replace" = "push"): void {
  const method = mode === "replace" ? "replaceState" : "pushState";
  window.history[method]({ noemaStudio: true, view }, "", studioViewHref(view));
}
