import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleStudioApiRequest } from "../worker/app";

const ORIGIN = "https://studio.example.com";
const BASE_SHA = "a".repeat(40);
const BASE_TREE_SHA = "b".repeat(40);
const ARTICLE_BLOB_SHA = "c".repeat(40);
const ARTICLE_TREE_SHA = "d".repeat(40);
const INITIAL_COMMIT_SHA = "e".repeat(40);
const SUBMISSION_ID = "6c8644cf-a1f8-4af7-93d6-ecdb31d64481";

interface PullRequestInput {
  base: string;
  body: string;
  draft: boolean;
  head: string;
  title: string;
}

class StatefulGitHub {
  readonly methods: string[] = [];
  articleContent = "";
  articlePath = "";
  branchExists = false;
  commitMessage = "";
  pullRequest: Record<string, unknown> | null = null;

  readonly fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = `${url.pathname}${url.search}`;
    const body = typeof init?.body === "string" ? init.body : "";
    this.methods.push(method);

    if (
      method === "POST" &&
      path === "/app/installations/12345678/access_tokens"
    ) {
      return json(
        {
          token: "http-integration-installation-token",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          permissions: { contents: "write", pull_requests: "write" },
          repositories: [{ full_name: "mani1261790/Noema" }]
        },
        201
      );
    }
    if (
      method === "GET" &&
      path === "/repos/mani1261790/Noema/git/ref/heads/develop"
    ) {
      return json(reference("heads/develop", BASE_SHA));
    }
    if (
      method === "GET" &&
      path === `/repos/mani1261790/Noema/git/commits/${BASE_SHA}`
    ) {
      return json(commit(BASE_SHA, BASE_TREE_SHA, "Base commit", []));
    }
    if (
      method === "GET" &&
      path ===
        `/repos/mani1261790/Noema/git/trees/${BASE_TREE_SHA}?recursive=1`
    ) {
      return json({ sha: BASE_TREE_SHA, tree: [], truncated: false });
    }
    if (
      method === "GET" &&
      path.startsWith(
        "/repos/mani1261790/Noema/git/ref/heads/studio/submissions/"
      )
    ) {
      return this.branchExists
        ? json(
            reference(
              `heads/studio/submissions/${SUBMISSION_ID}`,
              INITIAL_COMMIT_SHA
            )
          )
        : json({ message: "missing" }, 404);
    }
    if (
      method === "GET" &&
      path.startsWith("/repos/mani1261790/Noema/commits?")
    ) {
      return json([
        { sha: INITIAL_COMMIT_SHA, commit: { message: this.commitMessage } }
      ]);
    }
    if (
      method === "GET" &&
      path === `/repos/mani1261790/Noema/git/commits/${INITIAL_COMMIT_SHA}`
    ) {
      return json(
        commit(
          INITIAL_COMMIT_SHA,
          ARTICLE_TREE_SHA,
          this.commitMessage,
          [BASE_SHA]
        )
      );
    }
    if (
      method === "GET" &&
      path ===
        `/repos/mani1261790/Noema/compare/${BASE_SHA}...${INITIAL_COMMIT_SHA}?per_page=100`
    ) {
      return json({
        status: "ahead",
        ahead_by: 1,
        total_commits: 1,
        files: [
          {
            filename: this.articlePath,
            sha: ARTICLE_BLOB_SHA,
            status: "added"
          }
        ]
      });
    }
    if (
      method === "GET" &&
      path === `/repos/mani1261790/Noema/git/blobs/${ARTICLE_BLOB_SHA}`
    ) {
      return json({
        sha: ARTICLE_BLOB_SHA,
        encoding: "base64",
        content: base64Utf8(this.articleContent)
      });
    }
    if (
      method === "GET" &&
      path.startsWith("/repos/mani1261790/Noema/pulls?")
    ) {
      return json(this.pullRequest ? [this.pullRequest] : []);
    }
    if (
      method === "GET" &&
      path === "/repos/mani1261790/Noema/pulls/42/commits?per_page=100"
    ) {
      return json([
        { sha: INITIAL_COMMIT_SHA, commit: { message: this.commitMessage } }
      ]);
    }
    if (
      method === "POST" &&
      path === "/repos/mani1261790/Noema/git/blobs"
    ) {
      this.articleContent = (JSON.parse(body) as { content: string }).content;
      return json({ sha: ARTICLE_BLOB_SHA }, 201);
    }
    if (
      method === "POST" &&
      path === "/repos/mani1261790/Noema/git/trees"
    ) {
      const value = JSON.parse(body) as {
        tree: Array<{ path: string }>;
      };
      this.articlePath = value.tree[0]!.path;
      return json({ sha: ARTICLE_TREE_SHA }, 201);
    }
    if (
      method === "POST" &&
      path === "/repos/mani1261790/Noema/git/commits"
    ) {
      this.commitMessage = (JSON.parse(body) as { message: string }).message;
      return json({ sha: INITIAL_COMMIT_SHA }, 201);
    }
    if (
      method === "POST" &&
      path === "/repos/mani1261790/Noema/git/refs"
    ) {
      this.branchExists = true;
      return json(
        reference(
          `heads/studio/submissions/${SUBMISSION_ID}`,
          INITIAL_COMMIT_SHA
        ),
        201
      );
    }
    if (method === "POST" && path === "/repos/mani1261790/Noema/pulls") {
      const value = JSON.parse(body) as PullRequestInput;
      this.pullRequest = {
        number: 42,
        html_url: "https://github.com/mani1261790/Noema/pull/42",
        state: "open",
        draft: value.draft,
        title: value.title,
        body: value.body,
        merged_at: null,
        merge_commit_sha: null,
        base: { ref: value.base, sha: BASE_SHA },
        head: { ref: value.head, sha: INITIAL_COMMIT_SHA }
      };
      return json(this.pullRequest, 201);
    }

    return json({ message: `unexpected ${method} ${path}` }, 500);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Studio publication HTTP integration", () => {
  it("runs Access-derived HTTP input through the real Durable Object and GitHub adapter", async () => {
    const github = new StatefulGitHub();
    vi.stubGlobal("fetch", github.fetch);
    const requestBody = articleSubmissionRequest();
    const response = await handleStudioApiRequest(
      new Request(`${ORIGIN}/api/article-submissions`, {
        body: JSON.stringify(requestBody),
        headers: {
          "cf-access-jwt-assertion": "integration-access-token",
          "content-type": "application/json",
          origin: ORIGIN
        },
        method: "POST"
      }),
      {
        ...env,
        ACCESS_POLICY_AUD: "integration-audience",
        ACCESS_TEAM_DOMAIN: "noema.cloudflareaccess.com",
        STUDIO_ALLOWED_ORIGIN: ORIGIN
      },
      {
        verifyAccessToken: async () => ({
          email: "author@example.com",
          subject: "integration-author"
        })
      }
    );
    const body = (await response.json()) as {
      result: {
        outcome: string;
        pullRequest: { number: number; draft: boolean };
      };
    };

    expect(response.status).toBe(202);
    expect(body.result).toMatchObject({
      outcome: "existing_pull_request",
      pullRequest: { number: 42, draft: true }
    });
    expect(github.branchExists).toBe(true);
    expect(github.pullRequest).not.toBeNull();
    expect(github.methods).toContain("POST");
    expect(github.methods.some((method) => ["DELETE", "PATCH", "PUT"].includes(method)))
      .toBe(false);
  });
});

function articleSubmissionRequest() {
  return {
    version: 1,
    operation: "create_article",
    submissionId: SUBMISSION_ID,
    frontmatter: {
      title: "HTTP publication integration",
      description: "The complete Studio publication boundary is verified.",
      slug: "http-publication-integration",
      status: "draft",
      updatedAt: "2026-07-17",
      authors: ["Noema Editorial"],
      topics: ["development-environment"],
      tags: ["Studio"],
      approach: "development",
      outcome: "A Draft Pull Request is created through the real runtime",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    },
    markdown: "## Integration\n\nHTTP, Durable Object, and GitHub are connected."
  };
}

function reference(name: string, sha: string) {
  return { ref: `refs/${name}`, object: { sha, type: "commit" } };
}

function commit(
  sha: string,
  treeSha: string,
  message: string,
  parents: string[]
) {
  return {
    sha,
    message,
    tree: { sha: treeSha },
    parents: parents.map((parentSha) => ({ sha: parentSha }))
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
