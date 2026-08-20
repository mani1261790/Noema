import { describe, expect, it, vi } from "vitest";
import { createBlankArticle } from "../src/draft-storage";
import {
  fetchCmsArticles,
  fetchCmsArticleVersion,
  fetchCmsArticleVersionCheckpoints,
  fetchCmsArticleVersions,
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

function articleSummary() {
  const { currentRevision: _currentRevision, ...summary } = articleDetail();
  const {
    publishedRevisionNumber: _publishedRevisionNumber,
    publishedSlug: _publishedSlug,
    publishedVisibility: _publishedVisibility,
    reviewNote: _reviewNote,
    ...value
  } = summary;
  return value;
}

describe("CMS article list client", () => {
  it("parses the article summaries used by the Studio library", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({
      articles: [articleSummary()]
    }));

    const result = await fetchCmsArticles({ fetchFn });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([articleSummary()]);
      expect(result.value[0]?.id).toBe("11111111-1111-4111-8111-111111111111");
    }
  });

  it("rejects the whole list when a summary is malformed", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({
      articles: [articleSummary(), { ...articleSummary(), revisionNumber: "2" }]
    }));

    const result = await fetchCmsArticles({ fetchFn });

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

describe("CMS version history client", () => {
  it("parses grouped versions and a restorable revision", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      if (path.endsWith("/versions")) return jsonResponse({ versions: [{
        checkpointCount: 3,
        createdAt: "2026-07-18T00:00:00.000Z",
        createdByEmail: "editor@example.com",
        firstRevisionNumber: 1,
        id: "33333333-3333-4333-8333-333333333333",
        isApproved: false,
        isCurrent: true,
        isPublished: false,
        latestRevisionId: "22222222-2222-4222-8222-222222222222",
        latestRevisionNumber: 3,
        reason: "manual",
        sourceRevisionId: null,
        updatedAt: "2026-07-18T00:02:00.000Z"
      }] });
      if (path.includes("/checkpoints")) return jsonResponse({
        checkpoints: [{
          createdAt: "2026-07-18T00:02:00.000Z",
          createdByEmail: "editor@example.com",
          id: "22222222-2222-4222-8222-222222222222",
          isApproved: false,
          isCurrent: true,
          isPublished: false,
          number: 3,
          reason: "manual"
        }],
        nextBeforeRevisionNumber: null
      });
      return jsonResponse({ version: {
        isApproved: false,
        isCurrent: true,
        isPublished: false,
        reason: "manual",
        revision: articleDetail().currentRevision,
        sourceRevisionId: null,
        visibility: "public"
      } });
    });

    const versions = await fetchCmsArticleVersions(
      "11111111-1111-4111-8111-111111111111",
      { fetchFn }
    );
    const version = await fetchCmsArticleVersion(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      { fetchFn }
    );
    const checkpoints = await fetchCmsArticleVersionCheckpoints(
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
      undefined,
      { fetchFn }
    );

    expect(versions.ok && versions.value[0]).toMatchObject({
      checkpointCount: 3,
      reason: "manual"
    });
    expect(version.ok && version.value).toMatchObject({
      reason: "manual",
      visibility: "public"
    });
    expect(checkpoints.ok && checkpoints.value.checkpoints[0]).toMatchObject({
      number: 3,
      reason: "manual"
    });
  });
});

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

  it("sends the editing session and restore provenance with a save", async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        editSessionId: "33333333-3333-4333-8333-333333333333",
        saveReason: "restored",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222"
      });
      return jsonResponse({ article: articleDetail() });
    });

    const result = await updateCmsArticle(
      "11111111-1111-4111-8111-111111111111",
      3,
      { frontmatter: createBlankArticle(), markdown: "restored", visibility: "public" },
      { fetchFn },
      {
        editSessionId: "33333333-3333-4333-8333-333333333333",
        saveReason: "restored",
        sourceRevisionId: "22222222-2222-4222-8222-222222222222"
      }
    );

    expect(result.ok).toBe(true);
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
          passwordLoginReadyAt: null,
          provisioned: false,
          role: "editor",
          updatedAt: "2026-07-18T00:00:00.000Z"
        },
        {
          active: true,
          email: "reviewer@example.com",
          passwordLoginReadyAt: "2026-07-18T00:00:00.000Z",
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
