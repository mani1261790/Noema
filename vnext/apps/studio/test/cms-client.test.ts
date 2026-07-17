import { describe, expect, it, vi } from "vitest";
import { createBlankArticle } from "../src/draft-storage";
import {
  fetchCmsMembers,
  runCmsArticleAction,
  updateCmsArticle
} from "../src/cms-client";

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, {
    headers: { "content-type": "application/json; charset=utf-8" },
    status
  });
}

function articleDetail(lockVersion = 4) {
  const frontmatter = createBlankArticle();
  frontmatter.title = "CMS client";
  frontmatter.slug = "cms-client";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    lockVersion,
    publicationStatus: "unpublished",
    revisionNumber: 2,
    reviewStatus: "draft",
    slug: frontmatter.slug,
    title: frontmatter.title,
    updatedAt: "2026-07-18T00:00:00.000Z",
    updatedByEmail: "editor@example.com",
    visibility: "public",
    currentRevision: {
      createdAt: "2026-07-18T00:00:00.000Z",
      createdByEmail: "editor@example.com",
      frontmatter,
      id: "22222222-2222-4222-8222-222222222222",
      markdown: "## CMS client",
      number: 2
    },
    publishedRevisionNumber: null,
    publishedSlug: null,
    publishedVisibility: null,
    reviewNote: null
  };
}

describe("CMS client optimistic updates", () => {
  it("sends the expected revision in both the body and If-Match", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("PUT");
      expect(new Headers(init?.headers).get("if-match")).toBe('"cms-v3"');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        expectedVersion: 3,
        visibility: "public"
      });
      return jsonResponse({ article: articleDetail() });
    });
    const frontmatter = createBlankArticle();

    const result = await updateCmsArticle(
      "11111111-1111-4111-8111-111111111111",
      3,
      { frontmatter, markdown: "## Local draft", visibility: "public" },
      { fetchFn }
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.lockVersion).toBe(4);
  });

  it("preserves a server revision conflict as a recoverable client result", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({
      error: {
        code: "revision_conflict",
        message: "別の編集者が記事を更新しました。最新版を読み込んでください。",
        retryable: false
      }
    }, 412));

    const result = await updateCmsArticle(
      "11111111-1111-4111-8111-111111111111",
      3,
      { frontmatter: createBlankArticle(), markdown: "local", visibility: "internal" },
      { fetchFn }
    );

    expect(result).toEqual({
      error: {
        code: "revision_conflict",
        message: "別の編集者が記事を更新しました。最新版を読み込んでください。",
        retryable: false,
        status: 412
      },
      ok: false
    });
  });

  it("sends If-Match for workflow actions", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("if-match")).toBe('"cms-v4"');
      expect(JSON.parse(String(init?.body))).toEqual({
        action: "publish",
        expectedVersion: 4,
        visibility: "unlisted"
      });
      return jsonResponse({ article: articleDetail(5) });
    });

    const result = await runCmsArticleAction(
      "11111111-1111-4111-8111-111111111111",
      4,
      "publish",
      { visibility: "unlisted" },
      { fetchFn }
    );

    expect(result.ok).toBe(true);
  });
});

describe("CMS member client", () => {
  it("distinguishes invited and provisioned members", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({
      members: [
        {
          active: true,
          email: "pending@example.com",
          provisioned: false,
          role: "editor",
          updatedAt: "2026-07-18T00:00:00.000Z"
        },
        {
          active: true,
          email: "reviewer@example.com",
          provisioned: true,
          role: "reviewer",
          updatedAt: "2026-07-18T00:00:01.000Z"
        }
      ]
    }));

    const result = await fetchCmsMembers({ fetchFn });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((member) => member.provisioned)).toEqual([false, true]);
  });

  it("rejects malformed JSON even when the response claims to be JSON", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{", {
      headers: { "content-type": "application/json" },
      status: 200
    }));

    const result = await fetchCmsMembers({ fetchFn });

    expect(result).toEqual({
      error: {
        code: "invalid_response",
        message: "CMSから安全に読み取れる応答を受け取れませんでした。",
        retryable: true,
        status: 200
      },
      ok: false
    });
  });
});
