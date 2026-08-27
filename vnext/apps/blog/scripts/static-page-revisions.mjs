import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const VIRTUAL_MODULE_ID = "virtual:noema-static-page-revisions";
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const staticPageSources = Object.freeze({
  "/about": ["vnext/apps/blog/src/pages/about.astro"],
  "/privacy": [
    "vnext/apps/blog/src/pages/privacy.astro",
    "vnext/packages/cms/src/index.ts",
  ],
  "/updates": ["vnext/apps/blog/src/pages/updates.astro"],
});

export function resolveStaticPageRevisions(readLastModified) {
  return Object.fromEntries(Object.entries(staticPageSources).map(([pathname, sources]) => {
    const lastModified = readLastModified(sources).trim();
    if (!ISO_DATE.test(lastModified)) {
      throw new Error(`Could not resolve an accurate sitemap last-modified date for ${pathname}.`);
    }
    return [pathname, lastModified];
  }));
}

export function readStaticPageRevisions(repositoryRoot) {
  const root = resolve(repositoryRoot);
  const runGit = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const actualRoot = resolve(runGit(["rev-parse", "--show-toplevel"]));
  if (actualRoot !== root) {
    throw new Error(`Expected ${root} to be the Git repository root, received ${actualRoot}.`);
  }
  if (runGit(["rev-parse", "--is-shallow-repository"]) === "true") {
    throw new Error("Accurate static-page sitemap dates require a full Git history. Configure checkout with fetch-depth: 0.");
  }
  return resolveStaticPageRevisions((sources) =>
    runGit(["log", "-1", "--format=%cs", "--", ...sources]),
  );
}

export function staticPageRevisionsPlugin({ repositoryRoot, readRevisions = readStaticPageRevisions }) {
  return {
    name: "noema-static-page-revisions",
    resolveId(source) {
      return source === VIRTUAL_MODULE_ID ? RESOLVED_VIRTUAL_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) return null;
      const revisions = readRevisions(repositoryRoot);
      return `export default Object.freeze(${JSON.stringify(revisions)});`;
    },
  };
}
