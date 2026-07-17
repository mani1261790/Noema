import { describe, expect, it, vi } from "vitest";
import type {
  ArticleSubmissionDecision,
  ArticleSubmissionPlan,
} from "@noema/studio-publication";
import {
  GITHUB_PUBLICATION_TARGET,
  GitHubPublicationAdapter,
  GitHubPublicationConfigurationError,
  GitHubPublicationConflictError,
  GitHubPublicationError,
} from "../worker/github-publication";
import { TEST_GITHUB_PRIVATE_KEY } from "./github-test-fixture";

const NOW = Date.parse("2026-07-17T00:00:00.000Z");
const BASE_SHA = "a".repeat(40);
const BASE_TREE_SHA = "b".repeat(40);
const ARTICLE_BLOB_SHA = "c".repeat(40);
const ARTICLE_TREE_SHA = "d".repeat(40);
const INITIAL_COMMIT_SHA = "e".repeat(40);
const ACCESS_TOKEN = "installation-token-for-tests";
const SUBMISSION_ID = "287f0d8b-c79f-4b20-9c3d-683b0c4e643e";

type CreateRefAction = Extract<
  ArticleSubmissionDecision,
  { action: "create_submission_ref" }
>;

interface RecordedRequest {
  authorization: string | null;
  body: string;
  method: string;
  path: string;
  userAgent: string | null;
  version: string | null;
}

type ResponseFactory = (
  request: RecordedRequest,
) => Response | Promise<Response>;

class GitHubScript {
  readonly requests: RecordedRequest[] = [];
  readonly unexpected: string[] = [];
  readonly #routes = new Map<string, ResponseFactory[]>();

  readonly fetch = (async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: Parameters<typeof globalThis.fetch>[1],
  ): Promise<Response> => {
    const inputRequest = input instanceof Request ? input : null;
    const url = new URL(inputRequest?.url ?? String(input));
    const headers = new Headers(init?.headers ?? inputRequest?.headers);
    const method = init?.method ?? inputRequest?.method ?? "GET";
    const body =
      typeof init?.body === "string"
        ? init.body
        : inputRequest
          ? await inputRequest.clone().text()
          : "";
    const recorded: RecordedRequest = {
      authorization: headers.get("authorization"),
      body,
      method,
      path: `${url.pathname}${url.search}`,
      userAgent: headers.get("user-agent"),
      version: headers.get("x-github-api-version"),
    };
    this.requests.push(recorded);

    const key = `${recorded.method} ${recorded.path}`;
    const factories = this.#routes.get(key);
    const factory = factories?.shift();
    if (!factory) {
      this.unexpected.push(key);
      return jsonResponse({ message: "unexpected test request" }, 500);
    }
    return factory(recorded);
  }) as typeof globalThis.fetch;

  add(
    method: "GET" | "POST",
    path: string,
    ...responses: Array<Response | ResponseFactory>
  ): void {
    const key = `${method} ${path}`;
    const factories = this.#routes.get(key) ?? [];
    for (const response of responses) {
      factories.push(typeof response === "function" ? response : () => response);
    }
    this.#routes.set(key, factories);
  }

  expectDone(): void {
    expect(this.unexpected).toEqual([]);
    const remaining = [...this.#routes.entries()]
      .filter(([, factories]) => factories.length > 0)
      .map(([key, factories]) => `${key} (${factories.length})`);
    expect(remaining).toEqual([]);
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function reference(name: string, sha: string): unknown {
  return { ref: `refs/${name}`, object: { sha, type: "commit" } };
}

function gitCommit(
  sha: string,
  treeSha: string,
  message: string,
  parents: string[],
): unknown {
  return {
    sha,
    message,
    tree: { sha: treeSha },
    parents: parents.map((parentSha) => ({ sha: parentSha })),
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

async function validPlan(): Promise<ArticleSubmissionPlan> {
  const slug = "github-publication-adapter";
  const path = `vnext/apps/blog/src/content/articles/${slug}.md`;
  const content = [
    "---",
    'title: "GitHub publication adapter"',
    'description: "GitHub publication adapter test article."',
    `slug: "${slug}"`,
    'status: "draft"',
    'updatedAt: "2026-07-17"',
    "authors:",
    '  - "Noema Editorial"',
    "topics:",
    '  - "development-environment"',
    "tags: []",
    'approach: "development"',
    'outcome: "GitHub publication adapter is verified"',
    "prerequisites: []",
    "estimatedMinutes: 10",
    "heroImage: null",
    "sources: []",
    "---",
    "",
    "Test article.",
    "",
  ].join("\n");
  const contentSha256 = await sha256(content);
  const metadata = {
    version: 1 as const,
    submissionId: SUBMISSION_ID,
    requestSha256: `sha256:${"f".repeat(64)}`,
    contentSha256,
    articlePath: path,
    baseBranch: "develop" as const,
    submissionMode: "create_only" as const,
  };
  const headBranch = `studio/submissions/${SUBMISSION_ID}`;
  const commitMessage = [
    `Studio: add article ${slug}`,
    "",
    `Noema-Studio-Submission: ${metadata.submissionId}`,
    `Noema-Studio-Request-SHA256: ${metadata.requestSha256}`,
    `Noema-Studio-Content-SHA256: ${metadata.contentSha256}`,
    `Noema-Studio-Article-Path: ${metadata.articlePath}`,
  ].join("\n");
  const pullRequestBody = [
    "Noema Studioから新規記事を送信します。",
    "",
    `- 記事: \`${metadata.articlePath}\``,
    `- 送信ID: \`${metadata.submissionId}\``,
    "",
    "このPull RequestはDraftとして作成し、内容をレビューしてからdevelopへマージします。",
    "",
    `<!-- noema-studio-submission:${JSON.stringify(metadata)} -->`,
  ].join("\n");

  return {
    version: 1,
    operation: "create_article",
    intent: {
      ...metadata,
      principalId: "access-subject:test-author",
      slug,
      headBranch,
      reviewKind: "draft_pull_request",
      repository: "mani1261790/Noema",
    },
    article: { slug, path, content, contentSha256 },
    git: {
      baseBranch: "develop",
      headBranch,
      commitMessage,
      allowDirectBaseWrite: false,
      allowForceUpdate: false,
    },
    pullRequest: {
      baseBranch: "develop",
      headBranch,
      title: `Studio: add article ${slug}`,
      body: pullRequestBody,
      draft: true,
    },
    metadata,
  };
}

function createRefAction(plan: ArticleSubmissionPlan): CreateRefAction {
  return {
    ok: true,
    kind: "act",
    action: "create_submission_ref",
    baseCommitSha: BASE_SHA,
    commitMetadata: { ...plan.metadata, baseCommitSha: BASE_SHA },
    expectedClaim: {
      version: 1,
      intent: plan.intent,
      refCreationStarted: true,
      initialCommit: null,
      pullRequestNumber: null,
      terminalOutcome: null,
    },
  };
}

function adapter(script: GitHubScript): GitHubPublicationAdapter {
  return new GitHubPublicationAdapter(
    {
      clientId: "Iv1.test-client-id",
      installationId: "12345678",
      privateKeyPem: TEST_GITHUB_PRIVATE_KEY,
    },
    { fetch: script.fetch, now: () => NOW },
  );
}

function addToken(script: GitHubScript): void {
  script.add(
    "POST",
    "/app/installations/12345678/access_tokens",
    jsonResponse(
      {
        token: ACCESS_TOKEN,
        expires_at: "2026-07-17T01:00:00.000Z",
        permissions: { contents: "write", pull_requests: "write" },
        repositories: [{ full_name: "mani1261790/Noema" }],
      },
      201,
    ),
  );
}

function baseReferenceResponse(): Response {
  return jsonResponse(reference("heads/develop", BASE_SHA));
}

function addBaseObservation(script: GitHubScript): void {
  script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
  script.add(
    "GET",
    `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
    jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
  );
  script.add(
    "GET",
    `/repos/mani1261790/Noema/git/trees/${BASE_TREE_SHA}?recursive=1`,
    jsonResponse({ sha: BASE_TREE_SHA, truncated: false, tree: [] }),
  );
}

function branchRefPath(plan: ArticleSubmissionPlan): string {
  return `/repos/mani1261790/Noema/git/ref/heads/${plan.git.headBranch}`;
}

function pullRequestListPath(plan: ArticleSubmissionPlan): string {
  const query = new URLSearchParams({
    base: "develop",
    head: `mani1261790:${plan.git.headBranch}`,
    per_page: "100",
    state: "all",
  });
  return `/repos/mani1261790/Noema/pulls?${query.toString()}`;
}

function commitListPath(plan: ArticleSubmissionPlan): string {
  const query = new URLSearchParams({
    path: plan.article.path,
    per_page: "100",
    sha: plan.git.headBranch,
  });
  return `/repos/mani1261790/Noema/commits?${query.toString()}`;
}

function addBranchObservation(
  script: GitHubScript,
  plan: ArticleSubmissionPlan,
): void {
  script.add(
    "GET",
    branchRefPath(plan),
    jsonResponse(reference(`heads/${plan.git.headBranch}`, INITIAL_COMMIT_SHA)),
  );
  script.add(
    "GET",
    commitListPath(plan),
    jsonResponse([
      { sha: INITIAL_COMMIT_SHA, commit: { message: plan.git.commitMessage } },
    ]),
  );
  script.add(
    "GET",
    `/repos/mani1261790/Noema/git/commits/${INITIAL_COMMIT_SHA}`,
    jsonResponse(
      gitCommit(
        INITIAL_COMMIT_SHA,
        ARTICLE_TREE_SHA,
        plan.git.commitMessage,
        [BASE_SHA],
      ),
    ),
  );
  script.add(
    "GET",
    `/repos/mani1261790/Noema/compare/${BASE_SHA}...${INITIAL_COMMIT_SHA}?per_page=100`,
    jsonResponse({
      status: "ahead",
      ahead_by: 1,
      total_commits: 1,
      files: [
        { filename: plan.article.path, sha: ARTICLE_BLOB_SHA, status: "added" },
      ],
    }),
  );
  script.add(
    "GET",
    `/repos/mani1261790/Noema/git/blobs/${ARTICLE_BLOB_SHA}`,
    jsonResponse({
      sha: ARTICLE_BLOB_SHA,
      encoding: "base64",
      content: btoa(plan.article.content),
    }),
  );
}

function rawPullRequest(plan: ArticleSubmissionPlan, number = 42): unknown {
  return {
    number,
    html_url: `https://github.com/mani1261790/Noema/pull/${number}`,
    state: "open",
    draft: true,
    title: plan.pullRequest.title,
    body: plan.pullRequest.body,
    merged_at: null,
    merge_commit_sha: null,
    base: { ref: "develop", sha: BASE_SHA },
    head: { ref: plan.git.headBranch, sha: INITIAL_COMMIT_SHA },
  };
}

function decodeJwtPart(value: string): Record<string, unknown> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

describe("GitHubPublicationAdapter", () => {
  it("uses a signed App JWT, repository-scoped token, and fixed GitHub headers", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    addBaseObservation(script);
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add("GET", pullRequestListPath(plan), jsonResponse([]));

    const observation = await adapter(script).observe(plan);

    expect(observation).toEqual({
      base: {
        state: "known",
        value: { headSha: BASE_SHA, targetPath: null, articlesWithSlug: [] },
      },
      branch: { state: "known", value: null },
      pullRequests: { state: "known", value: [] },
    });
    const tokenRequest = script.requests[0]!;
    const tokenBody = JSON.parse(tokenRequest.body) as Record<string, unknown>;
    expect(tokenBody).toEqual({
      permissions: { contents: "write", pull_requests: "write" },
      repositories: ["Noema"],
    });
    const jwt = tokenRequest.authorization!.replace(/^Bearer /, "");
    const [encodedHeader, encodedPayload, signature] = jwt.split(".");
    expect(decodeJwtPart(encodedHeader!)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decodeJwtPart(encodedPayload!)).toEqual({
      iat: Math.floor(NOW / 1000) - 60,
      exp: Math.floor(NOW / 1000) + 9 * 60,
      iss: "Iv1.test-client-id",
    });
    expect(signature).toMatch(/^[A-Za-z0-9_-]+$/);
    for (const request of script.requests) {
      expect(request.version).toBe(GITHUB_PUBLICATION_TARGET.apiVersion);
      expect(request.userAgent).toBe(GITHUB_PUBLICATION_TARGET.userAgent);
    }
    expect(script.requests.slice(1).every((request) =>
      request.authorization === `Bearer ${ACCESS_TOKEN}`,
    )).toBe(true);
    script.expectDone();
  });

  it("reuses a live installation token and immutable inventory for the same base head", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    addBaseObservation(script);
    script.add(
      "GET",
      branchRefPath(plan),
      jsonResponse({ message: "missing" }, 404),
    );
    script.add("GET", pullRequestListPath(plan), jsonResponse([]));
    script.add(
      "GET",
      "/repos/mani1261790/Noema/git/ref/heads/develop",
      baseReferenceResponse(),
    );
    script.add(
      "GET",
      branchRefPath(plan),
      jsonResponse({ message: "missing" }, 404),
    );
    script.add("GET", pullRequestListPath(plan), jsonResponse([]));
    const github = adapter(script);

    await github.observe(plan);
    await github.observe(plan);

    expect(
      script.requests.filter(
        (request) =>
          request.path === "/app/installations/12345678/access_tokens",
      ),
    ).toHaveLength(1);
    expect(
      script.requests.filter(
        (request) =>
          request.path ===
          `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      ),
    ).toHaveLength(1);
    script.expectDone();
  });

  it("detects nested slug collisions from the base tree without scanning blobs", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/trees/${BASE_TREE_SHA}?recursive=1`,
      jsonResponse({
        sha: BASE_TREE_SHA,
        truncated: false,
        tree: [
          {
            mode: "100644",
            path: `${GITHUB_PUBLICATION_TARGET.articleDirectory}/guides/${plan.article.slug}.md`,
            sha: ARTICLE_BLOB_SHA,
            type: "blob",
          },
        ],
      }),
    );
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add("GET", pullRequestListPath(plan), jsonResponse([]));

    const observation = await adapter(script).observe(plan);

    expect(observation.base).toEqual({
      state: "known",
      value: {
        articlesWithSlug: [
          {
            path: `${GITHUB_PUBLICATION_TARGET.articleDirectory}/guides/${plan.article.slug}.md`,
          },
        ],
        headSha: BASE_SHA,
        targetPath: null,
      },
    });
    expect(
      script.requests.some((request) => request.path.includes("/git/blobs/")),
    ).toBe(false);
    script.expectDone();
  });

  it("keeps a target frontmatter mismatch conflicting across cache retries", async () => {
    const plan = await validPlan();
    const mismatchedContent = plan.article.content.replace(
      `slug: "${plan.article.slug}"`,
      'slug: "different-slug"',
    );
    const script = new GitHubScript();
    addToken(script);
    script.add(
      "GET",
      "/repos/mani1261790/Noema/git/ref/heads/develop",
      baseReferenceResponse(),
      baseReferenceResponse(),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/trees/${BASE_TREE_SHA}?recursive=1`,
      jsonResponse({
        sha: BASE_TREE_SHA,
        truncated: false,
        tree: [
          {
            mode: "100644",
            path: plan.article.path,
            sha: ARTICLE_BLOB_SHA,
            type: "blob",
          },
        ],
      }),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/blobs/${ARTICLE_BLOB_SHA}`,
      jsonResponse({
        sha: ARTICLE_BLOB_SHA,
        encoding: "base64",
        content: btoa(mismatchedContent),
      }),
      jsonResponse({
        sha: ARTICLE_BLOB_SHA,
        encoding: "base64",
        content: btoa(mismatchedContent),
      }),
    );
    const github = adapter(script);

    await expect(github.observe(plan)).rejects.toBeInstanceOf(
      GitHubPublicationError,
    );
    await expect(github.observe(plan)).rejects.toBeInstanceOf(
      GitHubPublicationError,
    );
    script.expectDone();
  });

  it("rejects a BOM-prefixed target instead of hashing normalized text", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/trees/${BASE_TREE_SHA}?recursive=1`,
      jsonResponse({
        sha: BASE_TREE_SHA,
        truncated: false,
        tree: [
          {
            mode: "100644",
            path: plan.article.path,
            sha: ARTICLE_BLOB_SHA,
            type: "blob",
          },
        ],
      }),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/blobs/${ARTICLE_BLOB_SHA}`,
      jsonResponse({
        sha: ARTICLE_BLOB_SHA,
        encoding: "base64",
        content: btoa(`\u00ef\u00bb\u00bf${plan.article.content}`),
      }),
    );

    await expect(adapter(script).observe(plan)).rejects.toMatchObject({
      code: "github_protocol_invalid",
      retryable: false,
    });
    script.expectDone();
  });

  it("treats GitHub rate-limit 403 responses as retryable", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    script.add(
      "POST",
      "/app/installations/12345678/access_tokens",
      new Response(JSON.stringify({ message: "rate limited" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1784247000",
        },
      }),
    );

    await expect(adapter(script).observe(plan)).resolves.toEqual({
      base: { retryable: true, state: "unavailable" },
      branch: { retryable: true, state: "unavailable" },
      pullRequests: { retryable: true, state: "unavailable" },
    });
    script.expectDone();
  });

  it("treats permission 403 responses with remaining quota as configuration failures", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    script.add(
      "POST",
      "/app/installations/12345678/access_tokens",
      new Response(JSON.stringify({ message: "forbidden" }), {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-remaining": "42",
          "x-ratelimit-reset": "1784247000",
        },
      }),
    );

    await expect(adapter(script).observe(plan)).rejects.toBeInstanceOf(
      GitHubPublicationConfigurationError,
    );
    script.expectDone();
  });

  it("times out a response body that stalls after headers", async () => {
    vi.useFakeTimers();
    try {
      const plan = await validPlan();
      const script = new GitHubScript();
      let markRequestStarted!: () => void;
      const requestStarted = new Promise<void>((resolve) => {
        markRequestStarted = resolve;
      });
      script.add(
        "POST",
        "/app/installations/12345678/access_tokens",
        () => {
          markRequestStarted();
          return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        },
      );

      const observation = adapter(script).observe(plan);
      await requestStarted;
      await vi.advanceTimersByTimeAsync(15_001);

      await expect(observation).resolves.toEqual({
        base: { retryable: true, state: "unavailable" },
        branch: { retryable: true, state: "unavailable" },
        pullRequests: { retryable: true, state: "unavailable" },
      });
      script.expectDone();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      label: "a non-tree article root",
      tree: () => [
        {
          mode: "120000",
          path: GITHUB_PUBLICATION_TARGET.articleDirectory,
          sha: ARTICLE_BLOB_SHA,
          type: "blob",
        },
      ],
    },
    {
      label: "an exact non-blob target",
      tree: (plan: ArticleSubmissionPlan) => [
        {
          mode: "040000",
          path: plan.article.path,
          sha: ARTICLE_TREE_SHA,
          type: "tree",
        },
      ],
    },
    {
      label: "a Markdown-named directory",
      tree: (plan: ArticleSubmissionPlan) => [
        {
          mode: "040000",
          path: `${GITHUB_PUBLICATION_TARGET.articleDirectory}/archive.md`,
          sha: ARTICLE_TREE_SHA,
          type: "tree",
        },
        {
          mode: "100644",
          path: `${GITHUB_PUBLICATION_TARGET.articleDirectory}/archive.md/${plan.article.slug}.md`,
          sha: ARTICLE_BLOB_SHA,
          type: "blob",
        },
      ],
    },
  ])("fails closed for $label", async ({ tree }) => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/trees/${BASE_TREE_SHA}?recursive=1`,
      jsonResponse({ sha: BASE_TREE_SHA, truncated: false, tree: tree(plan) }),
    );

    await expect(adapter(script).observe(plan)).rejects.toMatchObject({
      code: "github_protocol_invalid",
      retryable: false,
    });
    script.expectDone();
  });

  it("does not interpret a non-404 ref failure as a missing branch", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    addBaseObservation(script);
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "busy" }, 500));

    const observation = await adapter(script).observe(plan);

    expect(observation.branch).toEqual({ state: "unavailable", retryable: true });
    expect(observation.pullRequests).toEqual({
      state: "unavailable",
      retryable: true,
    });
    expect(
      JSON.stringify(observation.branch) ===
        JSON.stringify({ state: "known", value: null }),
    ).toBe(false);
    script.expectDone();
  });

  it("stops after a retryable base outage", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add(
      "GET",
      "/repos/mani1261790/Noema/git/ref/heads/develop",
      jsonResponse({ message: "busy" }, 500),
    );

    await expect(adapter(script).observe(plan)).resolves.toEqual({
      base: { retryable: true, state: "unavailable" },
      branch: { retryable: true, state: "unavailable" },
      pullRequests: { retryable: true, state: "unavailable" },
    });
    script.expectDone();
  });

  it("fails closed before proving more than one matching Pull Request", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    addBaseObservation(script);
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add(
      "GET",
      pullRequestListPath(plan),
      jsonResponse([rawPullRequest(plan, 42), rawPullRequest(plan, 43)]),
    );

    await expect(adapter(script).observe(plan)).rejects.toBeInstanceOf(
      GitHubPublicationConflictError,
    );
    script.expectDone();
  });

  it("proves cancellation artifacts are absent without needing article content", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add(
      "GET",
      branchRefPath(plan),
      jsonResponse({ message: "missing" }, 404),
    );
    script.add("GET", pullRequestListPath(plan), jsonResponse([]));

    await expect(
      adapter(script).observeCancellationArtifacts(plan.intent),
    ).resolves.toEqual({
      state: "known",
      value: { branchExists: false, pullRequestCount: 0 },
    });
    script.expectDone();
  });

  it("fails cancellation observation closed when GitHub cannot prove absence", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add(
      "GET",
      branchRefPath(plan),
      jsonResponse({ message: "busy" }, 500),
    );

    await expect(
      adapter(script).observeCancellationArtifacts(plan.intent),
    ).resolves.toEqual({ state: "unavailable", retryable: true });
    script.expectDone();
  });

  it("bounds installation-token responses before parsing them", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    script.add(
      "POST",
      "/app/installations/12345678/access_tokens",
      new Response("x".repeat(256 * 1024 + 1), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );

    let caught: unknown;
    try {
      await adapter(script).observe(plan);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitHubPublicationError);
    expect((caught as GitHubPublicationError).code).toBe(
      "github_protocol_invalid",
    );
    expect((caught as GitHubPublicationError).retryable).toBe(false);
    script.expectDone();
  });

  it("rejects malformed PKCS#1 bodies during configuration", () => {
    expect(
      () =>
        new GitHubPublicationAdapter({
          clientId: "Iv1.test-client-id",
          installationId: "12345678",
          privateKeyPem:
            "-----BEGIN RSA PRIVATE KEY-----\nYWJj\n-----END RSA PRIVATE KEY-----",
        }),
    ).toThrow(GitHubPublicationConfigurationError);
  });

  it("creates only blob, tree, commit, and a new ref for a submission branch", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
    );
    script.add(
      "POST",
      "/repos/mani1261790/Noema/git/blobs",
      jsonResponse({ sha: ARTICLE_BLOB_SHA }, 201),
    );
    script.add(
      "POST",
      "/repos/mani1261790/Noema/git/trees",
      jsonResponse({ sha: ARTICLE_TREE_SHA }, 201),
    );
    script.add(
      "POST",
      "/repos/mani1261790/Noema/git/commits",
      jsonResponse({ sha: INITIAL_COMMIT_SHA }, 201),
    );
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add(
      "POST",
      "/repos/mani1261790/Noema/git/refs",
      jsonResponse(reference(`heads/${plan.git.headBranch}`, INITIAL_COMMIT_SHA), 201),
    );

    await expect(
      adapter(script).createSubmissionRef(plan, createRefAction(plan)),
    ).resolves.toBeUndefined();

    const writeRequests = script.requests.filter((request) => request.method === "POST").slice(1);
    expect(writeRequests.map((request) => request.path)).toEqual([
      "/repos/mani1261790/Noema/git/blobs",
      "/repos/mani1261790/Noema/git/trees",
      "/repos/mani1261790/Noema/git/commits",
      "/repos/mani1261790/Noema/git/refs",
    ]);
    expect(JSON.parse(writeRequests[3]!.body)).toEqual({
      ref: `refs/heads/${plan.git.headBranch}`,
      sha: INITIAL_COMMIT_SHA,
    });
    expect(script.requests.every((request) =>
      !["DELETE", "PATCH", "PUT"].includes(request.method),
    )).toBe(true);
    script.expectDone();
  });

  it("does not re-observe GitHub writes inside a rate-limited step", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
    );
    script.add(
      "POST",
      "/repos/mani1261790/Noema/git/blobs",
      new Response(JSON.stringify({ message: "rate limited" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "60",
        },
      }),
    );

    await expect(
      adapter(script).createSubmissionRef(plan, createRefAction(plan)),
    ).rejects.toMatchObject({
      code: "github_request_failed",
      retryable: true,
      status: 429,
    });
    script.expectDone();
  });

  it.each([
    {
      operation: "create_blob",
      path: "/repos/mani1261790/Noema/git/blobs",
    },
    {
      operation: "create_tree",
      path: "/repos/mani1261790/Noema/git/trees",
    },
    {
      operation: "create_commit",
      path: "/repos/mani1261790/Noema/git/commits",
    },
  ])(
    "keeps a 422 $operation failure definitive",
    async ({ operation, path }) => {
      const plan = await validPlan();
      const script = new GitHubScript();
      addToken(script);
      script.add(
        "GET",
        branchRefPath(plan),
        jsonResponse({ message: "missing" }, 404),
      );
      script.add(
        "GET",
        "/repos/mani1261790/Noema/git/ref/heads/develop",
        baseReferenceResponse(),
      );
      script.add(
        "GET",
        `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
        jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
      );
      if (operation !== "create_blob") {
        script.add(
          "POST",
          "/repos/mani1261790/Noema/git/blobs",
          jsonResponse({ sha: ARTICLE_BLOB_SHA }, 201),
        );
      }
      if (operation === "create_commit") {
        script.add(
          "POST",
          "/repos/mani1261790/Noema/git/trees",
          jsonResponse({ sha: ARTICLE_TREE_SHA }, 201),
        );
      }
      script.add(
        "POST",
        path,
        jsonResponse({ message: "validation failed" }, 422),
      );

      await expect(
        adapter(script).createSubmissionRef(plan, createRefAction(plan)),
      ).rejects.toMatchObject({
        code: "github_request_failed",
        operation,
        retryable: false,
        status: 422,
      });
      script.expectDone();
    },
  );

  it("re-observes a 422 ref write and accepts only the exact owned commit", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
    );
    script.add("POST", "/repos/mani1261790/Noema/git/blobs", jsonResponse({ sha: ARTICLE_BLOB_SHA }, 201));
    script.add("POST", "/repos/mani1261790/Noema/git/trees", jsonResponse({ sha: ARTICLE_TREE_SHA }, 201));
    script.add("POST", "/repos/mani1261790/Noema/git/commits", jsonResponse({ sha: INITIAL_COMMIT_SHA }, 201));
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add("POST", "/repos/mani1261790/Noema/git/refs", jsonResponse({ message: "already exists" }, 422));
    addBranchObservation(script, plan);

    await expect(
      adapter(script).createSubmissionRef(plan, createRefAction(plan)),
    ).resolves.toBeUndefined();
    script.expectDone();
  });

  it("returns a typed retryable error when a 422 ref write cannot be proven", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`,
      jsonResponse(gitCommit(BASE_SHA, BASE_TREE_SHA, "Base commit", [])),
    );
    script.add("POST", "/repos/mani1261790/Noema/git/blobs", jsonResponse({ sha: ARTICLE_BLOB_SHA }, 201));
    script.add("POST", "/repos/mani1261790/Noema/git/trees", jsonResponse({ sha: ARTICLE_TREE_SHA }, 201));
    script.add("POST", "/repos/mani1261790/Noema/git/commits", jsonResponse({ sha: INITIAL_COMMIT_SHA }, 201));
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "missing" }, 404));
    script.add("POST", "/repos/mani1261790/Noema/git/refs", jsonResponse({ message: "already exists" }, 422));
    script.add("GET", branchRefPath(plan), jsonResponse({ message: "still missing" }, 404));

    let caught: unknown;
    try {
      await adapter(script).createSubmissionRef(plan, createRefAction(plan));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitHubPublicationError);
    expect((caught as GitHubPublicationError).code).toBe("github_write_indeterminate");
    expect((caught as GitHubPublicationError).retryable).toBe(true);
    expect((caught as GitHubPublicationError).status).toBe(null);
    script.expectDone();
  });

  it("creates a draft pull request only after proving a pristine owned branch", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    addBranchObservation(script, plan);
    script.add("GET", pullRequestListPath(plan), jsonResponse([]));
    script.add(
      "POST",
      "/repos/mani1261790/Noema/pulls",
      jsonResponse(rawPullRequest(plan), 201),
    );

    await expect(adapter(script).createDraftPullRequest(plan)).resolves.toBeUndefined();

    const request = script.requests.find((candidate) =>
      candidate.method === "POST" && candidate.path === "/repos/mani1261790/Noema/pulls",
    )!;
    expect(JSON.parse(request.body)).toEqual({
      base: "develop",
      body: plan.pullRequest.body,
      draft: true,
      head: plan.pullRequest.headBranch,
      title: plan.pullRequest.title,
    });
    script.expectDone();
  });

  it.each([
    {
      failure: "connection-lost",
      response: () => {
        throw new TypeError("simulated connection loss");
      },
    },
    {
      failure: "422",
      response: jsonResponse({ message: "already exists" }, 422),
    },
  ])("re-observes a $failure PR write and proves the exact draft", async ({ response }) => {
    const plan = await validPlan();
    const script = new GitHubScript();
    addToken(script);
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    addBranchObservation(script, plan);
    script.add("GET", pullRequestListPath(plan), jsonResponse([]));
    script.add("POST", "/repos/mani1261790/Noema/pulls", response);
    script.add("GET", "/repos/mani1261790/Noema/git/ref/heads/develop", baseReferenceResponse());
    addBranchObservation(script, plan);
    script.add("GET", pullRequestListPath(plan), jsonResponse([rawPullRequest(plan)]));
    script.add(
      "GET",
      "/repos/mani1261790/Noema/pulls/42/commits?per_page=100",
      jsonResponse([
        { sha: INITIAL_COMMIT_SHA, commit: { message: plan.git.commitMessage } },
      ]),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/commits/${INITIAL_COMMIT_SHA}`,
      jsonResponse(
        gitCommit(
          INITIAL_COMMIT_SHA,
          ARTICLE_TREE_SHA,
          plan.git.commitMessage,
          [BASE_SHA],
        ),
      ),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/compare/${BASE_SHA}...${INITIAL_COMMIT_SHA}?per_page=100`,
      jsonResponse({
        status: "ahead",
        ahead_by: 1,
        total_commits: 1,
        files: [
          { filename: plan.article.path, sha: ARTICLE_BLOB_SHA, status: "added" },
        ],
      }),
    );
    script.add(
      "GET",
      `/repos/mani1261790/Noema/git/blobs/${ARTICLE_BLOB_SHA}`,
      jsonResponse({
        sha: ARTICLE_BLOB_SHA,
        encoding: "base64",
        content: btoa(plan.article.content),
      }),
    );

    await expect(adapter(script).createDraftPullRequest(plan)).resolves.toBeUndefined();
    script.expectDone();
  });

  it("never exposes key or GitHub response details in configuration errors", async () => {
    const plan = await validPlan();
    const script = new GitHubScript();
    script.add(
      "POST",
      "/app/installations/12345678/access_tokens",
      jsonResponse({ message: "response-secret-marker" }, 401),
    );

    let caught: unknown;
    try {
      await adapter(script).createSubmissionRef(plan, createRefAction(plan));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitHubPublicationConfigurationError);
    const rendered = `${String(caught)} ${JSON.stringify(caught)}`;
    expect(rendered.includes("response-secret-marker")).toBe(false);
    expect(rendered.includes("MIICXQIBAAKBgQ")).toBe(false);
    expect(rendered.includes(ACCESS_TOKEN)).toBe(false);
    script.expectDone();
  });
});
