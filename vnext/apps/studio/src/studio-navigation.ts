export type StudioView = "articles" | "assets" | "editor" | "team";

const studioViewPaths: Record<StudioView, string> = {
  articles: "/articles",
  assets: "/assets",
  editor: "/editor",
  team: "/team"
};

export function studioViewHref(view: StudioView): string {
  return `#${studioViewPaths[view]}`;
}

export function readStudioView(hash: string, fallback: StudioView): StudioView {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = Object.entries(studioViewPaths).find(([, value]) => value === path);
  return match ? match[0] as StudioView : fallback;
}

export function writeStudioHistory(view: StudioView, mode: "push" | "replace" = "push"): void {
  const method = mode === "replace" ? "replaceState" : "pushState";
  window.history[method]({ noemaStudio: true, view }, "", studioViewHref(view));
}
