import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveStaticPageRevisions,
  staticPageRevisionsPlugin,
  staticPageSources,
} from "./static-page-revisions.mjs";

test("maps each indexable static page to its latest tracked source revision", () => {
  const dates = new Map([
    [staticPageSources["/about"].join("|"), "2026-08-26"],
    [staticPageSources["/privacy"].join("|"), "2026-08-28"],
    [staticPageSources["/updates"].join("|"), "2026-08-27"],
  ]);

  assert.deepEqual(resolveStaticPageRevisions((sources) => dates.get(sources.join("|")) ?? ""), {
    "/about": "2026-08-26",
    "/privacy": "2026-08-28",
    "/updates": "2026-08-27",
  });
});

test("fails closed instead of publishing a missing or malformed last-modified date", () => {
  assert.throws(
    () => resolveStaticPageRevisions(() => ""),
    /accurate sitemap last-modified date/,
  );
  assert.throws(
    () => resolveStaticPageRevisions(() => "28 August 2026"),
    /accurate sitemap last-modified date/,
  );
});

test("serves immutable revision data through the build-only virtual module", () => {
  const plugin = staticPageRevisionsPlugin({
    repositoryRoot: "/repo",
    readRevisions(root) {
      assert.equal(root, "/repo");
      return { "/about": "2026-08-26", "/privacy": "2026-08-28", "/updates": "2026-08-27" };
    },
  });
  const resolved = plugin.resolveId("virtual:noema-static-page-revisions");

  assert.equal(resolved, "\0virtual:noema-static-page-revisions");
  assert.match(plugin.load(resolved), /Object\.freeze/);
  assert.equal(plugin.resolveId("virtual:unrelated"), null);
  assert.equal(plugin.load("\0virtual:unrelated"), null);
});
