import { describe, expect, it, vi } from "vitest";
import {
  PUBLICATION_ATTEMPT_STORAGE_KEY,
  cancelArticleSubmission,
  clearPublicationAttempt,
  clearPublicationAttemptSafely,
  clearInvalidPublicationAttemptSafely,
  createArticleSubmission,
  fetchPublicationCapabilities,
  loadPublicationAttempt,
  persistPublicationAttempt,
  resumeArticleSubmission,
  retryPublicationAttempt,
  type PublicationAttempt,
  type PublicationFetcher,
  type PublicationStorage
} from "../src/publication-client";

const SUBMISSION_ID = "287f0d8b-c79f-4b20-9c3d-683b0c4e643e";
const OTHER_SUBMISSION_ID = "83ba2b8a-9a10-47ef-a21d-e1ec20b6749d";
const FINAL_CONTENT_SHA256 = `sha256:${"b".repeat(64)}`;

class MemoryStorage implements PublicationStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function articleInput() {
  return {
    frontmatter: {
      title: "Publication client",
      description: "Publication client browser state is tested.",
      slug: "publication-client",
      status: "draft",
      updatedAt: "2026-07-17",
      authors: ["Noema編集部"],
      topics: ["development-environment"],
      tags: ["Studio"],
      approach: "development",
      outcome: "A stable publication attempt can be retried",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    },
    markdown: "## Publication client\n\nThe browser keeps one stable attempt."
  };
}

function capabilityBody(enabled: boolean): unknown {
  return {
    identity: {
      email: "author@example.com",
      subject: "author-123"
    },
    publication: enabled
      ? {
          baseBranch: "develop",
          enabled: true,
          reviewKind: "draft_pull_request",
          state: "enabled",
          submissionMode: "create_only"
        }
      : {
          baseBranch: "develop",
          code: "github_app_not_configured",
          enabled: false,
          reviewKind: "draft_pull_request",
          state: "disabled",
          submissionMode: "create_only"
        }
  };
}

function pullRequest(state: "closed" | "merged" | "open", number = 42) {
  const merged = state === "merged";
  return {
    number,
    url: `https://github.com/mani1261790/Noema/pull/${number}`,
    state,
    draft: state === "open",
    baseBranch: "develop",
    headBranch: `studio/submissions/${SUBMISSION_ID}`,
    containsInitialCommit: true,
    mergeCommitSha: merged ? "a".repeat(40) : null,
    mergeCommitReachableFromBase: merged
  };
}

function successBody(outcome: "closed" | "merged" | "open"): unknown {
  if (outcome === "open") {
    return {
      result: {
        kind: "done",
        ok: true,
        outcome: "existing_pull_request",
        pullRequest: pullRequest("open")
      }
    };
  }
  if (outcome === "closed") {
    return {
      result: {
        kind: "done",
        ok: true,
        outcome: "closed_unmerged",
        pullRequest: pullRequest("closed")
      }
    };
  }
  return {
    result: {
      finalContentSha256: FINAL_CONTENT_SHA256,
      kind: "done",
      ok: true,
      outcome: "merged",
      pullRequest: pullRequest("merged")
    }
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status
  });
}

function asFetch(
  implementation: PublicationFetcher
): { fetcher: PublicationFetcher; mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(implementation);
  return { fetcher: mock as unknown as PublicationFetcher, mock };
}

function fixedSubmissionId() {
  return SUBMISSION_ID;
}

describe("publication capabilities", () => {
  it.each([
    ["enabled", true],
    ["disabled", false]
  ])("strictly parses %s capabilities", async (_label, enabled) => {
    const controller = new AbortController();
    const { fetcher, mock } = asFetch(async () =>
      jsonResponse(capabilityBody(enabled))
    );

    const result = await fetchPublicationCapabilities({
      fetcher,
      signal: controller.signal
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid capabilities");
    expect(result.capabilities.publication.enabled).toBe(enabled);
    expect(mock).toHaveBeenCalledWith(
      "/api/publication-capabilities",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "GET",
        signal: controller.signal
      })
    );
  });

  it.each([
    {
      ...capabilityBody(true) as Record<string, unknown>,
      diagnostic: "must not be accepted"
    },
    {
      identity: {
        email: "author@example.com",
        subject: "author-123",
        token: "must not be accepted"
      },
      publication: (capabilityBody(true) as {
        publication: unknown;
      }).publication
    },
    {
      identity: { email: "author@example.com", subject: "author-123" },
      publication: {
        baseBranch: "develop",
        enabled: true,
        reviewKind: "draft_pull_request",
        state: "disabled",
        submissionMode: "create_only"
      }
    }
  ])("fails closed on malformed capabilities", async (body) => {
    const { fetcher } = asFetch(async () => jsonResponse(body));

    const result = await fetchPublicationCapabilities({ fetcher });

    expect(result).toEqual({
      error: {
        code: "invalid_api_response",
        message: "公開状態を安全に確認できませんでした。",
        retryable: true
      },
      ok: false
    });
  });
});

describe("article submission attempts", () => {
  it("persists the exact schema request before POST and never sends identity", async () => {
    const storage = new MemoryStorage();
    const createSubmissionId = vi.fn(fixedSubmissionId);
    const { fetcher, mock } = asFetch(async (input, init) => {
      expect(String(input)).toBe("/api/article-submissions");
      const saved = loadPublicationAttempt(storage);
      expect(saved?.status).toEqual({ kind: "pending", operation: "create" });
      expect(typeof init?.body).toBe("string");
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body).toEqual(saved?.request);
      expect(body).not.toHaveProperty("identity");
      expect(body).not.toHaveProperty("principalId");
      return jsonResponse(successBody("open"), 202);
    });

    const result = await createArticleSubmission(articleInput(), {
      createSubmissionId,
      fetcher,
      storage
    });

    expect(result.ok).toBe(true);
    expect(createSubmissionId).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledTimes(1);
    const saved = loadPublicationAttempt(storage);
    expect(saved?.request.submissionId).toBe(SUBMISSION_ID);
    expect(saved?.status.kind).toBe("succeeded");
  });

  it("does not overwrite an existing attempt during a second create call", async () => {
    const storage = new MemoryStorage();
    let finishFirstRequest: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      finishFirstRequest = resolve;
    });
    const firstFetch = asFetch(async () => firstResponse);
    const firstSubmissionId = vi.fn(fixedSubmissionId);
    const first = createArticleSubmission(articleInput(), {
      createSubmissionId: firstSubmissionId,
      fetcher: firstFetch.fetcher,
      storage
    });
    const pending = loadPublicationAttempt(storage);
    if (!pending) throw new Error("Expected the first pending attempt");

    const secondSubmissionId = vi.fn(() =>
      "83ba2b8a-9a10-47ef-a21d-e1ec20b6749d"
    );
    const secondFetch = asFetch(async () =>
      jsonResponse(successBody("open"), 202)
    );
    const second = await createArticleSubmission(articleInput(), {
      createSubmissionId: secondSubmissionId,
      fetcher: secondFetch.fetcher,
      storage
    });

    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("Expected the existing attempt guard");
    expect(second.error.code).toBe("publication_attempt_exists");
    expect(second.attempt).toEqual(pending);
    expect(secondSubmissionId).not.toHaveBeenCalled();
    expect(secondFetch.mock).not.toHaveBeenCalled();
    expect(loadPublicationAttempt(storage)).toEqual(pending);

    finishFirstRequest?.(jsonResponse(successBody("open"), 202));
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(firstSubmissionId).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a cancelled result contains extra fields", async () => {
    const storage = new MemoryStorage();
    const { fetcher } = asFetch(async () =>
      jsonResponse({
        result: {
          claim: { diagnostic: "must not cross the HTTP boundary" },
          kind: "done",
          ok: true,
          outcome: "cancelled"
        }
      })
    );

    const result = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher,
      storage
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an operation mismatch");
    expect(result.error.code).toBe("invalid_api_response");
    expect(result.outcomeUnknown).toBe(true);
    expect(result.attempt?.status).toMatchObject({
      kind: "outcomeUnknown",
      operation: "create"
    });
  });

  it.each([
    ["network", new Error("offline"), undefined, "network_error"],
    [
      "abort",
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      "aborted",
      "request_aborted"
    ]
  ])(
    "marks a %s failure after POST as outcomeUnknown and retains the attempt",
    async (_label, thrown, signalState, expectedCode) => {
      const storage = new MemoryStorage();
      const controller = new AbortController();
      if (signalState === "aborted") controller.abort();
      const { fetcher } = asFetch(async () => {
        throw thrown;
      });

      const result = await createArticleSubmission(articleInput(), {
        createSubmissionId: fixedSubmissionId,
        fetcher,
        signal: controller.signal,
        storage
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected an unknown result");
      expect(result.outcomeUnknown).toBe(true);
      expect(result.error.code).toBe(expectedCode);
      expect(result.attempt?.status.kind).toBe("outcomeUnknown");
      expect(loadPublicationAttempt(storage)).toEqual(result.attempt);
    }
  );

  it.each([
    ["network", new Error("response stream disconnected"), false, "network_error"],
    [
      "abort",
      Object.assign(new Error("response stream aborted"), { name: "AbortError" }),
      true,
      "request_aborted"
    ]
  ])(
    "retains outcomeUnknown when the response body has a %s failure",
    async (_label, streamError, abortSignal, expectedCode) => {
      const storage = new MemoryStorage();
      const controller = new AbortController();
      const { fetcher } = asFetch(async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(streamController) {
              if (abortSignal) controller.abort();
              streamController.error(streamError);
            }
          }),
          { headers: { "content-type": "application/json" }, status: 202 }
        )
      );

      const result = await createArticleSubmission(articleInput(), {
        createSubmissionId: fixedSubmissionId,
        fetcher,
        signal: controller.signal,
        storage
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected an unknown stream result");
      expect(result.outcomeUnknown).toBe(true);
      expect(result.error.code).toBe(expectedCode);
      expect(loadPublicationAttempt(storage)).toEqual(result.attempt);
    }
  );

  it("loads and retries a stable request without generating a new UUID", async () => {
    const storage = new MemoryStorage();
    const createSubmissionId = vi.fn(fixedSubmissionId);
    const firstFetch = asFetch(async () => {
      throw new Error("offline");
    });
    await createArticleSubmission(articleInput(), {
      createSubmissionId,
      fetcher: firstFetch.fetcher,
      storage
    });
    const reloaded = loadPublicationAttempt(storage);
    if (!reloaded) throw new Error("Expected a persisted attempt");

    const retryFetch = asFetch(async (_input, init) => {
      const body = JSON.parse(init?.body as string) as { submissionId: string };
      expect(body.submissionId).toBe(SUBMISSION_ID);
      expect(body).toEqual(reloaded.request);
      return jsonResponse(successBody("open"), 202);
    });
    const result = await retryPublicationAttempt(reloaded, {
      fetcher: retryFetch.fetcher,
      storage
    });

    expect(result.ok).toBe(true);
    expect(createSubmissionId).toHaveBeenCalledTimes(1);
    expect(retryFetch.mock).toHaveBeenCalledTimes(1);
    expect(loadPublicationAttempt(storage)).toEqual(result.attempt);
  });

  it("refuses a stale-tab retry without overwriting the current attempt", async () => {
    const storage = new MemoryStorage();
    const firstFetch = asFetch(async () => {
      throw new Error("offline");
    });
    const first = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher: firstFetch.fetcher,
      storage
    });
    if (first.ok || !first.attempt) {
      throw new Error("Expected a retained first attempt");
    }
    const staleAttempt = first.attempt;
    if (staleAttempt.status.kind !== "outcomeUnknown") {
      throw new Error("Expected an outcome-unknown first attempt");
    }
    const currentAttempt: PublicationAttempt = {
      request: {
        ...staleAttempt.request,
        submissionId: OTHER_SUBMISSION_ID
      },
      status: staleAttempt.status,
      version: 1
    };
    expect(persistPublicationAttempt(storage, currentAttempt)).toBe(true);
    const retryFetch = asFetch(async () =>
      jsonResponse(successBody("open"), 202)
    );

    const result = await retryPublicationAttempt(staleAttempt, {
      fetcher: retryFetch.fetcher,
      storage
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a stale-attempt failure");
    expect(result.error.code).toBe("publication_attempt_changed");
    expect(result.attempt).toEqual(currentAttempt);
    expect(retryFetch.mock).not.toHaveBeenCalled();
    expect(loadPublicationAttempt(storage)).toEqual(currentAttempt);
  });

  it.each([
    ["open", 202],
    ["closed", 200],
    ["merged", 200]
  ] as const)("parses and persists a confirmed %s result", async (outcome, status) => {
    const storage = new MemoryStorage();
    const { fetcher } = asFetch(async () =>
      jsonResponse(successBody(outcome), status)
    );

    const result = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher,
      storage
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected a successful result");
    expect(result.result.outcome).toBe(outcome);
    expect(loadPublicationAttempt(storage)).toEqual(result.attempt);
  });

  it("rejects an unsafe Pull Request URL and keeps the stable attempt", async () => {
    const storage = new MemoryStorage();
    const body = successBody("open") as {
      result: { pullRequest: { url: string } };
    };
    body.result.pullRequest.url = "https://attacker.example/steal";
    const { fetcher } = asFetch(async () => jsonResponse(body, 202));

    const result = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher,
      storage
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected an unsafe response failure");
    expect(result.error.code).toBe("invalid_api_response");
    expect(result.outcomeUnknown).toBe(true);
    expect(loadPublicationAttempt(storage)?.status.kind).toBe("outcomeUnknown");
  });

  it.each([
    ["observation_unavailable", true, 503],
    ["article_already_exists", false, 409]
  ])(
    "parses a bounded %s API error",
    async (code, retryable, status) => {
      const storage = new MemoryStorage();
      const { fetcher } = asFetch(async () =>
        jsonResponse(
          {
            error: {
              code,
              message: "公開処理を完了できませんでした。",
              retryable
            }
          },
          status
        )
      );

      const result = await createArticleSubmission(articleInput(), {
        createSubmissionId: fixedSubmissionId,
        fetcher,
        storage
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected an API error");
      expect(result.outcomeUnknown).toBe(false);
      expect(result.error).toEqual({
        code,
        message: "公開処理を完了できませんでした。",
        retryable
      });
      expect(result.attempt?.status.kind).toBe("failed");
      expect(loadPublicationAttempt(storage)).toEqual(result.attempt);
    }
  );

  it("does not expose oversized or diagnostic-rich API errors", async () => {
    const storage = new MemoryStorage();
    const { fetcher } = asFetch(async () =>
      jsonResponse(
        {
          error: {
            code: "publication_unavailable",
            diagnostic: "private server detail",
            message: "x".repeat(501),
            retryable: true
          }
        },
        503
      )
    );

    const result = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher,
      storage
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected a bounded generic failure");
    expect(result.error.code).toBe("invalid_api_response");
    expect(result.error.message).not.toContain("private server detail");
    expect(result.outcomeUnknown).toBe(true);
  });
});

describe("publication cancellation and persistence", () => {
  it("cancels with the same submissionId and leaves clearing to the caller", async () => {
    const storage = new MemoryStorage();
    const firstFetch = asFetch(async () => {
      throw new Error("offline");
    });
    const firstResult = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher: firstFetch.fetcher,
      storage
    });
    if (firstResult.ok || !firstResult.attempt) {
      throw new Error("Expected a retained unknown attempt");
    }

    const cancelFetch = asFetch(async (input, init) => {
      expect(String(input)).toBe("/api/article-submission-cancellations");
      expect(JSON.parse(init?.body as string)).toEqual({
        version: 1,
        operation: "cancel_article_submission",
        submissionId: SUBMISSION_ID
      });
      expect(init?.body).not.toContain("identity");
      return jsonResponse({
        result: { kind: "done", ok: true, outcome: "cancelled" }
      });
    });
    const cancelled = await cancelArticleSubmission(firstResult.attempt, {
      fetcher: cancelFetch.fetcher,
      storage
    });

    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) throw new Error("Expected confirmed cancellation");
    expect(cancelled.result).toEqual({ outcome: "cancelled" });
    expect(loadPublicationAttempt(storage)).toEqual(cancelled.attempt);
    expect(storage.getItem(PUBLICATION_ATTEMPT_STORAGE_KEY)).not.toBeNull();

    expect(clearPublicationAttempt(storage)).toBe(true);
    expect(loadPublicationAttempt(storage)).toBeNull();
  });

  it("rejects a PR result for cancel and retries the cancellation operation", async () => {
    const storage = new MemoryStorage();
    const initialFetch = asFetch(async () => {
      throw new Error("offline");
    });
    const initial = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher: initialFetch.fetcher,
      storage
    });
    if (initial.ok || !initial.attempt) {
      throw new Error("Expected an initial retained attempt");
    }

    const mismatchedFetch = asFetch(async () =>
      jsonResponse(successBody("open"), 202)
    );
    const mismatched = await cancelArticleSubmission(initial.attempt, {
      fetcher: mismatchedFetch.fetcher,
      storage
    });
    if (mismatched.ok || !mismatched.attempt) {
      throw new Error("Expected a mismatched cancellation result");
    }
    expect(mismatched.outcomeUnknown).toBe(true);
    expect(mismatched.attempt.status).toMatchObject({
      kind: "outcomeUnknown",
      operation: "cancel"
    });

    const retryFetch = asFetch(async (input) => {
      expect(String(input)).toBe("/api/article-submission-cancellations");
      return jsonResponse({
        result: { kind: "done", ok: true, outcome: "cancelled" }
      });
    });
    const retried = await retryPublicationAttempt(mismatched.attempt, {
      fetcher: retryFetch.fetcher,
      storage
    });

    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error("Expected a confirmed cancellation");
    expect(retried.result).toEqual({ outcome: "cancelled" });
  });

  it("can return from a definite cancellation failure to create reconciliation", async () => {
    const storage = new MemoryStorage();
    const initialFetch = asFetch(async () => {
      throw new Error("offline");
    });
    const initial = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher: initialFetch.fetcher,
      storage
    });
    if (initial.ok || !initial.attempt) {
      throw new Error("Expected an initial retained attempt");
    }

    const failedCancelFetch = asFetch(async () =>
      jsonResponse(
        {
          error: {
            code: "submission_cancellation_forbidden",
            message: "GitHub artifactの作成が始まった送信はcancelできません。",
            retryable: false
          }
        },
        403
      )
    );
    const failedCancel = await cancelArticleSubmission(initial.attempt, {
      fetcher: failedCancelFetch.fetcher,
      storage
    });
    if (failedCancel.ok || !failedCancel.attempt) {
      throw new Error("Expected a definite cancellation failure");
    }
    expect(failedCancel.attempt.status).toMatchObject({
      kind: "failed",
      operation: "cancel"
    });

    const resumeFetch = asFetch(async (input, init) => {
      expect(String(input)).toBe("/api/article-submissions");
      expect(JSON.parse(init?.body as string)).toEqual(initial.attempt?.request);
      return jsonResponse(successBody("open"), 202);
    });
    const resumed = await resumeArticleSubmission(failedCancel.attempt, {
      fetcher: resumeFetch.fetcher,
      storage
    });

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("Expected create reconciliation");
    expect(resumed.result.outcome).toBe("open");
    expect(resumed.attempt.request.submissionId).toBe(SUBMISSION_ID);
  });

  it("resume converges to cancelled when create reconciliation observes a cancelled claim", async () => {
    const storage = new MemoryStorage();
    const initialFetch = asFetch(async () => {
      throw new Error("create response lost");
    });
    const initial = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher: initialFetch.fetcher,
      storage
    });
    if (initial.ok || !initial.attempt) {
      throw new Error("Expected an unknown create attempt");
    }

    const cancelFetch = asFetch(async () => {
      throw new Error("cancel response lost");
    });
    const unconfirmedCancel = await cancelArticleSubmission(initial.attempt, {
      fetcher: cancelFetch.fetcher,
      storage
    });
    if (unconfirmedCancel.ok || !unconfirmedCancel.attempt) {
      throw new Error("Expected an unknown cancellation attempt");
    }
    expect(unconfirmedCancel.attempt.status).toMatchObject({
      kind: "outcomeUnknown",
      operation: "cancel"
    });

    const resumeFetch = asFetch(async (input) => {
      expect(String(input)).toBe("/api/article-submissions");
      return jsonResponse({
        result: { kind: "done", ok: true, outcome: "cancelled" }
      });
    });
    const resumed = await resumeArticleSubmission(unconfirmedCancel.attempt, {
      fetcher: resumeFetch.fetcher,
      storage
    });

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error("Expected cancelled convergence");
    expect(resumed.result).toEqual({ outcome: "cancelled" });
    expect(resumed.attempt.status).toEqual({
      kind: "succeeded",
      result: { outcome: "cancelled" }
    });
    expect(loadPublicationAttempt(storage)).toEqual(resumed.attempt);
  });

  it("fails closed for invalid or unavailable storage", () => {
    const storage = new MemoryStorage();
    storage.values.set(PUBLICATION_ATTEMPT_STORAGE_KEY, "{not-json");

    expect(loadPublicationAttempt(storage)).toBeNull();
    expect(persistPublicationAttempt(storage, {})).toBe(false);

    const throwingStorage: PublicationStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      }
    };
    expect(loadPublicationAttempt(throwingStorage)).toBeNull();
    expect(clearPublicationAttempt(throwingStorage)).toBe(false);
  });

  it("safe clear refuses a stale-tab mismatch and retains the current attempt", async () => {
    const storage = new MemoryStorage();
    const firstFetch = asFetch(async () => {
      throw new Error("offline");
    });
    const first = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher: firstFetch.fetcher,
      storage
    });
    if (first.ok || !first.attempt) {
      throw new Error("Expected a retained first attempt");
    }
    const staleAttempt = first.attempt;
    if (staleAttempt.status.kind !== "outcomeUnknown") {
      throw new Error("Expected an outcome-unknown first attempt");
    }
    const currentAttempt: PublicationAttempt = {
      request: {
        ...staleAttempt.request,
        submissionId: OTHER_SUBMISSION_ID
      },
      status: staleAttempt.status,
      version: 1
    };
    expect(persistPublicationAttempt(storage, currentAttempt)).toBe(true);

    const result = await clearPublicationAttemptSafely(staleAttempt, {
      storage
    });

    expect(result).toEqual({
      attempt: currentAttempt,
      error: {
        code: "publication_attempt_changed",
        message: "別のタブでレビュー依頼が更新されました。最新状態を読み直してください。",
        retryable: false
      },
      ok: false
    });
    expect(loadPublicationAttempt(storage)).toEqual(currentAttempt);
  });

  it("safe clear removes an exact attempt and is idempotent for a second tab", async () => {
    const storage = new MemoryStorage();
    const firstFetch = asFetch(async () => {
      throw new Error("offline");
    });
    const first = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher: firstFetch.fetcher,
      storage
    });
    if (first.ok || !first.attempt) {
      throw new Error("Expected a retained attempt");
    }

    const result = await clearPublicationAttemptSafely(first.attempt, {
      storage
    });

    expect(result).toEqual({ ok: true });
    expect(loadPublicationAttempt(storage)).toBeNull();

    const secondTabResult = await clearPublicationAttemptSafely(first.attempt, {
      storage
    });

    expect(secondTabResult).toEqual({ ok: true });
    expect(loadPublicationAttempt(storage)).toBeNull();
  });

  it("safe invalid clear removes a present malformed attempt", async () => {
    const storage = new MemoryStorage();
    storage.values.set(PUBLICATION_ATTEMPT_STORAGE_KEY, "{not-json");

    const result = await clearInvalidPublicationAttemptSafely({ storage });

    expect(result).toEqual({ ok: true });
    expect(storage.getItem(PUBLICATION_ATTEMPT_STORAGE_KEY)).toBeNull();
  });

  it("safe invalid clear refuses a value that is now a valid attempt", async () => {
    const storage = new MemoryStorage();
    const firstFetch = asFetch(async () => {
      throw new Error("offline");
    });
    const first = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher: firstFetch.fetcher,
      storage
    });
    if (first.ok || !first.attempt) {
      throw new Error("Expected a retained valid attempt");
    }

    const result = await clearInvalidPublicationAttemptSafely({ storage });

    expect(result).toEqual({
      attempt: first.attempt,
      error: {
        code: "publication_attempt_changed",
        message: "別のタブでレビュー依頼が更新されました。最新状態を読み直してください。",
        retryable: false
      },
      ok: false
    });
    expect(loadPublicationAttempt(storage)).toEqual(first.attempt);
  });

  it("safe invalid clear succeeds without removing when storage is empty", async () => {
    const removeItem = vi.fn();
    const storage: PublicationStorage = {
      getItem: () => null,
      removeItem,
      setItem: () => undefined
    };

    const result = await clearInvalidPublicationAttemptSafely({ storage });

    expect(result).toEqual({ ok: true });
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("safe invalid clear fails closed on storage read or removal errors", async () => {
    const unreadableRemove = vi.fn();
    const unreadable: PublicationStorage = {
      getItem() {
        throw new Error("read blocked");
      },
      removeItem: unreadableRemove,
      setItem: () => undefined
    };

    const unreadableResult = await clearInvalidPublicationAttemptSafely({
      storage: unreadable
    });

    expect(unreadableResult).toEqual({
      error: {
        code: "storage_unavailable",
        message: "公開操作をこのブラウザに保存できませんでした。",
        retryable: false
      },
      ok: false
    });
    expect(unreadableRemove).not.toHaveBeenCalled();

    const removalFailure: PublicationStorage = {
      getItem: () => "{not-json",
      removeItem() {
        throw new Error("remove blocked");
      },
      setItem: () => undefined
    };
    const removalResult = await clearInvalidPublicationAttemptSafely({
      storage: removalFailure
    });

    expect(removalResult).toEqual({
      error: {
        code: "storage_unavailable",
        message: "公開操作をこのブラウザに保存できませんでした。",
        retryable: false
      },
      ok: false
    });
  });

  it("retains a successful result across a storage reload", async () => {
    const storage = new MemoryStorage();
    const { fetcher } = asFetch(async () =>
      jsonResponse(successBody("merged"))
    );
    const result = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher,
      storage
    });
    if (!result.ok) throw new Error("Expected successful publication");

    const reloaded = loadPublicationAttempt(storage);

    expect(reloaded).toEqual(result.attempt);
    expect(reloaded?.status).toEqual({
      kind: "succeeded",
      result: {
        finalContentSha256: FINAL_CONTENT_SHA256,
        outcome: "merged",
        pullRequest: pullRequest("merged")
      }
    });
  });

  it("does not POST when the exact attempt cannot be persisted first", async () => {
    const storage: PublicationStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
      removeItem: () => undefined
    };
    const { fetcher, mock } = asFetch(async () =>
      jsonResponse(successBody("open"), 202)
    );

    const result = await createArticleSubmission(articleInput(), {
      createSubmissionId: fixedSubmissionId,
      fetcher,
      storage
    });

    expect(result).toEqual({
      error: {
        code: "storage_unavailable",
        message: "公開操作をこのブラウザに保存できませんでした。",
        retryable: false
      },
      ok: false,
      outcomeUnknown: false
    });
    expect(mock).not.toHaveBeenCalled();
  });
});
