import { describe, it, expect, vi } from "vitest";
import { articleOgImagePath, createArticleOgMarkup, fitArticleTitle } from "./article-og";

const mocks = vi.hoisted(() => ({ get: vi.fn(), assets: vi.fn(), render: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { ASSETS: { fetch: mocks.assets } } }));
vi.mock("./cms-publications", () => ({ getPublishedArticleBySlug: mocks.get }));
vi.mock("@cloudflare/pages-plugin-vercel-og/api", () => ({ ImageResponse: class { arrayBuffer() { return mocks.render(); } } }));
import { GET } from "../pages/og/articles/[slug].png";
const request = () => GET({ params: { slug: "example" }, request: new Request("https://example.com/og/articles/example.png") } as unknown as Parameters<typeof GET>[0]);

describe("article social previews", () => {
  it("invalidates image URL when displayed content changes and encodes slug", () => {
    const base = { slug: "a/b", title: "タイトル", topic: "数理" };
    expect(articleOgImagePath(base)).toContain("a%2Fb.png?v=");
    expect(articleOgImagePath(base)).not.toBe(articleOgImagePath({ ...base, title: "新しいタイトル" }));
    expect(articleOgImagePath(base)).not.toBe(articleOgImagePath({ ...base, topic: "対話AI" }));
  });
  it("bounds unusually long Japanese and Latin titles, preserving short titles", () => {
    for (const title of ["知る".repeat(100), "LongUnbrokenIdentifier".repeat(30)]) {
      const lines = fitArticleTitle(title);
      expect(lines).toHaveLength(3);
      expect(lines[2]).toMatch(/…$/);
    }
    expect(JSON.stringify(createArticleOgMarkup({ title: "AIを知る", topic: "対話AI" }))).toContain("AIを知る");
  });
  it("keeps Japanese words together", () => {
    expect(fitArticleTitle("LLM が次の1文字を予想する仕組みを、数えた確率の表で考える").join("|")).not.toContain("仕組|み");
  });
  it("does not render unpublished or missing articles", async () => {
    mocks.get.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
  });
  it("serves PNG and keeps unlisted images out of shared caches", async () => {
    mocks.get.mockResolvedValue({ visibility: "unlisted", data: { title: "限定", topics: ["mathematics"] } });
    mocks.assets.mockImplementation(async () => new Response(new Uint8Array([1])));
    mocks.render.mockResolvedValue(new Uint8Array([137, 80, 78, 71]).buffer);
    const result = await request();
    expect(result.headers.get("Content-Type")).toBe("image/png");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("falls back without caching when deferred rendering fails", async () => {
    mocks.render.mockRejectedValue(new Error("renderer unavailable"));
    const result = await request();
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.assets.mock.calls.at(-1)?.[0].url).toContain("/og/default.png");
  });
});
