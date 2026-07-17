import {
  STUDIO_ARTICLE_MAX_SERIALIZED_BYTES,
  STUDIO_PUBLICATION_TARGET,
  articleSubmissionCancellationRequestSchema,
  articleSubmissionPullRequestSchema,
  articleSubmissionRequestSchema,
  type ArticleSubmissionPullRequest,
  type ArticleSubmissionRequest,
  type ArticleSubmissionValidationIssue
} from "@noema/studio-publication";

export const PUBLICATION_ATTEMPT_STORAGE_KEY =
  "noema-studio-publication-attempt-v1";

const PUBLICATION_CAPABILITIES_PATH = "/api/publication-capabilities";
const ARTICLE_SUBMISSIONS_PATH = "/api/article-submissions";
const ARTICLE_SUBMISSION_CANCELLATIONS_PATH =
  "/api/article-submission-cancellations";
const PUBLICATION_LOCK_NAME = "noema-studio-publication-v1";
const MAX_API_RESPONSE_BYTES = 64 * 1024;
const MAX_STORED_ATTEMPT_BYTES = STUDIO_ARTICLE_MAX_SERIALIZED_BYTES * 4;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const errorCodePattern = /^[a-z][a-z0-9_]{0,79}$/u;
const unsafeTextPattern = /[\u0000-\u001f\u007f-\u009f]/u;

export interface PublicationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PublicationFetchInit {
  body?: string;
  cache?: "no-store";
  credentials: "same-origin";
  headers: Record<string, string>;
  method: "GET" | "POST";
  signal?: AbortSignal;
}

export type PublicationFetcher = (
  input: string,
  init: PublicationFetchInit
) => Promise<Response>;

export interface PublicationClientError {
  code: string;
  issues?: ArticleSubmissionValidationIssue[];
  message: string;
  retryable: boolean;
}

export type PublicationCapabilities = {
  identity: {
    email: string;
    subject: string;
  };
  publication:
    | {
        baseBranch: "develop";
        code: "github_app_not_configured";
        enabled: false;
        reviewKind: "draft_pull_request";
        state: "disabled";
        submissionMode: "create_only";
      }
    | {
        baseBranch: "develop";
        enabled: true;
        reviewKind: "draft_pull_request";
        state: "enabled";
        submissionMode: "create_only";
      };
};

export type PublicationCapabilitiesResult =
  | { capabilities: PublicationCapabilities; ok: true }
  | { error: PublicationClientError; ok: false };

export type PublicationSuccess =
  | { outcome: "cancelled" }
  | { outcome: "closed"; pullRequest: ArticleSubmissionPullRequest }
  | {
      finalContentSha256: string;
      outcome: "merged";
      pullRequest: ArticleSubmissionPullRequest;
    }
  | { outcome: "open"; pullRequest: ArticleSubmissionPullRequest };

export type PublicationOperation = "cancel" | "create";

interface PublicationAttemptBase {
  request: ArticleSubmissionRequest;
  version: 1;
}

export interface PendingPublicationAttempt extends PublicationAttemptBase {
  status: {
    kind: "pending";
    operation: PublicationOperation;
  };
}

export interface OutcomeUnknownPublicationAttempt
  extends PublicationAttemptBase {
  status: {
    error: PublicationClientError;
    kind: "outcomeUnknown";
    operation: PublicationOperation;
  };
}

export interface FailedPublicationAttempt extends PublicationAttemptBase {
  status: {
    error: PublicationClientError;
    kind: "failed";
    operation: PublicationOperation;
  };
}

export interface SuccessfulPublicationAttempt extends PublicationAttemptBase {
  status: {
    kind: "succeeded";
    result: PublicationSuccess;
  };
}

export type PublicationAttempt =
  | FailedPublicationAttempt
  | OutcomeUnknownPublicationAttempt
  | PendingPublicationAttempt
  | SuccessfulPublicationAttempt;

export type PublicationActionResult =
  | {
      attempt: SuccessfulPublicationAttempt;
      ok: true;
      result: PublicationSuccess;
    }
  | {
      attempt?: PublicationAttempt;
      error: PublicationClientError;
      ok: false;
      outcomeUnknown: boolean;
    };

export interface PublicationFetchOptions {
  fetcher?: PublicationFetcher;
  signal?: AbortSignal;
}

export interface PublicationLockRunner {
  run<T>(callback: () => Promise<T>): Promise<T>;
}

export interface PublicationActionOptions extends PublicationFetchOptions {
  lockRunner?: PublicationLockRunner;
  storage: PublicationStorage;
}

export interface PublicationClearOptions {
  lockRunner?: PublicationLockRunner;
  storage: PublicationStorage;
}

export type PublicationClearResult =
  | { ok: true }
  | {
      attempt?: PublicationAttempt;
      error: PublicationClientError;
      ok: false;
    };

export interface CreateArticleSubmissionOptions
  extends PublicationActionOptions {
  createSubmissionId?: () => string;
}

export async function fetchPublicationCapabilities(
  options: PublicationFetchOptions = {}
): Promise<PublicationCapabilitiesResult> {
  const fetcher = options.fetcher ?? defaultPublicationFetch;

  let response: Response;
  try {
    response = await fetcher(PUBLICATION_CAPABILITIES_PATH, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      method: "GET",
      signal: options.signal
    });
  } catch (error) {
    return {
      error: requestFailure(error, options.signal),
      ok: false
    };
  }

  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch (error) {
    return {
      error: requestFailure(error, options.signal),
      ok: false
    };
  }
  if (response.status === 200) {
    const capabilities = parsePublicationCapabilities(body);
    return capabilities
      ? { capabilities, ok: true }
      : { error: invalidApiResponse(), ok: false };
  }

  const error = parseApiError(body);
  return {
    error: error ?? invalidApiResponse(),
    ok: false
  };
}

export async function createArticleSubmission(
  input: { frontmatter: unknown; markdown: string },
  options: CreateArticleSubmissionOptions
): Promise<PublicationActionResult> {
  return withPublicationLock(options, () =>
    createArticleSubmissionUnlocked(input, options)
  );
}

async function createArticleSubmissionUnlocked(
  input: { frontmatter: unknown; markdown: string },
  options: CreateArticleSubmissionOptions
): Promise<PublicationActionResult> {
  const stored = readStoredAttempt(options.storage);
  if (stored.kind === "unavailable") {
    return actionFailure(storageUnavailable(), false);
  }
  if (stored.kind === "invalid") {
    return actionFailure(invalidStoredAttempt(), false);
  }
  if (stored.kind === "valid") {
    const existingAttempt = stored.attempt;
    return {
      attempt: existingAttempt,
      error: publicationAttemptExists(),
      ok: false,
      outcomeUnknown:
        existingAttempt.status.kind === "outcomeUnknown" ||
        existingAttempt.status.kind === "pending"
    };
  }

  let submissionId: string;
  try {
    submissionId = (options.createSubmissionId ?? (() => crypto.randomUUID()))();
  } catch {
    return actionFailure(submissionIdUnavailable(), false);
  }

  const parsed = articleSubmissionRequestSchema.safeParse({
    version: 1,
    operation: "create_article",
    submissionId,
    frontmatter: input.frontmatter,
    markdown: input.markdown
  });
  if (!parsed.success) {
    return actionFailure(
      {
        code: "invalid_submission_request",
        issues: parsed.error.issues.slice(0, 20).map((issue) => ({
          message: issue.message.slice(0, 500),
          path: issue.path.slice(0, 20).map((segment) =>
            typeof segment === "number" ? segment : String(segment).slice(0, 200)
          )
        })),
        message: "記事の入力内容を確認してください。",
        retryable: false
      },
      false
    );
  }

  return postPublicationAttempt(parsed.data, "create", options);
}

export async function retryPublicationAttempt(
  rawAttempt: PublicationAttempt,
  options: PublicationActionOptions
): Promise<PublicationActionResult> {
  return withPublicationLock(options, () =>
    retryPublicationAttemptUnlocked(rawAttempt, options)
  );
}

async function retryPublicationAttemptUnlocked(
  rawAttempt: PublicationAttempt,
  options: PublicationActionOptions
): Promise<PublicationActionResult> {
  const attempt = parsePublicationAttempt(rawAttempt);
  if (!attempt) return actionFailure(invalidStoredAttempt(), false);
  const changed = currentAttemptFailure(attempt, options.storage);
  if (changed) return changed;

  if (attempt.status.kind === "succeeded") {
    const result = attempt.status.result;
    const successfulAttempt: SuccessfulPublicationAttempt = {
      request: attempt.request,
      status: { kind: "succeeded", result },
      version: 1
    };
    if (result.outcome !== "open") {
      return {
        attempt: successfulAttempt,
        ok: true,
        result
      };
    }
    return postPublicationAttempt(attempt.request, "create", options);
  }

  return postPublicationAttempt(
    attempt.request,
    attempt.status.operation,
    options
  );
}

/**
 * Reconcile the create operation after a cancellation attempt could not be
 * confirmed. This keeps the original UUID and canonical request intact while
 * returning to the server's create/status observation path.
 */
export async function resumeArticleSubmission(
  rawAttempt: PublicationAttempt,
  options: PublicationActionOptions
): Promise<PublicationActionResult> {
  return withPublicationLock(options, () =>
    resumeArticleSubmissionUnlocked(rawAttempt, options)
  );
}

async function resumeArticleSubmissionUnlocked(
  rawAttempt: PublicationAttempt,
  options: PublicationActionOptions
): Promise<PublicationActionResult> {
  const attempt = parsePublicationAttempt(rawAttempt);
  if (!attempt) return actionFailure(invalidStoredAttempt(), false);
  const changed = currentAttemptFailure(attempt, options.storage);
  if (changed) return changed;

  if (
    attempt.status.kind === "succeeded" &&
    attempt.status.result.outcome !== "open"
  ) {
    const result = attempt.status.result;
    const successfulAttempt: SuccessfulPublicationAttempt = {
      request: attempt.request,
      status: { kind: "succeeded", result },
      version: 1
    };
    return {
      attempt: successfulAttempt,
      ok: true,
      result
    };
  }

  return postPublicationAttempt(attempt.request, "create", options);
}

export async function cancelArticleSubmission(
  rawAttempt: PublicationAttempt,
  options: PublicationActionOptions
): Promise<PublicationActionResult> {
  return withPublicationLock(options, () =>
    cancelArticleSubmissionUnlocked(rawAttempt, options)
  );
}

async function cancelArticleSubmissionUnlocked(
  rawAttempt: PublicationAttempt,
  options: PublicationActionOptions
): Promise<PublicationActionResult> {
  const attempt = parsePublicationAttempt(rawAttempt);
  if (!attempt) return actionFailure(invalidStoredAttempt(), false);
  const changed = currentAttemptFailure(attempt, options.storage);
  if (changed) return changed;

  return postPublicationAttempt(attempt.request, "cancel", options);
}

export function loadPublicationAttempt(
  storage: PublicationStorage
): PublicationAttempt | null {
  const stored = readStoredAttempt(storage);
  return stored.kind === "valid" ? stored.attempt : null;
}

export function persistPublicationAttempt(
  storage: PublicationStorage,
  rawAttempt: unknown
): boolean {
  const attempt = parsePublicationAttempt(rawAttempt);
  if (!attempt) return false;

  try {
    const serialized = JSON.stringify(attempt);
    if (
      serialized.length > MAX_STORED_ATTEMPT_BYTES ||
      new TextEncoder().encode(serialized).byteLength > MAX_STORED_ATTEMPT_BYTES
    ) {
      return false;
    }
    storage.setItem(PUBLICATION_ATTEMPT_STORAGE_KEY, serialized);
    return storage.getItem(PUBLICATION_ATTEMPT_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

export function clearPublicationAttempt(storage: PublicationStorage): boolean {
  try {
    storage.removeItem(PUBLICATION_ATTEMPT_STORAGE_KEY);
    return storage.getItem(PUBLICATION_ATTEMPT_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

export async function clearPublicationAttemptSafely(
  rawAttempt: PublicationAttempt | null,
  options: PublicationClearOptions
): Promise<PublicationClearResult> {
  const runner = resolvePublicationLockRunner(options.lockRunner);
  if (!runner) return { error: publicationLockUnavailable(), ok: false };

  try {
    return await runner.run(async () => {
      const expected = rawAttempt === null
        ? null
        : parsePublicationAttempt(rawAttempt);
      if (rawAttempt !== null && !expected) {
        return { error: invalidStoredAttempt(), ok: false };
      }

      const stored = readStoredAttempt(options.storage);
      if (stored.kind === "unavailable") {
        return { error: storageUnavailable(), ok: false };
      }
      if (stored.kind === "invalid") {
        return { error: invalidStoredAttempt(), ok: false };
      }
      if (stored.kind === "empty") return { ok: true };
      if (
        expected === null ||
        !sameAttempt(expected, stored.attempt)
      ) {
        return {
          attempt: stored.attempt,
          error: publicationAttemptChanged(),
          ok: false
        };
      }

      return clearPublicationAttempt(options.storage)
        ? { ok: true }
        : { error: storageUnavailable(), ok: false };
    });
  } catch {
    return { error: publicationLockUnavailable(), ok: false };
  }
}

export async function clearInvalidPublicationAttemptSafely(
  options: PublicationClearOptions
): Promise<PublicationClearResult> {
  const runner = resolvePublicationLockRunner(options.lockRunner);
  if (!runner) return { error: publicationLockUnavailable(), ok: false };

  try {
    return await runner.run(async () => {
      const stored = readStoredAttempt(options.storage);
      if (stored.kind === "empty") return { ok: true };
      if (stored.kind === "unavailable") {
        return { error: storageUnavailable(), ok: false };
      }
      if (stored.kind === "valid") {
        return {
          attempt: stored.attempt,
          error: publicationAttemptChanged(),
          ok: false
        };
      }

      return clearPublicationAttempt(options.storage)
        ? { ok: true }
        : { error: storageUnavailable(), ok: false };
    });
  } catch {
    return { error: publicationLockUnavailable(), ok: false };
  }
}

async function postPublicationAttempt(
  request: ArticleSubmissionRequest,
  operation: PublicationOperation,
  options: PublicationActionOptions
): Promise<PublicationActionResult> {
  const pendingAttempt: PendingPublicationAttempt = {
    version: 1,
    request,
    status: { kind: "pending", operation }
  };
  if (!persistPublicationAttempt(options.storage, pendingAttempt)) {
    return actionFailure(storageUnavailable(), false);
  }

  const requestBody =
    operation === "create"
      ? request
      : articleSubmissionCancellationRequestSchema.parse({
          version: 1,
          operation: "cancel_article_submission",
          submissionId: request.submissionId
        });
  const path =
    operation === "create"
      ? ARTICLE_SUBMISSIONS_PATH
      : ARTICLE_SUBMISSION_CANCELLATIONS_PATH;
  const fetcher = options.fetcher ?? defaultPublicationFetch;

  let response: Response;
  try {
    response = await fetcher(path, {
      body: JSON.stringify(requestBody),
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      method: "POST",
      signal: options.signal
    });
  } catch (error) {
    return outcomeUnknown(
      pendingAttempt,
      operation,
      requestFailure(error, options.signal),
      options.storage
    );
  }

  let body: unknown;
  try {
    body = await readBoundedJson(response);
  } catch (error) {
    return outcomeUnknown(
      pendingAttempt,
      operation,
      requestFailure(error, options.signal),
      options.storage
    );
  }
  if (response.ok) {
    const result = parsePublicationSuccess(
      body,
      request.submissionId,
      operation,
      response.status
    );
    if (!result) {
      return outcomeUnknown(
        pendingAttempt,
        operation,
        invalidApiResponse(),
        options.storage
      );
    }

    const attempt: SuccessfulPublicationAttempt = {
      version: 1,
      request,
      status: { kind: "succeeded", result }
    };
    if (!persistPublicationAttempt(options.storage, attempt)) {
      return {
        attempt,
        error: storageUnavailable(),
        ok: false,
        outcomeUnknown: false
      };
    }
    return { attempt, ok: true, result };
  }

  const error = parseApiError(body);
  if (!error) {
    return outcomeUnknown(
      pendingAttempt,
      operation,
      invalidApiResponse(),
      options.storage
    );
  }

  const attempt: FailedPublicationAttempt = {
    version: 1,
    request,
    status: { error, kind: "failed", operation }
  };
  persistPublicationAttempt(options.storage, attempt);
  return {
    attempt,
    error,
    ok: false,
    outcomeUnknown: false
  };
}

function outcomeUnknown(
  pendingAttempt: PendingPublicationAttempt,
  operation: PublicationOperation,
  error: PublicationClientError,
  storage: PublicationStorage
): PublicationActionResult {
  const attempt: OutcomeUnknownPublicationAttempt = {
    ...pendingAttempt,
    status: { error, kind: "outcomeUnknown", operation }
  };
  persistPublicationAttempt(storage, attempt);
  return { attempt, error, ok: false, outcomeUnknown: true };
}

function parsePublicationCapabilities(
  value: unknown
): PublicationCapabilities | null {
  if (!isRecord(value) || !hasExactKeys(value, ["identity", "publication"])) {
    return null;
  }
  if (
    !isRecord(value.identity) ||
    !hasExactKeys(value.identity, ["email", "subject"]) ||
    !isBoundedText(value.identity.email, 320) ||
    !isBoundedText(value.identity.subject, 200) ||
    !isRecord(value.publication)
  ) {
    return null;
  }

  const commonPublication =
    value.publication.baseBranch === "develop" &&
    value.publication.reviewKind === "draft_pull_request" &&
    value.publication.submissionMode === "create_only";
  if (!commonPublication) return null;

  if (
    value.publication.enabled === true &&
    value.publication.state === "enabled" &&
    hasExactKeys(value.publication, [
      "baseBranch",
      "enabled",
      "reviewKind",
      "state",
      "submissionMode"
    ])
  ) {
    return {
      identity: {
        email: value.identity.email,
        subject: value.identity.subject
      },
      publication: {
        baseBranch: "develop",
        enabled: true,
        reviewKind: "draft_pull_request",
        state: "enabled",
        submissionMode: "create_only"
      }
    };
  }

  if (
    value.publication.enabled === false &&
    value.publication.state === "disabled" &&
    value.publication.code === "github_app_not_configured" &&
    hasExactKeys(value.publication, [
      "baseBranch",
      "code",
      "enabled",
      "reviewKind",
      "state",
      "submissionMode"
    ])
  ) {
    return {
      identity: {
        email: value.identity.email,
        subject: value.identity.subject
      },
      publication: {
        baseBranch: "develop",
        code: "github_app_not_configured",
        enabled: false,
        reviewKind: "draft_pull_request",
        state: "disabled",
        submissionMode: "create_only"
      }
    };
  }

  return null;
}

function parsePublicationSuccess(
  value: unknown,
  submissionId: string,
  operation: PublicationOperation,
  status: number
): PublicationSuccess | null {
  if (!isRecord(value) || !hasExactKeys(value, ["result"]) || !isRecord(value.result)) {
    return null;
  }
  const result = value.result;
  if (result.ok !== true || result.kind !== "done") return null;

  if (
    result.outcome === "cancelled" &&
    status === 200 &&
    hasExactKeys(result, ["kind", "ok", "outcome"])
  ) {
    return { outcome: "cancelled" };
  }

  if (!isRecord(result.pullRequest)) return null;
  if (operation !== "create") return null;

  if (
    result.outcome === "existing_pull_request" &&
    status === 202 &&
    hasExactKeys(result, ["kind", "ok", "outcome", "pullRequest"])
  ) {
    const pullRequest = parsePullRequest(
      result.pullRequest,
      submissionId,
      "open"
    );
    return pullRequest ? { outcome: "open", pullRequest } : null;
  }

  if (
    result.outcome === "closed_unmerged" &&
    status === 200 &&
    hasExactKeys(result, ["kind", "ok", "outcome", "pullRequest"])
  ) {
    const pullRequest = parsePullRequest(
      result.pullRequest,
      submissionId,
      "closed"
    );
    return pullRequest ? { outcome: "closed", pullRequest } : null;
  }

  if (
    result.outcome === "merged" &&
    status === 200 &&
    hasExactKeys(result, [
      "finalContentSha256",
      "kind",
      "ok",
      "outcome",
      "pullRequest"
    ]) &&
    typeof result.finalContentSha256 === "string" &&
    digestPattern.test(result.finalContentSha256)
  ) {
    const pullRequest = parsePullRequest(
      result.pullRequest,
      submissionId,
      "merged"
    );
    return pullRequest
      ? {
          finalContentSha256: result.finalContentSha256,
          outcome: "merged",
          pullRequest
        }
      : null;
  }

  return null;
}

function parsePullRequest(
  value: unknown,
  submissionId: string,
  expectedState: "closed" | "merged" | "open"
): ArticleSubmissionPullRequest | null {
  const parsed = articleSubmissionPullRequestSchema.safeParse(value);
  if (!parsed.success) return null;

  const pullRequest = parsed.data;
  const expectedHead = `${STUDIO_PUBLICATION_TARGET.branchPrefix}/${submissionId}`;
  if (
    pullRequest.baseBranch !== STUDIO_PUBLICATION_TARGET.baseBranch ||
    pullRequest.headBranch !== expectedHead ||
    pullRequest.state !== expectedState ||
    !pullRequest.containsInitialCommit
  ) {
    return null;
  }

  if (expectedState === "merged") {
    return pullRequest.mergeCommitSha !== null &&
      pullRequest.mergeCommitReachableFromBase
      ? pullRequest
      : null;
  }

  return pullRequest.mergeCommitSha === null &&
    !pullRequest.mergeCommitReachableFromBase
    ? pullRequest
    : null;
}

function parseApiError(value: unknown): PublicationClientError | null {
  if (!isRecord(value) || !hasExactKeys(value, ["error"]) || !isRecord(value.error)) {
    return null;
  }
  const raw = value.error;
  const expectedKeys = raw.issues === undefined
    ? ["code", "message", "retryable"]
    : ["code", "issues", "message", "retryable"];
  if (
    !hasExactKeys(raw, expectedKeys) ||
    typeof raw.code !== "string" ||
    !errorCodePattern.test(raw.code) ||
    !isBoundedText(raw.message, 500) ||
    typeof raw.retryable !== "boolean"
  ) {
    return null;
  }

  if (raw.issues === undefined) {
    return {
      code: raw.code,
      message: raw.message,
      retryable: raw.retryable
    };
  }
  const issues = parseIssues(raw.issues);
  return issues
    ? {
        code: raw.code,
        issues,
        message: raw.message,
        retryable: raw.retryable
      }
    : null;
}

function parseIssues(value: unknown): ArticleSubmissionValidationIssue[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;

  const issues: ArticleSubmissionValidationIssue[] = [];
  for (const rawIssue of value) {
    if (
      !isRecord(rawIssue) ||
      !hasExactKeys(rawIssue, ["message", "path"]) ||
      !isBoundedText(rawIssue.message, 500) ||
      !Array.isArray(rawIssue.path) ||
      rawIssue.path.length > 20
    ) {
      return null;
    }
    const path: Array<string | number> = [];
    for (const segment of rawIssue.path) {
      if (
        typeof segment === "string" &&
        segment.length <= 200 &&
        !unsafeTextPattern.test(segment)
      ) {
        path.push(segment);
      } else if (typeof segment === "number" && Number.isSafeInteger(segment)) {
        path.push(segment);
      } else {
        return null;
      }
    }
    issues.push({ message: rawIssue.message, path });
  }
  return issues;
}

function parsePublicationAttempt(value: unknown): PublicationAttempt | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["request", "status", "version"]) ||
    value.version !== 1 ||
    !isRecord(value.request) ||
    !isRecord(value.status)
  ) {
    return null;
  }

  const parsedRequest = articleSubmissionRequestSchema.safeParse(value.request);
  if (
    !parsedRequest.success ||
    JSON.stringify(parsedRequest.data) !== JSON.stringify(value.request)
  ) {
    return null;
  }
  const base = { request: parsedRequest.data, version: 1 as const };
  const status = value.status;

  if (
    status.kind === "pending" &&
    isPublicationOperation(status.operation) &&
    hasExactKeys(status, ["kind", "operation"])
  ) {
    return { ...base, status: { kind: "pending", operation: status.operation } };
  }

  if (
    (status.kind === "failed" || status.kind === "outcomeUnknown") &&
    isPublicationOperation(status.operation) &&
    hasExactKeys(status, ["error", "kind", "operation"])
  ) {
    const error = parseStoredError(status.error);
    if (!error) return null;
    return status.kind === "failed"
      ? { ...base, status: { error, kind: "failed", operation: status.operation } }
      : {
          ...base,
          status: { error, kind: "outcomeUnknown", operation: status.operation }
        };
  }

  if (
    status.kind === "succeeded" &&
    hasExactKeys(status, ["kind", "result"])
  ) {
    const result = parseStoredSuccess(
      status.result,
      parsedRequest.data.submissionId
    );
    return result
      ? { ...base, status: { kind: "succeeded", result } }
      : null;
  }

  return null;
}

function parseStoredError(value: unknown): PublicationClientError | null {
  return parseApiError({ error: value });
}

function parseStoredSuccess(
  value: unknown,
  submissionId: string
): PublicationSuccess | null {
  if (!isRecord(value) || typeof value.outcome !== "string") return null;

  if (value.outcome === "cancelled" && hasExactKeys(value, ["outcome"])) {
    return { outcome: "cancelled" };
  }
  if (!isRecord(value.pullRequest)) return null;

  if (
    value.outcome === "open" &&
    hasExactKeys(value, ["outcome", "pullRequest"])
  ) {
    const pullRequest = parsePullRequest(value.pullRequest, submissionId, "open");
    return pullRequest ? { outcome: "open", pullRequest } : null;
  }
  if (
    value.outcome === "closed" &&
    hasExactKeys(value, ["outcome", "pullRequest"])
  ) {
    const pullRequest = parsePullRequest(value.pullRequest, submissionId, "closed");
    return pullRequest ? { outcome: "closed", pullRequest } : null;
  }
  if (
    value.outcome === "merged" &&
    hasExactKeys(value, ["finalContentSha256", "outcome", "pullRequest"]) &&
    typeof value.finalContentSha256 === "string" &&
    digestPattern.test(value.finalContentSha256)
  ) {
    const pullRequest = parsePullRequest(value.pullRequest, submissionId, "merged");
    return pullRequest
      ? {
          finalContentSha256: value.finalContentSha256,
          outcome: "merged",
          pullRequest
        }
      : null;
  }

  return null;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (
    !contentType ||
    contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
  ) {
    return null;
  }

  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_API_RESPONSE_BYTES)
  ) {
    return null;
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_API_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
    );
  } catch {
    return null;
  }
}

function requestFailure(
  error: unknown,
  signal?: AbortSignal
): PublicationClientError {
  if (
    signal?.aborted ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  ) {
    return {
      code: "request_aborted",
      message: "リクエストを中断しました。",
      retryable: true
    };
  }
  return {
    code: "network_error",
    message: "通信できませんでした。接続を確認して再試行してください。",
    retryable: true
  };
}

function defaultPublicationFetch(
  input: string,
  init: PublicationFetchInit
): Promise<Response> {
  return globalThis.fetch(
    input,
    init as Parameters<typeof globalThis.fetch>[1]
  );
}

type StoredAttemptRead =
  | { kind: "empty" }
  | { attempt: PublicationAttempt; kind: "valid" }
  | { kind: "invalid" }
  | { kind: "unavailable" };

const directPublicationLockRunner: PublicationLockRunner = {
  run<T>(callback: () => Promise<T>): Promise<T> {
    return callback();
  }
};

type WebLockRequest = (
  name: string,
  options: { mode: "exclusive" },
  callback: () => Promise<unknown>
) => Promise<unknown>;

function resolvePublicationLockRunner(
  provided?: PublicationLockRunner
): PublicationLockRunner | null {
  if (provided) return provided;
  const browser = globalThis as unknown as {
    navigator?: { locks?: unknown };
    window?: unknown;
  };
  if (browser.window === undefined) return directPublicationLockRunner;

  try {
    const manager = browser.navigator?.locks;
    if (
      typeof manager !== "object" ||
      manager === null ||
      !("request" in manager) ||
      typeof manager.request !== "function"
    ) {
      return null;
    }
    const request = manager.request as WebLockRequest;
    return {
      run<T>(callback: () => Promise<T>): Promise<T> {
        return request.call(
          manager,
          PUBLICATION_LOCK_NAME,
          { mode: "exclusive" },
          callback
        ) as Promise<T>;
      }
    };
  } catch {
    return null;
  }
}

async function withPublicationLock(
  options: PublicationActionOptions,
  action: () => Promise<PublicationActionResult>
): Promise<PublicationActionResult> {
  const runner = resolvePublicationLockRunner(options.lockRunner);
  if (!runner) return actionFailure(publicationLockUnavailable(), false);

  let entered = false;
  try {
    return await runner.run(async () => {
      entered = true;
      return action();
    });
  } catch {
    return actionFailure(
      entered ? publicationClientExecutionFailed() : publicationLockUnavailable(),
      entered
    );
  }
}

function readStoredAttempt(storage: PublicationStorage): StoredAttemptRead {
  let serialized: string | null;
  try {
    serialized = storage.getItem(PUBLICATION_ATTEMPT_STORAGE_KEY);
  } catch {
    return { kind: "unavailable" };
  }
  if (serialized === null) return { kind: "empty" };
  if (
    serialized.length > MAX_STORED_ATTEMPT_BYTES ||
    new TextEncoder().encode(serialized).byteLength > MAX_STORED_ATTEMPT_BYTES
  ) {
    return { kind: "invalid" };
  }

  try {
    const attempt = parsePublicationAttempt(JSON.parse(serialized));
    return attempt ? { attempt, kind: "valid" } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

function sameAttempt(left: PublicationAttempt, right: PublicationAttempt): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function currentAttemptFailure(
  attempt: PublicationAttempt,
  storage: PublicationStorage
): PublicationActionResult | null {
  const stored = readStoredAttempt(storage);
  if (stored.kind === "valid" && sameAttempt(attempt, stored.attempt)) {
    return null;
  }

  const error = stored.kind === "invalid"
    ? invalidStoredAttempt()
    : stored.kind === "unavailable"
      ? storageUnavailable()
      : publicationAttemptChanged();
  const operation = attempt.status.kind === "succeeded"
    ? "create"
    : attempt.status.operation;
  const fallback: FailedPublicationAttempt = {
    request: attempt.request,
    status: { error, kind: "failed", operation },
    version: 1
  };
  const currentAttempt = stored.kind === "valid" ? stored.attempt : fallback;

  return {
    attempt: currentAttempt,
    error,
    ok: false,
    outcomeUnknown:
      currentAttempt.status.kind === "pending" ||
      currentAttempt.status.kind === "outcomeUnknown"
  };
}

function invalidApiResponse(): PublicationClientError {
  return {
    code: "invalid_api_response",
    message: "公開状態を安全に確認できませんでした。",
    retryable: true
  };
}

function invalidStoredAttempt(): PublicationClientError {
  return {
    code: "invalid_stored_attempt",
    message: "保存されている公開操作を安全に確認できませんでした。",
    retryable: false
  };
}

function storageUnavailable(): PublicationClientError {
  return {
    code: "storage_unavailable",
    message: "公開操作をこのブラウザに保存できませんでした。",
    retryable: false
  };
}

function submissionIdUnavailable(): PublicationClientError {
  return {
    code: "submission_id_unavailable",
    message: "公開操作を安全に開始できませんでした。",
    retryable: false
  };
}

function publicationAttemptExists(): PublicationClientError {
  return {
    code: "publication_attempt_exists",
    message: "前回の公開操作を確認してから続けてください。",
    retryable: false
  };
}

function publicationAttemptChanged(): PublicationClientError {
  return {
    code: "publication_attempt_changed",
    message: "別のタブでレビュー依頼が更新されました。最新状態を読み直してください。",
    retryable: false
  };
}

function publicationLockUnavailable(): PublicationClientError {
  return {
    code: "publication_lock_unavailable",
    message: "複数タブでの重複送信を防げないため、レビュー依頼を開始できません。対応ブラウザで開き直してください。",
    retryable: false
  };
}

function publicationClientExecutionFailed(): PublicationClientError {
  return {
    code: "publication_client_execution_failed",
    message: "レビュー依頼の結果を安全に確認できませんでした。内容を変更せずに再確認してください。",
    retryable: true
  };
}

function actionFailure(
  error: PublicationClientError,
  outcomeUnknownValue: boolean
): PublicationActionResult {
  return {
    error,
    ok: false,
    outcomeUnknown: outcomeUnknownValue
  };
}

function isPublicationOperation(value: unknown): value is PublicationOperation {
  return value === "cancel" || value === "create";
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !unsafeTextPattern.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
