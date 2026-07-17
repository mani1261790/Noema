import {
  articleSubmissionCancellationRequestSchema,
  articleSubmissionContextSchema,
  prepareArticleSubmission,
  reconcileArticleSubmission,
  reconcileArticleSubmissionCancellation,
  type ArticleSubmissionCancellationDecision,
  type ArticleSubmissionClaim,
  type ArticleSubmissionDecision,
  type ArticleSubmissionError,
  type ArticleSubmissionFailure,
  type ArticleSubmissionPlan,
  type ArticleSubmissionSnapshot,
  type ArticleSubmissionValidationIssue
} from "@noema/studio-publication";
import {
  GitHubPublicationAdapter,
  GitHubPublicationConfigurationError,
  GitHubPublicationConflictError,
  GitHubPublicationError,
  type GitHubCancellationArtifactObservation,
  type GitHubPublicationObservation
} from "./github-publication";
import type {
  InitialCommitRecord,
  PublicationCoordinatorClaimMutation,
  PublicationCoordinatorObservation,
  PublicationCoordinatorReservation,
  PublicationCoordinatorResult,
  PublicationCoordinatorSlugRelease
} from "./publication-coordinator";

export type GitHubPublicationEnvironment = Partial<
  Pick<
    Env,
    | "GITHUB_APP_CLIENT_ID"
    | "GITHUB_APP_INSTALLATION_ID"
    | "GITHUB_APP_PRIVATE_KEY"
  >
>;

export type GitHubPublicationAdapterResult =
  | { ok: true; value: GitHubPublicationAdapter }
  | { ok: false };

type MaybePromise<T> = T | Promise<T>;

type CreateDoneDecision = Extract<
  ArticleSubmissionDecision,
  { kind: "done"; ok: true }
>;
type CancellationDoneDecision = Extract<
  ArticleSubmissionCancellationDecision,
  { kind: "done"; ok: true }
>;

export type StudioPublicationStepResult =
  | { ok: true; kind: "continue" }
  | CreateDoneDecision
  | CancellationDoneDecision
  | ArticleSubmissionFailure;

export interface PublicationCoordinatorPort {
  observe(
    submissionId: string,
    slug: string
  ): MaybePromise<
    PublicationCoordinatorResult<PublicationCoordinatorObservation>
  >;
  observeSubmission(
    submissionId: string
  ): MaybePromise<
    PublicationCoordinatorResult<PublicationCoordinatorObservation>
  >;
  reserveClaim(
    claim: Parameters<
      import("./publication-coordinator").PublicationCoordinator["reserveClaim"]
    >[0],
    slugClaim: Parameters<
      import("./publication-coordinator").PublicationCoordinator["reserveClaim"]
    >[1]
  ): MaybePromise<
    PublicationCoordinatorResult<PublicationCoordinatorReservation>
  >;
  assertClaim(
    expectedClaim: ArticleSubmissionClaim
  ): MaybePromise<
    PublicationCoordinatorResult<{
      matched: true;
      claim: ArticleSubmissionClaim;
    }>
  >;
  recordRefCreationStarted(
    expectedClaim: ArticleSubmissionClaim
  ): MaybePromise<
    PublicationCoordinatorResult<PublicationCoordinatorClaimMutation>
  >;
  recordInitialCommit(
    submissionId: string,
    initialCommit: InitialCommitRecord
  ): MaybePromise<
    PublicationCoordinatorResult<PublicationCoordinatorClaimMutation>
  >;
  recordPullRequest(
    submissionId: string,
    pullRequestNumber: number
  ): MaybePromise<
    PublicationCoordinatorResult<PublicationCoordinatorClaimMutation>
  >;
  recordTerminalOutcome(
    expectedClaim: ArticleSubmissionClaim,
    outcome: "closed_unmerged" | "cancelled"
  ): MaybePromise<
    PublicationCoordinatorResult<PublicationCoordinatorClaimMutation>
  >;
  releaseSlugClaim(
    slugClaim: Parameters<
      import("./publication-coordinator").PublicationCoordinator["releaseSlugClaim"]
    >[0]
  ): MaybePromise<
    PublicationCoordinatorResult<PublicationCoordinatorSlugRelease>
  >;
}

export interface GitHubPublicationPort {
  observe(plan: ArticleSubmissionPlan): Promise<GitHubPublicationObservation>;
  observeCancellationArtifacts(
    intent: ArticleSubmissionPlan["intent"]
  ): Promise<GitHubCancellationArtifactObservation>;
  createSubmissionRef(
    plan: ArticleSubmissionPlan,
    action: Extract<
      ArticleSubmissionDecision,
      { action: "create_submission_ref"; kind: "act"; ok: true }
    >
  ): Promise<void>;
  createDraftPullRequest(plan: ArticleSubmissionPlan): Promise<void>;
}

const continueResult = {
  ok: true,
  kind: "continue"
} as const satisfies StudioPublicationStepResult;

export class StudioPublicationRuntime {
  readonly #coordinator: PublicationCoordinatorPort;
  readonly #github: GitHubPublicationPort;

  constructor(
    coordinator: PublicationCoordinatorPort,
    github: GitHubPublicationPort
  ) {
    this.#coordinator = coordinator;
    this.#github = github;
  }

  async advanceCreate(
    rawRequest: unknown,
    principalId: string
  ): Promise<StudioPublicationStepResult> {
    const preparation = await prepareArticleSubmission(rawRequest, {
      principalId
    });
    if (!preparation.ok) {
      return { ok: false, kind: "error", error: preparation.error };
    }
    const plan = preparation.plan;

    const coordinatorObservation = await this.#coordinator.observe(
      plan.intent.submissionId,
      plan.article.slug
    );
    if (!coordinatorObservation.ok) {
      return coordinatorObservationFailure(coordinatorObservation);
    }

    let githubObservation: GitHubPublicationObservation;
    try {
      githubObservation = await this.#github.observe(plan);
    } catch (error) {
      return githubFailure(error);
    }

    const snapshot: ArticleSubmissionSnapshot = {
      claim: known(coordinatorObservation.value.claim),
      slugClaim: known(coordinatorObservation.value.slugClaim),
      ...githubObservation
    };
    const decision = await reconcileArticleSubmission(plan, snapshot);
    if (!decision.ok || decision.kind === "done") return decision;

    try {
      return await this.#executeCreateAction(plan, snapshot, decision);
    } catch (error) {
      return githubFailure(error);
    }
  }

  async advanceCancellation(
    rawRequest: unknown,
    principalId: string
  ): Promise<StudioPublicationStepResult> {
    const parsedRequest = articleSubmissionCancellationRequestSchema.safeParse(
      rawRequest
    );
    if (!parsedRequest.success) {
      return validationFailure(
        "invalid_submission_cancellation_request",
        "記事送信のcancel入力を確認してください。",
        parsedRequest.error.issues
      );
    }
    const parsedContext = articleSubmissionContextSchema.safeParse({
      principalId
    });
    if (!parsedContext.success) {
      return validationFailure(
        "invalid_submission_context",
        "送信者情報を確認できません。",
        parsedContext.error.issues
      );
    }

    const coordinatorObservation = await this.#coordinator.observeSubmission(
      parsedRequest.data.submissionId
    );
    if (!coordinatorObservation.ok) {
      return coordinatorObservationFailure(coordinatorObservation);
    }

    const claim = coordinatorObservation.value.claim;
    if (
      claim === null ||
      claim.intent.submissionId !== parsedRequest.data.submissionId ||
      claim.intent.principalId !== parsedContext.data.principalId
    ) {
      return cancellationForbidden();
    }
    if (
      claim.terminalOutcome === "closed_unmerged" ||
      claim.refCreationStarted ||
      claim.initialCommit !== null ||
      claim.pullRequestNumber !== null
    ) {
      return cancellationForbidden();
    }

    let artifacts: GitHubCancellationArtifactObservation;
    try {
      artifacts = await this.#github.observeCancellationArtifacts(claim.intent);
    } catch (error) {
      return githubFailure(error);
    }

    const decision = reconcileArticleSubmissionCancellation(
      parsedRequest.data,
      parsedContext.data,
      {
        claim: known(claim),
        slugClaim: known(coordinatorObservation.value.slugClaim),
        artifacts
      }
    );
    if (!decision.ok || decision.kind === "done") return decision;

    const result =
      decision.action === "record_terminal_outcome"
        ? await this.#coordinator.recordTerminalOutcome(
            decision.expectedClaim,
            decision.outcome
          )
        : await this.#coordinator.releaseSlugClaim(decision.slugClaim);
    return coordinatorActionResult(result);
  }

  async #executeCreateAction(
    plan: ArticleSubmissionPlan,
    snapshot: ArticleSubmissionSnapshot,
    decision: Extract<
      ArticleSubmissionDecision,
      { kind: "act"; ok: true }
    >
  ): Promise<StudioPublicationStepResult> {
    switch (decision.action) {
      case "reserve_claim":
        return coordinatorActionResult(
          await this.#coordinator.reserveClaim(
            decision.claim,
            decision.slugClaim
          )
        );
      case "record_ref_creation_started":
        return coordinatorActionResult(
          await this.#coordinator.recordRefCreationStarted(
            decision.expectedClaim
          )
        );
      case "create_submission_ref": {
        const assertion = await this.#coordinator.assertClaim(
          decision.expectedClaim
        );
        if (!assertion.ok) return coordinatorActionResult(assertion);
        await this.#github.createSubmissionRef(plan, decision);
        return continueResult;
      }
      case "record_initial_commit":
        return coordinatorActionResult(
          await this.#coordinator.recordInitialCommit(
            plan.intent.submissionId,
            decision.initialCommit
          )
        );
      case "create_draft_pull_request": {
        const assertion = await this.#coordinator.assertClaim(
          decision.expectedClaim
        );
        if (!assertion.ok) return coordinatorActionResult(assertion);
        await this.#github.createDraftPullRequest(plan);
        return continueResult;
      }
      case "record_pull_request":
        return coordinatorActionResult(
          await this.#coordinator.recordPullRequest(
            plan.intent.submissionId,
            decision.pullRequestNumber
          )
        );
      case "record_terminal_outcome":
        return coordinatorActionResult(
          await this.#coordinator.recordTerminalOutcome(
            decision.expectedClaim,
            decision.outcome
          )
        );
      case "release_slug_claim":
        return coordinatorActionResult(
          await this.#coordinator.releaseSlugClaim(decision.slugClaim)
        );
      default:
        return assertNever(decision);
    }
  }
}

export function createGitHubPublicationAdapter(
  env: GitHubPublicationEnvironment
): GitHubPublicationAdapterResult {
  try {
    return {
      ok: true,
      value: new GitHubPublicationAdapter({
        clientId:
          typeof env.GITHUB_APP_CLIENT_ID === "string"
            ? env.GITHUB_APP_CLIENT_ID
            : "",
        installationId:
          typeof env.GITHUB_APP_INSTALLATION_ID === "string"
            ? env.GITHUB_APP_INSTALLATION_ID
            : "",
        privateKeyPem:
          typeof env.GITHUB_APP_PRIVATE_KEY === "string"
            ? env.GITHUB_APP_PRIVATE_KEY
            : ""
      })
    };
  } catch (error) {
    if (error instanceof GitHubPublicationConfigurationError) {
      return { ok: false };
    }
    return { ok: false };
  }
}

export function publicationRuntimeUnavailable(
  retryable = true
): ArticleSubmissionFailure {
  return runtimeFailure(
    "observation_unavailable",
    "公開状態を安全に確認できませんでした。",
    retryable
  );
}

export function publicationRuntimeBusy(): ArticleSubmissionFailure {
  return runtimeFailure(
    "observation_unavailable",
    "公開処理が混み合っているため受け付けられませんでした。",
    false
  );
}

function known<T>(value: T): { state: "known"; value: T } {
  return { state: "known", value };
}

function coordinatorActionResult(
  result: PublicationCoordinatorResult<unknown>
): StudioPublicationStepResult {
  if (result.ok) return continueResult;

  if (
    result.error.code === "claim_conflict" ||
    result.error.code === "claim_mismatch" ||
    result.error.code === "claim_not_found" ||
    result.error.code === "slug_claim_conflict"
  ) {
    return continueResult;
  }

  if (
    result.error.code === "repository_mismatch" ||
    result.error.code === "storage_corrupt"
  ) {
    return publicationRuntimeUnavailable(false);
  }

  return runtimeFailure(
    "submission_artifact_conflict",
    "保存済みの送信状態と次の操作が一致しません。",
    false
  );
}

function coordinatorObservationFailure(
  result: Exclude<
    PublicationCoordinatorResult<PublicationCoordinatorObservation>,
    { ok: true }
  >
): ArticleSubmissionFailure {
  if (result.error.code === "invalid_input") {
    return runtimeFailure(
      "invalid_submission_snapshot",
      "送信状態を安全に確認できませんでした。",
      false
    );
  }
  return publicationRuntimeUnavailable(false);
}

function githubFailure(error: unknown): ArticleSubmissionFailure {
  if (error instanceof GitHubPublicationConflictError) {
    return runtimeFailure(
      "submission_artifact_conflict",
      "GitHub上の送信状態が送信計画と一致しません。",
      false
    );
  }
  if (error instanceof GitHubPublicationConfigurationError) {
    return publicationRuntimeUnavailable(false);
  }
  if (error instanceof GitHubPublicationError) {
    return publicationRuntimeUnavailable(error.retryable);
  }
  return publicationRuntimeUnavailable(true);
}

function cancellationForbidden(): ArticleSubmissionFailure {
  return runtimeFailure(
    "submission_cancellation_forbidden",
    "この送信をcancelできません。",
    false
  );
}

function validationFailure(
  code: "invalid_submission_cancellation_request" | "invalid_submission_context",
  message: string,
  issues: ReadonlyArray<{
    message: string;
    path: ReadonlyArray<PropertyKey>;
  }>
): ArticleSubmissionFailure {
  const normalizedIssues: ArticleSubmissionValidationIssue[] = issues.map(
    (issue) => ({
      message: issue.message,
      path: issue.path.map((segment) =>
        typeof segment === "number" ? segment : String(segment)
      )
    })
  );
  return {
    ok: false,
    kind: "error",
    error: {
      code,
      message,
      retryable: false,
      issues: normalizedIssues
    }
  };
}

function runtimeFailure(
  code: ArticleSubmissionError["code"],
  message: string,
  retryable: boolean
): ArticleSubmissionFailure {
  return {
    ok: false,
    kind: "error",
    error: { code, message, retryable }
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled publication action: ${String(value)}`);
}
