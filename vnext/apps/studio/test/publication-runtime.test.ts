import { describe, expect, it, vi } from "vitest";
import {
  prepareArticleSubmission,
  type ArticleSlugClaim,
  type ArticleSubmissionClaim,
  type ArticleSubmissionPlan
} from "@noema/studio-publication";
import type {
  PublicationCoordinatorFailure,
  PublicationCoordinatorObservation,
  PublicationCoordinatorResult
} from "../worker/publication-coordinator";
import {
  StudioPublicationRuntime,
  type GitHubPublicationPort,
  type PublicationCoordinatorPort
} from "../worker/publication-runtime";

const SUBMISSION_ID = "287f0d8b-c79f-4b20-9c3d-683b0c4e643e";
const PRINCIPAL_ID = "access-subject:author-1";
const BASE_SHA = "a".repeat(40);

function validRequest(): unknown {
  return {
    version: 1,
    operation: "create_article",
    submissionId: SUBMISSION_ID,
    frontmatter: {
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
      sources: []
    },
    markdown: "## 送信の流れ\n\n本文です。"
  };
}

function cancellationRequest(): unknown {
  return {
    version: 1,
    operation: "cancel_article_submission",
    submissionId: SUBMISSION_ID
  };
}

async function plan(): Promise<ArticleSubmissionPlan> {
  const prepared = await prepareArticleSubmission(validRequest(), {
    principalId: PRINCIPAL_ID
  });
  if (!prepared.ok) throw new Error(prepared.error.code);
  return prepared.plan;
}

function initialClaim(plan: ArticleSubmissionPlan): ArticleSubmissionClaim {
  return {
    version: 1,
    intent: plan.intent,
    refCreationStarted: false,
    initialCommit: null,
    pullRequestNumber: null,
    terminalOutcome: null
  };
}

function slugClaim(plan: ArticleSubmissionPlan): ArticleSlugClaim {
  return {
    version: 1,
    slug: plan.article.slug,
    submissionId: plan.intent.submissionId,
    requestSha256: plan.intent.requestSha256
  };
}

class FakeCoordinator implements PublicationCoordinatorPort {
  claim: ArticleSubmissionClaim | null = null;
  slugClaim: ArticleSlugClaim | null = null;
  readonly calls: string[] = [];

  observe(): PublicationCoordinatorResult<PublicationCoordinatorObservation> {
    this.calls.push("observe");
    return this.#observation();
  }

  observeSubmission(): PublicationCoordinatorResult<PublicationCoordinatorObservation> {
    this.calls.push("observeSubmission");
    return this.#observation();
  }

  reserveClaim(
    claim: ArticleSubmissionClaim,
    slug: ArticleSlugClaim
  ): PublicationCoordinatorResult<{
    changed: boolean;
    claim: ArticleSubmissionClaim;
    slugClaim: ArticleSlugClaim;
  }> {
    this.calls.push("reserveClaim");
    this.claim = claim;
    this.slugClaim = slug;
    return { ok: true, value: { changed: true, claim, slugClaim: slug } };
  }

  assertClaim(
    expectedClaim: ArticleSubmissionClaim
  ): PublicationCoordinatorResult<{
    matched: true;
    claim: ArticleSubmissionClaim;
  }> {
    this.calls.push("assertClaim");
    if (!this.#matches(expectedClaim)) return mismatch();
    return {
      ok: true,
      value: { matched: true, claim: this.claim! }
    };
  }

  recordRefCreationStarted(
    expectedClaim: ArticleSubmissionClaim
  ): PublicationCoordinatorResult<{
    changed: boolean;
    claim: ArticleSubmissionClaim;
  }> {
    this.calls.push("recordRefCreationStarted");
    if (!this.#matches(expectedClaim)) return mismatch();
    this.claim = { ...expectedClaim, refCreationStarted: true };
    return { ok: true, value: { changed: true, claim: this.claim } };
  }

  recordInitialCommit(): never {
    throw new Error("not used");
  }

  recordPullRequest(): never {
    throw new Error("not used");
  }

  recordTerminalOutcome(
    expectedClaim: ArticleSubmissionClaim,
    outcome: "closed_unmerged" | "cancelled"
  ): PublicationCoordinatorResult<{
    changed: boolean;
    claim: ArticleSubmissionClaim;
  }> {
    this.calls.push("recordTerminalOutcome");
    if (!this.#matches(expectedClaim)) return mismatch();
    this.claim = { ...expectedClaim, terminalOutcome: outcome };
    return { ok: true, value: { changed: true, claim: this.claim } };
  }

  releaseSlugClaim(
    expectedSlugClaim: ArticleSlugClaim
  ): PublicationCoordinatorResult<{ released: boolean }> {
    this.calls.push("releaseSlugClaim");
    if (JSON.stringify(this.slugClaim) !== JSON.stringify(expectedSlugClaim)) {
      return mismatch();
    }
    this.slugClaim = null;
    return { ok: true, value: { released: true } };
  }

  #observation(): PublicationCoordinatorResult<PublicationCoordinatorObservation> {
    return {
      ok: true,
      value: {
        repository: "mani1261790/Noema",
        claim: this.claim,
        slugClaim: this.slugClaim
      }
    };
  }

  #matches(expectedClaim: ArticleSubmissionClaim): boolean {
    return JSON.stringify(this.claim) === JSON.stringify(expectedClaim);
  }
}

class FakeGitHub implements GitHubPublicationPort {
  cancellationArtifacts = {
    state: "known" as const,
    value: { branchExists: false, pullRequestCount: 0 }
  };
  readonly observe = vi.fn(async () => ({
    base: {
      state: "known" as const,
      value: {
        headSha: BASE_SHA,
        targetPath: null,
        articlesWithSlug: []
      }
    },
    branch: { state: "known" as const, value: null },
    pullRequests: { state: "known" as const, value: [] }
  }));
  readonly observeCancellationArtifacts = vi.fn(
    async () => this.cancellationArtifacts
  );
  readonly createSubmissionRef = vi.fn(async () => undefined);
  readonly createDraftPullRequest = vi.fn(async () => undefined);
}

function mismatch(): PublicationCoordinatorFailure {
  return {
    ok: false,
    error: {
      code: "claim_mismatch",
      message: "mismatch",
      retryable: false
    }
  };
}

describe("StudioPublicationRuntime", () => {
  it("executes only one planner action and fully re-observes before the next", async () => {
    const coordinator = new FakeCoordinator();
    const github = new FakeGitHub();
    const runtime = new StudioPublicationRuntime(coordinator, github);

    await expect(
      runtime.advanceCreate(validRequest(), PRINCIPAL_ID)
    ).resolves.toEqual({ ok: true, kind: "continue" });
    expect(coordinator.calls).toEqual(["observe", "reserveClaim"]);
    expect(github.observe).toHaveBeenCalledTimes(1);
    expect(github.createSubmissionRef).not.toHaveBeenCalled();

    await expect(
      runtime.advanceCreate(validRequest(), PRINCIPAL_ID)
    ).resolves.toEqual({ ok: true, kind: "continue" });
    expect(coordinator.calls).toEqual([
      "observe",
      "reserveClaim",
      "observe",
      "recordRefCreationStarted"
    ]);
    expect(github.observe).toHaveBeenCalledTimes(2);
    expect(github.createSubmissionRef).not.toHaveBeenCalled();

    await expect(
      runtime.advanceCreate(validRequest(), PRINCIPAL_ID)
    ).resolves.toEqual({ ok: true, kind: "continue" });
    expect(coordinator.calls.slice(-2)).toEqual(["observe", "assertClaim"]);
    expect(github.observe).toHaveBeenCalledTimes(3);
    expect(github.createSubmissionRef).toHaveBeenCalledTimes(1);
  });

  it("does not query GitHub for a missing or differently owned cancellation", async () => {
    const articlePlan = await plan();
    const missingCoordinator = new FakeCoordinator();
    const ownedCoordinator = new FakeCoordinator();
    ownedCoordinator.claim = initialClaim(articlePlan);
    ownedCoordinator.slugClaim = slugClaim(articlePlan);
    const missingGitHub = new FakeGitHub();
    const ownedGitHub = new FakeGitHub();
    const missingRuntime = new StudioPublicationRuntime(
      missingCoordinator,
      missingGitHub
    );
    const ownedRuntime = new StudioPublicationRuntime(
      ownedCoordinator,
      ownedGitHub
    );

    const missing = await missingRuntime.advanceCancellation(
      cancellationRequest(),
      PRINCIPAL_ID
    );
    const wrongOwner = await ownedRuntime.advanceCancellation(
      cancellationRequest(),
      "access-subject:another-author"
    );

    expect(missing).toEqual(wrongOwner);
    expect(missing).toEqual({
      error: {
        code: "submission_cancellation_forbidden",
        message: "この送信をcancelできません。",
        retryable: false
      },
      kind: "error",
      ok: false
    });
    expect(missingGitHub.observeCancellationArtifacts).not.toHaveBeenCalled();
    expect(ownedGitHub.observeCancellationArtifacts).not.toHaveBeenCalled();
  });

  it("strictly rejects client-controlled cancellation identity fields", async () => {
    const coordinator = new FakeCoordinator();
    const github = new FakeGitHub();
    const runtime = new StudioPublicationRuntime(coordinator, github);
    const result = await runtime.advanceCancellation(
      {
        ...(cancellationRequest() as Record<string, unknown>),
        principalId: PRINCIPAL_ID,
        repository: "mani1261790/Noema",
        slug: "safe-article-submission"
      },
      PRINCIPAL_ID
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancellation validation failure");
    expect(result.error.code).toBe("invalid_submission_cancellation_request");
    expect(coordinator.calls).toEqual([]);
    expect(github.observeCancellationArtifacts).not.toHaveBeenCalled();
  });

  it("records cancellation, re-observes, and only then releases the slug", async () => {
    const articlePlan = await plan();
    const coordinator = new FakeCoordinator();
    coordinator.claim = initialClaim(articlePlan);
    coordinator.slugClaim = slugClaim(articlePlan);
    const github = new FakeGitHub();
    const runtime = new StudioPublicationRuntime(coordinator, github);

    await expect(
      runtime.advanceCancellation(cancellationRequest(), PRINCIPAL_ID)
    ).resolves.toEqual({ ok: true, kind: "continue" });
    expect(coordinator.claim?.terminalOutcome).toBe("cancelled");
    expect(coordinator.slugClaim).not.toBeNull();

    await expect(
      runtime.advanceCancellation(cancellationRequest(), PRINCIPAL_ID)
    ).resolves.toEqual({ ok: true, kind: "continue" });
    expect(coordinator.slugClaim).toBeNull();

    await expect(
      runtime.advanceCancellation(cancellationRequest(), PRINCIPAL_ID)
    ).resolves.toEqual({ ok: true, kind: "done", outcome: "cancelled" });
    expect(github.observeCancellationArtifacts).toHaveBeenCalledTimes(3);
  });

  it("keeps the slug reserved if an artifact appears after cancellation", async () => {
    const articlePlan = await plan();
    const coordinator = new FakeCoordinator();
    coordinator.claim = {
      ...initialClaim(articlePlan),
      terminalOutcome: "cancelled"
    };
    coordinator.slugClaim = slugClaim(articlePlan);
    const github = new FakeGitHub();
    github.cancellationArtifacts = {
      state: "known",
      value: { branchExists: true, pullRequestCount: 0 }
    };
    const runtime = new StudioPublicationRuntime(coordinator, github);

    const result = await runtime.advanceCancellation(
      cancellationRequest(),
      PRINCIPAL_ID
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected artifact conflict");
    expect(result.error.code).toBe("submission_artifact_conflict");
    expect(coordinator.slugClaim).not.toBeNull();
    expect(coordinator.calls).not.toContain("releaseSlugClaim");
  });
});
