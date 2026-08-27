import { describe, expect, it, vi } from "vitest";
import {
  CMS_CLOUDFLARE_WEB_ANALYTICS_URL,
  CMS_GOOGLE_SEARCH_CONSOLE_URL
} from "@noema/cms";
import { createBlankArticle } from "../src/draft-storage";
import {
  deleteCmsArticle,
  fetchCmsArticles,
  fetchCmsAnalyticsSummary,
  fetchCmsArticleVersion,
  fetchCmsArticleVersionCheckpoints,
  fetchCmsArticleVersions,
  fetchCmsMembers,
  rebuildCmsAnalyticsMart,
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
      editor: {
        displayName: "最後の編集者",
        publicId: "0123456789abcdef0123456789abcdef"
      },
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

describe("CMS article deletion client", () => {
  it("sends the expected version in the body and If-Match header", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

    await expect(deleteCmsArticle(
      "11111111-1111-4111-8111-111111111111",
      4,
      { fetchFn }
    )).resolves.toEqual({ ok: true, value: null });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/cms/articles/11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        body: JSON.stringify({ expectedVersion: 4 }),
        headers: expect.objectContaining({
          "content-type": "application/json",
          "if-match": '"cms-v4"'
        }),
        method: "DELETE"
      })
    );
  });
});

describe("CMS analytics client", () => {
  it("parses revision and source metrics", async () => {
    const counts = {
      article50: 8,
      articleEnd: 6,
      assistantError: 1,
      assistantOpen: 3,
      assistantSuccess: 2,
      landing: 10,
      navigationClick: 3,
      relatedClick: 2,
      seriesNext: 1,
      share: 1,
      updatesAction: 1,
      updatesClick: 2
    };
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({ summary: {
      articles: [{
        ...counts,
        articleId: "11111111-1111-4111-8111-111111111111",
        article50Rate: 0.8,
        assistantSuccessRate: 2 / 3,
        assistantUseRate: 0.3,
        onwardRate: 0.5,
        qualifiedReadRate: 0.6,
        revisionNumber: 4,
        slug: "analytics-article",
        title: "分析記事",
        updatesActionRate: 0.5,
        updatesGuideRate: 1 / 3
      }],
      comparison: {
        availableOn: "2026-08-23",
        range: { from: "2026-06-25", through: "2026-07-24" },
        status: "available",
        totals: {
          ...counts,
          article50Rate: 0.7,
          assistantSuccessRate: 0.5,
          assistantUseRate: 0.2,
          onwardRate: 0.4,
          qualifiedReadRate: 0.5,
          updatesActionRate: 0.5,
          updatesGuideRate: 0.25
        }
      },
      daily: [{ articleEnd: 6, date: "2026-08-23", landing: 10, navigationClick: 3, updatesAction: 1, updatesClick: 2 }],
      entries: [{
        article50: 5,
        article50Rate: 5 / 6,
        articleEnd: 4,
        entryKind: "home",
        landing: 6,
        navigationClick: 2,
        qualifiedReadRate: 4 / 6,
        updatesClick: 1,
        updatesGuideRate: 1 / 4
      }],
      health: {
        acceptedEvents: 10,
        checks: [{ detail: "正常です。", id: "freshness", label: "収集鮮度", status: "pass" }],
        duplicateEvents: 0,
        entryCoverageFrom: "2026-08-23",
        eventContractVersion: 1,
        generatedAt: "2026-08-23T01:00:00.000Z",
        latestEventReceivedAt: "2026-08-23T00:59:00.000Z",
        metricCatalogVersion: "2026-09-01",
        rawCoverageFrom: "2026-08-23",
        reprocessableFrom: "2026-08-23",
        retention: { eventFactsDays: 45, reportingMartDays: 500 },
        sources: [
          { id: "noema_reader_events", role: "記事内行動", status: "active" },
          {
            accessUrl: CMS_CLOUDFLARE_WEB_ANALYTICS_URL,
            id: "cloudflare_web_analytics",
            role: "Core Web Vitals",
            status: "external"
          },
          {
            accessUrl: CMS_GOOGLE_SEARCH_CONSOLE_URL,
            id: "google_search_console",
            role: "検索パフォーマンス",
            status: "external"
          }
        ],
        status: "healthy"
      },
      onwardPaths: [{
        clickCount: 2,
        navigationKind: "related",
        sourceArticleId: "11111111-1111-4111-8111-111111111111",
        sourceRevisionNumber: 4,
        sourceSlug: "analytics-article",
        sourceTitle: "分析記事",
        targetSlug: "next-article",
        targetTitle: "次の記事"
      }],
      onwardPathsTruncated: false,
      range: { days: 30, from: "2026-07-25", through: "2026-08-23" },
      sources: [{
        article50: 8,
        article50Rate: 0.8,
        articleEnd: 6,
        campaign: "launch",
        content: "diagram",
        landing: 10,
        medium: "social",
        navigationClick: 3,
        qualifiedReadRate: 0.6,
        referrerHost: "",
        source: "x",
        updatesClick: 2,
        updatesGuideRate: 1 / 3
      }],
      totals: {
        ...counts,
        article50Rate: 0.8,
        assistantSuccessRate: 2 / 3,
        assistantUseRate: 0.3,
        onwardRate: 0.5,
        qualifiedReadRate: 0.6,
        updatesActionRate: 0.5,
        updatesGuideRate: 1 / 3
      }
    } }));

    const result = await fetchCmsAnalyticsSummary(30, { fetchFn });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.articles[0]).toMatchObject({ revisionNumber: 4, landing: 10 });
      expect(result.value.sources[0]).toMatchObject({ campaign: "launch", source: "x" });
      expect(result.value.entries[0]).toMatchObject({ entryKind: "home", landing: 6 });
      expect(result.value.onwardPaths[0]).toMatchObject({
        clickCount: 2,
        navigationKind: "related",
        targetSlug: "next-article"
      });
      expect(result.value.onwardPathsTruncated).toBe(false);
      expect(result.value.comparison).toMatchObject({
        status: "available",
        totals: { article50Rate: 0.7, qualifiedReadRate: 0.5 }
      });
      expect(result.value.health).toMatchObject({
        metricCatalogVersion: "2026-09-01",
        retention: { eventFactsDays: 45, reportingMartDays: 500 },
        sources: expect.arrayContaining([expect.objectContaining({
          accessUrl: CMS_CLOUDFLARE_WEB_ANALYTICS_URL,
          id: "cloudflare_web_analytics",
          status: "external"
        }), expect.objectContaining({
          accessUrl: CMS_GOOGLE_SEARCH_CONSOLE_URL,
          id: "google_search_console",
          status: "external"
        })])
      });
    }
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/cms/analytics/summary?days=30",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("rejects malformed analytics counts", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({ summary: {
      articles: [],
      daily: [],
      range: { days: 30, from: "2026-07-25", through: "2026-08-23" },
      sources: [],
      totals: { landing: "10" }
    } }));

    expect(await fetchCmsAnalyticsSummary(30, { fetchFn })).toMatchObject({
      error: { code: "invalid_response" },
      ok: false
    });
  });

  it("requests a bounded analytics mart rebuild", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => jsonResponse({ rebuild: {
      completedAt: "2026-08-23T01:02:03.000Z",
      from: "2026-08-20",
      runId: "019d2f30-4dc8-7a32-8a31-e5e80b4f0d9e",
      sourceEventCount: 42,
      through: "2026-08-23"
    } }));

    await expect(rebuildCmsAnalyticsMart("2026-08-20", "2026-08-23", { fetchFn }))
      .resolves.toMatchObject({ ok: true, value: { sourceEventCount: 42 } });
    expect(fetchFn).toHaveBeenCalledWith(
      "/api/cms/analytics/rebuild",
      expect.objectContaining({
        body: JSON.stringify({ from: "2026-08-20", through: "2026-08-23" }),
        method: "POST"
      })
    );
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
          createdAt: path.includes("?before=3")
            ? "2026-07-18T00:01:00.000Z"
            : "2026-07-18T00:02:00.000Z",
          createdByEmail: "editor@example.com",
          id: path.includes("?before=3")
            ? "44444444-4444-4444-8444-444444444444"
            : "22222222-2222-4222-8222-222222222222",
          isApproved: false,
          isCurrent: !path.includes("?before=3"),
          isPublished: false,
          number: path.includes("?before=3") ? 2 : 3,
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
    const olderCheckpoints = await fetchCmsArticleVersionCheckpoints(
      "11111111-1111-4111-8111-111111111111",
      "33333333-3333-4333-8333-333333333333",
      3,
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
    expect(olderCheckpoints.ok && olderCheckpoints.value.checkpoints[0]).toMatchObject({
      number: 2,
      reason: "manual"
    });
    expect(fetchFn.mock.calls.map(([input]) => String(input))).toContain(
      "/api/cms/articles/11111111-1111-4111-8111-111111111111/versions/33333333-3333-4333-8333-333333333333/checkpoints?before=3"
    );
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
    if (result.ok) {
      expect(result.value.lockVersion).toBe(4);
      expect(result.value.currentRevision.editor).toEqual({
        displayName: "最後の編集者",
        publicId: "0123456789abcdef0123456789abcdef"
      });
    }
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
          displayName: null,
          email: "pending@example.com",
          passwordLoginReadyAt: null,
          provisioned: false,
          role: "editor",
          updatedAt: "2026-07-18T00:00:00.000Z"
        },
        {
          active: true,
          displayName: "レビュー担当",
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
