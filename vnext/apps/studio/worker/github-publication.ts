import { parseArticle } from "@noema/content"
import type {
  ArticleSubmissionDecision,
  ArticleSubmissionPlan,
  ArticleSubmissionSnapshot
} from "@noema/studio-publication"

export const GITHUB_PUBLICATION_TARGET = {
  apiBaseUrl: "https://api.github.com",
  apiVersion: "2026-03-10",
  articleDirectory: "vnext/apps/blog/src/content/articles",
  baseBranch: "develop",
  owner: "mani1261790",
  repository: "Noema",
  userAgent: "Noema-Studio-Publication/1.0"
} as const

const GITHUB_REQUEST_TIMEOUT_MS = 15_000
const MAX_TOKEN_RESPONSE_BYTES = 256 * 1024
const MAX_OBJECT_RESPONSE_BYTES = 1024 * 1024
const MAX_LIST_RESPONSE_BYTES = 4 * 1024 * 1024
const MAX_TREE_RESPONSE_BYTES = 8 * 1024 * 1024
const MAX_ARTICLE_BYTES = 512 * 1024
const MAX_ARTICLE_FILES = 500
const MAX_PULL_REQUESTS = 20
const MAX_PEM_BYTES = 64 * 1024
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/
const SUBMISSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const ARTICLE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,200}$/
const INSTALLATION_ID_PATTERN = /^[1-9][0-9]{0,19}$/
const BRANCH_PATTERN =
  /^studio\/submissions\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type FetchImplementation = typeof globalThis.fetch
type CreateSubmissionRefAction = Extract<
  ArticleSubmissionDecision,
  {
    action: "create_submission_ref"
    kind: "act"
    ok: true
  }
>

type BaseObservation = ArticleSubmissionSnapshot["base"]
type BranchObservation = ArticleSubmissionSnapshot["branch"]
type PullRequestsObservation = ArticleSubmissionSnapshot["pullRequests"]
type BaseState = Extract<BaseObservation, { state: "known" }>["value"]
type BranchProof = NonNullable<
  Extract<BranchObservation, { state: "known" }>["value"]
>
type PullRequestProof = Extract<
  PullRequestsObservation,
  { state: "known" }
>["value"][number]

export interface GitHubPublicationConfiguration {
  clientId: string
  installationId: string
  privateKeyPem: string
}

export interface GitHubPublicationDependencies {
  fetch?: FetchImplementation
  now?: () => number
}

export interface GitHubPublicationObservation {
  base: BaseObservation
  branch: BranchObservation
  pullRequests: PullRequestsObservation
}

export type GitHubCancellationArtifactObservation =
  | {
      state: "known"
      value: {
        branchExists: boolean
        pullRequestCount: number
      }
    }
  | { state: "unavailable"; retryable: true }

export type GitHubPublicationErrorCode =
  | "github_configuration_invalid"
  | "github_protocol_invalid"
  | "github_publication_conflict"
  | "github_request_failed"
  | "github_write_indeterminate"

export class GitHubPublicationError extends Error {
  override readonly name: string = "GitHubPublicationError"
  readonly code: GitHubPublicationErrorCode
  readonly operation: string
  readonly retryable: boolean
  readonly status: number | null

  constructor(
    code: GitHubPublicationErrorCode,
    operation: string,
    retryable: boolean,
    status: number | null = null
  ) {
    super(publicErrorMessage(code))
    this.code = code
    this.operation = operation
    this.retryable = retryable
    this.status = status
  }
}

export class GitHubPublicationConfigurationError extends GitHubPublicationError {
  override readonly name = "GitHubPublicationConfigurationError"
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super("github_configuration_invalid", "configuration", false)
    this.issues = [...issues]
  }
}

export class GitHubPublicationConflictError extends GitHubPublicationError {
  override readonly name = "GitHubPublicationConflictError"

  constructor(operation: string) {
    super("github_publication_conflict", operation, false)
  }
}

interface JsonResult {
  data: unknown
  headers: Headers
  status: number
}

interface InstallationToken {
  expiresAt: number
  token: string
}

interface ReferenceState {
  name: string
  sha: string
}

interface GitCommit {
  message: string
  parents: string[]
  sha: string
  treeSha: string
}

interface GitTreeEntry {
  mode: string
  path: string
  sha: string
  type: "blob" | "commit" | "tree"
}

interface GitTree {
  entries: GitTreeEntry[]
  sha: string
  truncated: boolean
}

interface BaseArticleInventoryEntry {
  path: string
  sha: string
  slug: string
}

interface GitBlob {
  bytes: Uint8Array
  sha: string
}

interface CommitListEntry {
  message: string
  sha: string
}

interface CompareFile {
  filename: string
  sha: string
  status: string
}

interface Comparison {
  aheadBy: number
  files: CompareFile[]
  status: "ahead" | "behind" | "diverged" | "identical"
  totalCommits: number
}

interface RawPullRequest {
  baseBranch: string
  body: string | null
  draft: boolean
  headBranch: string
  headSha: string
  htmlUrl: string
  mergeCommitSha: string | null
  mergedAt: string | null
  number: number
  state: "closed" | "open"
  title: string
}

export class GitHubPublicationAdapter {
  readonly #clientId: string
  readonly #fetch: FetchImplementation
  readonly #installationId: string
  readonly #now: () => number
  readonly #privateKeyPem: string
  readonly #baseObservationCache = new Map<string, BaseState>()
  readonly #baseInventoryCache = new Map<string, BaseArticleInventoryEntry[]>()
  readonly #blobDigestCache = new Map<
    string,
    { contentSha256: string; slug: string }
  >()
  #installationToken: InstallationToken | null = null
  #installationTokenPromise: Promise<string> | null = null
  #signingKeyPromise: Promise<CryptoKey> | null = null

  constructor(
    configuration: GitHubPublicationConfiguration,
    dependencies: GitHubPublicationDependencies = {}
  ) {
    const validated = validateConfiguration(configuration)
    this.#clientId = validated.clientId
    this.#installationId = validated.installationId
    this.#privateKeyPem = validated.privateKeyPem
    this.#fetch = dependencies.fetch ?? globalThis.fetch
    this.#now = dependencies.now ?? Date.now
  }

  async observe(
    plan: ArticleSubmissionPlan
  ): Promise<GitHubPublicationObservation> {
    assertFixedPlan(plan)

    let token: string
    try {
      token = await this.#createInstallationToken()
    } catch (error) {
      if (
        error instanceof GitHubPublicationConfigurationError ||
        (error instanceof GitHubPublicationError && !error.retryable)
      ) {
        throw error
      }
      return allUnavailable()
    }

    const base = await this.#observePart(() => this.#observeBase(token, plan))
    if (base.state === "unavailable") {
      return {
        base,
        branch: unavailable(),
        pullRequests: unavailable()
      }
    }
    const branch = await this.#observePart(() =>
      this.#observeBranch(token, plan)
    )
    if (branch.state === "unavailable") {
      return { base, branch, pullRequests: unavailable() }
    }
    const pullRequests = await this.#observePart(() =>
      this.#observePullRequests(token, plan, base.value.headSha, branch)
    )

    return { base, branch, pullRequests }
  }

  async observeCancellationArtifacts(
    intent: ArticleSubmissionPlan["intent"]
  ): Promise<GitHubCancellationArtifactObservation> {
    assertFixedIntent(intent)

    let token: string
    try {
      token = await this.#createInstallationToken()
    } catch (error) {
      if (
        error instanceof GitHubPublicationConfigurationError ||
        (error instanceof GitHubPublicationError && !error.retryable)
      ) {
        throw error
      }
      return unavailable()
    }

    try {
      const branch = await this.#getReference(
        token,
        `heads/${intent.headBranch}`,
        true
      )
      const query = new URLSearchParams({
        base: GITHUB_PUBLICATION_TARGET.baseBranch,
        head: `${GITHUB_PUBLICATION_TARGET.owner}:${intent.headBranch}`,
        per_page: "100",
        state: "all"
      })
      const result = await this.#requestJson(
        token,
        `/repos/mani1261790/Noema/pulls?${query.toString()}`,
        { method: "GET" },
        MAX_LIST_RESPONSE_BYTES,
        "observe_cancellation_artifacts"
      )
      assertNoNextPage(result.headers, "observe_cancellation_artifacts")
      if (!Array.isArray(result.data) || result.data.length > 100) {
        throw protocolError("observe_cancellation_artifacts")
      }
      for (const value of result.data) {
        const pullRequest = parsePullRequest(
          value,
          "observe_cancellation_artifacts"
        )
        if (
          pullRequest.htmlUrl !==
            `https://github.com/mani1261790/Noema/pull/${pullRequest.number}` ||
          pullRequest.baseBranch !== GITHUB_PUBLICATION_TARGET.baseBranch ||
          pullRequest.headBranch !== intent.headBranch
        ) {
          throw protocolError("observe_cancellation_artifacts")
        }
      }
      return known({
        branchExists: branch !== null,
        pullRequestCount: result.data.length
      })
    } catch (error) {
      if (
        error instanceof GitHubPublicationConfigurationError ||
        error instanceof GitHubPublicationConflictError ||
        (error instanceof GitHubPublicationError && !error.retryable)
      ) {
        throw error
      }
      return unavailable()
    }
  }

  async createSubmissionRef(
    plan: ArticleSubmissionPlan,
    action: CreateSubmissionRefAction
  ): Promise<void> {
    assertFixedPlan(plan)
    assertCreateRefAction(plan, action)
    const token = await this.#createInstallationToken()
    let proposedCommitSha: string | null = null

    try {
      const existing = await this.#getReference(
        token,
        `heads/${plan.git.headBranch}`,
        true
      )
      if (existing) {
        const proof = await this.#observeBranch(token, plan)
        if (
          proof &&
          proof.headSha === proof.initialCommit.sha &&
          proof.initialCommit.parentSha === action.baseCommitSha &&
          branchProofMatchesPlan(proof, plan)
        ) {
          return
        }
        throw new GitHubPublicationConflictError("create_submission_ref")
      }

      const baseReference = await this.#getReference(
        token,
        `heads/${GITHUB_PUBLICATION_TARGET.baseBranch}`,
        false
      )
      if (!baseReference || baseReference.sha !== action.baseCommitSha) {
        throw new GitHubPublicationError(
          "github_write_indeterminate",
          "create_submission_ref",
          true
        )
      }

      const expectedContentDigest = await sha256(plan.article.content)
      if (expectedContentDigest !== plan.article.contentSha256) {
        throw new GitHubPublicationConflictError("create_submission_ref")
      }

      const baseCommit = await this.#getCommit(token, action.baseCommitSha)
      const blob = await this.#postBlob(token, plan.article.content)
      const treeSha = await this.#postTree(
        token,
        baseCommit.treeSha,
        plan.article.path,
        blob.sha
      )
      proposedCommitSha = await this.#postCommit(
        token,
        plan.git.commitMessage,
        treeSha,
        action.baseCommitSha
      )

      const currentBase = await this.#getReference(
        token,
        `heads/${GITHUB_PUBLICATION_TARGET.baseBranch}`,
        false
      )
      if (!currentBase || currentBase.sha !== action.baseCommitSha) {
        throw new GitHubPublicationError(
          "github_write_indeterminate",
          "create_submission_ref",
          true
        )
      }

      const currentHead = await this.#getReference(
        token,
        `heads/${plan.git.headBranch}`,
        true
      )
      if (currentHead) {
        if (currentHead.sha === proposedCommitSha) return
        throw new GitHubPublicationConflictError("create_submission_ref")
      }

      const result = await this.#requestJson(
        token,
        "/repos/mani1261790/Noema/git/refs",
        {
          body: JSON.stringify({
            ref: `refs/heads/${plan.git.headBranch}`,
            sha: proposedCommitSha
          }),
          method: "POST"
        },
        MAX_OBJECT_RESPONSE_BYTES,
        "create_submission_ref"
      )
      const created = parseReference(result.data, "create_submission_ref")
      if (
        created.name !== `refs/heads/${plan.git.headBranch}` ||
        created.sha !== proposedCommitSha
      ) {
        throw protocolError("create_submission_ref")
      }
    } catch (error) {
      if (
        error instanceof GitHubPublicationConfigurationError ||
        error instanceof GitHubPublicationConflictError
      ) {
        throw error
      }
      if (isDefinitiveRequestFailure(error)) throw error
      await this.#reconcileRefWrite(token, plan, action, proposedCommitSha)
    }
  }

  async createDraftPullRequest(plan: ArticleSubmissionPlan): Promise<void> {
    assertFixedPlan(plan)
    const token = await this.#createInstallationToken()

    try {
      const baseReference = await this.#getReference(
        token,
        `heads/${GITHUB_PUBLICATION_TARGET.baseBranch}`,
        false
      )
      if (!baseReference) throw protocolError("create_draft_pull_request")

      const branch = await this.#observeBranch(token, plan)
      if (
        !branch ||
        branch.headSha !== branch.initialCommit.sha ||
        !branchProofMatchesPlan(branch, plan)
      ) {
        throw new GitHubPublicationConflictError(
          "create_draft_pull_request"
        )
      }

      const existing = await this.#observePullRequests(
        token,
        plan,
        baseReference.sha,
        known(branch)
      )
      if (existing.length > 1) {
        throw new GitHubPublicationConflictError(
          "create_draft_pull_request"
        )
      }
      if (existing.length === 1) {
        if (existing[0]?.containsInitialCommit) return
        throw new GitHubPublicationConflictError(
          "create_draft_pull_request"
        )
      }

      const result = await this.#requestJson(
        token,
        "/repos/mani1261790/Noema/pulls",
        {
          body: JSON.stringify({
            base: GITHUB_PUBLICATION_TARGET.baseBranch,
            body: plan.pullRequest.body,
            draft: true,
            head: plan.pullRequest.headBranch,
            title: plan.pullRequest.title
          }),
          method: "POST"
        },
        MAX_LIST_RESPONSE_BYTES,
        "create_draft_pull_request"
      )
      const created = parsePullRequest(result.data, "create_draft_pull_request")
      assertPullRequestMatchesPlan(created, plan, "create_draft_pull_request")
      if (
        !created.draft ||
        created.state !== "open" ||
        created.headSha !== branch.headSha
      ) {
        throw new GitHubPublicationConflictError(
          "create_draft_pull_request"
        )
      }
    } catch (error) {
      if (
        error instanceof GitHubPublicationConfigurationError ||
        error instanceof GitHubPublicationConflictError
      ) {
        throw error
      }
      if (isDefinitiveRequestFailure(error)) throw error
      await this.#reconcilePullRequestWrite(token, plan)
    }
  }

  async #observePart<T>(operation: () => Promise<T>): Promise<
    | { state: "known"; value: T }
    | { retryable: true; state: "unavailable" }
  > {
    try {
      return known(await operation())
    } catch (error) {
      if (
        error instanceof GitHubPublicationConfigurationError ||
        error instanceof GitHubPublicationConflictError ||
        (error instanceof GitHubPublicationError && !error.retryable)
      ) {
        throw error
      }
      return unavailable()
    }
  }

  async #observeBase(
    token: string,
    plan: ArticleSubmissionPlan
  ): Promise<BaseState> {
    const reference = await this.#getReference(
      token,
      `heads/${GITHUB_PUBLICATION_TARGET.baseBranch}`,
      false
    )
    if (!reference) throw protocolError("observe_base")

    const cacheKey = [
      reference.sha,
      plan.article.path,
      plan.article.slug
    ].join("\0")
    const cached = this.#baseObservationCache.get(cacheKey)
    if (cached) return cached

    const articleEntries = await this.#baseArticleInventory(
      token,
      reference.sha
    )

    let targetPath: BaseState["targetPath"] = null
    const articlesWithSlug: BaseState["articlesWithSlug"] = []

    const matchingEntries = articleEntries.filter(
      (entry) => entry.slug === plan.article.slug
    )
    if (matchingEntries.length > 1) {
      throw new GitHubPublicationConflictError("observe_base")
    }

    for (const entry of matchingEntries) {
      articlesWithSlug.push({ path: entry.path })
    }

    if (targetPath === null) {
      const targetEntry = articleEntries.find(
        (entry) => entry.path === plan.article.path
      )
      if (targetEntry) {
        targetPath = {
          contentSha256: await this.#baseBlobDigest(
            token,
            targetEntry.sha,
            targetEntry.slug
          ),
          path: targetEntry.path
        }
      }
    }

    const observation = {
      articlesWithSlug,
      headSha: reference.sha,
      targetPath
    }
    this.#baseObservationCache.set(cacheKey, observation)
    while (this.#baseObservationCache.size > 16) {
      const oldestKey = this.#baseObservationCache.keys().next().value
      if (oldestKey === undefined) break
      this.#baseObservationCache.delete(oldestKey)
    }
    return observation
  }

  async #baseArticleInventory(
    token: string,
    baseSha: string
  ): Promise<BaseArticleInventoryEntry[]> {
    const cached = this.#baseInventoryCache.get(baseSha)
    if (cached) return cached

    const commit = await this.#getCommit(token, baseSha)
    const tree = await this.#getTree(token, commit.treeSha, true)
    if (tree.truncated) throw protocolError("observe_base")

    const prefix = `${GITHUB_PUBLICATION_TARGET.articleDirectory}/`
    const fixedAncestorPaths = new Set(
      GITHUB_PUBLICATION_TARGET.articleDirectory
        .split("/")
        .map((_, index, segments) => segments.slice(0, index + 1).join("/"))
    )
    for (const entry of tree.entries) {
      if (
        fixedAncestorPaths.has(entry.path) &&
        (entry.type !== "tree" || entry.mode !== "040000")
      ) {
        throw protocolError("observe_base")
      }
    }
    const entries: BaseArticleInventoryEntry[] = []
    const pathsBySlug = new Map<string, string>()
    for (const entry of tree.entries) {
      if (!entry.path.startsWith(prefix)) continue
      const relativePath = entry.path.slice(prefix.length)
      const segments = relativePath.split("/")
      if (segments.slice(0, -1).some((segment) => segment.endsWith(".md"))) {
        throw protocolError("observe_base")
      }
      if (!entry.path.endsWith(".md")) continue
      if (entry.type !== "blob") throw protocolError("observe_base")
      const filename = segments.at(-1) ?? ""
      const slug = filename.slice(0, -3)
      if (
        relativePath.length === 0 ||
        entry.path.length > 300 ||
        entry.mode !== "100644" ||
        relativePath.includes("//") ||
        segments.some(
          (segment) =>
            segment.length === 0 ||
            segment === "." ||
            segment === ".." ||
            segment.startsWith(".") ||
            /[\u0000-\u001f\u007f]/u.test(segment)
        ) ||
        !ARTICLE_SLUG_PATTERN.test(slug) ||
        slug.length > 100
      ) {
        throw protocolError("observe_base")
      }
      if (pathsBySlug.has(slug)) {
        throw new GitHubPublicationConflictError("observe_base")
      }
      pathsBySlug.set(slug, entry.path)
      entries.push({ path: entry.path, sha: entry.sha, slug })
    }
    if (entries.length > MAX_ARTICLE_FILES) {
      throw protocolError("observe_base")
    }

    this.#baseInventoryCache.set(baseSha, entries)
    while (this.#baseInventoryCache.size > 8) {
      const oldestKey = this.#baseInventoryCache.keys().next().value
      if (oldestKey === undefined) break
      this.#baseInventoryCache.delete(oldestKey)
    }
    return entries
  }

  async #baseBlobDigest(
    token: string,
    blobSha: string,
    expectedSlug: string
  ): Promise<string> {
    const cached = this.#blobDigestCache.get(blobSha)
    if (cached) {
      if (cached.slug !== expectedSlug) {
        throw new GitHubPublicationConflictError("observe_base")
      }
      return cached.contentSha256
    }
    const blob = await this.#getBlob(token, blobSha, MAX_ARTICLE_BYTES)
    if (
      blob.bytes[0] === 0xef &&
      blob.bytes[1] === 0xbb &&
      blob.bytes[2] === 0xbf
    ) {
      throw protocolError("observe_base")
    }
    const content = decodeUtf8(blob.bytes, "observe_base")
    let articleSlug: string
    try {
      articleSlug = (await parseArticle(content)).frontmatter.slug
    } catch {
      throw protocolError("observe_base")
    }
    const contentSha256 = await sha256Bytes(blob.bytes)
    if (articleSlug !== expectedSlug) {
      throw new GitHubPublicationConflictError("observe_base")
    }
    this.#blobDigestCache.set(blobSha, { contentSha256, slug: articleSlug })
    while (this.#blobDigestCache.size > 64) {
      const oldestKey = this.#blobDigestCache.keys().next().value
      if (oldestKey === undefined) break
      this.#blobDigestCache.delete(oldestKey)
    }
    return contentSha256
  }

  async #observeBranch(
    token: string,
    plan: ArticleSubmissionPlan
  ): Promise<BranchProof | null> {
    const reference = await this.#getReference(
      token,
      `heads/${plan.git.headBranch}`,
      true
    )
    if (!reference) return null

    const candidates = await this.#listCommits(
      token,
      plan.git.headBranch,
      plan.article.path,
      "observe_branch"
    )
    const markerCandidates = candidates.filter(
      (candidate) => candidate.message === plan.git.commitMessage
    )
    if (markerCandidates.length !== 1) {
      throw new GitHubPublicationConflictError("observe_branch")
    }

    return this.#proveInitialCommit(
      token,
      plan,
      markerCandidates[0]!.sha,
      reference.sha,
      "observe_branch"
    )
  }

  async #observePullRequests(
    token: string,
    plan: ArticleSubmissionPlan,
    baseHeadSha: string,
    branchObservation: BranchObservation
  ): Promise<PullRequestProof[]> {
    const query = new URLSearchParams({
      base: GITHUB_PUBLICATION_TARGET.baseBranch,
      head: `${GITHUB_PUBLICATION_TARGET.owner}:${plan.pullRequest.headBranch}`,
      per_page: "100",
      state: "all"
    })
    const result = await this.#requestJson(
      token,
      `/repos/mani1261790/Noema/pulls?${query.toString()}`,
      { method: "GET" },
      MAX_LIST_RESPONSE_BYTES,
      "observe_pull_requests"
    )
    if (!Array.isArray(result.data) || result.data.length > MAX_PULL_REQUESTS) {
      throw protocolError("observe_pull_requests")
    }
    if (result.data.length > 1) {
      throw new GitHubPublicationConflictError("observe_pull_requests")
    }

    const branch =
      branchObservation.state === "known" ? branchObservation.value : null
    const proofs: PullRequestProof[] = []

    for (const value of result.data) {
      const pullRequest = parsePullRequest(value, "observe_pull_requests")
      assertPullRequestMatchesPlan(pullRequest, plan, "observe_pull_requests")

      const commits = await this.#listPullRequestCommits(
        token,
        pullRequest.number
      )
      const markers = commits.filter(
        (commit) => commit.message === plan.git.commitMessage
      )
      if (markers.length > 1) {
        throw new GitHubPublicationConflictError("observe_pull_requests")
      }

      let containsInitialCommit = false
      if (markers.length === 1) {
        const markerSha = markers[0]!.sha
        const proof = await this.#proveInitialCommit(
          token,
          plan,
          markerSha,
          pullRequest.headSha,
          "observe_pull_requests"
        )
        containsInitialCommit =
          proof.initialCommitReachableFromHead &&
          (branch === null || branch.initialCommit.sha === markerSha)
      }

      const state: PullRequestProof["state"] = pullRequest.mergedAt
        ? "merged"
        : pullRequest.state
      const mergeCommitSha =
        state === "merged" ? pullRequest.mergeCommitSha : null
      if (state === "merged" && !mergeCommitSha) {
        throw protocolError("observe_pull_requests")
      }

      let mergeCommitReachableFromBase = false
      if (mergeCommitSha) {
        mergeCommitReachableFromBase = await this.#isAncestor(
          token,
          mergeCommitSha,
          baseHeadSha,
          "observe_pull_requests"
        )
      }

      proofs.push({
        baseBranch: pullRequest.baseBranch,
        containsInitialCommit,
        draft: pullRequest.draft,
        headBranch: pullRequest.headBranch,
        mergeCommitReachableFromBase,
        mergeCommitSha,
        number: pullRequest.number,
        state,
        url: pullRequest.htmlUrl
      })
    }

    return proofs
  }

  async #proveInitialCommit(
    token: string,
    plan: ArticleSubmissionPlan,
    initialCommitSha: string,
    headSha: string,
    operation: string
  ): Promise<BranchProof> {
    const commit = await this.#getCommit(token, initialCommitSha)
    if (
      commit.message !== plan.git.commitMessage ||
      commit.parents.length !== 1
    ) {
      throw new GitHubPublicationConflictError(operation)
    }

    const parentSha = commit.parents[0]!
    const comparison = await this.#compare(
      token,
      parentSha,
      initialCommitSha,
      operation
    )
    if (
      comparison.status !== "ahead" ||
      comparison.aheadBy !== 1 ||
      comparison.totalCommits !== 1 ||
      comparison.files.length !== 1
    ) {
      throw new GitHubPublicationConflictError(operation)
    }

    const change = comparison.files[0]!
    if (change.status !== "added" || change.filename !== plan.article.path) {
      throw new GitHubPublicationConflictError(operation)
    }
    const blob = await this.#getBlob(token, change.sha, MAX_ARTICLE_BYTES)
    const contentSha256 = await sha256Bytes(blob.bytes)
    if (contentSha256 !== plan.article.contentSha256) {
      throw new GitHubPublicationConflictError(operation)
    }

    return {
      headSha,
      initialCommit: {
        changes: [
          {
            contentSha256,
            path: change.filename,
            status: "added"
          }
        ],
        markerVerified: true,
        metadata: {
          ...plan.metadata,
          baseCommitSha: parentSha
        },
        parentCount: 1,
        parentSha,
        sha: initialCommitSha
      },
      initialCommitReachableFromHead: await this.#isAncestor(
        token,
        initialCommitSha,
        headSha,
        operation
      ),
      name: plan.git.headBranch
    }
  }

  async #reconcileRefWrite(
    token: string,
    plan: ArticleSubmissionPlan,
    action: CreateSubmissionRefAction,
    _proposedCommitSha: string | null
  ): Promise<void> {
    try {
      const branch = await this.#observeBranch(token, plan)
      if (!branch) {
        throw new GitHubPublicationError(
          "github_write_indeterminate",
          "create_submission_ref",
          true
        )
      }
      const isExpected =
        branch.headSha === branch.initialCommit.sha &&
        branch.initialCommit.parentSha === action.baseCommitSha &&
        branchProofMatchesPlan(branch, plan)
      if (isExpected) return
      throw new GitHubPublicationConflictError("create_submission_ref")
    } catch (error) {
      if (error instanceof GitHubPublicationConflictError) throw error
      throw new GitHubPublicationError(
        "github_write_indeterminate",
        "create_submission_ref",
        true
      )
    }
  }

  async #reconcilePullRequestWrite(
    token: string,
    plan: ArticleSubmissionPlan
  ): Promise<void> {
    try {
      const base = await this.#getReference(
        token,
        `heads/${GITHUB_PUBLICATION_TARGET.baseBranch}`,
        false
      )
      if (!base) throw protocolError("create_draft_pull_request")
      const branch = await this.#observeBranch(token, plan)
      const pullRequests = await this.#observePullRequests(
        token,
        plan,
        base.sha,
        known(branch)
      )
      if (
        pullRequests.length === 1 &&
        pullRequests[0]?.containsInitialCommit
      ) {
        return
      }
      if (pullRequests.length > 1) {
        throw new GitHubPublicationConflictError(
          "create_draft_pull_request"
        )
      }
    } catch (error) {
      if (error instanceof GitHubPublicationConflictError) throw error
    }
    throw new GitHubPublicationError(
      "github_write_indeterminate",
      "create_draft_pull_request",
      true
    )
  }

  async #isAncestor(
    token: string,
    ancestorSha: string,
    descendantSha: string,
    operation: string
  ): Promise<boolean> {
    if (ancestorSha === descendantSha) return true
    const comparison = await this.#compare(
      token,
      ancestorSha,
      descendantSha,
      operation
    )
    return comparison.status === "ahead"
  }

  async #compare(
    token: string,
    base: string,
    head: string,
    operation: string
  ): Promise<Comparison> {
    requireGitObjectId(base, operation)
    requireGitObjectId(head, operation)
    const basehead = encodeURIComponent(`${base}...${head}`)
    const result = await this.#requestJson(
      token,
      `/repos/mani1261790/Noema/compare/${basehead}?per_page=100`,
      { method: "GET" },
      MAX_LIST_RESPONSE_BYTES,
      operation
    )
    return parseComparison(result.data, operation)
  }

  async #listCommits(
    token: string,
    ref: string,
    path: string,
    operation: string
  ): Promise<CommitListEntry[]> {
    const query = new URLSearchParams({ path, per_page: "100", sha: ref })
    const result = await this.#requestJson(
      token,
      `/repos/mani1261790/Noema/commits?${query.toString()}`,
      { method: "GET" },
      MAX_LIST_RESPONSE_BYTES,
      operation
    )
    assertNoNextPage(result.headers, operation)
    return parseCommitList(result.data, operation)
  }

  async #listPullRequestCommits(
    token: string,
    pullRequestNumber: number
  ): Promise<CommitListEntry[]> {
    const result = await this.#requestJson(
      token,
      `/repos/mani1261790/Noema/pulls/${pullRequestNumber}/commits?per_page=100`,
      { method: "GET" },
      MAX_LIST_RESPONSE_BYTES,
      "observe_pull_requests"
    )
    assertNoNextPage(result.headers, "observe_pull_requests")
    return parseCommitList(result.data, "observe_pull_requests")
  }

  async #getReference(
    token: string,
    ref: string,
    allowMissing: boolean
  ): Promise<ReferenceState | null> {
    const encodedRef = ref
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/")
    const result = await this.#requestJson(
      token,
      `/repos/mani1261790/Noema/git/ref/${encodedRef}`,
      { method: "GET" },
      MAX_OBJECT_RESPONSE_BYTES,
      "get_reference",
      allowMissing
    )
    if (result === null) return null
    const reference = parseReference(result.data, "get_reference")
    if (reference.name !== `refs/${ref}`) throw protocolError("get_reference")
    return reference
  }

  async #getCommit(token: string, sha: string): Promise<GitCommit> {
    requireGitObjectId(sha, "get_commit")
    const result = await this.#requestJson(
      token,
      `/repos/mani1261790/Noema/git/commits/${sha}`,
      { method: "GET" },
      MAX_OBJECT_RESPONSE_BYTES,
      "get_commit"
    )
    const commit = parseGitCommit(result.data, "get_commit")
    if (commit.sha !== sha) throw protocolError("get_commit")
    return commit
  }

  async #getTree(
    token: string,
    sha: string,
    recursive: boolean
  ): Promise<GitTree> {
    requireGitObjectId(sha, "get_tree")
    const suffix = recursive ? "?recursive=1" : ""
    const result = await this.#requestJson(
      token,
      `/repos/mani1261790/Noema/git/trees/${sha}${suffix}`,
      { method: "GET" },
      recursive ? MAX_TREE_RESPONSE_BYTES : MAX_OBJECT_RESPONSE_BYTES,
      "get_tree"
    )
    const tree = parseGitTree(result.data, "get_tree")
    if (tree.sha !== sha) throw protocolError("get_tree")
    return tree
  }

  async #getBlob(
    token: string,
    sha: string,
    maxContentBytes: number
  ): Promise<GitBlob> {
    requireGitObjectId(sha, "get_blob")
    const result = await this.#requestJson(
      token,
      `/repos/mani1261790/Noema/git/blobs/${sha}`,
      { method: "GET" },
      Math.min(MAX_OBJECT_RESPONSE_BYTES, maxContentBytes * 2 + 64 * 1024),
      "get_blob"
    )
    const blob = parseGitBlob(result.data, "get_blob")
    if (blob.sha !== sha) throw protocolError("get_blob")
    if (blob.bytes.byteLength > maxContentBytes) {
      throw protocolError("get_blob")
    }
    return blob
  }

  async #postBlob(token: string, content: string): Promise<{ sha: string }> {
    const result = await this.#requestJson(
      token,
      "/repos/mani1261790/Noema/git/blobs",
      {
        body: JSON.stringify({ content, encoding: "utf-8" }),
        method: "POST"
      },
      MAX_OBJECT_RESPONSE_BYTES,
      "create_blob"
    )
    return { sha: readGitObjectId(result.data, "sha", "create_blob") }
  }

  async #postTree(
    token: string,
    baseTreeSha: string,
    articlePath: string,
    blobSha: string
  ): Promise<string> {
    requireGitObjectId(baseTreeSha, "create_tree")
    requireGitObjectId(blobSha, "create_tree")
    const result = await this.#requestJson(
      token,
      "/repos/mani1261790/Noema/git/trees",
      {
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: [
            {
              mode: "100644",
              path: articlePath,
              sha: blobSha,
              type: "blob"
            }
          ]
        }),
        method: "POST"
      },
      MAX_OBJECT_RESPONSE_BYTES,
      "create_tree"
    )
    return readGitObjectId(result.data, "sha", "create_tree")
  }

  async #postCommit(
    token: string,
    message: string,
    treeSha: string,
    parentSha: string
  ): Promise<string> {
    requireGitObjectId(treeSha, "create_commit")
    requireGitObjectId(parentSha, "create_commit")
    const result = await this.#requestJson(
      token,
      "/repos/mani1261790/Noema/git/commits",
      {
        body: JSON.stringify({
          message,
          parents: [parentSha],
          tree: treeSha
        }),
        method: "POST"
      },
      MAX_OBJECT_RESPONSE_BYTES,
      "create_commit"
    )
    return readGitObjectId(result.data, "sha", "create_commit")
  }

  async #createInstallationToken(): Promise<string> {
    const now = this.#now()
    if (
      this.#installationToken &&
      this.#installationToken.expiresAt - now > 60_000
    ) {
      return this.#installationToken.token
    }
    if (this.#installationTokenPromise) {
      return this.#installationTokenPromise
    }

    this.#installationTokenPromise = this.#requestInstallationToken()
    try {
      return await this.#installationTokenPromise
    } finally {
      this.#installationTokenPromise = null
    }
  }

  async #requestInstallationToken(): Promise<string> {
    const jwt = await this.#createAppJwt()
    let result: JsonResult
    try {
      result = await this.#requestJson(
        jwt,
        `/app/installations/${this.#installationId}/access_tokens`,
        {
          body: JSON.stringify({
            permissions: {
              contents: "write",
              pull_requests: "write"
            },
            repositories: [GITHUB_PUBLICATION_TARGET.repository]
          }),
          method: "POST"
        },
        MAX_TOKEN_RESPONSE_BYTES,
        "create_installation_token"
      )
    } catch (error) {
      if (
        error instanceof GitHubPublicationError &&
        !error.retryable &&
        error.status !== null &&
        [401, 403, 404].includes(error.status)
      ) {
        throw new GitHubPublicationConfigurationError([
          "GITHUB_APP_INSTALLATION_AUTHENTICATION"
        ])
      }
      throw error
    }
    const installationToken = parseInstallationToken(result.data, this.#now())
    this.#installationToken = installationToken
    return installationToken.token
  }

  async #createAppJwt(): Promise<string> {
    const now = this.#now()
    if (!Number.isFinite(now) || now < 0) {
      throw new GitHubPublicationConfigurationError(["CLOCK"])
    }
    const issuedAt = Math.floor(now / 1000) - 60
    const expiresAt = Math.floor(now / 1000) + 9 * 60
    const encodedHeader = base64UrlEncode(
      new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    )
    const encodedPayload = base64UrlEncode(
      new TextEncoder().encode(
        JSON.stringify({
          exp: expiresAt,
          iat: issuedAt,
          iss: this.#clientId
        })
      )
    )
    const unsigned = `${encodedHeader}.${encodedPayload}`
    const key = await this.#getSigningKey()
    let signature: ArrayBuffer
    try {
      signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        new TextEncoder().encode(unsigned)
      )
    } catch {
      throw new GitHubPublicationConfigurationError([
        "GITHUB_APP_PRIVATE_KEY"
      ])
    }
    return `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`
  }

  #getSigningKey(): Promise<CryptoKey> {
    this.#signingKeyPromise ??= importGitHubPrivateKey(this.#privateKeyPem)
    return this.#signingKeyPromise
  }

  async #requestJson(
    authorization: string,
    path: string,
    init: { body?: string; method: "GET" | "POST" },
    maxBytes: number,
    operation: string
  ): Promise<JsonResult>

  async #requestJson(
    authorization: string,
    path: string,
    init: { body?: string; method: "GET" | "POST" },
    maxBytes: number,
    operation: string,
    allowMissing: boolean
  ): Promise<JsonResult | null>

  async #requestJson(
    authorization: string,
    path: string,
    init: { body?: string; method: "GET" | "POST" },
    maxBytes: number,
    operation: string,
    allowMissing = false
  ): Promise<JsonResult | null> {
    const url = new URL(path, GITHUB_PUBLICATION_TARGET.apiBaseUrl)
    if (url.origin !== GITHUB_PUBLICATION_TARGET.apiBaseUrl) {
      throw protocolError(operation)
    }

    let response: Response
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(),
      GITHUB_REQUEST_TIMEOUT_MS
    )
    try {
      response = await this.#fetch(url.toString(), {
        body: init.body,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${authorization}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          "user-agent": GITHUB_PUBLICATION_TARGET.userAgent,
          "x-github-api-version": GITHUB_PUBLICATION_TARGET.apiVersion
        },
        method: init.method,
        redirect: "error",
        signal: controller.signal
      })
    } catch {
      clearTimeout(timeout)
      throw new GitHubPublicationError(
        "github_request_failed",
        operation,
        true
      )
    }
    try {
      if (allowMissing && response.status === 404) {
        await cancelBody(response)
        return null
      }
      if (!response.ok) {
        const status = response.status
        await cancelBody(response)
        throw new GitHubPublicationError(
          "github_request_failed",
          operation,
          isRetryableStatus(status, response.headers),
          status
        )
      }
      const expectedStatus = init.method === "GET" ? 200 : 201
      if (response.status !== expectedStatus) {
        await cancelBody(response)
        throw protocolError(operation)
      }

      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.toLowerCase().startsWith("application/json")) {
        await cancelBody(response)
        throw protocolError(operation)
      }

      const bytes = await readBoundedBody(
        response,
        maxBytes,
        operation,
        controller.signal
      )
      let data: unknown
      try {
        data = JSON.parse(
          new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
            bytes
          )
        )
      } catch {
        throw protocolError(operation)
      }
      return { data, headers: response.headers, status: response.status }
    } finally {
      clearTimeout(timeout)
    }
  }
}

function validateConfiguration(
  configuration: GitHubPublicationConfiguration
): GitHubPublicationConfiguration {
  const clientId =
    typeof configuration.clientId === "string"
      ? configuration.clientId.trim()
      : ""
  const installationId =
    typeof configuration.installationId === "string"
      ? configuration.installationId.trim()
      : ""
  const privateKeyPem =
    typeof configuration.privateKeyPem === "string"
      ? configuration.privateKeyPem.trim()
      : ""
  const issues: string[] = []

  if (!CLIENT_ID_PATTERN.test(clientId)) issues.push("GITHUB_APP_CLIENT_ID")
  if (!INSTALLATION_ID_PATTERN.test(installationId)) {
    issues.push("GITHUB_APP_INSTALLATION_ID")
  }
  if (
    privateKeyPem.length === 0 ||
    new TextEncoder().encode(privateKeyPem).byteLength > MAX_PEM_BYTES ||
    !privateKeyPem.startsWith("-----BEGIN RSA PRIVATE KEY-----") ||
    !privateKeyPem.endsWith("-----END RSA PRIVATE KEY-----")
  ) {
    issues.push("GITHUB_APP_PRIVATE_KEY")
  } else {
    try {
      parsePkcs1Pem(privateKeyPem)
    } catch {
      issues.push("GITHUB_APP_PRIVATE_KEY")
    }
  }
  if (issues.length > 0) {
    throw new GitHubPublicationConfigurationError(issues)
  }

  return { clientId, installationId, privateKeyPem }
}

function assertFixedPlan(plan: ArticleSubmissionPlan): void {
  const expectedPath = `${GITHUB_PUBLICATION_TARGET.articleDirectory}/${plan.article.slug}.md`
  const expectedBranch = `studio/submissions/${plan.metadata.submissionId}`
  if (
    plan.version !== 1 ||
    plan.operation !== "create_article" ||
    plan.metadata.version !== 1 ||
    plan.intent.version !== 1 ||
    plan.intent.repository !== "mani1261790/Noema" ||
    plan.git.baseBranch !== GITHUB_PUBLICATION_TARGET.baseBranch ||
    plan.pullRequest.baseBranch !== GITHUB_PUBLICATION_TARGET.baseBranch ||
    plan.article.path !== expectedPath ||
    plan.intent.articlePath !== expectedPath ||
    plan.git.headBranch !== plan.pullRequest.headBranch ||
    plan.git.headBranch !== plan.intent.headBranch ||
    plan.git.headBranch !== expectedBranch ||
    !BRANCH_PATTERN.test(plan.git.headBranch) ||
    !SUBMISSION_ID_PATTERN.test(plan.metadata.submissionId) ||
    !SHA256_PATTERN.test(plan.metadata.requestSha256) ||
    !SHA256_PATTERN.test(plan.metadata.contentSha256) ||
    !ARTICLE_SLUG_PATTERN.test(plan.article.slug) ||
    plan.article.slug.length > 100 ||
    plan.article.content.length === 0 ||
    new TextEncoder().encode(plan.article.content).byteLength >
      MAX_ARTICLE_BYTES ||
    plan.article.slug !== plan.intent.slug ||
    plan.article.contentSha256 !== plan.metadata.contentSha256 ||
    plan.metadata.submissionId !== plan.intent.submissionId ||
    plan.metadata.requestSha256 !== plan.intent.requestSha256 ||
    plan.metadata.contentSha256 !== plan.intent.contentSha256 ||
    plan.metadata.articlePath !== plan.intent.articlePath ||
    plan.metadata.baseBranch !== plan.intent.baseBranch ||
    plan.metadata.submissionMode !== plan.intent.submissionMode ||
    plan.metadata.articlePath !== plan.article.path ||
    plan.metadata.baseBranch !== GITHUB_PUBLICATION_TARGET.baseBranch ||
    plan.metadata.submissionMode !== "create_only" ||
    plan.intent.reviewKind !== "draft_pull_request" ||
    plan.git.commitMessage !== buildCommitMessage(plan) ||
    plan.pullRequest.title !== `Studio: add article ${plan.article.slug}` ||
    plan.pullRequest.body !== buildPullRequestBody(plan) ||
    plan.git.allowDirectBaseWrite !== false ||
    plan.git.allowForceUpdate !== false ||
    plan.pullRequest.draft !== true
  ) {
    throw new GitHubPublicationConflictError("validate_plan")
  }
}

function assertFixedIntent(intent: ArticleSubmissionPlan["intent"]): void {
  const expectedPath = `${GITHUB_PUBLICATION_TARGET.articleDirectory}/${intent.slug}.md`
  const expectedBranch = `studio/submissions/${intent.submissionId}`
  if (
    intent.version !== 1 ||
    intent.repository !== "mani1261790/Noema" ||
    intent.baseBranch !== GITHUB_PUBLICATION_TARGET.baseBranch ||
    intent.submissionMode !== "create_only" ||
    intent.reviewKind !== "draft_pull_request" ||
    intent.articlePath !== expectedPath ||
    intent.headBranch !== expectedBranch ||
    !BRANCH_PATTERN.test(intent.headBranch) ||
    !SUBMISSION_ID_PATTERN.test(intent.submissionId) ||
    !SHA256_PATTERN.test(intent.requestSha256) ||
    !SHA256_PATTERN.test(intent.contentSha256) ||
    !ARTICLE_SLUG_PATTERN.test(intent.slug) ||
    intent.slug.length > 100 ||
    typeof intent.principalId !== "string" ||
    intent.principalId.length === 0 ||
    intent.principalId.length > 200
  ) {
    throw new GitHubPublicationConflictError("validate_intent")
  }
}

function assertCreateRefAction(
  plan: ArticleSubmissionPlan,
  action: CreateSubmissionRefAction
): void {
  const metadata = action.commitMetadata
  if (
    metadata.submissionId !== plan.metadata.submissionId ||
    metadata.requestSha256 !== plan.metadata.requestSha256 ||
    metadata.contentSha256 !== plan.metadata.contentSha256 ||
    metadata.articlePath !== plan.metadata.articlePath ||
    metadata.baseBranch !== plan.metadata.baseBranch ||
    metadata.submissionMode !== plan.metadata.submissionMode ||
    metadata.baseCommitSha !== action.baseCommitSha ||
    !GIT_OBJECT_ID_PATTERN.test(action.baseCommitSha) ||
    !intentsEqual(action.expectedClaim.intent, plan.intent) ||
    action.expectedClaim.version !== 1 ||
    action.expectedClaim.refCreationStarted !== true ||
    action.expectedClaim.initialCommit !== null ||
    action.expectedClaim.pullRequestNumber !== null ||
    action.expectedClaim.terminalOutcome !== null
  ) {
    throw new GitHubPublicationConflictError("create_submission_ref")
  }
}

function buildCommitMessage(plan: ArticleSubmissionPlan): string {
  return [
    `Studio: add article ${plan.article.slug}`,
    "",
    `Noema-Studio-Submission: ${plan.metadata.submissionId}`,
    `Noema-Studio-Request-SHA256: ${plan.metadata.requestSha256}`,
    `Noema-Studio-Content-SHA256: ${plan.metadata.contentSha256}`,
    `Noema-Studio-Article-Path: ${plan.metadata.articlePath}`
  ].join("\n")
}

function buildPullRequestBody(plan: ArticleSubmissionPlan): string {
  const marker = `<!-- noema-studio-submission:${JSON.stringify(plan.metadata)} -->`
  return [
    "Noema Studioから新規記事を送信します。",
    "",
    `- 記事: \`${plan.metadata.articlePath}\``,
    `- 送信ID: \`${plan.metadata.submissionId}\``,
    "",
    "このPull RequestはDraftとして作成し、内容をレビューしてからdevelopへマージします。",
    "",
    marker
  ].join("\n")
}

function intentsEqual(
  left: ArticleSubmissionPlan["intent"],
  right: ArticleSubmissionPlan["intent"]
): boolean {
  return (
    left.version === right.version &&
    left.submissionId === right.submissionId &&
    left.requestSha256 === right.requestSha256 &&
    left.contentSha256 === right.contentSha256 &&
    left.articlePath === right.articlePath &&
    left.baseBranch === right.baseBranch &&
    left.submissionMode === right.submissionMode &&
    left.principalId === right.principalId &&
    left.slug === right.slug &&
    left.headBranch === right.headBranch &&
    left.reviewKind === right.reviewKind &&
    left.repository === right.repository
  )
}

function branchProofMatchesPlan(
  branch: BranchProof,
  plan: ArticleSubmissionPlan
): boolean {
  const change = branch.initialCommit.changes[0]
  const metadata = branch.initialCommit.metadata
  return (
    branch.name === plan.git.headBranch &&
    branch.initialCommit.markerVerified &&
    branch.initialCommitReachableFromHead &&
    metadata.version === plan.metadata.version &&
    metadata.submissionId === plan.metadata.submissionId &&
    metadata.requestSha256 === plan.metadata.requestSha256 &&
    metadata.contentSha256 === plan.metadata.contentSha256 &&
    metadata.articlePath === plan.metadata.articlePath &&
    metadata.baseBranch === plan.metadata.baseBranch &&
    metadata.submissionMode === plan.metadata.submissionMode &&
    metadata.baseCommitSha === branch.initialCommit.parentSha &&
    change?.status === "added" &&
    change.path === plan.article.path &&
    change.contentSha256 === plan.article.contentSha256
  )
}

function assertPullRequestMatchesPlan(
  pullRequest: RawPullRequest,
  plan: ArticleSubmissionPlan,
  operation: string
): void {
  if (
    pullRequest.htmlUrl !==
      `https://github.com/mani1261790/Noema/pull/${pullRequest.number}` ||
    pullRequest.baseBranch !== plan.pullRequest.baseBranch ||
    pullRequest.headBranch !== plan.pullRequest.headBranch ||
    pullRequest.body !== plan.pullRequest.body ||
    pullRequest.title !== plan.pullRequest.title
  ) {
    throw new GitHubPublicationConflictError(operation)
  }
}

function parseInstallationToken(
  value: unknown,
  now: number
): InstallationToken {
  const object = requireRecord(value, "create_installation_token")
  const token = requireString(object, "token", "create_installation_token")
  const expiresAt = requireString(
    object,
    "expires_at",
    "create_installation_token"
  )
  const permissions = requireRecord(
    object.permissions,
    "create_installation_token"
  )
  const repositories = object.repositories
  if (
    token.length > 8192 ||
    /[\u0000-\u0020\u007f]/u.test(token) ||
    permissions.contents !== "write" ||
    permissions.pull_requests !== "write" ||
    !Array.isArray(repositories) ||
    repositories.length !== 1 ||
    !repositories.every((repository) => {
      if (!isRecord(repository)) return false
      return repository.full_name === "mani1261790/Noema"
    }) ||
    !Number.isFinite(Date.parse(expiresAt)) ||
    Date.parse(expiresAt) <= now
  ) {
    throw protocolError("create_installation_token")
  }
  return { expiresAt: Date.parse(expiresAt), token }
}

function parseReference(value: unknown, operation: string): ReferenceState {
  const object = requireRecord(value, operation)
  const target = requireRecord(object.object, operation)
  const name = requireString(object, "ref", operation)
  const sha = requireString(target, "sha", operation)
  requireGitObjectId(sha, operation)
  return { name, sha }
}

function parseGitCommit(value: unknown, operation: string): GitCommit {
  const object = requireRecord(value, operation)
  const tree = requireRecord(object.tree, operation)
  const parentValues = object.parents
  if (!Array.isArray(parentValues)) throw protocolError(operation)
  const parents = parentValues.map((parent) => {
    const sha = requireString(requireRecord(parent, operation), "sha", operation)
    requireGitObjectId(sha, operation)
    return sha
  })
  const sha = requireString(object, "sha", operation)
  const treeSha = requireString(tree, "sha", operation)
  requireGitObjectId(sha, operation)
  requireGitObjectId(treeSha, operation)
  return {
    message: requireString(object, "message", operation),
    parents,
    sha,
    treeSha
  }
}

function parseGitTree(value: unknown, operation: string): GitTree {
  const object = requireRecord(value, operation)
  const sha = requireString(object, "sha", operation)
  requireGitObjectId(sha, operation)
  const values = object.tree
  if (!Array.isArray(values)) throw protocolError(operation)
  const entries = values.map((entry) => {
    const record = requireRecord(entry, operation)
    const path = requireString(record, "path", operation)
    const sha = requireString(record, "sha", operation)
    const type = requireString(record, "type", operation)
    const mode = requireString(record, "mode", operation)
    requireGitObjectId(sha, operation)
    if (!/^[0-7]{6}$/u.test(mode)) throw protocolError(operation)
    if (type !== "blob" && type !== "tree" && type !== "commit") {
      throw protocolError(operation)
    }
    return { mode, path, sha, type: type as GitTreeEntry["type"] }
  })
  if (typeof object.truncated !== "boolean") throw protocolError(operation)
  return { entries, sha, truncated: object.truncated }
}

function parseGitBlob(value: unknown, operation: string): GitBlob {
  const object = requireRecord(value, operation)
  const sha = requireString(object, "sha", operation)
  const content = requireString(object, "content", operation)
  const encoding = requireString(object, "encoding", operation)
  requireGitObjectId(sha, operation)
  if (encoding !== "base64") throw protocolError(operation)
  return { bytes: decodeBase64(content, operation), sha }
}

function parseCommitList(
  value: unknown,
  operation: string
): CommitListEntry[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw protocolError(operation)
  }
  return value.map((entry) => {
    const object = requireRecord(entry, operation)
    const commit = requireRecord(object.commit, operation)
    const sha = requireString(object, "sha", operation)
    requireGitObjectId(sha, operation)
    return {
      message: requireString(commit, "message", operation),
      sha
    }
  })
}

function parseComparison(value: unknown, operation: string): Comparison {
  const object = requireRecord(value, operation)
  const status = requireString(object, "status", operation)
  if (
    status !== "ahead" &&
    status !== "behind" &&
    status !== "diverged" &&
    status !== "identical"
  ) {
    throw protocolError(operation)
  }
  const files = object.files
  if (!Array.isArray(files) || files.length > 300) {
    throw protocolError(operation)
  }
  return {
    aheadBy: requireNonNegativeInteger(object, "ahead_by", operation),
    files: files.map((file) => {
      const record = requireRecord(file, operation)
      const sha = requireString(record, "sha", operation)
      requireGitObjectId(sha, operation)
      return {
        filename: requireString(record, "filename", operation),
        sha,
        status: requireString(record, "status", operation)
      }
    }),
    status,
    totalCommits: requireNonNegativeInteger(object, "total_commits", operation)
  }
}

function parsePullRequest(value: unknown, operation: string): RawPullRequest {
  const object = requireRecord(value, operation)
  const base = requireRecord(object.base, operation)
  const head = requireRecord(object.head, operation)
  const state = requireString(object, "state", operation)
  if (state !== "open" && state !== "closed") throw protocolError(operation)
  if (typeof object.draft !== "boolean") throw protocolError(operation)
  return {
    baseBranch: requireString(base, "ref", operation),
    body: requireNullableString(object, "body", operation),
    draft: object.draft,
    headBranch: requireString(head, "ref", operation),
    headSha: readGitObjectId(head, "sha", operation),
    htmlUrl: requireString(object, "html_url", operation),
    mergeCommitSha: readNullableGitObjectId(
      object,
      "merge_commit_sha",
      operation
    ),
    mergedAt: requireNullableString(object, "merged_at", operation),
    number: requirePositiveInteger(object, "number", operation),
    state,
    title: requireString(object, "title", operation)
  }
}

function readGitObjectId(
  value: unknown,
  field: string,
  operation: string
): string {
  const object = requireRecord(value, operation)
  const sha = requireString(object, field, operation)
  requireGitObjectId(sha, operation)
  return sha
}

function readNullableGitObjectId(
  object: Record<string, unknown>,
  field: string,
  operation: string
): string | null {
  const value = object[field]
  if (value === null) return null
  if (typeof value !== "string") throw protocolError(operation)
  requireGitObjectId(value, operation)
  return value
}

function requireGitObjectId(value: string, operation: string): void {
  if (!GIT_OBJECT_ID_PATTERN.test(value)) throw protocolError(operation)
}

function requireRecord(
  value: unknown,
  operation: string
): Record<string, unknown> {
  if (!isRecord(value)) throw protocolError(operation)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requireString(
  object: Record<string, unknown>,
  field: string,
  operation: string
): string {
  const value = object[field]
  if (typeof value !== "string") throw protocolError(operation)
  return value
}

function requireNullableString(
  object: Record<string, unknown>,
  field: string,
  operation: string
): string | null {
  const value = object[field]
  if (value === null) return null
  if (typeof value !== "string") throw protocolError(operation)
  return value
}

function requireNonNegativeInteger(
  object: Record<string, unknown>,
  field: string,
  operation: string
): number {
  const value = object[field]
  if (!Number.isInteger(value) || typeof value !== "number" || value < 0) {
    throw protocolError(operation)
  }
  return value
}

function requirePositiveInteger(
  object: Record<string, unknown>,
  field: string,
  operation: string
): number {
  const value = requireNonNegativeInteger(object, field, operation)
  if (value === 0) throw protocolError(operation)
  return value
}

function assertNoNextPage(headers: Headers, operation: string): void {
  const link = headers.get("link")
  if (link?.includes('rel="next"')) throw protocolError(operation)
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
  operation: string,
  signal: AbortSignal
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length")
  if (contentLength !== null) {
    const parsed = Number(contentLength)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) {
      await cancelBody(response)
      throw protocolError(operation)
    }
  }
  if (!response.body) throw protocolError(operation)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const result = await readBodyChunk(reader, signal, operation)
      if (result.done) break
      length += result.value.byteLength
      if (length > maxBytes) {
        await reader.cancel()
        throw protocolError(operation)
      }
      chunks.push(result.value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function readBodyChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  operation: string
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    void reader.cancel().catch(() => undefined)
    return Promise.reject(
      new GitHubPublicationError("github_request_failed", operation, true)
    )
  }

  return new Promise((resolve, reject) => {
    const abort = () => {
      void reader.cancel().catch(() => undefined)
      reject(
        new GitHubPublicationError("github_request_failed", operation, true)
      )
    }
    signal.addEventListener("abort", abort, { once: true })
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort)
    })
  })
}

async function cancelBody(response: Response): Promise<void> {
  if (!response.body) return
  try {
    await response.body.cancel()
  } catch {
    // The response is already unusable; cancellation failure has no safe detail to expose.
  }
}

function decodeUtf8(bytes: Uint8Array, operation: string): string {
  try {
    return new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false
    }).decode(bytes)
  } catch {
    throw protocolError(operation)
  }
}

function decodeBase64(value: string, operation: string): Uint8Array {
  const normalized = value.replace(/\s+/gu, "")
  if (
    normalized.length === 0 ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)
  ) {
    throw protocolError(operation)
  }
  let decoded: string
  try {
    decoded = globalThis.atob(normalized)
  } catch {
    throw protocolError(operation)
  }
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return bytes
}

async function sha256(value: string): Promise<string> {
  return sha256Bytes(new TextEncoder().encode(value))
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    copyToArrayBuffer(bytes)
  )
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return `sha256:${hex}`
}

async function importGitHubPrivateKey(pem: string): Promise<CryptoKey> {
  try {
    const pkcs1 = parsePkcs1Pem(pem)
    const pkcs8 = wrapPkcs1AsPkcs8(pkcs1)
    return await crypto.subtle.importKey(
      "pkcs8",
      copyToArrayBuffer(pkcs8),
      { hash: "SHA-256", name: "RSASSA-PKCS1-v1_5" },
      false,
      ["sign"]
    )
  } catch {
    throw new GitHubPublicationConfigurationError([
      "GITHUB_APP_PRIVATE_KEY"
    ])
  }
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function parsePkcs1Pem(pem: string): Uint8Array {
  const match =
    /^-----BEGIN RSA PRIVATE KEY-----\s+([A-Za-z0-9+/=\r\n]+?)\s+-----END RSA PRIVATE KEY-----$/u.exec(
      pem.trim()
    )
  if (!match) throw new Error("invalid")
  const bytes = decodeBase64(match[1]!, "configuration")
  if (
    bytes.byteLength < 32 ||
    bytes.byteLength > MAX_PEM_BYTES ||
    bytes[0] !== 0x30 ||
    !hasCompleteDerValue(bytes)
  ) {
    throw new Error("invalid")
  }
  return bytes
}

function hasCompleteDerValue(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 2) return false
  const firstLength = bytes[1]!
  if ((firstLength & 0x80) === 0) {
    return firstLength + 2 === bytes.byteLength
  }
  const lengthBytes = firstLength & 0x7f
  if (lengthBytes === 0 || lengthBytes > 4 || bytes.byteLength < 2 + lengthBytes) {
    return false
  }
  let length = 0
  for (let index = 0; index < lengthBytes; index += 1) {
    length = length * 256 + bytes[2 + index]!
  }
  return 2 + lengthBytes + length === bytes.byteLength
}

function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00])
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01,
    0x01, 0x01, 0x05, 0x00
  ])
  const privateKey = derWrap(0x04, pkcs1)
  return derWrap(
    0x30,
    concatenateBytes(version, rsaAlgorithmIdentifier, privateKey)
  )
}

function derWrap(tag: number, value: Uint8Array): Uint8Array {
  return concatenateBytes(
    new Uint8Array([tag]),
    encodeDerLength(value.byteLength),
    value
  )
}

function encodeDerLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length])
  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function concatenateBytes(...values: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    values.reduce((length, value) => length + value.byteLength, 0)
  )
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.byteLength
  }
  return result
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ""
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return globalThis
    .btoa(binary)
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
}

function isRetryableStatus(status: number, headers: Headers): boolean {
  const rateLimited =
    status === 403 &&
    (headers.has("retry-after") ||
      headers.get("x-ratelimit-remaining") === "0")
  return (
    status === 408 ||
    status === 409 ||
    status === 422 ||
    status === 429 ||
    rateLimited ||
    status >= 500
  )
}

function isDefinitiveRequestFailure(error: unknown): boolean {
  return (
    error instanceof GitHubPublicationError &&
    error.code === "github_request_failed" &&
    (!error.retryable ||
      (error.retryable &&
        error.status !== null &&
        [403, 429].includes(error.status)))
  )
}

function protocolError(operation: string): GitHubPublicationError {
  return new GitHubPublicationError(
    "github_protocol_invalid",
    operation,
    false
  )
}

function publicErrorMessage(code: GitHubPublicationErrorCode): string {
  if (code === "github_configuration_invalid") {
    return "GitHub publication configuration is invalid."
  }
  if (code === "github_publication_conflict") {
    return "GitHub publication state conflicts with the requested operation."
  }
  return "GitHub publication is unavailable."
}

function known<T>(value: T): { state: "known"; value: T } {
  return { state: "known", value }
}

function unavailable(): { retryable: true; state: "unavailable" } {
  return { retryable: true, state: "unavailable" }
}

function allUnavailable(): GitHubPublicationObservation {
  return {
    base: unavailable(),
    branch: unavailable(),
    pullRequests: unavailable()
  }
}
