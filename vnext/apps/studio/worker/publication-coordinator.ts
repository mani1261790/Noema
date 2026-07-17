import { DurableObject } from "cloudflare:workers";
import {
  articleSlugClaimSchema,
  articleSubmissionClaimSchema,
  type ArticleSlugClaim,
  type ArticleSubmissionClaim
} from "@noema/studio-publication";
import {
  StudioPublicationRuntime,
  createGitHubPublicationAdapter,
  publicationRuntimeBusy,
  publicationRuntimeUnavailable,
  type GitHubPublicationPort,
  type StudioPublicationStepResult
} from "./publication-runtime";

export const NOEMA_PUBLICATION_REPOSITORY = "mani1261790/Noema" as const;
export const MAX_SERIALIZED_PUBLICATION_STEPS = 8;

export class BoundedPublicationStepQueue {
  #operationQueue: Promise<void> = Promise.resolve();
  #queuedOperationCount = 0;

  run(
    operation: () => Promise<StudioPublicationStepResult>
  ): Promise<StudioPublicationStepResult> {
    if (this.#queuedOperationCount >= MAX_SERIALIZED_PUBLICATION_STEPS) {
      return Promise.resolve(publicationRuntimeBusy());
    }

    this.#queuedOperationCount += 1;
    const result = this.#operationQueue.then(operation, operation);
    this.#operationQueue = result.then(
      () => {
        this.#queuedOperationCount -= 1;
      },
      () => {
        this.#queuedOperationCount -= 1;
      }
    );
    return result;
  }
}

export type PublicationCoordinatorErrorCode =
  | "claim_conflict"
  | "claim_mismatch"
  | "claim_not_found"
  | "invalid_input"
  | "invalid_transition"
  | "repository_mismatch"
  | "slug_claim_conflict"
  | "storage_corrupt";

export interface PublicationCoordinatorError {
  code: PublicationCoordinatorErrorCode;
  message: string;
  retryable: false;
}

export interface PublicationCoordinatorFailure {
  ok: false;
  error: PublicationCoordinatorError;
}

export type PublicationCoordinatorResult<T> =
  | { ok: true; value: T }
  | PublicationCoordinatorFailure;

export interface PublicationCoordinatorObservation {
  repository: typeof NOEMA_PUBLICATION_REPOSITORY;
  claim: ArticleSubmissionClaim | null;
  slugClaim: ArticleSlugClaim | null;
}

export interface PublicationCoordinatorClaimMutation {
  changed: boolean;
  claim: ArticleSubmissionClaim;
}

export interface PublicationCoordinatorReservation {
  changed: boolean;
  claim: ArticleSubmissionClaim;
  slugClaim: ArticleSlugClaim;
}

export interface PublicationCoordinatorSlugRelease {
  released: boolean;
}

export interface InitialCommitRecord {
  sha: string;
  baseSha: string;
}

type StoredValue<T> =
  | { state: "missing" }
  | { state: "found"; value: T; json: string }
  | { state: "corrupt" };

const submissionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const gitObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const initialCommitKeys = ["sha", "baseSha"] as const;

function failure(
  code: PublicationCoordinatorErrorCode,
  message: string
): PublicationCoordinatorFailure {
  return { ok: false, error: { code, message, retryable: false } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  return (
    actualKeys.length === sortedExpected.length &&
    actualKeys.every((key, index) => key === sortedExpected[index])
  );
}

function isBoundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum;
}

function parseSubmissionId(value: unknown): string | null {
  if (typeof value !== "string" || !submissionIdPattern.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

function parseInitialCommit(value: unknown): InitialCommitRecord | null {
  if (!isRecord(value) || !hasExactKeys(value, initialCommitKeys)) {
    return null;
  }
  if (
    typeof value.sha !== "string" ||
    !gitObjectIdPattern.test(value.sha) ||
    typeof value.baseSha !== "string" ||
    !gitObjectIdPattern.test(value.baseSha)
  ) {
    return null;
  }
  return { sha: value.sha, baseSha: value.baseSha };
}

function parseClaim(value: unknown): ArticleSubmissionClaim | null {
  const parsed = articleSubmissionClaimSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseSlugClaim(value: unknown): ArticleSlugClaim | null {
  const parsed = articleSlugClaimSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function canonicalJson(value: ArticleSubmissionClaim | ArticleSlugClaim): string {
  return JSON.stringify(value);
}

function claimsMatch(
  left: ArticleSubmissionClaim,
  right: ArticleSubmissionClaim
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function slugClaimsMatch(left: ArticleSlugClaim, right: ArticleSlugClaim): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function slugClaimMatchesClaim(
  slugClaim: ArticleSlugClaim,
  claim: ArticleSubmissionClaim
): boolean {
  return (
    slugClaim.slug === claim.intent.slug &&
    slugClaim.submissionId === claim.intent.submissionId &&
    slugClaim.requestSha256 === claim.intent.requestSha256
  );
}

function isInitialClaim(claim: ArticleSubmissionClaim): boolean {
  return (
    !claim.refCreationStarted &&
    claim.initialCommit === null &&
    claim.pullRequestNumber === null &&
    claim.terminalOutcome === null
  );
}

function parseStoredClaim(json: string): ArticleSubmissionClaim | null {
  try {
    const parsed = parseClaim(JSON.parse(json));
    return parsed && canonicalJson(parsed) === json ? parsed : null;
  } catch {
    return null;
  }
}

function parseStoredSlugClaim(json: string): ArticleSlugClaim | null {
  try {
    const parsed = parseSlugClaim(JSON.parse(json));
    return parsed && canonicalJson(parsed) === json ? parsed : null;
  } catch {
    return null;
  }
}

export class PublicationCoordinator extends DurableObject<Env> {
  readonly #publicationEnv: Env;
  #github: GitHubPublicationPort | null = null;
  readonly #publicationStepQueue = new BoundedPublicationStepQueue();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#publicationEnv = env;
    void this.ctx.blockConcurrencyWhile(async () => {
      this.#migrateSchema();
    });
  }

  advanceCreate(
    rawRequest: unknown,
    principalId: string
  ): Promise<StudioPublicationStepResult> {
    return this.#serializePublicationStep(async () => {
      const runtime = this.#publicationRuntime();
      if (runtime === null) return publicationRuntimeUnavailable(false);

      try {
        return await runtime.advanceCreate(rawRequest, principalId);
      } catch {
        return publicationRuntimeUnavailable(true);
      }
    });
  }

  advanceCancellation(
    rawRequest: unknown,
    principalId: string
  ): Promise<StudioPublicationStepResult> {
    return this.#serializePublicationStep(async () => {
      const runtime = this.#publicationRuntime();
      if (runtime === null) return publicationRuntimeUnavailable(false);

      try {
        return await runtime.advanceCancellation(rawRequest, principalId);
      } catch {
        return publicationRuntimeUnavailable(true);
      }
    });
  }

  observe(
    submissionId: string,
    slug: string
  ): PublicationCoordinatorResult<PublicationCoordinatorObservation> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const normalizedSubmissionId = parseSubmissionId(submissionId);
    if (normalizedSubmissionId === null || !isBoundedString(slug, 100)) {
      return failure("invalid_input", "submissionIdまたはslugが不正です。");
    }

    return this.ctx.storage.transactionSync(() => {
      const storedClaim = this.#readClaim(normalizedSubmissionId);
      const storedSlugClaim = this.#readSlugClaimBySlug(slug);
      if (storedClaim.state === "corrupt" || storedSlugClaim.state === "corrupt") {
        return failure("storage_corrupt", "保存済みの送信状態を検証できません。");
      }
      return {
        ok: true,
        value: {
          repository: NOEMA_PUBLICATION_REPOSITORY,
          claim: storedClaim.state === "found" ? storedClaim.value : null,
          slugClaim: storedSlugClaim.state === "found" ? storedSlugClaim.value : null
        }
      };
    });
  }

  observeSubmission(
    submissionId: string
  ): PublicationCoordinatorResult<PublicationCoordinatorObservation> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const normalizedSubmissionId = parseSubmissionId(submissionId);
    if (normalizedSubmissionId === null) {
      return failure("invalid_input", "submissionIdが不正です。");
    }

    return this.ctx.storage.transactionSync(() => {
      const storedClaim = this.#readClaim(normalizedSubmissionId);
      const storedSlugClaim = this.#readSlugClaimBySubmissionId(
        normalizedSubmissionId
      );
      if (
        storedClaim.state === "corrupt" ||
        storedSlugClaim.state === "corrupt"
      ) {
        return failure("storage_corrupt", "保存済みの送信状態を検証できません。");
      }
      if (
        (storedClaim.state === "missing") !==
        (storedSlugClaim.state === "missing")
      ) {
        if (
          storedClaim.state === "found" &&
          storedClaim.value.terminalOutcome !== null &&
          storedSlugClaim.state === "missing"
        ) {
          return {
            ok: true,
            value: {
              repository: NOEMA_PUBLICATION_REPOSITORY,
              claim: storedClaim.value,
              slugClaim: null
            }
          };
        }
        return failure("storage_corrupt", "保存済みの送信状態が一致しません。");
      }
      if (
        storedClaim.state === "found" &&
        storedSlugClaim.state === "found" &&
        !slugClaimMatchesClaim(storedSlugClaim.value, storedClaim.value)
      ) {
        return failure("storage_corrupt", "保存済みの送信状態が一致しません。");
      }
      return {
        ok: true,
        value: {
          repository: NOEMA_PUBLICATION_REPOSITORY,
          claim: storedClaim.state === "found" ? storedClaim.value : null,
          slugClaim:
            storedSlugClaim.state === "found" ? storedSlugClaim.value : null
        }
      };
    });
  }

  reserveClaim(
    rawClaim: ArticleSubmissionClaim,
    rawSlugClaim: ArticleSlugClaim
  ): PublicationCoordinatorResult<PublicationCoordinatorReservation> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const claim = parseClaim(rawClaim);
    const slugClaim = parseSlugClaim(rawSlugClaim);
    if (
      claim === null ||
      slugClaim === null ||
      !isInitialClaim(claim) ||
      !slugClaimMatchesClaim(slugClaim, claim)
    ) {
      return failure("invalid_input", "送信claimまたはslug claimが不正です。");
    }

    return this.ctx.storage.transactionSync(() => {
      const storedClaim = this.#readClaim(claim.intent.submissionId);
      const storedSlugClaim = this.#readSlugClaimBySlug(slugClaim.slug);
      const storedSubmissionSlug = this.#readSlugClaimBySubmissionId(
        claim.intent.submissionId
      );
      if (
        storedClaim.state === "corrupt" ||
        storedSlugClaim.state === "corrupt" ||
        storedSubmissionSlug.state === "corrupt"
      ) {
        return failure("storage_corrupt", "保存済みの送信状態を検証できません。");
      }

      if (
        storedClaim.state === "found" &&
        storedSlugClaim.state === "found" &&
        storedSubmissionSlug.state === "found" &&
        claimsMatch(storedClaim.value, claim) &&
        slugClaimsMatch(storedSlugClaim.value, slugClaim) &&
        slugClaimsMatch(storedSubmissionSlug.value, slugClaim)
      ) {
        return {
          ok: true,
          value: { changed: false, claim, slugClaim }
        };
      }

      if (storedClaim.state !== "missing") {
        return failure("claim_conflict", "submissionIdのclaimが既に存在します。");
      }
      if (
        storedSlugClaim.state !== "missing" ||
        storedSubmissionSlug.state !== "missing"
      ) {
        return failure("slug_claim_conflict", "slugのclaimが既に存在します。");
      }

      this.#insertClaim(claim);
      this.ctx.storage.sql.exec(
        `INSERT INTO publication_slug_claims (
          slug, submission_id, request_sha256, claim_json
        ) VALUES (?, ?, ?, ?)`,
        slugClaim.slug,
        slugClaim.submissionId,
        slugClaim.requestSha256,
        canonicalJson(slugClaim)
      );
      return {
        ok: true,
        value: { changed: true, claim, slugClaim }
      };
    });
  }

  assertClaim(
    rawExpectedClaim: ArticleSubmissionClaim
  ): PublicationCoordinatorResult<{ matched: true; claim: ArticleSubmissionClaim }> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const expectedClaim = parseClaim(rawExpectedClaim);
    if (expectedClaim === null) {
      return failure("invalid_input", "expected claimが不正です。");
    }

    return this.ctx.storage.transactionSync(() => {
      const stored = this.#readClaim(expectedClaim.intent.submissionId);
      if (stored.state === "corrupt") {
        return failure("storage_corrupt", "保存済みの送信claimを検証できません。");
      }
      if (stored.state === "missing") {
        return failure("claim_not_found", "送信claimが存在しません。");
      }
      if (!claimsMatch(stored.value, expectedClaim)) {
        return failure("claim_mismatch", "送信claimがexpected claimと一致しません。");
      }
      return { ok: true, value: { matched: true as const, claim: stored.value } };
    });
  }

  recordRefCreationStarted(
    rawExpectedClaim: ArticleSubmissionClaim
  ): PublicationCoordinatorResult<PublicationCoordinatorClaimMutation> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const expectedClaim = parseClaim(rawExpectedClaim);
    if (
      expectedClaim === null ||
      expectedClaim.refCreationStarted ||
      expectedClaim.terminalOutcome !== null
    ) {
      return failure("invalid_input", "ref creation fenceのexpected claimが不正です。");
    }
    const nextClaim = parseClaim({ ...expectedClaim, refCreationStarted: true });
    if (nextClaim === null) {
      return failure("invalid_transition", "ref creation fenceを記録できません。");
    }

    return this.#compareAndSetClaim(expectedClaim, nextClaim);
  }

  recordInitialCommit(
    submissionId: string,
    rawInitialCommit: InitialCommitRecord
  ): PublicationCoordinatorResult<PublicationCoordinatorClaimMutation> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const normalizedSubmissionId = parseSubmissionId(submissionId);
    const initialCommit = parseInitialCommit(rawInitialCommit);
    if (normalizedSubmissionId === null || initialCommit === null) {
      return failure("invalid_input", "initial commitの入力が不正です。");
    }

    return this.ctx.storage.transactionSync(() => {
      const stored = this.#readClaim(normalizedSubmissionId);
      if (stored.state === "corrupt") {
        return failure("storage_corrupt", "保存済みの送信claimを検証できません。");
      }
      if (stored.state === "missing") {
        return failure("claim_not_found", "送信claimが存在しません。");
      }
      if (stored.value.initialCommit !== null) {
        if (
          stored.value.initialCommit.sha === initialCommit.sha &&
          stored.value.initialCommit.baseSha === initialCommit.baseSha
        ) {
          return {
            ok: true,
            value: { changed: false, claim: stored.value }
          };
        }
        return failure("claim_conflict", "異なるinitial commitが既に記録されています。");
      }
      if (!stored.value.refCreationStarted || stored.value.terminalOutcome !== null) {
        return failure(
          "invalid_transition",
          "ref creation fence前またはterminal後にinitial commitを記録できません。"
        );
      }

      const nextClaim = parseClaim({ ...stored.value, initialCommit });
      if (nextClaim === null) {
        return failure("invalid_transition", "initial commitを記録できません。");
      }
      if (!this.#updateClaim(stored.value, nextClaim)) {
        return failure("claim_mismatch", "送信claimの更新競合を検出しました。");
      }
      return { ok: true, value: { changed: true, claim: nextClaim } };
    });
  }

  recordPullRequest(
    submissionId: string,
    pullRequestNumber: number
  ): PublicationCoordinatorResult<PublicationCoordinatorClaimMutation> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const normalizedSubmissionId = parseSubmissionId(submissionId);
    if (
      normalizedSubmissionId === null ||
      !Number.isInteger(pullRequestNumber) ||
      pullRequestNumber <= 0
    ) {
      return failure("invalid_input", "Pull Request番号が不正です。");
    }

    return this.ctx.storage.transactionSync(() => {
      const stored = this.#readClaim(normalizedSubmissionId);
      if (stored.state === "corrupt") {
        return failure("storage_corrupt", "保存済みの送信claimを検証できません。");
      }
      if (stored.state === "missing") {
        return failure("claim_not_found", "送信claimが存在しません。");
      }
      if (stored.value.pullRequestNumber !== null) {
        if (stored.value.pullRequestNumber === pullRequestNumber) {
          return {
            ok: true,
            value: { changed: false, claim: stored.value }
          };
        }
        return failure("claim_conflict", "異なるPull Requestが既に記録されています。");
      }
      if (stored.value.initialCommit === null || stored.value.terminalOutcome !== null) {
        return failure(
          "invalid_transition",
          "initial commit前またはterminal後にPull Requestを記録できません。"
        );
      }

      const nextClaim = parseClaim({ ...stored.value, pullRequestNumber });
      if (nextClaim === null) {
        return failure("invalid_transition", "Pull Requestを記録できません。");
      }
      if (!this.#updateClaim(stored.value, nextClaim)) {
        return failure("claim_mismatch", "送信claimの更新競合を検出しました。");
      }
      return { ok: true, value: { changed: true, claim: nextClaim } };
    });
  }

  recordTerminalOutcome(
    rawExpectedClaim: ArticleSubmissionClaim,
    outcome: "closed_unmerged" | "cancelled"
  ): PublicationCoordinatorResult<PublicationCoordinatorClaimMutation> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const expectedClaim = parseClaim(rawExpectedClaim);
    if (
      expectedClaim === null ||
      expectedClaim.terminalOutcome !== null ||
      (outcome !== "closed_unmerged" && outcome !== "cancelled")
    ) {
      return failure("invalid_input", "terminal outcomeのexpected claimが不正です。");
    }
    const nextClaim = parseClaim({ ...expectedClaim, terminalOutcome: outcome });
    if (nextClaim === null) {
      return failure("invalid_transition", "terminal outcomeを記録できません。");
    }

    return this.#compareAndSetClaim(expectedClaim, nextClaim);
  }

  releaseSlugClaim(
    rawExpectedSlugClaim: ArticleSlugClaim
  ): PublicationCoordinatorResult<PublicationCoordinatorSlugRelease> {
    const repositoryError = this.#ensureRepository();
    if (repositoryError) return repositoryError;

    const expectedSlugClaim = parseSlugClaim(rawExpectedSlugClaim);
    if (expectedSlugClaim === null) {
      return failure("invalid_input", "release対象のslug claimが不正です。");
    }

    return this.ctx.storage.transactionSync(() => {
      const storedClaim = this.#readClaim(expectedSlugClaim.submissionId);
      const storedSlugClaim = this.#readSlugClaimBySlug(expectedSlugClaim.slug);
      const storedSubmissionSlug = this.#readSlugClaimBySubmissionId(
        expectedSlugClaim.submissionId
      );
      if (
        storedClaim.state === "corrupt" ||
        storedSlugClaim.state === "corrupt" ||
        storedSubmissionSlug.state === "corrupt"
      ) {
        return failure("storage_corrupt", "保存済みの送信状態を検証できません。");
      }
      if (storedClaim.state === "missing") {
        return failure("claim_not_found", "terminal claimが存在しません。");
      }
      if (
        storedClaim.value.terminalOutcome === null ||
        !slugClaimMatchesClaim(expectedSlugClaim, storedClaim.value)
      ) {
        return failure(
          "invalid_transition",
          "terminal claimを確認できないためslug claimを解放できません。"
        );
      }

      if (
        storedSlugClaim.state === "missing" &&
        storedSubmissionSlug.state === "missing"
      ) {
        return { ok: true, value: { released: false } };
      }
      if (
        storedSlugClaim.state !== "found" ||
        storedSubmissionSlug.state !== "found" ||
        !slugClaimsMatch(storedSlugClaim.value, expectedSlugClaim) ||
        !slugClaimsMatch(storedSubmissionSlug.value, expectedSlugClaim)
      ) {
        return failure(
          "slug_claim_conflict",
          "保存済みのslug claimがexpected claimと一致しません。"
        );
      }

      const deletion = this.ctx.storage.sql.exec(
        `DELETE FROM publication_slug_claims
         WHERE slug = ? AND submission_id = ? AND claim_json = ?`,
        expectedSlugClaim.slug,
        expectedSlugClaim.submissionId,
        canonicalJson(expectedSlugClaim)
      );
      if (deletion.rowsWritten !== 1) {
        return failure("slug_claim_conflict", "slug claimの削除競合を検出しました。");
      }
      return { ok: true, value: { released: true } };
    });
  }

  #ensureRepository(): PublicationCoordinatorFailure | null {
    if (this.ctx.id.name !== NOEMA_PUBLICATION_REPOSITORY) {
      return failure(
        "repository_mismatch",
        "publication coordinatorのrepository identityが一致しません。"
      );
    }
    return null;
  }

  #serializePublicationStep(
    operation: () => Promise<StudioPublicationStepResult>
  ): Promise<StudioPublicationStepResult> {
    return this.#publicationStepQueue.run(operation);
  }

  #publicationRuntime(): StudioPublicationRuntime | null {
    if (this.#github === null) {
      const configured = createGitHubPublicationAdapter(this.#publicationEnv);
      if (!configured.ok) return null;
      this.#github = configured.value;
    }
    return new StudioPublicationRuntime(this, this.#github);
  }

  #compareAndSetClaim(
    expectedClaim: ArticleSubmissionClaim,
    nextClaim: ArticleSubmissionClaim
  ): PublicationCoordinatorResult<PublicationCoordinatorClaimMutation> {
    return this.ctx.storage.transactionSync(() => {
      const stored = this.#readClaim(expectedClaim.intent.submissionId);
      if (stored.state === "corrupt") {
        return failure("storage_corrupt", "保存済みの送信claimを検証できません。");
      }
      if (stored.state === "missing") {
        return failure("claim_not_found", "送信claimが存在しません。");
      }
      if (claimsMatch(stored.value, nextClaim)) {
        return { ok: true, value: { changed: false, claim: stored.value } };
      }
      if (!claimsMatch(stored.value, expectedClaim)) {
        return failure("claim_mismatch", "送信claimがexpected claimと一致しません。");
      }
      if (!this.#updateClaim(expectedClaim, nextClaim)) {
        return failure("claim_mismatch", "送信claimの更新競合を検出しました。");
      }
      return { ok: true, value: { changed: true, claim: nextClaim } };
    });
  }

  #readClaim(submissionId: string): StoredValue<ArticleSubmissionClaim> {
    const row = this.ctx.storage.sql
      .exec<{ claim_json: string }>(
        `SELECT claim_json FROM publication_submission_claims
         WHERE submission_id = ?`,
        submissionId
      )
      .toArray()[0];
    if (!row) return { state: "missing" };
    const claim = parseStoredClaim(row.claim_json);
    return claim
      ? { state: "found", value: claim, json: row.claim_json }
      : { state: "corrupt" };
  }

  #readSlugClaimBySlug(slug: string): StoredValue<ArticleSlugClaim> {
    const row = this.ctx.storage.sql
      .exec<{ claim_json: string }>(
        `SELECT claim_json FROM publication_slug_claims WHERE slug = ?`,
        slug
      )
      .toArray()[0];
    if (!row) return { state: "missing" };
    const claim = parseStoredSlugClaim(row.claim_json);
    return claim
      ? { state: "found", value: claim, json: row.claim_json }
      : { state: "corrupt" };
  }

  #readSlugClaimBySubmissionId(
    submissionId: string
  ): StoredValue<ArticleSlugClaim> {
    const row = this.ctx.storage.sql
      .exec<{ claim_json: string }>(
        `SELECT claim_json FROM publication_slug_claims WHERE submission_id = ?`,
        submissionId
      )
      .toArray()[0];
    if (!row) return { state: "missing" };
    const claim = parseStoredSlugClaim(row.claim_json);
    return claim
      ? { state: "found", value: claim, json: row.claim_json }
      : { state: "corrupt" };
  }

  #insertClaim(claim: ArticleSubmissionClaim): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO publication_submission_claims (
        submission_id,
        slug,
        request_sha256,
        claim_json,
        ref_creation_started,
        initial_commit_sha,
        initial_commit_base_sha,
        pull_request_number,
        terminal_outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      claim.intent.submissionId,
      claim.intent.slug,
      claim.intent.requestSha256,
      canonicalJson(claim),
      claim.refCreationStarted ? 1 : 0,
      claim.initialCommit?.sha ?? null,
      claim.initialCommit?.baseSha ?? null,
      claim.pullRequestNumber,
      claim.terminalOutcome
    );
  }

  #updateClaim(
    expectedClaim: ArticleSubmissionClaim,
    nextClaim: ArticleSubmissionClaim
  ): boolean {
    const update = this.ctx.storage.sql.exec(
      `UPDATE publication_submission_claims
       SET claim_json = ?,
           ref_creation_started = ?,
           initial_commit_sha = ?,
           initial_commit_base_sha = ?,
           pull_request_number = ?,
           terminal_outcome = ?
       WHERE submission_id = ? AND claim_json = ?`,
      canonicalJson(nextClaim),
      nextClaim.refCreationStarted ? 1 : 0,
      nextClaim.initialCommit?.sha ?? null,
      nextClaim.initialCommit?.baseSha ?? null,
      nextClaim.pullRequestNumber,
      nextClaim.terminalOutcome,
      expectedClaim.intent.submissionId,
      canonicalJson(expectedClaim)
    );
    return update.rowsWritten === 1;
  }

  #migrateSchema(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    const version = this.ctx.storage.sql
      .exec<{ version: number }>(
        `SELECT COALESCE(MAX(id), 0) AS version FROM _sql_schema_migrations`
      )
      .one().version;

    if (version > 1) {
      throw new Error("PublicationCoordinator schema is newer than this Worker");
    }
    if (version === 1) return;

    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE publication_submission_claims (
          submission_id TEXT PRIMARY KEY,
          slug TEXT NOT NULL,
          request_sha256 TEXT NOT NULL,
          claim_json TEXT NOT NULL CHECK (json_valid(claim_json)),
          ref_creation_started INTEGER NOT NULL
            CHECK (ref_creation_started IN (0, 1)),
          initial_commit_sha TEXT,
          initial_commit_base_sha TEXT,
          pull_request_number INTEGER CHECK (
            pull_request_number IS NULL OR pull_request_number > 0
          ),
          terminal_outcome TEXT CHECK (
            terminal_outcome IS NULL OR
            terminal_outcome IN ('closed_unmerged', 'cancelled')
          ),
          CHECK (
            (initial_commit_sha IS NULL AND initial_commit_base_sha IS NULL) OR
            (initial_commit_sha IS NOT NULL AND initial_commit_base_sha IS NOT NULL)
          ),
          CHECK (initial_commit_sha IS NULL OR ref_creation_started = 1),
          CHECK (pull_request_number IS NULL OR initial_commit_sha IS NOT NULL),
          CHECK (
            terminal_outcome != 'closed_unmerged' OR pull_request_number IS NOT NULL
          ),
          CHECK (
            terminal_outcome != 'cancelled' OR
            (
              ref_creation_started = 0 AND
              initial_commit_sha IS NULL AND
              pull_request_number IS NULL
            )
          )
        );

        CREATE INDEX publication_submission_claims_slug_idx
          ON publication_submission_claims (slug);

        CREATE TABLE publication_slug_claims (
          slug TEXT PRIMARY KEY,
          submission_id TEXT NOT NULL UNIQUE,
          request_sha256 TEXT NOT NULL,
          claim_json TEXT NOT NULL CHECK (json_valid(claim_json))
        );

        INSERT INTO _sql_schema_migrations (id) VALUES (1);
      `);
    });
  }
}
