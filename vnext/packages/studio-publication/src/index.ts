import {
  articleFrontmatterSchema,
  articleTopicSchema,
  parseArticle,
  serializeArticle,
  type ArticleFrontmatter,
} from "@noema/content";
import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import { z } from "zod";

export const STUDIO_ARTICLE_MAX_MARKDOWN_BYTES = 128 * 1024;
export const STUDIO_ARTICLE_MAX_SERIALIZED_BYTES = 256 * 1024;

export const STUDIO_PUBLICATION_TARGET = {
  repositoryOwner: "mani1261790",
  repositoryName: "Noema",
  baseBranch: "develop",
  articleDirectory: "vnext/apps/blog/src/content/articles",
  branchPrefix: "studio/submissions",
  submissionMode: "create_only",
  reviewKind: "draft_pull_request",
  allowDirectBaseWrite: false,
  allowForceUpdate: false,
} as const;

const submissionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const gitObjectIdPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const unsafeControlPattern =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const rootArticleImagePattern = /^\/images\/articles\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isSafeArticleImage(value: string): boolean {
  return rootArticleImagePattern.test(value) && !value.includes("..") && !value.includes("//");
}

function isSafeMarkdownLink(value: string): boolean {
  if (unsafeControlPattern.test(value) || value.includes("\\")) return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) return true;

  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

const markdownParser = new MarkdownIt({ html: true, linkify: true });
markdownParser.validateLink = () => true;

function unsafeMarkdownMessages(markdown: string): string[] {
  const messages = new Set<string>();

  const inspect = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === "html_block" || token.type === "html_inline") {
        messages.add("Markdown本文でraw HTMLまたはMDXを使用できません");
      }
      if (token.type === "heading_open" && token.tag === "h1") {
        messages.add("Markdown本文でH1見出しを使用できません");
      }
      if (token.type === "link_open") {
        const href = token.attrGet("href");
        if (!href || !isSafeMarkdownLink(href)) {
          messages.add("Markdownリンクに安全でないURLが含まれています");
        }
      }
      if (token.type === "image") {
        const src = token.attrGet("src");
        if (!src || !isSafeArticleImage(src)) {
          messages.add("Markdown画像には/images/articles/以下のpathを指定してください");
        }
      }
      if (token.children) inspect(token.children);
    }
  };

  inspect(markdownParser.parse(markdown, {}));
  return [...messages];
}

const submissionSourceSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  url: z.string().trim().min(1).max(2048).refine(isSafeHttpsUrl, "参考資料URLにはhttps URLを指定してください"),
  checkedAt: z.string().date(),
});

const submissionImageSchema = z.strictObject({
  src: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .refine(isSafeArticleImage, "記事画像には/images/articles/以下のpathを指定してください"),
  alt: z.string().trim().min(1).max(240),
});

const submissionFrontmatterSchema = articleFrontmatterSchema
  .safeExtend({
    authors: z.array(z.string().trim().min(1).max(80)).min(1).max(5),
    topics: z.array(articleTopicSchema).min(1).max(3),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    prerequisites: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
    heroImage: submissionImageSchema.nullable().default(null),
    sources: z.array(submissionSourceSchema).max(20).default([]),
  })
  .strict()
  .superRefine((frontmatter, context) => {
    if (frontmatter.status === "archived") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "新規記事をarchived状態では送信できません",
      });
    }

    for (const field of ["authors", "topics", "tags", "prerequisites"] as const) {
      if (new Set(frontmatter[field]).size !== frontmatter[field].length) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field}に同じ値を重複して指定できません`,
        });
      }
    }
  });

export const articleSubmissionRequestSchema = z
  .strictObject({
    version: z.literal(1),
    operation: z.literal("create_article"),
    submissionId: z
      .string()
      .regex(submissionIdPattern, "submissionIdにはUUID v4を指定してください")
      .transform((value) => value.toLowerCase()),
    frontmatter: submissionFrontmatterSchema,
    markdown: z
      .string()
      .max(STUDIO_ARTICLE_MAX_MARKDOWN_BYTES)
      .transform((value) => value.replace(/\r\n?/g, "\n")),
  })
  .superRefine((request, context) => {
    if (!request.markdown.trim()) {
      context.addIssue({
        code: "custom",
        path: ["markdown"],
        message: "Markdown本文を入力してください",
      });
    }

    if (unsafeControlPattern.test(request.markdown)) {
      context.addIssue({
        code: "custom",
        path: ["markdown"],
        message: "Markdown本文に使用できない制御文字が含まれています",
      });
    }

    if (new TextEncoder().encode(request.markdown).byteLength > STUDIO_ARTICLE_MAX_MARKDOWN_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["markdown"],
        message: `Markdown本文は${STUDIO_ARTICLE_MAX_MARKDOWN_BYTES} bytes以下にしてください`,
      });
    }

    for (const message of unsafeMarkdownMessages(request.markdown)) {
      context.addIssue({
        code: "custom",
        path: ["markdown"],
        message,
      });
    }
  });

export const articleSubmissionContextSchema = z.strictObject({
  principalId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "principalIdが不正です"),
});

export const articleSubmissionCancellationRequestSchema = z.strictObject({
  version: z.literal(1),
  operation: z.literal("cancel_article_submission"),
  submissionId: z
    .string()
    .regex(submissionIdPattern, "submissionIdにはUUID v4を指定してください")
    .transform((value) => value.toLowerCase()),
});

export type ArticleSubmissionRequest = z.infer<typeof articleSubmissionRequestSchema>;
export type ArticleSubmissionContext = z.infer<typeof articleSubmissionContextSchema>;
export type ArticleSubmissionCancellationRequest = z.infer<
  typeof articleSubmissionCancellationRequestSchema
>;

export interface ArticleSubmissionValidationIssue {
  path: Array<string | number>;
  message: string;
}

export type ArticleSubmissionErrorCode =
  | "invalid_submission_request"
  | "invalid_submission_cancellation_request"
  | "invalid_submission_context"
  | "invalid_submission_plan"
  | "submission_planning_failed"
  | "observation_unavailable"
  | "invalid_submission_snapshot"
  | "article_already_exists"
  | "open_submission_exists"
  | "submission_id_reused"
  | "submission_cancellation_forbidden"
  | "submission_artifact_conflict"
  | "submission_artifact_missing"
  | "submission_merge_pending";

export interface ArticleSubmissionError {
  code: ArticleSubmissionErrorCode;
  message: string;
  retryable: boolean;
  issues?: ArticleSubmissionValidationIssue[];
}

export interface ArticleSubmissionMetadata {
  version: 1;
  submissionId: string;
  requestSha256: string;
  contentSha256: string;
  articlePath: string;
  baseBranch: "develop";
  submissionMode: "create_only";
}

export interface ArticleSubmissionIntent extends ArticleSubmissionMetadata {
  principalId: string;
  slug: string;
  headBranch: string;
  reviewKind: "draft_pull_request";
  repository: "mani1261790/Noema";
}

export interface ArticleSubmissionPlan {
  version: 1;
  operation: "create_article";
  intent: ArticleSubmissionIntent;
  article: {
    slug: string;
    path: string;
    content: string;
    contentSha256: string;
  };
  git: {
    baseBranch: "develop";
    headBranch: string;
    commitMessage: string;
    allowDirectBaseWrite: false;
    allowForceUpdate: false;
  };
  pullRequest: {
    baseBranch: "develop";
    headBranch: string;
    title: string;
    body: string;
    draft: true;
  };
  metadata: ArticleSubmissionMetadata;
}

export type ArticleSubmissionPreparation =
  | { ok: true; plan: ArticleSubmissionPlan }
  | { ok: false; error: ArticleSubmissionError };

function issuesOf(error: z.ZodError): ArticleSubmissionValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => (typeof segment === "number" ? segment : String(segment))),
    message: issue.message,
  }));
}

function preparationError(
  code: "invalid_submission_request" | "invalid_submission_context",
  error: z.ZodError,
): ArticleSubmissionPreparation {
  return {
    ok: false,
    error: {
      code,
      message: code === "invalid_submission_request" ? "記事送信の入力を確認してください。" : "送信者情報を確認できません。",
      retryable: false,
      issues: issuesOf(error),
    },
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

async function requestSha256(content: string, articlePath: string): Promise<string> {
  return sha256(
    [
      "noema.studio.article-submission/v1",
      `${STUDIO_PUBLICATION_TARGET.repositoryOwner}/${STUDIO_PUBLICATION_TARGET.repositoryName}`,
      STUDIO_PUBLICATION_TARGET.submissionMode,
      STUDIO_PUBLICATION_TARGET.reviewKind,
      STUDIO_PUBLICATION_TARGET.baseBranch,
      articlePath,
      content,
    ].join("\0"),
  );
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function buildCommitMessage(metadata: ArticleSubmissionMetadata, slug: string): string {
  return [
    `Studio: add article ${slug}`,
    "",
    `Noema-Studio-Submission: ${metadata.submissionId}`,
    `Noema-Studio-Request-SHA256: ${metadata.requestSha256}`,
    `Noema-Studio-Content-SHA256: ${metadata.contentSha256}`,
    `Noema-Studio-Article-Path: ${metadata.articlePath}`,
  ].join("\n");
}

function buildPullRequestBody(metadata: ArticleSubmissionMetadata): string {
  const marker = `<!-- noema-studio-submission:${JSON.stringify(metadata)} -->`;
  return [
    "Noema Studioから新規記事を送信します。",
    "",
    `- 記事: \`${metadata.articlePath}\``,
    `- 送信ID: \`${metadata.submissionId}\``,
    "",
    "このPull RequestはDraftとして作成し、内容をレビューしてからdevelopへマージします。",
    "",
    marker,
  ].join("\n");
}

export async function prepareArticleSubmission(
  rawRequest: unknown,
  rawContext: unknown,
): Promise<ArticleSubmissionPreparation> {
  const parsedRequest = articleSubmissionRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) return preparationError("invalid_submission_request", parsedRequest.error);

  const parsedContext = articleSubmissionContextSchema.safeParse(rawContext);
  if (!parsedContext.success) return preparationError("invalid_submission_context", parsedContext.error);

  try {
    const { submissionId, frontmatter, markdown } = parsedRequest.data;
    const { principalId } = parsedContext.data;
    const content = serializeArticle(frontmatter as ArticleFrontmatter, markdown);
    if (new TextEncoder().encode(content).byteLength > STUDIO_ARTICLE_MAX_SERIALIZED_BYTES) {
      return {
        ok: false,
        error: {
          code: "invalid_submission_request",
          message: "記事全体のサイズが上限を超えています。",
          retryable: false,
          issues: [{ path: ["frontmatter"], message: "記事全体を256 KiB以下にしてください" }],
        },
      };
    }
    const contentSha256 = await sha256(content);
    const articlePath = `${STUDIO_PUBLICATION_TARGET.articleDirectory}/${frontmatter.slug}.md`;
    const headBranch = `${STUDIO_PUBLICATION_TARGET.branchPrefix}/${submissionId}`;
    const submissionRequestSha256 = await requestSha256(content, articlePath);
    const metadata: ArticleSubmissionMetadata = {
      version: 1,
      submissionId,
      requestSha256: submissionRequestSha256,
      contentSha256,
      articlePath,
      baseBranch: STUDIO_PUBLICATION_TARGET.baseBranch,
      submissionMode: STUDIO_PUBLICATION_TARGET.submissionMode,
    };
    const intent: ArticleSubmissionIntent = {
      ...metadata,
      principalId,
      slug: frontmatter.slug,
      headBranch,
      reviewKind: STUDIO_PUBLICATION_TARGET.reviewKind,
      repository: `${STUDIO_PUBLICATION_TARGET.repositoryOwner}/${STUDIO_PUBLICATION_TARGET.repositoryName}`,
    };

    return deepFreeze({
      ok: true,
      plan: {
        version: 1,
        operation: "create_article",
        intent,
        article: {
          slug: frontmatter.slug,
          path: articlePath,
          content,
          contentSha256,
        },
        git: {
          baseBranch: STUDIO_PUBLICATION_TARGET.baseBranch,
          headBranch,
          commitMessage: buildCommitMessage(metadata, frontmatter.slug),
          allowDirectBaseWrite: STUDIO_PUBLICATION_TARGET.allowDirectBaseWrite,
          allowForceUpdate: STUDIO_PUBLICATION_TARGET.allowForceUpdate,
        },
        pullRequest: {
          baseBranch: STUDIO_PUBLICATION_TARGET.baseBranch,
          headBranch,
          title: `Studio: add article ${frontmatter.slug}`,
          body: buildPullRequestBody(metadata),
          draft: true,
        },
        metadata,
      },
    });
  } catch {
    return {
      ok: false,
      error: {
        code: "submission_planning_failed",
        message: "記事送信の準備に失敗しました。",
        retryable: true,
      },
    };
  }
}

const metadataSchema = z.strictObject({
  version: z.literal(1),
  submissionId: z.string().regex(submissionIdPattern).transform((value) => value.toLowerCase()),
  requestSha256: z.string().regex(digestPattern),
  contentSha256: z.string().regex(digestPattern),
  articlePath: z.string().min(1).max(300),
  baseBranch: z.literal("develop"),
  submissionMode: z.literal("create_only"),
});

const intentSchema = metadataSchema.extend({
  principalId: z.string().min(1).max(200),
  slug: z.string().min(1).max(100),
  headBranch: z.string().min(1).max(300),
  reviewKind: z.literal("draft_pull_request"),
  repository: z.literal("mani1261790/Noema"),
});

const articleSubmissionPlanSchema = z
  .strictObject({
    version: z.literal(1),
    operation: z.literal("create_article"),
    intent: intentSchema,
    article: z.strictObject({
      slug: z
        .string()
        .min(1)
        .max(100)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      path: z.string().min(1).max(300),
      content: z.string().min(1).max(STUDIO_ARTICLE_MAX_SERIALIZED_BYTES),
      contentSha256: z.string().regex(digestPattern),
    }),
    git: z.strictObject({
      baseBranch: z.literal("develop"),
      headBranch: z.string().min(1).max(300),
      commitMessage: z.string().min(1).max(1000),
      allowDirectBaseWrite: z.literal(false),
      allowForceUpdate: z.literal(false),
    }),
    pullRequest: z.strictObject({
      baseBranch: z.literal("develop"),
      headBranch: z.string().min(1).max(300),
      title: z.string().min(1).max(256),
      body: z.string().min(1).max(10_000),
      draft: z.literal(true),
    }),
    metadata: metadataSchema,
  })
  .superRefine((plan, context) => {
    const expectedPath = `${STUDIO_PUBLICATION_TARGET.articleDirectory}/${plan.article.slug}.md`;
    const expectedHead = `${STUDIO_PUBLICATION_TARGET.branchPrefix}/${plan.intent.submissionId}`;
    const addInvariant = (path: Array<string | number>, message: string) =>
      context.addIssue({ code: "custom", path, message });

    for (const key of Object.keys(plan.metadata) as Array<keyof ArticleSubmissionMetadata>) {
      if (plan.metadata[key] !== plan.intent[key]) {
        addInvariant(["intent", key], "intentとmetadataが一致しません");
      }
    }
    if (plan.article.slug !== plan.intent.slug) addInvariant(["article", "slug"], "slugがintentと一致しません");
    if (plan.article.path !== expectedPath || plan.intent.articlePath !== expectedPath) {
      addInvariant(["article", "path"], "記事pathが固定targetと一致しません");
    }
    if (plan.article.contentSha256 !== plan.metadata.contentSha256) {
      addInvariant(["article", "contentSha256"], "content digestがmetadataと一致しません");
    }
    if (
      plan.git.headBranch !== expectedHead ||
      plan.pullRequest.headBranch !== expectedHead ||
      plan.intent.headBranch !== expectedHead
    ) {
      addInvariant(["git", "headBranch"], "submission branchが固定規則と一致しません");
    }
    if (
      plan.git.commitMessage !== buildCommitMessage(plan.metadata, plan.article.slug) ||
      plan.pullRequest.title !== `Studio: add article ${plan.article.slug}` ||
      plan.pullRequest.body !== buildPullRequestBody(plan.metadata)
    ) {
      addInvariant(["git", "commitMessage"], "GitHub metadataがserver生成値と一致しません");
    }
  });

const initialCommitRecordSchema = z.strictObject({
  sha: z.string().regex(gitObjectIdPattern),
  baseSha: z.string().regex(gitObjectIdPattern),
});

const claimSchema = z
  .strictObject({
    version: z.literal(1),
    intent: intentSchema,
    refCreationStarted: z.boolean(),
    initialCommit: initialCommitRecordSchema.nullable(),
    pullRequestNumber: z.number().int().positive().nullable(),
    terminalOutcome: z.enum(["closed_unmerged", "cancelled"]).nullable(),
  })
  .superRefine((claim, context) => {
    if (claim.initialCommit !== null && !claim.refCreationStarted) {
      context.addIssue({
        code: "custom",
        path: ["initialCommit"],
        message: "ref creation fenceなしで初回commitを記録できません",
      });
    }
    if (claim.pullRequestNumber !== null && claim.initialCommit === null) {
      context.addIssue({
        code: "custom",
        path: ["pullRequestNumber"],
        message: "initialCommitなしでPull Requestを記録できません",
      });
    }
    if (claim.terminalOutcome === "closed_unmerged" && claim.pullRequestNumber === null) {
      context.addIssue({
        code: "custom",
        path: ["terminalOutcome"],
        message: "Pull Requestなしでterminal outcomeを記録できません",
      });
    }
    if (
      claim.terminalOutcome === "cancelled" &&
      (claim.refCreationStarted || claim.initialCommit !== null || claim.pullRequestNumber !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["terminalOutcome"],
        message: "GitHub writeのfenceまたはmilestoneを持つclaimはcancelledにできません",
      });
    }
  });

const slugClaimSchema = z.strictObject({
  version: z.literal(1),
  slug: z.string().min(1).max(100),
  submissionId: z.string().regex(submissionIdPattern).transform((value) => value.toLowerCase()),
  requestSha256: z.string().regex(digestPattern),
});

/** Runtime adapters use these schemas when claims cross a durable RPC/storage boundary. */
export const articleSubmissionClaimSchema = claimSchema;
export const articleSlugClaimSchema = slugClaimSchema;

const articleInventoryEntrySchema = z.strictObject({
  path: z.string().min(1).max(300),
  contentSha256: z.string().regex(digestPattern),
});

const articleSlugInventoryEntrySchema = z.strictObject({
  path: z.string().min(1).max(300),
});

const baseStateSchema = z.strictObject({
  headSha: z.string().regex(gitObjectIdPattern),
  targetPath: articleInventoryEntrySchema.nullable(),
  articlesWithSlug: z.array(articleSlugInventoryEntrySchema).max(100),
});

const commitMetadataSchema = metadataSchema.extend({
  baseCommitSha: z.string().regex(gitObjectIdPattern),
});

const branchProofSchema = z.strictObject({
  name: z.string().min(1).max(300),
  headSha: z.string().regex(gitObjectIdPattern),
  initialCommit: z.strictObject({
    sha: z.string().regex(gitObjectIdPattern),
    parentSha: z.string().regex(gitObjectIdPattern),
    parentCount: z.literal(1),
    markerVerified: z.boolean(),
    metadata: commitMetadataSchema,
    changes: z
      .array(
        z.strictObject({
          status: z.literal("added"),
          path: z.string().min(1).max(300),
          contentSha256: z.string().regex(digestPattern),
        }),
      )
      .length(1),
  }),
  initialCommitReachableFromHead: z.boolean(),
});

const pullRequestSchema = z
  .strictObject({
    number: z.number().int().positive(),
    url: z.string().url().max(500).refine((value) => new URL(value).protocol === "https:"),
    state: z.enum(["open", "closed", "merged"]),
    draft: z.boolean(),
    baseBranch: z.string().min(1).max(300),
    headBranch: z.string().min(1).max(300),
    containsInitialCommit: z.boolean(),
    mergeCommitSha: z.string().regex(gitObjectIdPattern).nullable(),
    mergeCommitReachableFromBase: z.boolean(),
  })
  .superRefine((pullRequest, context) => {
    if (pullRequest.url !== `https://github.com/mani1261790/Noema/pull/${pullRequest.number}`) {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Pull Request URLが固定repositoryと一致しません",
      });
    }
    if (pullRequest.state === "merged" && pullRequest.mergeCommitSha === null) {
      context.addIssue({
        code: "custom",
        path: ["mergeCommitSha"],
        message: "merged Pull Requestにはmerge commit SHAが必要です",
      });
    }
  });

export const articleSubmissionPullRequestSchema = pullRequestSchema;

function observationSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("known"), value: valueSchema }),
    z.strictObject({ state: z.literal("unavailable"), retryable: z.literal(true) }),
  ]);
}

export const articleSubmissionSnapshotSchema = z.strictObject({
  claim: observationSchema(claimSchema.nullable()),
  slugClaim: observationSchema(slugClaimSchema.nullable()),
  base: observationSchema(baseStateSchema),
  branch: observationSchema(branchProofSchema.nullable()),
  pullRequests: observationSchema(z.array(pullRequestSchema).max(20)),
});

const cancellationArtifactsSchema = z.strictObject({
  branchExists: z.boolean(),
  pullRequestCount: z.number().int().min(0).max(100),
});

export const articleSubmissionCancellationSnapshotSchema = z.strictObject({
  claim: observationSchema(claimSchema.nullable()),
  slugClaim: observationSchema(slugClaimSchema.nullable()),
  artifacts: observationSchema(cancellationArtifactsSchema),
});

export type ArticleSubmissionClaim = z.infer<typeof claimSchema>;
export type ArticleSlugClaim = z.infer<typeof slugClaimSchema>;
export type ArticleSubmissionSnapshot = z.infer<typeof articleSubmissionSnapshotSchema>;
export type ArticleSubmissionCancellationSnapshot = z.infer<
  typeof articleSubmissionCancellationSnapshotSchema
>;
export type ArticleSubmissionPullRequest = z.infer<typeof pullRequestSchema>;
export type ArticleSubmissionCommitMetadata = z.infer<typeof commitMetadataSchema>;

export type ArticleSubmissionDecision =
  | {
      ok: true;
      kind: "act";
      action: "reserve_claim";
      claim: ArticleSubmissionClaim;
      slugClaim: ArticleSlugClaim;
    }
  | {
      ok: true;
      kind: "act";
      action: "record_ref_creation_started";
      expectedClaim: ArticleSubmissionClaim;
    }
  | {
      ok: true;
      kind: "act";
      action: "create_submission_ref";
      baseCommitSha: string;
      commitMetadata: ArticleSubmissionCommitMetadata;
      expectedClaim: ArticleSubmissionClaim;
    }
  | {
      ok: true;
      kind: "act";
      action: "record_initial_commit";
      initialCommit: { sha: string; baseSha: string };
    }
  | {
      ok: true;
      kind: "act";
      action: "create_draft_pull_request";
      expectedClaim: ArticleSubmissionClaim;
    }
  | { ok: true; kind: "act"; action: "record_pull_request"; pullRequestNumber: number }
  | {
      ok: true;
      kind: "act";
      action: "record_terminal_outcome";
      outcome: "closed_unmerged" | "cancelled";
      expectedClaim: ArticleSubmissionClaim;
    }
  | { ok: true; kind: "act"; action: "release_slug_claim"; slugClaim: ArticleSlugClaim }
  | {
      ok: true;
      kind: "done";
      outcome: "existing_pull_request" | "closed_unmerged";
      pullRequest: ArticleSubmissionPullRequest;
    }
  | {
      ok: true;
      kind: "done";
      outcome: "merged";
      finalContentSha256: string;
      pullRequest: ArticleSubmissionPullRequest;
    }
  | { ok: true; kind: "done"; outcome: "cancelled" }
  | ArticleSubmissionFailure;

export type ArticleSubmissionFailure = {
  ok: false;
  kind: "error";
  error: ArticleSubmissionError;
};

export type ArticleSubmissionCancellationDecision =
  | {
      ok: true;
      kind: "act";
      action: "record_terminal_outcome";
      outcome: "cancelled";
      expectedClaim: ArticleSubmissionClaim;
    }
  | { ok: true; kind: "act"; action: "release_slug_claim"; slugClaim: ArticleSlugClaim }
  | { ok: true; kind: "done"; outcome: "cancelled" }
  | ArticleSubmissionFailure;

function decisionError(
  code: ArticleSubmissionErrorCode,
  message: string,
  retryable = false,
  issues?: ArticleSubmissionValidationIssue[],
): ArticleSubmissionFailure {
  return {
    ok: false,
    kind: "error",
    error: { code, message, retryable, ...(issues ? { issues } : {}) },
  };
}

function intentMatches(left: ArticleSubmissionIntent, right: ArticleSubmissionIntent): boolean {
  return Object.keys(left).every(
    (key) => left[key as keyof ArticleSubmissionIntent] === right[key as keyof ArticleSubmissionIntent],
  );
}

function metadataMatches(plan: ArticleSubmissionPlan, metadata: ArticleSubmissionMetadata): boolean {
  return Object.keys(plan.metadata).every(
    (key) => plan.metadata[key as keyof ArticleSubmissionMetadata] === metadata[key as keyof ArticleSubmissionMetadata],
  );
}

function hasBaseCollision(base: z.infer<typeof baseStateSchema>): boolean {
  return base.targetPath !== null || base.articlesWithSlug.length > 0;
}

function validateBranchProof(
  plan: ArticleSubmissionPlan,
  branch: z.infer<typeof branchProofSchema>,
  recordedCommit: z.infer<typeof initialCommitRecordSchema> | null,
  requirePristineHead: boolean,
): ArticleSubmissionDecision | null {
  const commit = branch.initialCommit;
  const change = commit.changes[0];

  if (
    branch.name !== plan.git.headBranch ||
    !commit.markerVerified ||
    !branch.initialCommitReachableFromHead ||
    (requirePristineHead && branch.headSha !== commit.sha) ||
    !metadataMatches(plan, commit.metadata) ||
    commit.metadata.baseCommitSha !== commit.parentSha ||
    change.path !== plan.article.path ||
    change.contentSha256 !== plan.article.contentSha256
  ) {
    return decisionError(
      "submission_artifact_conflict",
      "submission branchのcommit証明が送信計画と一致しません。",
    );
  }

  if (recordedCommit && (recordedCommit.sha !== commit.sha || recordedCommit.baseSha !== commit.parentSha)) {
    return decisionError(
      "submission_artifact_conflict",
      "記録済みの初回commitとsubmission branchが一致しません。",
    );
  }

  return null;
}

export async function reconcileArticleSubmission(
  rawPlan: unknown,
  rawSnapshot: unknown,
): Promise<ArticleSubmissionDecision> {
  const parsedPlan = articleSubmissionPlanSchema.safeParse(rawPlan);
  if (!parsedPlan.success) {
    return decisionError(
      "invalid_submission_plan",
      "記事送信計画が固定contractと一致しません。",
      false,
      issuesOf(parsedPlan.error),
    );
  }

  const plan = parsedPlan.data as ArticleSubmissionPlan;
  try {
    const parsedArticle = await parseArticle(plan.article.content);
    const canonical = await prepareArticleSubmission(
      {
        version: 1,
        operation: "create_article",
        submissionId: plan.intent.submissionId,
        frontmatter: parsedArticle.frontmatter,
        markdown: parsedArticle.markdown,
      },
      { principalId: plan.intent.principalId },
    );
    if (!canonical.ok || JSON.stringify(canonical.plan) !== JSON.stringify(plan)) {
      return decisionError(
        "invalid_submission_plan",
        "記事送信計画を安全なcanonical articleから再現できません。",
      );
    }
  } catch {
    return decisionError(
      "invalid_submission_plan",
      "記事送信計画の記事内容を再検証できませんでした。",
    );
  }

  const parsed = articleSubmissionSnapshotSchema.safeParse(rawSnapshot);
  if (!parsed.success) {
    return decisionError(
      "invalid_submission_snapshot",
      "送信状態を安全に確認できませんでした。",
      false,
      issuesOf(parsed.error),
    );
  }

  const snapshot = parsed.data;
  if (
    snapshot.claim.state === "unavailable" ||
    snapshot.slugClaim.state === "unavailable" ||
    snapshot.branch.state === "unavailable" ||
    snapshot.pullRequests.state === "unavailable"
  ) {
    return decisionError(
      "observation_unavailable",
      "送信状態の一部を取得できませんでした。再確認してから続行します。",
      true,
    );
  }

  const claim = snapshot.claim.value;
  const slugClaim = snapshot.slugClaim.value;
  const branch = snapshot.branch.value;
  const pullRequests = snapshot.pullRequests.value;

  if (claim?.terminalOutcome === "cancelled") {
    if (!intentMatches(plan.intent, claim.intent)) {
      return decisionError(
        "submission_id_reused",
        "同じ送信IDが異なる送信内容または送信者に使用されています。",
      );
    }
    if (
      claim.refCreationStarted ||
      claim.initialCommit !== null ||
      claim.pullRequestNumber !== null ||
      branch !== null ||
      pullRequests.length > 0
    ) {
      return decisionError(
        "submission_artifact_conflict",
        "cancelled claimにGitHub artifactまたはmilestoneが存在します。",
      );
    }
    const ownsCancelledSlugClaim = Boolean(
      slugClaim &&
        slugClaim.slug === plan.article.slug &&
        slugClaim.submissionId === plan.intent.submissionId &&
        slugClaim.requestSha256 === plan.intent.requestSha256,
    );
    if (slugClaim?.submissionId === plan.intent.submissionId && !ownsCancelledSlugClaim) {
      return decisionError(
        "submission_artifact_conflict",
        "release対象のslug claimがcancelled claimと一致しません。",
      );
    }
    if (ownsCancelledSlugClaim && slugClaim) {
      return {
        ok: true,
        kind: "act",
        action: "release_slug_claim",
        slugClaim,
      };
    }
    return { ok: true, kind: "done", outcome: "cancelled" };
  }

  if (snapshot.base.state === "unavailable") {
    return decisionError(
      "observation_unavailable",
      "送信状態の一部を取得できませんでした。再確認してから続行します。",
      true,
    );
  }
  const base = snapshot.base.value;

  if (base.targetPath && base.targetPath.path !== plan.article.path) {
    return decisionError(
      "invalid_submission_snapshot",
      "developの記事path観測が送信計画と一致しません。",
    );
  }

  if (!claim) {
    if (slugClaim) {
      return decisionError(
        slugClaim.submissionId === plan.intent.submissionId
          ? "submission_artifact_missing"
          : "open_submission_exists",
        "同じslugの送信予約が既に存在します。",
      );
    }
    if (branch || pullRequests.length > 0) {
      return decisionError(
        "submission_artifact_conflict",
        "送信予約のないGitHub artifactが存在します。",
      );
    }
    if (hasBaseCollision(base)) {
      return decisionError(
        "article_already_exists",
        "同じslugまたはpathの記事がdevelopに存在します。",
      );
    }

    return {
      ok: true,
      kind: "act",
      action: "reserve_claim",
      claim: {
        version: 1,
        intent: plan.intent,
        refCreationStarted: false,
        initialCommit: null,
        pullRequestNumber: null,
        terminalOutcome: null,
      },
      slugClaim: {
        version: 1,
        slug: plan.article.slug,
        submissionId: plan.intent.submissionId,
        requestSha256: plan.intent.requestSha256,
      },
    };
  }

  if (!intentMatches(plan.intent, claim.intent)) {
    return decisionError(
      "submission_id_reused",
      "同じ送信IDが異なる送信内容または送信者に使用されています。",
    );
  }

  const ownsSlugClaim = Boolean(
    slugClaim &&
      slugClaim.slug === plan.article.slug &&
      slugClaim.submissionId === plan.intent.submissionId &&
      slugClaim.requestSha256 === plan.intent.requestSha256,
  );

  if (claim.terminalOutcome === null && !ownsSlugClaim) {
    return decisionError(
      slugClaim && slugClaim.submissionId !== plan.intent.submissionId
        ? "open_submission_exists"
        : "submission_artifact_missing",
      "slugの送信予約が送信claimと一致しません。",
    );
  }

  if (pullRequests.length > 1) {
    return decisionError(
      "submission_artifact_conflict",
      "同じ送信に複数のPull Requestが見つかりました。",
    );
  }

  const pullRequest = pullRequests[0] ?? null;
  if (
    pullRequest &&
    (pullRequest.baseBranch !== plan.pullRequest.baseBranch ||
      pullRequest.headBranch !== plan.pullRequest.headBranch ||
      !pullRequest.containsInitialCommit)
  ) {
    return decisionError(
      "submission_artifact_conflict",
      "Pull Requestが送信claimまたは初回commitと一致しません。",
    );
  }

  if (pullRequest && claim.initialCommit === null) {
    return decisionError(
      "submission_artifact_conflict",
      "初回commitを記録する前にPull Requestが存在します。",
    );
  }

  if (pullRequest?.state === "open") {
    if (!branch) {
      return decisionError(
        "submission_artifact_missing",
        "開いているPull Requestのsubmission branchを確認できません。",
      );
    }
    const branchError = validateBranchProof(plan, branch, claim.initialCommit, false);
    if (branchError) return branchError;
  }

  if (pullRequest && claim.pullRequestNumber === null) {
    return {
      ok: true,
      kind: "act",
      action: "record_pull_request",
      pullRequestNumber: pullRequest.number,
    };
  }

  if (claim.pullRequestNumber !== null && (!pullRequest || claim.pullRequestNumber !== pullRequest.number)) {
    return decisionError(
      "submission_artifact_missing",
      "記録済みのPull Requestを確認できません。",
    );
  }

  if (claim.terminalOutcome !== null && pullRequest?.state !== "closed") {
    return decisionError(
      "submission_artifact_conflict",
      "terminal outcomeとPull Requestの状態が一致しません。",
    );
  }

  if (pullRequest?.state === "merged") {
    if (!pullRequest.mergeCommitReachableFromBase) {
      return decisionError(
        "submission_merge_pending",
        "Pull Requestのmerge結果がdevelopへ反映されるのを待っています。",
        true,
      );
    }
    const matchingArticles = base.articlesWithSlug.filter((article) => article.path === plan.article.path);
    if (
      base.targetPath !== null &&
      matchingArticles.length === 1 &&
      base.articlesWithSlug.length === 1 &&
      matchingArticles[0].path === base.targetPath.path
    ) {
      return {
        ok: true,
        kind: "done",
        outcome: "merged",
        finalContentSha256: base.targetPath.contentSha256,
        pullRequest,
      };
    }
    return decisionError(
      "submission_artifact_conflict",
      "merge後のdevelop記事が送信内容と一致しません。",
    );
  }

  if (pullRequest?.state === "open") {
    return { ok: true, kind: "done", outcome: "existing_pull_request", pullRequest };
  }

  if (pullRequest?.state === "closed") {
    if (claim.terminalOutcome === null) {
      return {
        ok: true,
        kind: "act",
        action: "record_terminal_outcome",
        outcome: "closed_unmerged",
        expectedClaim: claim,
      };
    }
    if (
      slugClaim &&
      slugClaim.submissionId === plan.intent.submissionId &&
      !ownsSlugClaim
    ) {
      return decisionError(
        "submission_artifact_conflict",
        "release対象のslug claimが送信intentと一致しません。",
      );
    }
    if (ownsSlugClaim && slugClaim) {
      return {
        ok: true,
        kind: "act",
        action: "release_slug_claim",
        slugClaim,
      };
    }
    return { ok: true, kind: "done", outcome: "closed_unmerged", pullRequest };
  }

  if (hasBaseCollision(base)) {
    return decisionError(
      "article_already_exists",
      "同じslugまたはpathの記事がdevelopに存在します。",
    );
  }

  if (!branch) {
    if (claim.initialCommit) {
      return decisionError(
        "submission_artifact_missing",
        "記録済みのsubmission branchを確認できません。",
      );
    }
    if (!claim.refCreationStarted) {
      return {
        ok: true,
        kind: "act",
        action: "record_ref_creation_started",
        expectedClaim: claim,
      };
    }
    return {
      ok: true,
      kind: "act",
      action: "create_submission_ref",
      baseCommitSha: base.headSha,
      commitMetadata: {
        ...plan.metadata,
        baseCommitSha: base.headSha,
      },
      expectedClaim: claim,
    };
  }

  if (!claim.refCreationStarted) {
    return decisionError(
      "submission_artifact_conflict",
      "ref creation fenceなしでsubmission branchが存在します。",
    );
  }

  const branchError = validateBranchProof(plan, branch, claim.initialCommit, true);
  if (branchError) return branchError;

  if (!claim.initialCommit) {
    return {
      ok: true,
      kind: "act",
      action: "record_initial_commit",
      initialCommit: {
        sha: branch.initialCommit.sha,
        baseSha: branch.initialCommit.parentSha,
      },
    };
  }

  return {
    ok: true,
    kind: "act",
    action: "create_draft_pull_request",
    expectedClaim: claim,
  };
}

export function reconcileArticleSubmissionCancellation(
  rawRequest: unknown,
  rawContext: unknown,
  rawSnapshot: unknown,
): ArticleSubmissionCancellationDecision {
  const parsedRequest = articleSubmissionCancellationRequestSchema.safeParse(rawRequest);
  if (!parsedRequest.success) {
    return decisionError(
      "invalid_submission_cancellation_request",
      "記事送信のcancel入力を確認してください。",
      false,
      issuesOf(parsedRequest.error),
    );
  }

  const parsedContext = articleSubmissionContextSchema.safeParse(rawContext);
  if (!parsedContext.success) {
    return decisionError(
      "invalid_submission_context",
      "送信者情報を確認できません。",
      false,
      issuesOf(parsedContext.error),
    );
  }

  const parsedSnapshot = articleSubmissionCancellationSnapshotSchema.safeParse(rawSnapshot);
  if (!parsedSnapshot.success) {
    return decisionError(
      "invalid_submission_snapshot",
      "送信状態を安全に確認できませんでした。",
      false,
      issuesOf(parsedSnapshot.error),
    );
  }

  const snapshot = parsedSnapshot.data;
  if (snapshot.claim.state === "unavailable") {
    return decisionError(
      "observation_unavailable",
      "cancelに必要な送信状態を取得できませんでした。再確認してから続行します。",
      true,
    );
  }

  const claim = snapshot.claim.value;
  if (
    !claim ||
    claim.intent.submissionId !== parsedRequest.data.submissionId ||
    claim.intent.principalId !== parsedContext.data.principalId
  ) {
    return decisionError(
      "submission_cancellation_forbidden",
      "この送信をcancelできません。",
    );
  }

  if (
    snapshot.slugClaim.state === "unavailable" ||
    snapshot.artifacts.state === "unavailable"
  ) {
    return decisionError(
      "observation_unavailable",
      "cancelに必要な送信状態を取得できませんでした。再確認してから続行します。",
      true,
    );
  }

  const slugClaim = snapshot.slugClaim.value;
  const artifacts = snapshot.artifacts.value;
  const hasGitHubArtifacts =
    artifacts.branchExists || artifacts.pullRequestCount > 0;

  if (claim.terminalOutcome === "closed_unmerged") {
    return decisionError(
      "submission_cancellation_forbidden",
      "Pull Requestへ進んだ送信はcancelできません。",
    );
  }

  if (claim.terminalOutcome === "cancelled") {
    if (hasGitHubArtifacts) {
      return decisionError(
        "submission_artifact_conflict",
        "cancelled claimにGitHub artifactが存在するためslug予約を解放できません。",
      );
    }
    const ownsSlugClaim = Boolean(
      slugClaim &&
        slugClaim.slug === claim.intent.slug &&
        slugClaim.submissionId === claim.intent.submissionId &&
        slugClaim.requestSha256 === claim.intent.requestSha256,
    );
    if (slugClaim?.submissionId === claim.intent.submissionId && !ownsSlugClaim) {
      return decisionError(
        "submission_artifact_conflict",
        "release対象のslug claimがcancelled claimと一致しません。",
      );
    }
    if (ownsSlugClaim && slugClaim) {
      return {
        ok: true,
        kind: "act",
        action: "release_slug_claim",
        slugClaim,
      };
    }
    return { ok: true, kind: "done", outcome: "cancelled" };
  }

  if (
    claim.refCreationStarted ||
    claim.initialCommit !== null ||
    claim.pullRequestNumber !== null ||
    hasGitHubArtifacts
  ) {
    return decisionError(
      "submission_cancellation_forbidden",
      "GitHub artifactの作成が始まった送信はcancelできません。",
    );
  }

  const ownsSlugClaim = Boolean(
    slugClaim &&
      slugClaim.slug === claim.intent.slug &&
      slugClaim.submissionId === claim.intent.submissionId &&
      slugClaim.requestSha256 === claim.intent.requestSha256,
  );
  if (!ownsSlugClaim) {
    return decisionError(
      "submission_artifact_conflict",
      "slug予約が送信claimと一致しないためcancelできません。",
    );
  }

  return {
    ok: true,
    kind: "act",
    action: "record_terminal_outcome",
    outcome: "cancelled",
    expectedClaim: claim,
  };
}
