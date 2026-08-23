import {
  cmsDraftFrontmatterSchema,
  cmsAssetStatusSchema,
  cmsPublicationStatusSchema,
  cmsReviewStatusSchema,
  cmsRoleSchema,
  cmsRevisionSaveReasonSchema,
  cmsReviewCommentTargetSchema,
  cmsReviewCommentStatusSchema,
  cmsVisibilitySchema,
  type CmsArticleAction,
  type CmsAnalyticsArticleMetric,
  type CmsAnalyticsCounts,
  type CmsAnalyticsDailyMetric,
  type CmsAnalyticsDays,
  type CmsAnalyticsHealth,
  type CmsAnalyticsQualityCheck,
  type CmsAnalyticsRebuildResult,
  type CmsAnalyticsSourceMetric,
  type CmsAnalyticsSummary,
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
  type CmsReviewComment,
  type CmsReviewCommentAction,
  type CmsReviewCommentAnchor,
  type CmsReviewCommentTarget,
  type CmsSession,
  type CmsSeries,
  type CmsSeriesArticle,
  type CmsSeriesVersion,
  type CmsVisibility
} from "@noema/cms";
import type { ArticleFrontmatter } from "@noema/content";

const CMS_ARTICLES_PATH = "/api/cms/articles";
const CMS_SERIES_PATH = "/api/cms/series";
const CMS_MEMBERS_PATH = "/api/cms/members";
const CMS_SESSION_PATH = "/api/cms/session";
const CMS_ASSETS_PATH = "/api/cms/assets";
const CMS_ANALYTICS_PATH = "/api/cms/analytics/summary";
const CMS_ANALYTICS_REBUILD_PATH = "/api/cms/analytics/rebuild";
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

export interface CmsSeriesContent {
  articleIds: string[];
  description: string;
  slug: string;
  title: string;
}

export async function fetchCmsSeries(
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsSeries[]>> {
  const result = await cmsRequest(CMS_SERIES_PATH, { method: "GET" }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.series)) return invalidResponse(result.status);
  const series = result.value.series.map(parseCmsSeries);
  return series.every((item): item is CmsSeries => item !== null)
    ? { ok: true, value: series }
    : invalidResponse(result.status);
}

export async function createCmsSeriesRecord(
  content: CmsSeriesContent,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsSeries>> {
  const result = await cmsRequest(CMS_SERIES_PATH, {
    body: JSON.stringify(content),
    headers: { "content-type": "application/json" },
    method: "POST"
  }, options);
  return seriesResult(result);
}

export async function updateCmsSeriesRecord(
  seriesId: string,
  expectedVersion: number,
  content: CmsSeriesContent,
  restoredFromRevisionId?: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsSeries>> {
  const result = await cmsRequest(`${CMS_SERIES_PATH}/${encodeURIComponent(seriesId)}`, {
    body: JSON.stringify({ ...content, expectedVersion, restoredFromRevisionId }),
    headers: {
      "content-type": "application/json",
      "if-match": cmsEtag(expectedVersion)
    },
    method: "PUT"
  }, options);
  return seriesResult(result);
}

export async function fetchCmsSeriesVersions(
  seriesId: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsSeriesVersion[]>> {
  const result = await cmsRequest(
    `${CMS_SERIES_PATH}/${encodeURIComponent(seriesId)}/versions`,
    { method: "GET" },
    options
  );
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.versions)) return invalidResponse(result.status);
  const versions = result.value.versions.map(parseCmsSeriesVersion);
  return versions.every((item): item is CmsSeriesVersion => item !== null)
    ? { ok: true, value: versions }
    : invalidResponse(result.status);
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

export async function fetchCmsAnalyticsSummary(
  days: CmsAnalyticsDays,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsAnalyticsSummary>> {
  const result = await cmsRequest(`${CMS_ANALYTICS_PATH}?days=${days}`, { method: "GET" }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value)) return invalidResponse(result.status);
  const summary = parseCmsAnalyticsSummary(result.value.summary);
  return summary ? { ok: true, value: summary } : invalidResponse(result.status);
}

export async function rebuildCmsAnalyticsMart(
  from: string,
  through: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsAnalyticsRebuildResult>> {
  const result = await cmsRequest(CMS_ANALYTICS_REBUILD_PATH, {
    body: JSON.stringify({ from, through }),
    headers: { "content-type": "application/json" },
    method: "POST"
  }, options);
  if (!result.ok) return result;
  if (!isRecord(result.value) || !isRecord(result.value.rebuild)) return invalidResponse(result.status);
  const rebuild = result.value.rebuild;
  if (
    !isString(rebuild.completedAt) ||
    !isString(rebuild.from) ||
    !isString(rebuild.runId) ||
    !isNonnegativeInteger(rebuild.sourceEventCount) ||
    !isString(rebuild.through)
  ) return invalidResponse(result.status);
  return {
    ok: true,
    value: {
      completedAt: rebuild.completedAt,
      from: rebuild.from,
      runId: rebuild.runId,
      sourceEventCount: rebuild.sourceEventCount,
      through: rebuild.through
    }
  };
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

export async function deleteCmsAsset(
  assetId: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<null>> {
  const result = await cmsRequest(`${CMS_ASSETS_PATH}/${encodeURIComponent(assetId)}`, {
    method: "DELETE"
  }, options);
  return result.ok ? { ok: true, value: null } : result;
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

export async function fetchCmsReviewComments(
  articleId: string,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsReviewComment[]>> {
  const result = await cmsRequest(
    `${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}/comments`,
    { method: "GET" },
    options
  );
  if (!result.ok) return result;
  if (!isRecord(result.value) || !Array.isArray(result.value.comments)) {
    return invalidResponse(result.status);
  }
  const comments = result.value.comments.map(parseCmsReviewComment);
  return comments.every((comment): comment is CmsReviewComment => comment !== null)
    ? { ok: true, value: comments }
    : invalidResponse(result.status);
}

export async function createCmsReviewCommentRecord(
  articleId: string,
  input: { anchor?: CmsReviewCommentAnchor; body: string; target: CmsReviewCommentTarget },
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsReviewComment>> {
  const result = await cmsRequest(
    `${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}/comments`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST"
    },
    options
  );
  if (!result.ok) return result;
  if (!isRecord(result.value)) return invalidResponse(result.status);
  const comment = parseCmsReviewComment(result.value.comment);
  return comment ? { ok: true, value: comment } : invalidResponse(result.status);
}

export async function updateCmsReviewCommentStatusRecord(
  articleId: string,
  commentId: string,
  action: CmsReviewCommentAction,
  options: CmsRequestOptions = {}
): Promise<CmsClientResult<CmsReviewComment>> {
  const result = await cmsRequest(
    `${CMS_ARTICLES_PATH}/${encodeURIComponent(articleId)}/comments/${encodeURIComponent(commentId)}`,
    {
      body: JSON.stringify({ action }),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    },
    options
  );
  if (!result.ok) return result;
  if (!isRecord(result.value)) return invalidResponse(result.status);
  const comment = parseCmsReviewComment(result.value.comment);
  return comment ? { ok: true, value: comment } : invalidResponse(result.status);
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

function seriesResult(result: RawCmsResult): CmsClientResult<CmsSeries> {
  if (!result.ok) return result;
  if (!isRecord(result.value)) return invalidResponse(result.status);
  const series = parseCmsSeries(result.value.series);
  return series ? { ok: true, value: series } : invalidResponse(result.status);
}

function parseCmsSeries(value: unknown): CmsSeries | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.articleIds) ||
    !value.articleIds.every(isString) ||
    !Array.isArray(value.articles) ||
    !isString(value.createdAt) ||
    !isString(value.description) ||
    !isString(value.id) ||
    !isNonnegativeInteger(value.lockVersion) ||
    !isNonnegativeInteger(value.revisionNumber) ||
    !isString(value.slug) ||
    !isString(value.title) ||
    !isString(value.updatedAt) ||
    !isString(value.updatedByEmail)
  ) return null;
  const articles = value.articles.map(parseCmsSeriesArticle);
  if (!articles.every((item): item is CmsSeriesArticle => item !== null)) return null;
  return {
    articleIds: value.articleIds,
    articles,
    createdAt: value.createdAt,
    description: value.description,
    id: value.id,
    lockVersion: value.lockVersion,
    revisionNumber: value.revisionNumber,
    slug: value.slug,
    title: value.title,
    updatedAt: value.updatedAt,
    updatedByEmail: value.updatedByEmail
  };
}

function parseCmsSeriesArticle(value: unknown): CmsSeriesArticle | null {
  if (!isRecord(value)) return null;
  const publicationStatus = cmsPublicationStatusSchema.safeParse(value.publicationStatus);
  const reviewStatus = cmsReviewStatusSchema.safeParse(value.reviewStatus);
  const visibility = cmsVisibilitySchema.safeParse(value.visibility);
  if (
    !publicationStatus.success ||
    !reviewStatus.success ||
    !visibility.success ||
    !isString(value.id) ||
    !isString(value.slug) ||
    !isString(value.title)
  ) return null;
  return {
    id: value.id,
    publicationStatus: publicationStatus.data,
    reviewStatus: reviewStatus.data,
    slug: value.slug,
    title: value.title,
    visibility: visibility.data
  };
}

function parseCmsSeriesVersion(value: unknown): CmsSeriesVersion | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.articleIds) ||
    !value.articleIds.every(isString) ||
    !isString(value.createdAt) ||
    !isString(value.createdByEmail) ||
    !isString(value.description) ||
    !isString(value.id) ||
    !isBoolean(value.isCurrent) ||
    !isNonnegativeInteger(value.number) ||
    !(value.restoredFromRevisionId === null || isString(value.restoredFromRevisionId)) ||
    !isString(value.slug) ||
    !isString(value.title)
  ) return null;
  return {
    articleIds: value.articleIds,
    createdAt: value.createdAt,
    createdByEmail: value.createdByEmail,
    description: value.description,
    id: value.id,
    isCurrent: value.isCurrent,
    number: value.number,
    restoredFromRevisionId: value.restoredFromRevisionId,
    slug: value.slug,
    title: value.title
  };
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
    !isBoolean(capabilities.canComment) ||
    !isBoolean(capabilities.canEdit) ||
    !isBoolean(capabilities.canManageMembers) ||
    !isBoolean(capabilities.canPublish)
  ) return null;
  return {
    capabilities: {
      canApprove: capabilities.canApprove,
      canComment: capabilities.canComment,
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

function parseCmsReviewComment(value: unknown): CmsReviewComment | null {
  if (!isRecord(value)) return null;
  const target = cmsReviewCommentTargetSchema.safeParse(value.target);
  const status = cmsReviewCommentStatusSchema.safeParse(value.status);
  const anchor = value.anchor === null
    ? null
    : isRecord(value.anchor) &&
        isNonnegativeInteger(value.anchor.startOffset) &&
        isNonnegativeInteger(value.anchor.endOffset) &&
        isString(value.anchor.quote) &&
        isString(value.anchor.prefix) &&
        isString(value.anchor.suffix)
      ? {
          endOffset: value.anchor.endOffset,
          prefix: value.anchor.prefix,
          quote: value.anchor.quote,
          startOffset: value.anchor.startOffset,
          suffix: value.anchor.suffix
        }
      : undefined;
  if (
    !target.success ||
    !status.success ||
    anchor === undefined ||
    !isString(value.articleId) ||
    !isString(value.authorEmail) ||
    !isString(value.body) ||
    !isString(value.createdAt) ||
    !isString(value.id) ||
    !isString(value.revisionId) ||
    !isNonnegativeInteger(value.revisionNumber) ||
    !(value.resolvedAt === null || isString(value.resolvedAt)) ||
    !(value.resolvedByEmail === null || isString(value.resolvedByEmail)) ||
    !(value.resolvedRevisionId === null || isString(value.resolvedRevisionId)) ||
    !(value.resolvedRevisionNumber === null || isNonnegativeInteger(value.resolvedRevisionNumber))
  ) return null;
  return {
    anchor,
    articleId: value.articleId,
    authorEmail: value.authorEmail,
    body: value.body,
    createdAt: value.createdAt,
    id: value.id,
    resolvedAt: value.resolvedAt,
    resolvedByEmail: value.resolvedByEmail,
    resolvedRevisionId: value.resolvedRevisionId,
    resolvedRevisionNumber: value.resolvedRevisionNumber,
    revisionId: value.revisionId,
    revisionNumber: value.revisionNumber,
    status: status.data,
    target: target.data
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

function parseAnalyticsCounts(value: unknown): CmsAnalyticsCounts | null {
  if (!isRecord(value)) return null;
  const {
    article50,
    articleEnd,
    assistantError,
    assistantOpen,
    assistantSuccess,
    landing,
    navigationClick,
    relatedClick,
    seriesNext,
    share
  } = value;
  if (
    !isNonnegativeInteger(article50) ||
    !isNonnegativeInteger(articleEnd) ||
    !isNonnegativeInteger(assistantError) ||
    !isNonnegativeInteger(assistantOpen) ||
    !isNonnegativeInteger(assistantSuccess) ||
    !isNonnegativeInteger(landing) ||
    !isNonnegativeInteger(navigationClick) ||
    !isNonnegativeInteger(relatedClick) ||
    !isNonnegativeInteger(seriesNext) ||
    !isNonnegativeInteger(share)
  ) return null;
  return {
    article50,
    articleEnd,
    assistantError,
    assistantOpen,
    assistantSuccess,
    landing,
    navigationClick,
    relatedClick,
    seriesNext,
    share
  };
}

function isNullableRate(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function parseCmsAnalyticsArticle(value: unknown): CmsAnalyticsArticleMetric | null {
  const counts = parseAnalyticsCounts(value);
  if (
    !counts ||
    !isRecord(value) ||
    !isString(value.articleId) ||
    !isNullableRate(value.article50Rate) ||
    !isNullableRate(value.assistantSuccessRate) ||
    !isNullableRate(value.assistantUseRate) ||
    !isNullableRate(value.onwardRate) ||
    !isNullableRate(value.qualifiedReadRate) ||
    !isNonnegativeInteger(value.revisionNumber) ||
    !isString(value.slug) ||
    !isString(value.title)
  ) return null;
  return {
    ...counts,
    articleId: value.articleId,
    article50Rate: value.article50Rate,
    assistantSuccessRate: value.assistantSuccessRate,
    assistantUseRate: value.assistantUseRate,
    onwardRate: value.onwardRate,
    qualifiedReadRate: value.qualifiedReadRate,
    revisionNumber: value.revisionNumber,
    slug: value.slug,
    title: value.title
  };
}

function parseCmsAnalyticsSource(value: unknown): CmsAnalyticsSourceMetric | null {
  if (
    !isRecord(value) ||
    !isNonnegativeInteger(value.article50) ||
    !isNullableRate(value.article50Rate) ||
    !isNonnegativeInteger(value.articleEnd) ||
    !isString(value.campaign) ||
    !isString(value.content) ||
    !isNonnegativeInteger(value.landing) ||
    !isString(value.medium) ||
    !isNonnegativeInteger(value.navigationClick) ||
    !isNullableRate(value.qualifiedReadRate) ||
    !isString(value.referrerHost) ||
    !isString(value.source)
  ) return null;
  return {
    article50: value.article50,
    article50Rate: value.article50Rate,
    articleEnd: value.articleEnd,
    campaign: value.campaign,
    content: value.content,
    landing: value.landing,
    medium: value.medium,
    navigationClick: value.navigationClick,
    qualifiedReadRate: value.qualifiedReadRate,
    referrerHost: value.referrerHost,
    source: value.source
  };
}

function parseCmsAnalyticsDaily(value: unknown): CmsAnalyticsDailyMetric | null {
  if (
    !isRecord(value) ||
    !isNonnegativeInteger(value.articleEnd) ||
    !isString(value.date) ||
    !isNonnegativeInteger(value.landing) ||
    !isNonnegativeInteger(value.navigationClick)
  ) return null;
  return {
    articleEnd: value.articleEnd,
    date: value.date,
    landing: value.landing,
    navigationClick: value.navigationClick
  };
}

function parseCmsAnalyticsQualityCheck(value: unknown): CmsAnalyticsQualityCheck | null {
  if (
    !isRecord(value) ||
    !(value.id === "freshness" || value.id === "duplicate_rate" || value.id === "contract_conformance" || value.id === "revision_lineage" || value.id === "mart_reconciliation" || value.id === "funnel_consistency") ||
    !isString(value.label) ||
    !isString(value.detail) ||
    !(value.status === "pass" || value.status === "warn" || value.status === "not_evaluated")
  ) return null;
  return {
    detail: value.detail,
    id: value.id,
    label: value.label,
    status: value.status
  };
}

function parseCmsAnalyticsHealth(value: unknown): CmsAnalyticsHealth | null {
  if (
    !isRecord(value) ||
    !isNonnegativeInteger(value.acceptedEvents) ||
    !Array.isArray(value.checks) ||
    !isNonnegativeInteger(value.duplicateEvents) ||
    value.eventContractVersion !== 1 ||
    !isString(value.generatedAt) ||
    !(value.latestEventReceivedAt === null || isString(value.latestEventReceivedAt)) ||
    value.metricCatalogVersion !== "2026-08-23" ||
    !isString(value.rawCoverageFrom) ||
    !isString(value.reprocessableFrom) ||
    !isRecord(value.retention) ||
    value.retention.eventFactsDays !== 35 ||
    value.retention.reportingMartDays !== 400 ||
    !Array.isArray(value.sources) ||
    !(value.status === "healthy" || value.status === "attention" || value.status === "collecting" || value.status === "no_data")
  ) return null;
  const checks = value.checks.map(parseCmsAnalyticsQualityCheck);
  if (!checks.every((check): check is CmsAnalyticsQualityCheck => check !== null)) return null;
  const sources: CmsAnalyticsHealth["sources"] = [];
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      !(source.id === "noema_reader_events" || source.id === "cloudflare_web_analytics" || source.id === "google_search_console") ||
      !isString(source.role) ||
      !(source.status === "active" || source.status === "not_configured")
    ) return null;
    sources.push({ id: source.id, role: source.role, status: source.status });
  }
  return {
    acceptedEvents: value.acceptedEvents,
    checks,
    duplicateEvents: value.duplicateEvents,
    eventContractVersion: 1,
    generatedAt: value.generatedAt,
    latestEventReceivedAt: value.latestEventReceivedAt,
    metricCatalogVersion: "2026-08-23",
    rawCoverageFrom: value.rawCoverageFrom,
    reprocessableFrom: value.reprocessableFrom,
    retention: { eventFactsDays: 35, reportingMartDays: 400 },
    sources,
    status: value.status
  };
}

function parseCmsAnalyticsSummary(value: unknown): CmsAnalyticsSummary | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.articles) ||
    !Array.isArray(value.daily) ||
    !isRecord(value.health) ||
    !isRecord(value.range) ||
    !Array.isArray(value.sources) ||
    !isRecord(value.totals)
  ) return null;
  const articles = value.articles.map(parseCmsAnalyticsArticle);
  const daily = value.daily.map(parseCmsAnalyticsDaily);
  const sources = value.sources.map(parseCmsAnalyticsSource);
  const health = parseCmsAnalyticsHealth(value.health);
  const counts = parseAnalyticsCounts(value.totals);
  const days = value.range.days;
  if (
    !articles.every((item): item is CmsAnalyticsArticleMetric => item !== null) ||
    !daily.every((item): item is CmsAnalyticsDailyMetric => item !== null) ||
    !sources.every((item): item is CmsAnalyticsSourceMetric => item !== null) ||
    !health ||
    !counts ||
    !(days === 7 || days === 30 || days === 90) ||
    !isString(value.range.from) ||
    !isString(value.range.through) ||
    !isNullableRate(value.totals.article50Rate) ||
    !isNullableRate(value.totals.assistantSuccessRate) ||
    !isNullableRate(value.totals.assistantUseRate) ||
    !isNullableRate(value.totals.onwardRate) ||
    !isNullableRate(value.totals.qualifiedReadRate)
  ) return null;
  return {
    articles,
    daily,
    health,
    range: { days, from: value.range.from, through: value.range.through },
    sources,
    totals: {
      ...counts,
      article50Rate: value.totals.article50Rate,
      assistantSuccessRate: value.totals.assistantSuccessRate,
      assistantUseRate: value.totals.assistantUseRate,
      onwardRate: value.totals.onwardRate,
      qualifiedReadRate: value.totals.qualifiedReadRate
    }
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
