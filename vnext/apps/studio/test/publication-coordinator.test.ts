import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareArticleSubmission,
  type ArticleSlugClaim,
  type ArticleSubmissionClaim,
  type ArticleSubmissionPlan,
} from "@noema/studio-publication";
import {
  BoundedPublicationStepQueue,
  MAX_SERIALIZED_PUBLICATION_STEPS,
  NOEMA_PUBLICATION_REPOSITORY,
  type PublicationCoordinatorResult
} from "../worker/publication-coordinator";

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {}
}

const objectId = (character: string): string => character.repeat(40);
const digest = (character: string): string => `sha256:${character.repeat(64)}`;

function submissionId(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function claimFor(sequence: number, slug = `article-${sequence}`): ArticleSubmissionClaim {
  const id = submissionId(sequence);
  return {
    version: 1,
    intent: {
      version: 1,
      submissionId: id,
      requestSha256: digest("a"),
      contentSha256: digest("b"),
      articlePath: `vnext/apps/blog/src/content/articles/${slug}.md`,
      baseBranch: "develop",
      submissionMode: "create_only",
      principalId: `access-subject-${sequence}`,
      slug,
      headBranch: `studio/submissions/${id}`,
      reviewKind: "draft_pull_request",
      repository: NOEMA_PUBLICATION_REPOSITORY
    },
    refCreationStarted: false,
    initialCommit: null,
    pullRequestNumber: null,
    terminalOutcome: null
  };
}

function slugClaimFor(claim: ArticleSubmissionClaim): ArticleSlugClaim {
  return {
    version: 1,
    slug: claim.intent.slug,
    submissionId: claim.intent.submissionId,
    requestSha256: claim.intent.requestSha256
  };
}

function coordinator() {
  return env.PUBLICATION_COORDINATOR.getByName(NOEMA_PUBLICATION_REPOSITORY);
}

function requestFor(sequence: number): unknown {
  const id = submissionId(sequence);
  const slug = `runtime-race-${sequence}`;
  return {
    version: 1,
    operation: "create_article",
    submissionId: id,
    frontmatter: {
      title: "Runtime race",
      description: "Publication step serialization is verified.",
      slug,
      status: "draft",
      updatedAt: "2026-07-17",
      authors: ["Noema編集部"],
      topics: ["development-environment"],
      tags: ["Studio"],
      approach: "development",
      outcome: "Serialized publication steps",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    },
    markdown: "## Runtime\n\nSerialized step test."
  };
}

async function planFor(sequence: number): Promise<ArticleSubmissionPlan> {
  const prepared = await prepareArticleSubmission(requestFor(sequence), {
    principalId: `access-subject-${sequence}`
  });
  if (!prepared.ok) throw new Error(prepared.error.code);
  return prepared.plan;
}

function successValue<T>(result: PublicationCoordinatorResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function expectError<T>(
  result: PublicationCoordinatorResult<T>,
  code: Exclude<PublicationCoordinatorResult<T>, { ok: true }>[
    "error"
  ]["code"]
): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected coordinator failure");
  expect(result.error.code).toBe(code);
  expect(result.error.retryable).toBe(false);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PublicationCoordinator", () => {
  it("reserves the submission and slug atomically and idempotently", async () => {
    const stub = coordinator();
    const claim = claimFor(1);
    const slugClaim = slugClaimFor(claim);

    expect(successValue(await stub.observe(claim.intent.submissionId, claim.intent.slug))).toEqual({
      repository: NOEMA_PUBLICATION_REPOSITORY,
      claim: null,
      slugClaim: null
    });

    expect(successValue(await stub.reserveClaim(claim, slugClaim))).toEqual({
      changed: true,
      claim,
      slugClaim
    });
    expect(successValue(await stub.reserveClaim(claim, slugClaim))).toEqual({
      changed: false,
      claim,
      slugClaim
    });
    expect(successValue(await stub.observe(claim.intent.submissionId, claim.intent.slug))).toEqual({
      repository: NOEMA_PUBLICATION_REPOSITORY,
      claim,
      slugClaim
    });
    expect(successValue(await stub.observeSubmission(claim.intent.submissionId))).toEqual({
      repository: NOEMA_PUBLICATION_REPOSITORY,
      claim,
      slugClaim
    });

    const reusedSubmission = claimFor(1, "different-article");
    expectError(
      await stub.reserveClaim(reusedSubmission, slugClaimFor(reusedSubmission)),
      "claim_conflict"
    );

    const competingClaim = claimFor(2, claim.intent.slug);
    expectError(
      await stub.reserveClaim(competingClaim, slugClaimFor(competingClaim)),
      "slug_claim_conflict"
    );
    const competingObservation = successValue(
      await stub.observe(competingClaim.intent.submissionId, competingClaim.intent.slug)
    );
    expect(competingObservation.claim).toBeNull();
    expect(competingObservation.slugClaim).toEqual(slugClaim);
  });

  it("fails closed when routed to a different repository object", async () => {
    const wrongRepository = env.PUBLICATION_COORDINATOR.getByName("someone/else");
    const claim = claimFor(3);

    expectError(
      await wrongRepository.observe(claim.intent.submissionId, claim.intent.slug),
      "repository_mismatch"
    );
    expectError(
      await wrongRepository.reserveClaim(claim, slugClaimFor(claim)),
      "repository_mismatch"
    );
  });

  it("uses an exact, idempotent CAS for the ref-creation fence", async () => {
    const stub = coordinator();
    const claim = claimFor(4);
    successValue(await stub.reserveClaim(claim, slugClaimFor(claim)));

    expect(successValue(await stub.assertClaim(claim))).toEqual({
      matched: true,
      claim
    });

    const first = successValue(await stub.recordRefCreationStarted(claim));
    expect(first.changed).toBe(true);
    expect(first.claim.refCreationStarted).toBe(true);

    const replay = successValue(await stub.recordRefCreationStarted(claim));
    expect(replay).toEqual({ changed: false, claim: first.claim });
    expectError(await stub.assertClaim(claim), "claim_mismatch");
    expect(successValue(await stub.assertClaim(first.claim)).matched).toBe(true);

    const staleTerminalAttempt = await stub.recordTerminalOutcome(claim, "cancelled");
    expectError(staleTerminalAttempt, "claim_mismatch");
  });

  it("allows only one winner between ref creation and cancellation", async () => {
    const stub = coordinator();
    const claim = claimFor(8);
    successValue(await stub.reserveClaim(claim, slugClaimFor(claim)));

    const [refCreation, cancellation] = await Promise.all([
      stub.recordRefCreationStarted(claim),
      stub.recordTerminalOutcome(claim, "cancelled")
    ]);
    const results = [refCreation, cancellation];

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    const observation = successValue(
      await stub.observeSubmission(claim.intent.submissionId)
    );
    expect(
      observation.claim?.refCreationStarted === true ||
        observation.claim?.terminalOutcome === "cancelled"
    ).toBe(true);
    expect(
      observation.claim?.refCreationStarted === true &&
        observation.claim?.terminalOutcome === "cancelled"
    ).toBe(false);
  });

  it("serializes high-level create and cancellation steps around GitHub I/O", async () => {
    const stub = coordinator();
    const plan = await planFor(9);
    const claim: ArticleSubmissionClaim = {
      version: 1,
      intent: plan.intent,
      refCreationStarted: false,
      initialCommit: null,
      pullRequestNumber: null,
      terminalOutcome: null
    };
    const reservedSlugClaim = slugClaimFor(claim);
    successValue(await stub.reserveClaim(claim, reservedSlugClaim));

    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const baseSha = objectId("a");
    const treeSha = objectId("b");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      try {
        await new Promise((resolve) => setTimeout(resolve, 2));
        const url = new URL(String(input));
        const path = `${url.pathname}${url.search}`;
        if (path === "/app/installations/12345678/access_tokens") {
          return githubJson(
            {
              token: "runtime-integration-token",
              expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              permissions: { contents: "write", pull_requests: "write" },
              repositories: [{ full_name: NOEMA_PUBLICATION_REPOSITORY }]
            },
            201
          );
        }
        if (path === "/repos/mani1261790/Noema/git/ref/heads/develop") {
          return githubJson({
            ref: "refs/heads/develop",
            object: { sha: baseSha, type: "commit" }
          });
        }
        if (path === `/repos/mani1261790/Noema/git/commits/${baseSha}`) {
          return githubJson({
            sha: baseSha,
            message: "Base commit",
            tree: { sha: treeSha },
            parents: []
          });
        }
        if (
          path ===
          `/repos/mani1261790/Noema/git/trees/${treeSha}?recursive=1`
        ) {
          return githubJson({ sha: treeSha, truncated: false, tree: [] });
        }
        if (path.includes("/git/ref/heads/studio/submissions/")) {
          return githubJson({ message: "missing" }, 404);
        }
        if (path.startsWith("/repos/mani1261790/Noema/pulls?")) {
          return githubJson([]);
        }
        return githubJson({ message: `unexpected ${path}` }, 500);
      } finally {
        activeRequests -= 1;
      }
    });

    const [createResult, cancellationResult] = await Promise.all([
      stub.advanceCreate(requestFor(9), plan.intent.principalId),
      stub.advanceCancellation(
        {
          version: 1,
          operation: "cancel_article_submission",
          submissionId: plan.intent.submissionId
        },
        plan.intent.principalId
      )
    ]);

    expect(maximumActiveRequests).toBe(1);
    expect(createResult.ok || cancellationResult.ok).toBe(true);
    const observation = successValue(
      await stub.observeSubmission(plan.intent.submissionId)
    );
    expect(
      observation.claim?.refCreationStarted === true ||
        observation.claim?.terminalOutcome === "cancelled"
    ).toBe(true);
    expect(
      observation.claim?.refCreationStarted === true &&
        observation.claim?.terminalOutcome === "cancelled"
    ).toBe(false);
  });

  it("bounds the serialized GitHub queue and recovers after the active step fails", async () => {
    const queue = new BoundedPublicationStepQueue();
    let releaseFirstOperation!: () => void;
    const firstOperationGate = new Promise<void>((resolve) => {
      releaseFirstOperation = resolve;
    });
    let operationCount = 0;
    let activeOperations = 0;
    let maximumActiveOperations = 0;
    const operation = async () => {
      operationCount += 1;
      const currentOperation = operationCount;
      activeOperations += 1;
      maximumActiveOperations = Math.max(
        maximumActiveOperations,
        activeOperations
      );
      if (currentOperation === 1) await firstOperationGate;
      activeOperations -= 1;
      if (currentOperation === 1) throw new Error("simulated operation failure");
      return { kind: "continue", ok: true } as const;
    };

    const first = queue.run(operation);
    const queued = Array.from(
      { length: MAX_SERIALIZED_PUBLICATION_STEPS - 1 },
      () => queue.run(operation)
    );
    const overflow = await queue.run(operation);

    expect(overflow.ok).toBe(false);
    if (overflow.ok) throw new Error("Expected a bounded queue failure");
    expect(overflow.error).toMatchObject({
      code: "observation_unavailable",
      retryable: false
    });

    releaseFirstOperation();
    const accepted = await Promise.allSettled([first, ...queued]);
    expect(accepted[0]?.status).toBe("rejected");
    expect(accepted.slice(1).every((result) => result.status === "fulfilled"))
      .toBe(true);
    expect(maximumActiveOperations).toBe(1);

    await expect(queue.run(operation)).resolves.toEqual({
      kind: "continue",
      ok: true
    });
  });

  it("records the initial commit and Pull Request monotonically", async () => {
    const stub = coordinator();
    const claim = claimFor(5);
    const initialCommit = { sha: objectId("c"), baseSha: objectId("d") };
    successValue(await stub.reserveClaim(claim, slugClaimFor(claim)));

    expectError(
      await stub.recordInitialCommit(claim.intent.submissionId, initialCommit),
      "invalid_transition"
    );
    const fenced = successValue(await stub.recordRefCreationStarted(claim)).claim;

    const committed = successValue(
      await stub.recordInitialCommit(claim.intent.submissionId, initialCommit)
    );
    expect(committed).toEqual({
      changed: true,
      claim: { ...fenced, initialCommit }
    });
    expect(
      successValue(await stub.recordInitialCommit(claim.intent.submissionId, initialCommit))
        .changed
    ).toBe(false);
    expectError(
      await stub.recordInitialCommit(claim.intent.submissionId, {
        sha: objectId("e"),
        baseSha: objectId("d")
      }),
      "claim_conflict"
    );

    const pullRequest = successValue(
      await stub.recordPullRequest(claim.intent.submissionId, 501)
    );
    expect(pullRequest).toEqual({
      changed: true,
      claim: { ...committed.claim, pullRequestNumber: 501 }
    });
    expect(
      successValue(await stub.recordPullRequest(claim.intent.submissionId, 501)).changed
    ).toBe(false);
    expectError(
      await stub.recordPullRequest(claim.intent.submissionId, 502),
      "claim_conflict"
    );
  });

  it("cancels only an exact pre-ref claim and releases its slug reservation", async () => {
    const stub = coordinator();
    const claim = claimFor(6);
    const slugClaim = slugClaimFor(claim);
    successValue(await stub.reserveClaim(claim, slugClaim));

    expectError(await stub.releaseSlugClaim(slugClaim), "invalid_transition");

    const cancelled = successValue(
      await stub.recordTerminalOutcome(claim, "cancelled")
    );
    expect(cancelled).toEqual({
      changed: true,
      claim: { ...claim, terminalOutcome: "cancelled" }
    });
    expect(
      successValue(await stub.recordTerminalOutcome(claim, "cancelled")).changed
    ).toBe(false);

    expect(successValue(await stub.releaseSlugClaim(slugClaim))).toEqual({
      released: true
    });
    expect(successValue(await stub.releaseSlugClaim(slugClaim))).toEqual({
      released: false
    });

    await evictDurableObject(stub);
    expect(successValue(await stub.observe(claim.intent.submissionId, claim.intent.slug))).toEqual({
      repository: NOEMA_PUBLICATION_REPOSITORY,
      claim: cancelled.claim,
      slugClaim: null
    });
    expect(successValue(await stub.observeSubmission(claim.intent.submissionId))).toEqual({
      repository: NOEMA_PUBLICATION_REPOSITORY,
      claim: cancelled.claim,
      slugClaim: null
    });
  });

  it("records closed-unmerged only after a Pull Request and then releases exactly", async () => {
    const stub = coordinator();
    const claim = claimFor(7);
    const slugClaim = slugClaimFor(claim);
    const initialCommit = {
      sha: objectId("f"),
      baseSha: objectId("1")
    };
    successValue(await stub.reserveClaim(claim, slugClaim));
    const fenced = successValue(await stub.recordRefCreationStarted(claim)).claim;
    const committed = successValue(
      await stub.recordInitialCommit(claim.intent.submissionId, initialCommit)
    ).claim;
    const withPullRequest = successValue(
      await stub.recordPullRequest(claim.intent.submissionId, 701)
    ).claim;

    expect(fenced.refCreationStarted).toBe(true);
    expect(committed.initialCommit).not.toBeNull();
    expectError(
      await stub.recordTerminalOutcome(withPullRequest, "cancelled"),
      "invalid_transition"
    );

    const terminal = successValue(
      await stub.recordTerminalOutcome(withPullRequest, "closed_unmerged")
    );
    expect(terminal.claim.terminalOutcome).toBe("closed_unmerged");
    expect(
      successValue(
        await stub.recordInitialCommit(claim.intent.submissionId, initialCommit)
      ).changed
    ).toBe(false);
    expect(
      successValue(await stub.recordPullRequest(claim.intent.submissionId, 701))
        .changed
    ).toBe(false);

    const wrongSlugClaim: ArticleSlugClaim = {
      ...slugClaim,
      requestSha256: digest("9")
    };
    expectError(await stub.releaseSlugClaim(wrongSlugClaim), "invalid_transition");
    expect(successValue(await stub.releaseSlugClaim(slugClaim))).toEqual({
      released: true
    });
  });
});

function githubJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
