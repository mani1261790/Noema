import {
  cmsDraftFrontmatterSchema,
  cmsAssetStatusSchema,
  cmsPublicationStatusSchema,
  cmsReviewStatusSchema,
  cmsRoleSchema,
  cmsRevisionSaveReasonSchema,
  cmsVisibilitySchema,
  type CmsArticleAction,
  type CmsArticleDetail,
  type CmsArticleSummary,
  type CmsArticleVersionDetail,
  type CmsArticleVersionCheckpoint,
  type CmsArticleVersionCheckpointPage,
  type CmsArticleVersionSummary,
  type CmsAsset,
  type CmsAssetStatus,
  type CmsEditorialIssue,
  type CmsMember,
  type CmsRole,
  type CmsRevisionSaveReason,
  type CmsSession,
  type CmsVisibility
} from "@noema/cms";
import type { ArticleFrontmatter } from "@noema/content";

const CMS_ARTICLES_PATH = "/api/cms/articles";
const CMS_MEMBERS_PATH = "/api/cms/members";
const CMS_SESSION_PATH = "/api/cms/session";
const CMS_ASSETS_PATH = "/api/cms/assets";
const AUTH_API_PREFIX = "/api/auth";
const STUDIO_PASSWORD_PATH = "/api/studio-auth/password";

export interface CmsClientError {
  code: string;
  issues?: CmsEditorialIssue[];
  message: string;
  retryable: boolean;
  status: number;
}

export type CmsClientResult<T> =
  | { ok: true; value: T }
  | { error: CmsClientError; ok: false };

interface CmsRequestOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
}

interface CmsArticleContent {
  frontmatter: ArticleFrontmatter;
  markdown: string;
  visibility: CmsVisibility;
}

export interface CmsRevisionWriteContext {
  editSessionId: string;
  saveReason?: Extract<
    CmsRevisionSaveReason,
    "autosave" | "manual" | "conflict_resolution" | "restored"
  >;
  sourceRevisionId?: string;
}

export async function fetchCmsSession(
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsSession>> {
  const result = await cmsRequest(CMS_SESSION_PATH, { method: "GET" }, options);
  if (!result.ok) return result;
  const session = parseCmsSession(result.value);
  return session
    ? { ok: true, value: session }
    : invalidResponse(result.status);
}

export async function configureStudioPassword(
  password: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<null>> {
  const result = await cmsRequest(STUDIO_PASSWORD_PATH, {
    body: JSON.stringify({ password }),
    headers: { "content-type": "application/json" },
    method: "POST"
  }, options);
  return result.ok ? { ok: true, value: null } : result;
}

export async function signInStudio(
  email: string,
  password: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<null>> {
  const result = await cmsRequest(`${AUTH_API_PREFIX}/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json" },
    method: "POST"
  }, options);
  return result.ok ? { ok: true, value: null } : result;
}

export async function fetchCmsArticles(
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsArticleSummary[]>> {
  const result = await cmsRequest(CMS_ARTICLES_PATH, { method: "GET" }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.articles)) {
    return invalidResponse(result.status);
  }
  const articles = result.value.articles.map(parseCmsArticleSummary);
  return articles.every((article): article is CmsArticleSummary => article !== null)
    ? { ok: true, value: articles }
    : invalidResponse(result.status);
}

export async function fetchCmsArticle(
  articleId: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsArticleDetail>> {
  const result = await cmsRequest(`${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}`, {
    method: "GET"
  }, options);
  return articleResult(result);
}

export async function fetchCmsArticleVersions(
  articleId: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsArticleVersionSummary[]>> {
  const result = await cmsRequest(
    `${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}/versions`,
    { method: "GET" },
    options
  );
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.versions)) {
    return invalidResponse(result.status);
  }
  const versions = result.value.versions.map(parseCmsArticleVersionSummary);
  return versions.every((version): version is CmsArticleVersionSummary => version !== null)
    ? { ok: true, value: versions }
    : invalidResponse(result.status);
}

export async function fetchCmsArticleVersion(
  articleId: string,
  revisionId: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsArticleVersionDetail>> {
  const result = await cmsRequest(
    `${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}/versions/${encodeURIComponent(revisionId)}`,
    { method: "GET" },
    options
  );
  if (!result.ok) return result;
  if (!isRecord(result.value)) return invalidResponse(result.status);
  const version = parseCmsArticleVersionDetail(result.value.version);
  return version ? { ok: true, value: version } : invalidResponse(result.status);
}

export async function fetchCmsArticleVersionCheckpoints(
  articleId: string,
  versionId: string,
  beforeRevisionNumber?: number,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsArticleVersionCheckpointPage>> {
  const query = beforeRevisionNumber === undefined ? "" : `?before=${beforeRevisionNumber}`;
  const result = await cmsRequest(
    `${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}/versions/${encodeURIComponent(versionId)}/checkpoints${query}`,
    { method: "GET" },
    options
  );
  if (!result.ok) return result;
  if (
    !isRecord(result.value) ||
    !Array.isArray(result.value.checkpoints) ||
    !(result.value.nextBeforeRevisionNumber === null || isNonnegativeInteger(result.value.nextBeforeRevisionNumber))
  ) return invalidResponse(result.status);
  const checkpoints = result.value.checkpoints.map(parseCmsArticleVersionCheckpoint);
  return checkpoints.every((checkpoint): checkpoint is CmsArticleVersionCheckpoint => checkpoint !== null)
    ? {
        ok: true,
        value: {
          checkpoints,
          nextBeforeRevisionNumber: result.value.nextBeforeRevisionNumber
        }
      }
    : invalidResponse(result.status);
}

export async function fetchCmsMembers(
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsMember[]>> {
  const result = await cmsRequest(CMS_MEMBERS_PATH, { method: "GET" }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.members)) {
    return invalidResponse(result.status);
  }
  const members = result.value.members.map(parseCmsMember);
  return members.every((member): member is CmsMember => member !== null)
    ? { ok: true, value: members }
    : invalidResponse(result.status);
}

export async function upsertCmsMember(
  member: { active: boolean; email: string; role: CmsRole },
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsMember[]>> {
  const result = await cmsRequest(CMS_MEMBERS_PATH, {
    body: JSON.stringify(member),
    headers: { "content-type": "application/json" },
    method: "PUT"
  }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.members)) {
    return invalidResponse(result.status);
  }
  const members = result.value.members.map(parseCmsMember);
  return members.every((item): item is CmsMember => item !== null)
    ? { ok: true, value: members }
    : invalidResponse(result.status);
}

export async function createCmsArticle(
  content: CmsArticleContent,
  options: CmsRequestOptions = {},
  revisionContext?: Pick<CmsRevisionWriteContext, "editSessionId">
): Promise<CmsClientResult<CmsArticleDetail>> {
  const result = await cmsRequest(CMS_ARTICLES_PATH, {
    body: JSON.stringify({ ...content, ...revisionContext }),
    headers: { "content-type": "application/json" },
    method: "POST"
  }, options);
  return articleResult(result);
}

export async function updateCmsArticle(
  articleId: string,
  expectedVersion: number,
  content: CmsArticleContent,
  options: CmsRequestOptions = {},
  revisionContext?: CmsRevisionWriteContext
): Promise<CmsClientResult<CmsArticleDetail>> {
  const result = await cmsRequest(`${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}`, {
    body: JSON.stringify({ ...content, ...revisionContext, expectedVersion }),
    headers: {
      "content-type": "application/json",
      "if-match": cmsEtag(expectedVersion)
    },
    method: "PUT"
  }, options);
  return articleResult(result);
}

export async function uploadCmsAsset(
  file: File,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsAsset>> {
  const form = new FormData();
  form.set("file", file);
  const result = await cmsRequest(CMS_ASSETS_PATH, {
    body: form,
    method: "POST"
  }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !isRecord(result.value.asset)) {
    return invalidResponse(result.status);
  }
  const asset = parseCmsAsset(result.value.asset);
  return asset ? { ok: true, value: asset } : invalidResponse(result.status);
}

export async function fetchCmsAssets(
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsAsset[]>> {
  const result = await cmsRequest(CMS_ASSETS_PATH, { method: "GET" }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.assets)) {
    return invalidResponse(result.status);
  }
  const assets = result.value.assets.map(parseCmsAsset);
  return assets.every((asset): asset is CmsAsset => asset !== null)
    ? { ok: true, value: assets }
    : invalidResponse(result.status);
}

export async function updateCmsAsset(
  assetId: string,
  input: { alt: string; status: CmsAssetStatus; tags: string[] },
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsAsset>> {
  const result = await cmsRequest(`${CMS_ASSETS_PATH}/${encodeURIComponent(assetId)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH"
  }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !isRecord(result.value.asset)) {
    return invalidResponse(result.status);
  }
  const asset = parseCmsAsset(result.value.asset);
  return asset ? { ok: true, value: asset } : invalidResponse(result.status);
}

export async function runCmsArticleAction(
  articleId: string,
  expectedVersion: number,
  action: CmsArticleAction,
  input: { note?: string; visibility?: CmsVisibility } = {},
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsArticleDetail>> {
  const result = await cmsRequest(
    `${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}/actions`,
    {
      body: JSON.stringify({ action, expectedVersion, ...input }),
      headers: {
        "content-type": "application/json",
        "if-match": cmsEtag(expectedVersion)
      },
      method: "POST"
    },
    options
  );
  return articleResult(result);
}

type RawCmsResult =
  | { ok: true; status: number; value: unknown }
  | { error: CmsClientError; ok: false };

async function cmsRequest(
  path: string,
  init: RequestInit,
  options: CmsRequestOptions
): Promise<RawCmsResult> {
  try {
    const response = await (options.fetchFn ?? fetch)(path, {
      ...init,
      signal: options.signal
    });
    const mediaType = response.headers.get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== "application/json") return invalidResponse(response.status);

    let value: unknown;
    try {
      value = await response.json() as unknown;
    } catch {
      return invalidResponse(response.status);
    }
    if (!response.ok) return { error: parseCmsError(value, response.status), ok: false };
    return { ok: true, status: response.status, value };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        error: {
          code: "request_aborted",
          message: "CMSへの通信を中止しました。",
          retryable: true,
          status: 0
        },
        ok: false
      };
    }
    return {
      error: {
        code: "network_error",
        message: "CMSに接続できません。通信状態を確認してください。",
        retryable: true,
        status: 0
      },
      ok: false
    };
  }
}

function articleResult(result: RawCmsResult): CmsClientResult<CmsArticleDetail> {
  if (!result.ok) return result;
  if (!isRecord(result.value)) return invalidResponse(result.status);
  const article = parseCmsArticleDetail(result.value.article);
  return article
    ? { ok: true, value: article }
    : invalidResponse(result.status);
}

function parseCmsSession(value: unknown): CmsSession | null {
  if (!isRecord(value) || !isRecord(value.identity) || !isRecord(value.capabilities)) return null;
  const role = cmsRoleSchema.safeParse(value.identity.role);
  const capabilities = value.capabilities;
  if (
    !role.success ||
    !isString(value.identity.email) ||
    !isString(value.identity.subject) ||
    !(value.passwordLoginReadyAt === null || isString(value.passwordLoginReadyAt)) ||
    !isBoolean(capabilities.canApprove) ||
    !isBoolean(capabilities.canEdit) ||
    !isBoolean(capabilities.canManageMembers) ||
    !isBoolean(capabilities.canPublish)
  ) return null;
  return {
    capabilities: {
      canApprove: capabilities.canApprove,
      canEdit: capabilities.canEdit,
      canManageMembers: capabilities.canManageMembers,
      canPublish: capabilities.canPublish
    },
    identity: {
      email: value.identity.email,
      role: role.data,
      subject: value.identity.subject
    },
    passwordLoginReadyAt: value.passwordLoginReadyAt
  };
}

function parseCmsArticleSummary(value: unknown): CmsArticleSummary | null {
  if (!isRecord(value)) return null;
  const publicationStatus = cmsPublicationStatusSchema.safeParse(value.publicationStatus);
  const reviewStatus = cmsReviewStatusSchema.safeParse(value.reviewStatus);
  const visibility = cmsVisibilitySchema.safeParse(value.visibility);
  if (
    !publicationStatus.success ||
    !reviewStatus.success ||
    !visibility.success ||
    !isString(value.id) ||
    !isNonnegativeInteger(value.lockVersion) ||
    !isNonnegativeInteger(value.revisionNumber) ||
    !isString(value.slug) ||
    !isString(value.title) ||
    !isString(value.updatedAt) ||
    !isString(value.updatedByEmail)
  ) return null;
  return {
    id: value.id,
    lockVersion: value.lockVersion,
    publicationStatus: publicationStatus.data,
    revisionNumber: value.revisionNumber,
    reviewStatus: reviewStatus.data,
    slug: value.slug,
    title: value.title,
    updatedAt: value.updatedAt,
    updatedByEmail: value.updatedByEmail,
    visibility: visibility.data
  };
}

function parseCmsArticleDetail(value: unknown): CmsArticleDetail | null {
  const summary = parseCmsArticleSummary(value);
  if (!summary || !isRecord(value) || !isRecord(value.currentRevision)) return null;
  const revision = value.currentRevision;
  const frontmatter = cmsDraftFrontmatterSchema.safeParse(revision.frontmatter);
  const publishedVisibility = value.publishedVisibility === null
    ? { data: null, success: true } as const
    : cmsVisibilitySchema.safeParse(value.publishedVisibility);
  if (
    !frontmatter.success ||
    !publishedVisibility.success ||
    !isString(revision.createdAt) ||
    !isString(revision.createdByEmail) ||
    !isString(revision.id) ||
    !isString(revision.markdown) ||
    !isNonnegativeInteger(revision.number) ||
    !(value.publishedRevisionNumber === null || isNonnegativeInteger(value.publishedRevisionNumber)) ||
    !(value.publishedSlug === null || isString(value.publishedSlug)) ||
    !(value.reviewNote === null || isString(value.reviewNote))
  ) return null;
  return {
    ...summary,
    currentRevision: {
      createdAt: revision.createdAt,
      createdByEmail: revision.createdByEmail,
      frontmatter: frontmatter.data,
      id: revision.id,
      markdown: revision.markdown,
      number: revision.number
    },
    publishedRevisionNumber: value.publishedRevisionNumber,
    publishedSlug: value.publishedSlug,
    publishedVisibility: publishedVisibility.data,
    reviewNote: value.reviewNote
  };
}

function parseCmsArticleVersionSummary(value: unknown): CmsArticleVersionSummary | null {
  if (!isRecord(value)) return null;
  const reason = cmsRevisionSaveReasonSchema.safeParse(value.reason);
  if (
    !reason.success ||
    !isNonnegativeInteger(value.checkpointCount) ||
    !isString(value.createdAt) ||
    !isString(value.createdByEmail) ||
    !isNonnegativeInteger(value.firstRevisionNumber) ||
    !isString(value.id) ||
    !isBoolean(value.isApproved) ||
    !isBoolean(value.isCurrent) ||
    !isBoolean(value.isPublished) ||
    !isString(value.latestRevisionId) ||
    !isNonnegativeInteger(value.latestRevisionNumber) ||
    !(value.sourceRevisionId === null || isString(value.sourceRevisionId)) ||
    !isString(value.updatedAt)
  ) return null;
  return {
    checkpointCount: value.checkpointCount,
    createdAt: value.createdAt,
    createdByEmail: value.createdByEmail,
    firstRevisionNumber: value.firstRevisionNumber,
    id: value.id,
    isApproved: value.isApproved,
    isCurrent: value.isCurrent,
    isPublished: value.isPublished,
    latestRevisionId: value.latestRevisionId,
    latestRevisionNumber: value.latestRevisionNumber,
    reason: reason.data,
    sourceRevisionId: value.sourceRevisionId,
    updatedAt: value.updatedAt
  };
}

function parseCmsArticleVersionDetail(value: unknown): CmsArticleVersionDetail | null {
  if (!isRecord(value) || !isRecord(value.revision)) return null;
  const reason = cmsRevisionSaveReasonSchema.safeParse(value.reason);
  const frontmatter = cmsDraftFrontmatterSchema.safeParse(value.revision.frontmatter);
  const visibility = value.visibility === null
    ? { data: null, success: true } as const
    : cmsVisibilitySchema.safeParse(value.visibility);
  if (
    !reason.success ||
    !frontmatter.success ||
    !visibility.success ||
    !isBoolean(value.isApproved) ||
    !isBoolean(value.isCurrent) ||
    !isBoolean(value.isPublished) ||
    !(value.sourceRevisionId === null || isString(value.sourceRevisionId)) ||
    !isString(value.revision.createdAt) ||
    !isString(value.revision.createdByEmail) ||
    !isString(value.revision.id) ||
    !isString(value.revision.markdown) ||
    !isNonnegativeInteger(value.revision.number)
  ) return null;
  return {
    isApproved: value.isApproved,
    isCurrent: value.isCurrent,
    isPublished: value.isPublished,
    reason: reason.data,
    revision: {
      createdAt: value.revision.createdAt,
      createdByEmail: value.revision.createdByEmail,
      frontmatter: frontmatter.data,
      id: value.revision.id,
      markdown: value.revision.markdown,
      number: value.revision.number
    },
    sourceRevisionId: value.sourceRevisionId,
    visibility: visibility.data
  };
}

function parseCmsArticleVersionCheckpoint(value: unknown): CmsArticleVersionCheckpoint | null {
  if (!isRecord(value)) return null;
  const reason = cmsRevisionSaveReasonSchema.safeParse(value.reason);
  if (
    !reason.success ||
    !isString(value.createdAt) ||
    !isString(value.createdByEmail) ||
    !isString(value.id) ||
    !isBoolean(value.isApproved) ||
    !isBoolean(value.isCurrent) ||
    !isBoolean(value.isPublished) ||
    !isNonnegativeInteger(value.number)
  ) return null;
  return {
    createdAt: value.createdAt,
    createdByEmail: value.createdByEmail,
    id: value.id,
    isApproved: value.isApproved,
    isCurrent: value.isCurrent,
    isPublished: value.isPublished,
    number: value.number,
    reason: reason.data
  };
}

function parseCmsMember(value: unknown): CmsMember | null {
  if (!isRecord(value)) return null;
  const role = cmsRoleSchema.safeParse(value.role);
  if (
    !role.success ||
    !isBoolean(value.active) ||
    !isString(value.email) ||
    !(value.passwordLoginReadyAt === null || isString(value.passwordLoginReadyAt)) ||
    !isBoolean(value.provisioned) ||
    !isString(value.updatedAt)
  ) return null;
  return {
    active: value.active,
    email: value.email,
    passwordLoginReadyAt: value.passwordLoginReadyAt,
    provisioned: value.provisioned,
    role: role.data,
    updatedAt: value.updatedAt
  };
}

function parseCmsAsset(value: unknown): CmsAsset | null {
  if (!isRecord(value)) return null;
  const status = cmsAssetStatusSchema.safeParse(value.status);
  if (
    !status.success ||
    !isString(value.alt) ||
    !isNonnegativeInteger(value.byteSize) ||
    !isString(value.contentType) ||
    !isString(value.createdAt) ||
    !isString(value.createdByEmail) ||
    !(value.height === null || isNonnegativeInteger(value.height)) ||
    !isString(value.id) ||
    !isString(value.markdownUrl) ||
    !isString(value.originalName) ||
    !isString(value.previewUrl) ||
    !isNonnegativeInteger(value.referenceCount) ||
    !Array.isArray(value.tags) ||
    !value.tags.every(isString) ||
    !isString(value.updatedAt) ||
    !(value.width === null || isNonnegativeInteger(value.width))
  ) return null;
  return {
    alt: value.alt,
    byteSize: value.byteSize,
    contentType: value.contentType,
    createdAt: value.createdAt,
    createdByEmail: value.createdByEmail,
    height: value.height,
    id: value.id,
    markdownUrl: value.markdownUrl,
    originalName: value.originalName,
    previewUrl: value.previewUrl,
    referenceCount: value.referenceCount,
    status: status.data,
    tags: value.tags,
    updatedAt: value.updatedAt,
    width: value.width
  };
}

function parseCmsError(value: unknown, status: number): CmsClientError {
  if (!isRecord(value) || !isRecord(value.error)) return invalidResponse(status).error;
  const raw = value.error;
  const issues = Array.isArray(raw.issues)
    ? raw.issues.flatMap((issue): CmsEditorialIssue[] => {
        if (!isRecord(issue) || !isString(issue.message) || !Array.isArray(issue.path)) return [];
        const path = issue.path.filter((part): part is string | number =>
          typeof part === "string" || typeof part === "number"
        );
        return path.length === issue.path.length ? [{ message: issue.message, path }] : [];
      })
    : undefined;
  return {
    code: isString(raw.code) ? raw.code : "cms_request_failed",
    ...(issues && issues.length > 0 ? { issues } : {}),
    message: isString(raw.message) ? raw.message : "CMSの処理を完了できませんでした。",
    retryable: isBoolean(raw.retryable) ? raw.retryable : false,
    status
  };
}

function invalidResponse(status: number): { error: CmsClientError; ok: false } {
  return {
    error: {
      code: "invalid_response",
      message: "CMSから安全に読み取れる応答を受け取れませんでした。",
      retryable: true,
      status
    },
    ok: false
  };
}

function cmsEtag(version: number): string {
  return `"cms-v${version}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
