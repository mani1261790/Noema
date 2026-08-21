import {
  articleApproachSchema,
  articleFrontmatterSchema,
  articleImageSchema,
  articleSourceSchema,
  articleTopicSchema,
  validateArticleMarkdown,
  type ArticleFrontmatter
} from "@noema/content";
import { z } from "zod";

export const cmsRoleSchema = z.enum(["admin", "editor", "reviewer"]);
export const cmsReviewStatusSchema = z.enum([
  "draft",
  "in_review",
  "changes_requested",
  "approved"
]);
export const cmsPublicationStatusSchema = z.enum([
  "unpublished",
  "published",
  "archived"
]);
export const cmsVisibilitySchema = z.enum([
  "public",
  "unlisted",
  "restricted",
  "internal"
]);
export const cmsAssetStatusSchema = z.enum(["active", "archived"]);
export const cmsRevisionSaveReasonSchema = z.enum([
  "legacy",
  "created",
  "autosave",
  "manual",
  "conflict_resolution",
  "restored"
]);

export type CmsRole = z.infer<typeof cmsRoleSchema>;
export type CmsReviewStatus = z.infer<typeof cmsReviewStatusSchema>;
export type CmsPublicationStatus = z.infer<typeof cmsPublicationStatusSchema>;
export type CmsVisibility = z.infer<typeof cmsVisibilitySchema>;
export type CmsAssetStatus = z.infer<typeof cmsAssetStatusSchema>;
export type CmsRevisionSaveReason = z.infer<typeof cmsRevisionSaveReasonSchema>;

export const cmsRoleLabels = {
  admin: "管理者",
  editor: "編集者",
  reviewer: "レビュー担当"
} as const satisfies Record<CmsRole, string>;

export const cmsReviewStatusLabels = {
  draft: "下書き",
  in_review: "レビュー待ち",
  changes_requested: "要修正",
  approved: "承認済み"
} as const satisfies Record<CmsReviewStatus, string>;

export const cmsPublicationStatusLabels = {
  unpublished: "未公開",
  published: "公開中",
  archived: "保管"
} as const satisfies Record<CmsPublicationStatus, string>;

export const cmsVisibilityLabels = {
  public: "一般公開",
  unlisted: "限定URL",
  restricted: "指定メンバー",
  internal: "運営メンバーのみ"
} as const satisfies Record<CmsVisibility, string>;

const boundedString = (maximum: number) => z.string().max(maximum);

/**
 * Drafts deliberately allow incomplete editorial fields. The strict article
 * schema is applied when review is requested and again before publication.
 */
export const cmsDraftFrontmatterSchema = z.object({
  title: boundedString(100),
  description: boundedString(180),
  slug: boundedString(100),
  // CMS workflow state lives on cms_articles. Revisions are always drafts;
  // the public reader overlays "published" only for the pinned publication.
  status: z.literal("draft"),
  publishedAt: boundedString(64).optional(),
  updatedAt: boundedString(64),
  authors: z.array(boundedString(1_000)).max(100),
  topics: z.array(articleTopicSchema).max(6),
  tags: z.array(boundedString(1_000)).max(100),
  approach: articleApproachSchema,
  outcome: boundedString(180),
  prerequisites: z.array(boundedString(1_000)).max(100),
  estimatedMinutes: z.number().int().min(0).max(10_000),
  heroImage: articleImageSchema.nullable(),
  sources: z.array(articleSourceSchema).max(50)
}).strict();

export const cmsArticleContentSchema = z.object({
  frontmatter: cmsDraftFrontmatterSchema,
  markdown: z.string().max(1_048_576),
  visibility: cmsVisibilitySchema
}).strict();

const cmsRevisionWriteContextSchema = z.object({
  editSessionId: z.uuid().optional(),
  saveReason: cmsRevisionSaveReasonSchema.exclude(["legacy", "created"]).optional(),
  sourceRevisionId: z.uuid().optional()
}).strict();

export const cmsCreateArticleRequestSchema = cmsArticleContentSchema.extend({
  editSessionId: z.uuid().optional()
});

export const cmsUpdateArticleRequestSchema = cmsArticleContentSchema.extend({
  ...cmsRevisionWriteContextSchema.shape,
  expectedVersion: z.number().int().nonnegative()
});

export const cmsArticleActionSchema = z.object({
  action: z.enum([
    "request_review",
    "approve",
    "request_changes",
    "publish",
    "archive",
    "restore"
  ]),
  expectedVersion: z.number().int().nonnegative(),
  note: boundedString(500).optional(),
  visibility: cmsVisibilitySchema.optional()
}).strict();

export type CmsArticleAction = z.infer<typeof cmsArticleActionSchema>["action"];

export const cmsMemberMutationSchema = z.object({
  active: z.boolean().default(true),
  email: z.string().trim().email().max(320),
  role: cmsRoleSchema
}).strict();

export const cmsAssetMutationSchema = z.object({
  alt: boundedString(500),
  status: cmsAssetStatusSchema,
  tags: z.array(boundedString(80)).max(30)
}).strict();

export const cmsSeriesContentSchema = z.object({
  description: z.string().trim().min(1).max(500),
  articleIds: z.array(z.uuid()).min(1).max(100).refine(
    (ids) => new Set(ids).size === ids.length,
    "同じ記事をシリーズへ重複して追加できません"
  ),
  slug: z.string().trim().min(1).max(100).regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "slugは半角英数字とハイフンで入力してください"
  ),
  title: z.string().trim().min(1).max(100)
}).strict();

export const cmsCreateSeriesRequestSchema = cmsSeriesContentSchema;
export const cmsUpdateSeriesRequestSchema = cmsSeriesContentSchema.extend({
  expectedVersion: z.number().int().positive(),
  restoredFromRevisionId: z.uuid().optional()
}).strict();

export interface CmsIdentity {
  email: string;
  role: CmsRole;
  subject: string;
}

export interface CmsCapabilities {
  canApprove: boolean;
  canEdit: boolean;
  canManageMembers: boolean;
  canPublish: boolean;
}

export interface CmsSession {
  capabilities: CmsCapabilities;
  identity: CmsIdentity;
  passwordLoginReadyAt: string | null;
}

export interface CmsArticleSummary {
  id: string;
  lockVersion: number;
  publicationStatus: CmsPublicationStatus;
  revisionNumber: number;
  reviewStatus: CmsReviewStatus;
  slug: string;
  title: string;
  updatedAt: string;
  updatedByEmail: string;
  visibility: CmsVisibility;
}

export interface CmsArticleRevision {
  createdAt: string;
  createdByEmail: string;
  frontmatter: ArticleFrontmatter;
  id: string;
  markdown: string;
  number: number;
}

export interface CmsArticleVersionSummary {
  checkpointCount: number;
  createdAt: string;
  createdByEmail: string;
  firstRevisionNumber: number;
  id: string;
  isApproved: boolean;
  isCurrent: boolean;
  isPublished: boolean;
  latestRevisionId: string;
  latestRevisionNumber: number;
  reason: CmsRevisionSaveReason;
  sourceRevisionId: string | null;
  updatedAt: string;
}

export interface CmsArticleVersionDetail {
  isApproved: boolean;
  isCurrent: boolean;
  isPublished: boolean;
  reason: CmsRevisionSaveReason;
  revision: CmsArticleRevision;
  sourceRevisionId: string | null;
  visibility: CmsVisibility | null;
}

export interface CmsArticleVersionCheckpoint {
  createdAt: string;
  createdByEmail: string;
  id: string;
  isApproved: boolean;
  isCurrent: boolean;
  isPublished: boolean;
  number: number;
  reason: CmsRevisionSaveReason;
}

export interface CmsArticleVersionCheckpointPage {
  checkpoints: CmsArticleVersionCheckpoint[];
  nextBeforeRevisionNumber: number | null;
}

export interface CmsArticleDetail extends CmsArticleSummary {
  currentRevision: CmsArticleRevision;
  publishedRevisionNumber: number | null;
  publishedSlug: string | null;
  publishedVisibility: CmsVisibility | null;
  reviewNote: string | null;
}

export interface CmsSeriesArticle {
  id: string;
  publicationStatus: CmsPublicationStatus;
  reviewStatus: CmsReviewStatus;
  slug: string;
  title: string;
  visibility: CmsVisibility;
}

export interface CmsSeries {
  articleIds: string[];
  articles: CmsSeriesArticle[];
  createdAt: string;
  description: string;
  id: string;
  lockVersion: number;
  revisionNumber: number;
  slug: string;
  title: string;
  updatedAt: string;
  updatedByEmail: string;
}

export interface CmsSeriesVersion {
  articleIds: string[];
  createdAt: string;
  createdByEmail: string;
  description: string;
  id: string;
  isCurrent: boolean;
  number: number;
  restoredFromRevisionId: string | null;
  slug: string;
  title: string;
}

export interface CmsMember {
  active: boolean;
  email: string;
  passwordLoginReadyAt: string | null;
  provisioned: boolean;
  role: CmsRole;
  updatedAt: string;
}

export interface CmsAsset {
  alt: string;
  byteSize: number;
  contentType: string;
  createdAt: string;
  createdByEmail: string;
  height: number | null;
  id: string;
  markdownUrl: string;
  originalName: string;
  previewUrl: string;
  referenceCount: number;
  status: CmsAssetStatus;
  tags: string[];
  updatedAt: string;
  width: number | null;
}

export type CmsPermission =
  | "approve"
  | "edit"
  | "manage_members"
  | "publish";

export function canCms(role: CmsRole, permission: CmsPermission): boolean {
  if (role === "admin") return true;
  if (permission === "edit") return role === "editor" || role === "reviewer";
  if (permission === "approve") return role === "reviewer";
  return false;
}

export function cmsCapabilitiesFor(role: CmsRole): CmsCapabilities {
  return {
    canApprove: canCms(role, "approve"),
    canEdit: canCms(role, "edit"),
    canManageMembers: canCms(role, "manage_members"),
    canPublish: canCms(role, "publish")
  };
}

export interface CmsEditorialIssue {
  message: string;
  path: Array<string | number>;
}

export function validateCmsArticleForReview(input: {
  frontmatter: ArticleFrontmatter;
  markdown: string;
}): CmsEditorialIssue[] {
  const issues: CmsEditorialIssue[] = [];
  const frontmatter = articleFrontmatterSchema.safeParse({
    ...input.frontmatter,
    status: "draft"
  });

  if (!frontmatter.success) {
    issues.push(
      ...frontmatter.error.issues.map((issue) => ({
        message: issue.message,
        path: ["frontmatter", ...issue.path.map((part) =>
          typeof part === "symbol" ? String(part) : part
        )]
      }))
    );
  }

  issues.push(
    ...validateArticleMarkdown(input.markdown)
      .filter((issue) => issue.severity === "error")
      .map((issue) => ({
        message: issue.message,
        path: ["markdown", issue.line]
      }))
  );

  return issues;
}
