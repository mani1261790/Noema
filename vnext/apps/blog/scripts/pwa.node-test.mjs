import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import sharp from "sharp";

const publicUrl = new URL("../public/", import.meta.url);
const worker = await readFile(new URL("sw.js", publicUrl), "utf8");
function harness(fetch) {
  const handlers = {};
  const deleted = [];
  const added = [];
  const fallback = new Response("offline");
  vm.runInNewContext(worker, {
    URL, Response, fetch,
    self: { location: { origin: "https://noema.test" }, clients: { claim: async () => {} }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    caches: { open: async () => ({ add: async (url) => added.push(url) }), match: async () => fallback,
      keys: async () => ["noema-offline-v0", "noema-offline-v1", "unrelated-cache"], delete: async (key) => deleted.push(key) },
  });
  return { handlers, added, deleted, fallback };
}
function request(overrides = {}) { return { url: "https://noema.test/articles/example", method: "GET", mode: "navigate", ...overrides }; }
/** @returns {Promise<Response> | undefined} */
function navigate(h, req) { /** @type {Promise<Response> | undefined} */ let result; h.handlers.fetch({ request: req, respondWith: (value) => { result = value; } }); return result; }

test("manifest references valid opaque icons with the declared dimensions", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", publicUrl), "utf8"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
  for (const icon of manifest.icons) {
    const metadata = await sharp(new URL(icon.src.slice(1), publicUrl).pathname).metadata();
    assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes);
    assert.equal(metadata.format, "png");
    const stats = await sharp(new URL(icon.src.slice(1), publicUrl).pathname).stats();
    assert.equal(stats.isOpaque, true);
  }
  const apple = await sharp(new URL("apple-touch-icon.png", publicUrl).pathname).metadata();
  assert.equal(apple.width, 180);
  assert.equal(apple.height, 180);
  assert.equal(apple.channels, 3);
  assert.equal(apple.hasAlpha, false);
  const rootIcon = await readFile(new URL("apple-touch-icon.png", publicUrl));
  assert.deepEqual(rootIcon, await readFile(new URL("apple-touch-icon-precomposed.png", publicUrl)));
  assert.deepEqual(rootIcon, await readFile(new URL("icons/v2/apple-touch-icon.png", publicUrl)));
  const embeddedIcon = await readFile(new URL("../src/lib/apple-touch-icon.txt", import.meta.url), "utf8");
  assert.ok(embeddedIcon.startsWith("data:image/png;base64,"));
  assert.deepEqual(Buffer.from(embeddedIcon.split(",")[1], "base64"), rootIcon);
});

test("installation caches only the self-contained fallback and cleans only owned old caches", async () => {
  const h = harness(() => {});
  /** @type {Promise<unknown> | undefined} */
  let pending;
  h.handlers.install({ waitUntil: (p) => { pending = p; } });
  await pending;
  assert.deepEqual(h.added, ["/offline"]);
  h.handlers.activate({ waitUntil: (p) => { pending = p; } });
  await pending;
  assert.deepEqual(h.deleted, ["noema-offline-v0"]);
});

test("navigation preserves fresh responses and HTTP errors; only network failure uses fallback", async () => {
  for (const status of [200, 404, 503]) {
    const response = new Response("network", { status });
    const h = harness(async () => response);
    assert.equal(await navigate(h, request()), response);
  }
  const h = harness(async () => { throw new TypeError("offline"); });
  assert.equal(await navigate(h, request()), h.fallback);
});

test("API, previews, writes, cross-origin requests and subresources bypass the worker", () => {
  const h = harness(() => { throw new Error("must not fetch"); });
  for (const overrides of [
    { method: "POST" }, { mode: "cors" }, { url: "https://elsewhere.test/" },
    ...["api/chat", "preview/article", "studio", "admin/settings", "auth/login"].map((path) => ({ url: `https://noema.test/${path}` })),
  ]) assert.equal(navigate(h, request(overrides)), undefined);
});
