import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";

import {
  STUDIO_ARTICLE_MAX_MARKDOWN_BYTES,
  STUDIO_ARTICLE_MAX_SERIALIZED_BYTES,
  prepareArticleSubmission,
  reconcileArticleSubmission,
} from "./index.ts";

const submissionId = "287f0d8b-c79f-4b20-9c3d-683b0c4e643e";
const principal = { principalId: "access-subject:author-1" };
const baseSha = "a".repeat(40);
const initialCommitSha = "b".repeat(40);

function validFrontmatter(overrides = {}) {
  return {
    title: "安全な記事送信",
    description: "Studioから新規記事を送信する契約を確認します。",
    slug: "safe-article-submission",
    status: "draft",
    updatedAt: "2026-07-17",
    authors: ["Noema編集部"],
    topics: ["development-environment"],
    tags: ["Studio"],
    approach: "development",
    outcome: "Draft Pull Requestとして安全に記事を送信できる",
    prerequisites: [],
    estimatedMinutes: 10,
    heroImage: null,
    sources: [],
    ...overrides,
  };
}

function validRequest(overrides = {}) {
  return {
    version: 1,
    operation: "create_article",
    submissionId,
    frontmatter: validFrontmatter(),
    markdown: "## 送信の流れ\n\n本文です。",
    ...overrides,
  };
}

async function validPlan(requestOverrides = {}, context = principal) {
  const prepared = await prepareArticleSubmission(validRequest(requestOverrides), context);
  assert.equal(prepared.ok, true);
  return prepared.plan;
}

const known = (value) => ({ state: "known", value });
const unavailable = () => ({ state: "unavailable", retryable: true });

function emptyBase() {
  return {
    headSha: baseSha,
    targetPath: null,
    articlesWithSlug: [],
  };
}

function claimFor(plan, overrides = {}) {
  return {
    version: 1,
    intent: plan.intent,
    initialCommit: null,
    pullRequestNumber: null,
    terminalOutcome: null,
    ...overrides,
  };
}

function slugClaimFor(plan, overrides = {}) {
  return {
    version: 1,
    slug: plan.article.slug,
    submissionId: plan.intent.submissionId,
    requestSha256: plan.intent.requestSha256,
    ...overrides,
  };
}

function branchFor(plan, overrides = {}) {
  const initialCommit = {
    sha: initialCommitSha,
    parentSha: baseSha,
    parentCount: 1,
    markerVerified: true,
    metadata: {
      ...plan.metadata,
      baseCommitSha: baseSha,
    },
    changes: [
      {
        status: "added",
        path: plan.article.path,
        contentSha256: plan.article.contentSha256,
      },
    ],
    ...(overrides.initialCommit ?? {}),
  };
  return {
    name: plan.git.headBranch,
    headSha: initialCommitSha,
    initialCommit,
    initialCommitReachableFromHead: true,
    ...overrides,
    initialCommit,
  };
}

function pullRequestFor(plan, overrides = {}) {
  const number = overrides.number ?? 42;
  return {
    number,
    url: `https://github.com/mani1261790/Noema/pull/${number}`,
    state: "open",
    draft: true,
    baseBranch: plan.pullRequest.baseBranch,
    headBranch: plan.pullRequest.headBranch,
    containsInitialCommit: true,
    mergeCommitSha: null,
    mergeCommitReachableFromBase: false,
    ...overrides,
  };
}

function reservedSnapshot(plan, overrides = {}) {
  return {
    claim: known(claimFor(plan)),
    slugClaim: known(slugClaimFor(plan)),
    base: known(emptyBase()),
    branch: known(null),
    pullRequests: known([]),
    ...overrides,
  };
}

describe("prepareArticleSubmission", () => {
  it("derives a fixed create-only Draft PR plan from article content only", async () => {
    const plan = await validPlan();

    assert.equal(plan.operation, "create_article");
    assert.equal(plan.intent.repository, "mani1261790/Noema");
    assert.equal(plan.intent.principalId, principal.principalId);
    assert.equal(plan.intent.submissionMode, "create_only");
    assert.equal(plan.intent.reviewKind, "draft_pull_request");
    assert.equal(plan.article.path, "vnext/apps/blog/src/content/articles/safe-article-submission.md");
    assert.equal(plan.git.baseBranch, "develop");
    assert.equal(plan.git.headBranch, `studio/submissions/${submissionId}`);
    assert.equal(plan.git.allowDirectBaseWrite, false);
    assert.equal(plan.git.allowForceUpdate, false);
    assert.equal(plan.pullRequest.draft, true);
    assert.equal(plan.pullRequest.baseBranch, "develop");
    assert.match(plan.git.commitMessage, new RegExp(`Noema-Studio-Submission: ${submissionId}`));
    assert.match(plan.pullRequest.body, /noema-studio-submission:/);
    assert.equal(
      plan.article.contentSha256,
      `sha256:${createHash("sha256").update(plan.article.content).digest("hex")}`,
    );
    assert.match(plan.intent.requestSha256, /^sha256:[0-9a-f]{64}$/);
  });

  it("normalizes UUID casing, line endings, and canonical content before hashing", async () => {
    const first = await validPlan({
      submissionId: submissionId.toUpperCase(),
      frontmatter: validFrontmatter({ title: "  安全な記事送信  " }),
      markdown: "\r\n## 送信の流れ\r\n\r\n本文です。\r\n",
    });
    const second = await validPlan();

    assert.equal(first.intent.submissionId, submissionId);
    assert.equal(first.article.content, second.article.content);
    assert.equal(first.article.contentSha256, second.article.contentSha256);
    assert.equal(first.intent.requestSha256, second.intent.requestSha256);
  });

  it("keeps the branch stable but changes the request digest when content changes", async () => {
    const first = await validPlan();
    const second = await validPlan({ markdown: "## 送信の流れ\n\n変更した本文です。" });

    assert.equal(first.git.headBranch, second.git.headBranch);
    assert.notEqual(first.intent.requestSha256, second.intent.requestSha256);
  });

  it("rejects version changes and client-controlled GitHub fields", async () => {
    const wrongVersion = await prepareArticleSubmission(validRequest({ version: 2 }), principal);
    const overrides = await prepareArticleSubmission(
      {
        ...validRequest(),
        principalId: "attacker",
        repository: "attacker/example",
        baseBranch: "main",
        draft: false,
      },
      principal,
    );

    assert.equal(wrongVersion.ok, false);
    assert.equal(overrides.ok, false);
    assert.equal(overrides.error.code, "invalid_submission_request");
  });

  it("rejects unknown nested frontmatter, image, and source fields", async () => {
    const frontmatter = await prepareArticleSubmission(
      validRequest({ frontmatter: validFrontmatter({ articlePath: "README.md" }) }),
      principal,
    );
    const image = await prepareArticleSubmission(
      validRequest({
        frontmatter: validFrontmatter({ heroImage: { src: "/images/articles/hero.webp", alt: "図", path: "README.md" } }),
      }),
      principal,
    );
    const source = await prepareArticleSubmission(
      validRequest({
        frontmatter: validFrontmatter({
          sources: [{ title: "資料", url: "https://example.com", checkedAt: "2026-07-17", token: "secret" }],
        }),
      }),
      principal,
    );

    assert.equal(frontmatter.ok, false);
    assert.equal(image.ok, false);
    assert.equal(source.ok, false);
  });

  it("requires a UUID v4 and a server-derived principal context", async () => {
    const badId = await prepareArticleSubmission(validRequest({ submissionId: "not-a-uuid" }), principal);
    const badPrincipal = await prepareArticleSubmission(validRequest(), { principalId: "\n" });

    assert.equal(badId.ok, false);
    assert.equal(badId.error.code, "invalid_submission_request");
    assert.equal(badPrincipal.ok, false);
    assert.equal(badPrincipal.error.code, "invalid_submission_context");
  });

  it("rejects empty, oversized, and bidi-controlled Markdown", async () => {
    const empty = await prepareArticleSubmission(validRequest({ markdown: " \n\t " }), principal);
    const oversized = await prepareArticleSubmission(
      validRequest({ markdown: "あ".repeat(Math.floor(STUDIO_ARTICLE_MAX_MARKDOWN_BYTES / 3) + 1) }),
      principal,
    );
    const controlled = await prepareArticleSubmission(validRequest({ markdown: "本文\u202e" }), principal);

    assert.equal(empty.ok, false);
    assert.equal(oversized.ok, false);
    assert.equal(controlled.ok, false);
  });

  it("rejects executable Markdown HTML and unsafe destinations", async () => {
    const unsafeMarkdown = [
      "<script>alert(1)</script>",
      '<img src="x" onerror="alert(1)">',
      "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
      "<style>body{display:none}</style>",
      "<form action=\"https://evil.example\"></form>",
      "[click](javascript:alert(1))",
      "[click](jav&#x61;script:alert(1))",
      "![image](data:image/svg+xml;base64,PHN2Zz4=)",
      "# 本文のH1",
    ];

    for (const markdown of unsafeMarkdown) {
      const prepared = await prepareArticleSubmission(validRequest({ markdown }), principal);
      assert.equal(prepared.ok, false, markdown);
      assert.equal(prepared.error.code, "invalid_submission_request");
    }
  });

  it("allows HTML examples inside code fences without executing them", async () => {
    const prepared = await prepareArticleSubmission(
      validRequest({ markdown: "## 例\n\n```html\n<script>alert(1)</script>\n```" }),
      principal,
    );

    assert.equal(prepared.ok, true);
  });

  it("bounds and deduplicates repeated frontmatter fields", async () => {
    const tooMany = await prepareArticleSubmission(
      validRequest({ frontmatter: validFrontmatter({ authors: Array.from({ length: 6 }, (_, index) => `著者${index}`) }) }),
      principal,
    );
    const duplicate = await prepareArticleSubmission(
      validRequest({ frontmatter: validFrontmatter({ tags: ["Studio", "Studio"] }) }),
      principal,
    );

    assert.equal(tooMany.ok, false);
    assert.equal(duplicate.ok, false);
  });

  it("rejects archived articles, insecure sources, and unsafe image paths", async () => {
    const archived = await prepareArticleSubmission(
      validRequest({ frontmatter: validFrontmatter({ status: "archived" }) }),
      principal,
    );
    const source = await prepareArticleSubmission(
      validRequest({
        frontmatter: validFrontmatter({ sources: [{ title: "資料", url: "http://example.com", checkedAt: "2026-07-17" }] }),
      }),
      principal,
    );
    const image = await prepareArticleSubmission(
      validRequest({
        frontmatter: validFrontmatter({ heroImage: { src: "/images/articles/../secret", alt: "図" } }),
      }),
      principal,
    );

    assert.equal(archived.ok, false);
    assert.equal(source.ok, false);
    assert.equal(image.ok, false);
  });

  it("keeps maximal schema-valid input inside the canonical plan contract", async () => {
    const urlPrefix = "https://example.com/";
    const maxUrl = urlPrefix + "a".repeat(2048 - urlPrefix.length);
    const sources = Array.from({ length: 20 }, (_, index) => ({
      title: `資料${index}`,
      url: maxUrl,
      checkedAt: "2026-07-17",
    }));
    const prepared = await prepareArticleSubmission(
      validRequest({
        frontmatter: validFrontmatter({ sources }),
        markdown: "a".repeat(STUDIO_ARTICLE_MAX_MARKDOWN_BYTES),
      }),
      principal,
    );

    assert.equal(prepared.ok, true);
    assert.ok(prepared.plan.article.content.length > STUDIO_ARTICLE_MAX_MARKDOWN_BYTES + 32 * 1024);
    assert.ok(Buffer.byteLength(prepared.plan.article.content) <= STUDIO_ARTICLE_MAX_SERIALIZED_BYTES);
    const decision = await reconcileArticleSubmission(prepared.plan, {
      claim: known(null),
      slugClaim: known(null),
      base: known(emptyBase()),
      branch: known(null),
      pullRequests: known([]),
    });
    assert.equal(decision.ok, true);
    assert.equal(decision.action, "reserve_claim");
  });
});

describe("reconcileArticleSubmission", () => {
  it("rejects mutated or deserialized plans before any action", async () => {
    const plan = await validPlan();
    assert.equal(Object.isFrozen(plan), true);
    assert.equal(Object.isFrozen(plan.intent), true);
    assert.throws(() => {
      plan.intent.repository = "attacker/repo";
    }, TypeError);

    const changedTarget = JSON.parse(JSON.stringify(plan));
    changedTarget.intent.repository = "attacker/repo";
    changedTarget.git.baseBranch = "main";
    changedTarget.article.path = "README.md";
    const changedContent = JSON.parse(JSON.stringify(plan));
    changedContent.article.content += "\n改ざん";
    const selfConsistentUnsafe = JSON.parse(JSON.stringify(plan));
    selfConsistentUnsafe.article.content = selfConsistentUnsafe.article.content.replace(
      /\n$/,
      "\n<script>alert(1)</script>\n",
    );
    const contentSha256 = `sha256:${createHash("sha256").update(selfConsistentUnsafe.article.content).digest("hex")}`;
    const requestSha256 = `sha256:${createHash("sha256")
      .update(
        [
          "noema.studio.article-submission/v1",
          "mani1261790/Noema",
          "create_only",
          "draft_pull_request",
          "develop",
          selfConsistentUnsafe.article.path,
          selfConsistentUnsafe.article.content,
        ].join("\0"),
      )
      .digest("hex")}`;
    selfConsistentUnsafe.article.contentSha256 = contentSha256;
    selfConsistentUnsafe.metadata.contentSha256 = contentSha256;
    selfConsistentUnsafe.metadata.requestSha256 = requestSha256;
    selfConsistentUnsafe.intent.contentSha256 = contentSha256;
    selfConsistentUnsafe.intent.requestSha256 = requestSha256;
    selfConsistentUnsafe.git.commitMessage = [
      `Studio: add article ${selfConsistentUnsafe.article.slug}`,
      "",
      `Noema-Studio-Submission: ${selfConsistentUnsafe.metadata.submissionId}`,
      `Noema-Studio-Request-SHA256: ${requestSha256}`,
      `Noema-Studio-Content-SHA256: ${contentSha256}`,
      `Noema-Studio-Article-Path: ${selfConsistentUnsafe.article.path}`,
    ].join("\n");
    selfConsistentUnsafe.pullRequest.body = [
      "Noema Studioから新規記事を送信します。",
      "",
      `- 記事: \`${selfConsistentUnsafe.article.path}\``,
      `- 送信ID: \`${selfConsistentUnsafe.intent.submissionId}\``,
      "",
      "このPull RequestはDraftとして作成し、内容をレビューしてからdevelopへマージします。",
      "",
      `<!-- noema-studio-submission:${JSON.stringify(selfConsistentUnsafe.metadata)} -->`,
    ].join("\n");
    const emptySnapshot = {
      claim: known(null),
      slugClaim: known(null),
      base: known(emptyBase()),
      branch: known(null),
      pullRequests: known([]),
    };

    for (const candidate of [changedTarget, changedContent, selfConsistentUnsafe]) {
      const decision = await reconcileArticleSubmission(candidate, emptySnapshot);
      assert.equal(decision.ok, false);
      assert.equal(decision.error.code, "invalid_submission_plan");
    }
  });

  it("atomically reserves the submission ID and slug before GitHub effects", async () => {
    const plan = await validPlan();
    const decision = await reconcileArticleSubmission(plan, {
      claim: known(null),
      slugClaim: known(null),
      base: known(emptyBase()),
      branch: known(null),
      pullRequests: known([]),
    });

    assert.equal(decision.ok, true);
    assert.equal(decision.kind, "act");
    assert.equal(decision.action, "reserve_claim");
    assert.deepEqual(decision.claim.intent, plan.intent);
    assert.equal(decision.slugClaim.slug, plan.article.slug);
  });

  it("creates the submission commit/ref from an observed develop SHA after reservation", async () => {
    const plan = await validPlan();
    const decision = await reconcileArticleSubmission(plan, reservedSnapshot(plan));

    assert.equal(decision.ok, true);
    assert.equal(decision.action, "create_submission_ref");
    assert.equal(decision.baseCommitSha, baseSha);
    assert.equal(decision.commitMetadata.baseCommitSha, baseSha);
  });

  it("records the exact verified initial commit before creating a PR", async () => {
    const plan = await validPlan();
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, { branch: known(branchFor(plan)) }),
    );

    assert.deepEqual(decision, {
      ok: true,
      kind: "act",
      action: "record_initial_commit",
      initialCommit: { sha: initialCommitSha, baseSha },
    });
  });

  it("creates only the Draft PR after the initial commit milestone is recorded", async () => {
    const plan = await validPlan();
    const claim = claimFor(plan, { initialCommit: { sha: initialCommitSha, baseSha } });
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, { claim: known(claim), branch: known(branchFor(plan)) }),
    );

    assert.deepEqual(decision, { ok: true, kind: "act", action: "create_draft_pull_request" });
  });

  it("records a discovered PR number after a lost create response", async () => {
    const plan = await validPlan();
    const claim = claimFor(plan, { initialCommit: { sha: initialCommitSha, baseSha } });
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claim),
        branch: known(branchFor(plan)),
        pullRequests: known([pullRequestFor(plan)]),
      }),
    );

    assert.deepEqual(decision, {
      ok: true,
      kind: "act",
      action: "record_pull_request",
      pullRequestNumber: 42,
    });
  });

  it("returns an existing open PR while preserving reviewer edits", async () => {
    const plan = await validPlan();
    const claim = claimFor(plan, {
      initialCommit: { sha: initialCommitSha, baseSha },
      pullRequestNumber: 42,
    });
    const existing = pullRequestFor(plan, { draft: false });
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claim),
        branch: known(
          branchFor(plan, {
            headSha: "f".repeat(40),
            initialCommitReachableFromHead: true,
          }),
        ),
        pullRequests: known([existing]),
      }),
    );

    assert.equal(decision.ok, true);
    assert.equal(decision.kind, "done");
    assert.equal(decision.outcome, "existing_pull_request");
    assert.equal(decision.pullRequest.draft, false);
  });

  it("reports merge completion for one reviewed article at the exact path", async () => {
    const plan = await validPlan();
    const claim = claimFor(plan, {
      initialCommit: { sha: initialCommitSha, baseSha },
      pullRequestNumber: 42,
    });
    const reviewedContentSha256 = "sha256:" + "e".repeat(64);
    const article = { path: plan.article.path, contentSha256: reviewedContentSha256 };
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claim),
        base: known({ headSha: "c".repeat(40), targetPath: article, articlesWithSlug: [article] }),
        pullRequests: known([
          pullRequestFor(plan, {
            state: "merged",
            draft: false,
            mergeCommitSha: "c".repeat(40),
            mergeCommitReachableFromBase: true,
          }),
        ]),
      }),
    );

    assert.equal(decision.ok, true);
    assert.equal(decision.kind, "done");
    assert.equal(decision.outcome, "merged");
    assert.equal(decision.finalContentSha256, reviewedContentSha256);
  });

  it("records a closed PR, releases its slug claim, and never recreates it", async () => {
    const plan = await validPlan();
    const claim = claimFor(plan, {
      initialCommit: { sha: initialCommitSha, baseSha },
      pullRequestNumber: 42,
    });
    const terminalDecision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claim),
        branch: known(null),
        pullRequests: known([pullRequestFor(plan, { state: "closed", draft: false })]),
      }),
    );
    const terminalClaim = { ...claim, terminalOutcome: "closed_unmerged" };
    const releaseDecision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(terminalClaim),
        branch: known(null),
        pullRequests: known([pullRequestFor(plan, { state: "closed", draft: false })]),
      }),
    );
    const doneDecision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(terminalClaim),
        slugClaim: known(null),
        branch: known(null),
        pullRequests: known([pullRequestFor(plan, { state: "closed", draft: false })]),
      }),
    );

    assert.deepEqual(terminalDecision, {
      ok: true,
      kind: "act",
      action: "record_terminal_outcome",
      outcome: "closed_unmerged",
    });
    assert.equal(releaseDecision.ok, true);
    assert.equal(releaseDecision.action, "release_slug_claim");
    assert.equal(doneDecision.ok, true);
    assert.equal(doneDecision.kind, "done");
    assert.equal(doneDecision.outcome, "closed_unmerged");

    const correctedPlan = await validPlan({
      submissionId: "3746d644-f5fb-44f0-8795-277e05d5e151",
      markdown: "## 修正版\n\nreviewを反映した本文です。",
    });
    const correctedDecision = await reconcileArticleSubmission(correctedPlan, {
      claim: known(null),
      slugClaim: known(null),
      base: known(emptyBase()),
      branch: known(null),
      pullRequests: known([]),
    });
    assert.equal(correctedDecision.ok, true);
    assert.equal(correctedDecision.action, "reserve_claim");
  });

  it("never interprets an unavailable observation as absence", async () => {
    const plan = await validPlan();
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, { branch: unavailable() }),
    );

    assert.equal(decision.ok, false);
    assert.equal(decision.error.code, "observation_unavailable");
    assert.equal(decision.error.retryable, true);
  });

  it("rejects reuse of a submission ID with changed content or principal", async () => {
    const first = await validPlan();
    const changedContent = await validPlan({ markdown: "## 別の本文\n\n内容です。" });
    const changedPrincipal = await validPlan({}, { principalId: "access-subject:author-2" });
    const snapshot = reservedSnapshot(first);

    for (const plan of [changedContent, changedPrincipal]) {
      const decision = await reconcileArticleSubmission(plan, snapshot);
      assert.equal(decision.ok, false);
      assert.equal(decision.error.code, "submission_id_reused");
    }
  });

  it("blocks a different active claim for the same slug", async () => {
    const plan = await validPlan();
    const decision = await reconcileArticleSubmission(plan, {
      claim: known(null),
      slugClaim: known(slugClaimFor(plan, { submissionId: "3746d644-f5fb-44f0-8795-277e05d5e151" })),
      base: known(emptyBase()),
      branch: known(null),
      pullRequests: known([]),
    });

    assert.equal(decision.ok, false);
    assert.equal(decision.error.code, "open_submission_exists");
  });

  it("rejects any target-path or duplicate-slug article already on develop", async () => {
    const plan = await validPlan();
    const collision = { path: "vnext/apps/blog/src/content/articles/other-name.md", contentSha256: "sha256:" + "d".repeat(64) };
    const decision = await reconcileArticleSubmission(plan, {
      claim: known(null),
      slugClaim: known(null),
      base: known({ ...emptyBase(), articlesWithSlug: [collision] }),
      branch: known(null),
      pullRequests: known([]),
    });

    assert.equal(decision.ok, false);
    assert.equal(decision.error.code, "article_already_exists");
  });

  it("rejects unverified markers and non-exact initial commit deltas", async () => {
    const plan = await validPlan();
    const marker = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, { branch: known(branchFor(plan, { initialCommit: { markerVerified: false } })) }),
    );
    const path = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        branch: known(
          branchFor(plan, {
            initialCommit: {
              changes: [{ status: "added", path: "README.md", contentSha256: plan.article.contentSha256 }],
            },
          }),
        ),
      }),
    );

    assert.equal(marker.ok, false);
    assert.equal(marker.error.code, "submission_artifact_conflict");
    assert.equal(path.ok, false);
    assert.equal(path.error.code, "submission_artifact_conflict");
  });

  it("rejects descendant commits before the Draft PR exists", async () => {
    const plan = await validPlan();
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claimFor(plan, { initialCommit: { sha: initialCommitSha, baseSha } })),
        branch: known(branchFor(plan, { headSha: "f".repeat(40) })),
      }),
    );

    assert.equal(decision.ok, false);
    assert.equal(decision.error.code, "submission_artifact_conflict");
  });

  it("does not resurrect a recorded branch or replace a recorded PR", async () => {
    const plan = await validPlan();
    const missingBranch = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claimFor(plan, { initialCommit: { sha: initialCommitSha, baseSha } })),
      }),
    );
    const missingPr = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(
          claimFor(plan, {
            initialCommit: { sha: initialCommitSha, baseSha },
            pullRequestNumber: 42,
          }),
        ),
        branch: known(branchFor(plan)),
      }),
    );

    assert.equal(missingBranch.ok, false);
    assert.equal(missingBranch.error.code, "submission_artifact_missing");
    assert.equal(missingPr.ok, false);
    assert.equal(missingPr.error.code, "submission_artifact_missing");
  });

  it("rejects ambiguous PRs and mismatched PR identity", async () => {
    const plan = await validPlan();
    const claim = claimFor(plan, { initialCommit: { sha: initialCommitSha, baseSha } });
    const ambiguous = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claim),
        branch: known(branchFor(plan)),
        pullRequests: known([pullRequestFor(plan), pullRequestFor(plan, { number: 43 })]),
      }),
    );
    const mismatched = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claim),
        branch: known(branchFor(plan)),
        pullRequests: known([pullRequestFor(plan, { baseBranch: "main" })]),
      }),
    );

    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.error.code, "submission_artifact_conflict");
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.error.code, "submission_artifact_conflict");
  });

  it("returns a retryable pending state until merged content is observable", async () => {
    const plan = await validPlan();
    const claim = claimFor(plan, {
      initialCommit: { sha: initialCommitSha, baseSha },
      pullRequestNumber: 42,
    });
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claim),
        base: known({
          headSha: "d".repeat(40),
          targetPath: { path: plan.article.path, contentSha256: "sha256:" + "e".repeat(64) },
          articlesWithSlug: [
            { path: plan.article.path, contentSha256: "sha256:" + "e".repeat(64) },
          ],
        }),
        branch: known(null),
        pullRequests: known([
          pullRequestFor(plan, {
            state: "merged",
            draft: false,
            mergeCommitSha: "c".repeat(40),
            mergeCommitReachableFromBase: false,
          }),
        ]),
      }),
    );

    assert.equal(decision.ok, false);
    assert.equal(decision.error.code, "submission_merge_pending");
    assert.equal(decision.error.retryable, true);
  });

  it("fails closed when develop contains a reachable merge but not its article", async () => {
    const plan = await validPlan();
    const claim = claimFor(plan, {
      initialCommit: { sha: initialCommitSha, baseSha },
      pullRequestNumber: 42,
    });
    const decision = await reconcileArticleSubmission(
      plan,
      reservedSnapshot(plan, {
        claim: known(claim),
        branch: known(null),
        pullRequests: known([
          pullRequestFor(plan, {
            state: "merged",
            draft: false,
            mergeCommitSha: "c".repeat(40),
            mergeCommitReachableFromBase: true,
          }),
        ]),
      }),
    );

    assert.equal(decision.ok, false);
    assert.equal(decision.error.code, "submission_artifact_conflict");
  });
});
