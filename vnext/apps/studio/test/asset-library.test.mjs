import assert from "node:assert/strict";
import test from "node:test";
import { filterCmsAssets, formatAssetBytes } from "../src/asset-library.ts";

const assets = [
  {
    alt: "Studioの記事編集画面",
    byteSize: 2048,
    contentType: "image/png",
    createdAt: "2026-08-12T00:00:00.000Z",
    createdByEmail: "owner@example.com",
    height: null,
    id: "1",
    markdownUrl: "/media/articles/1.png",
    originalName: "studio.png",
    previewUrl: "/api/cms/assets/articles/1.png",
    referenceCount: 2,
    status: "active",
    tags: ["UI"],
    updatedAt: "2026-08-12T00:00:00.000Z",
    width: null
  },
  {
    alt: "",
    byteSize: 1024,
    contentType: "image/webp",
    createdAt: "2026-08-11T00:00:00.000Z",
    createdByEmail: "owner@example.com",
    height: null,
    id: "2",
    markdownUrl: "/media/articles/2.webp",
    originalName: "cloudflare.webp",
    previewUrl: "/api/cms/assets/articles/2.webp",
    referenceCount: 0,
    status: "active",
    tags: ["Cloudflare"],
    updatedAt: "2026-08-11T00:00:00.000Z",
    width: null
  },
  {
    alt: "古い図",
    byteSize: 10,
    contentType: "image/gif",
    createdAt: "2026-08-10T00:00:00.000Z",
    createdByEmail: "owner@example.com",
    height: null,
    id: "3",
    markdownUrl: "/media/articles/3.gif",
    originalName: "old.gif",
    previewUrl: "/api/cms/assets/articles/3.gif",
    referenceCount: 0,
    status: "archived",
    tags: [],
    updatedAt: "2026-08-10T00:00:00.000Z",
    width: null
  }
];

test("filters active assets by editorial state", () => {
  assert.deepEqual(filterCmsAssets(assets, "", "used").map(({ id }) => id), ["1"]);
  assert.deepEqual(filterCmsAssets(assets, "", "unused").map(({ id }) => id), ["2"]);
  assert.deepEqual(filterCmsAssets(assets, "", "missing-alt").map(({ id }) => id), ["2"]);
  assert.deepEqual(filterCmsAssets(assets, "", "archived").map(({ id }) => id), ["3"]);
});

test("searches filename, alt text, and tags without exposing archived assets", () => {
  assert.deepEqual(filterCmsAssets(assets, "cloudflare", "all").map(({ id }) => id), ["2"]);
  assert.deepEqual(filterCmsAssets(assets, "記事編集", "all").map(({ id }) => id), ["1"]);
  assert.deepEqual(filterCmsAssets(assets, "古い", "all"), []);
});

test("formats compact asset sizes", () => {
  assert.equal(formatAssetBytes(900), "900 B");
  assert.equal(formatAssetBytes(2048), "2 KB");
  assert.equal(formatAssetBytes(2 * 1024 * 1024), "2 MB");
});
