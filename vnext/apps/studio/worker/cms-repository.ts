import {
  canCms,
  cmsCapabilitiesFor,
  cmsAssetMutationSchema,
  cmsAssetStatusSchema,
  cmsDraftFrontmatterSchema,
  cmsPublicationStatusSchema,
  cmsRevisionSaveReasonSchema,
  cmsReviewCommentAnchorSchema,
  cmsReviewCommentStatusSchema,
  cmsReviewCommentTargetSchema,
  cmsReviewStatusSchema,
  cmsRoleSchema,
  cmsVisibilitySchema,
  validateCmsArticleForReview,
  type CmsArticleAction,
  type CmsAsset,
  type CmsArticleDetail,
  type CmsArticleSummary,
  type CmsArticleVersionDetail,
  type CmsArticleVersionCheckpoint,
  type CmsArticleVersionCheckpointPage,
  type CmsArticleVersionSummary,
  type CmsIdentity,
  type CmsMember,
  type CmsPublicationStatus,
  type CmsReviewStatus,
  type CmsRevisionSaveReason,
  type CmsReviewComment,
  type CmsReviewCommentAction,
  type CmsReviewCommentAnchor,
  type CmsReviewCommentTarget,
  type CmsRole,
  type CmsSession,
  type CmsVisibility
} from "@noema/cms";
import {
  extractArticleHeadingSlugs,
  extractArticleLinkReferences,
  type ArticleFrontmatter,
  type ArticleLinkReference
} from "@noema/content";
import { z } from "zod";

interface MemberRow {
  active: number;
  display_name: string | null;
  email: string;
  password_login_ready_at: string | null;
  public_id: string | null;
  role: string;
  subject: string;
}

interface InvitationRow {
  active: number;
  email: string;
  role: string;
}

interface ArticleListRow {
  current_revision_number: number;
  draft_visibility: string;
  id: string;
  lock_version: number;
  publication_status: string;
  review_status: string;
  slug: string;
  title: string;
  updated_at: string;
  updated_by_email: string;
}

interface ArticleDetailRow extends ArticleListRow {
  approved_revision_id: string | null;
  created_at: string;
  created_by_subject: string;
  current_revision_created_at: string;
  current_revision_created_by_email: string;
  current_revision_created_by_subject: string;
  current_revision_editor_display_name: string | null;
  current_revision_editor_public_id: string | null;
  current_revision_id: string;
  frontmatter_json: string;
  markdown: string;
  published_at: string | null;
  published_revision_id: string | null;
  published_revision_number: number | null;
  published_slug: string | null;
  published_visibility: string | null;
  review_note: string | null;
  updated_by_subject: string;
}

interface CurrentArticleRow {
  approved_revision_id: string | null;
  current_revision_created_by_subject: string;
  current_revision_id: string;
  current_revision_number: number;
  draft_visibility: string;
  lock_version: number;
  publication_status: string;
  published_at: string | null;
  published_revision_id: string | null;
  published_slug: string | null;
  review_requested_at: string | null;
  reviewed_at: string | null;
  reviewed_by_subject: string | null;
  review_status: string;
  slug: string;
}

interface ArticleLinkTargetRow {
  current_markdown: string;
  id: string;
  publication_status: string;
  published_markdown: string | null;
  published_slug: string | null;
  resolves_to_published: number;
  slug: string;
}

interface PublishedArticleLinkSourceRow {
  article_id: string;
  markdown: string;
  published_slug: string;
}

interface ArticleVersionSummaryRow {
  checkpoint_count: number;
  created_at: string;
  created_by_email: string;
  first_revision_number: number;
  is_approved: number;
  is_current: number;
  is_published: number;
  latest_revision_id: string;
  latest_revision_number: number;
  reason: string;
  source_revision_id: string | null;
  updated_at: string;
  version_id: string;
}

interface ArticleVersionDetailRow {
  created_at: string;
  created_by_email: string;
  editor_display_name: string | null;
  editor_public_id: string | null;
  frontmatter_json: string;
  id: string;
  is_approved: number;
  is_current: number;
  is_published: number;
  markdown: string;
  reason: string;
  revision_number: number;
  source_revision_id: string | null;
  visibility: string | null;
}

interface ArticleVersionCheckpointRow {
  created_at: string;
  created_by_email: string;
  id: string;
  is_approved: number;
  is_current: number;
  is_published: number;
  reason: string;
  revision_number: number;
}

interface ReviewCommentRow {
  anchor_end: number | null;
  anchor_prefix: string | null;
  anchor_quote: string | null;
  anchor_start: number | null;
  anchor_suffix: string | null;
  article_id: string;
  author_email: string;
  body: string;
  created_at: string;
  id: string;
  resolved_at: string | null;
  resolved_by_email: string | null;
  resolved_revision_id: string | null;
  resolved_revision_number: number | null;
  revision_id: string;
  revision_number: number;
  status: string;
  target: string;
}

interface MemberListRow {
  active: number;
  display_name: string | null;
  email: string;
  password_login_ready_at: string | null;
  provisioned: number;
  role: string;
  updated_at: string;
}

interface AssetRow {
  alt: string;
  byte_size: number;
  content_type: string;
  created_at: string;
  created_by_email: string;
  height: number | null;
  id: string;
  original_name: string;
  reference_count: number;
  r2_key: string;
  status: string;
  tags_json: string;
  updated_at: string;
  width: number | null;
}

export type CmsRepositoryErrorCode =
  | "article_locked"
  | "article_not_found"
  | "asset_conflict"
  | "asset_delete_failed"
  | "asset_in_use"
  | "asset_not_found"
  | "cms_not_configured"
  | "forbidden"
  | "idempotency_conflict"
  | "invalid_article"
  | "invalid_asset"
  | "invalid_display_name"
  | "invalid_analytics_rebuild_range"
  | "invalid_series"
  | "invalid_transition"
  | "last_admin_required"
  | "member_not_registered"
  | "revision_conflict"
  | "self_approval_forbidden"
  | "series_article_conflict"
  | "series_conflict"
  | "series_not_empty"
  | "series_not_found"
  | "series_slug_conflict"
  | "slug_conflict";

export class CmsRepositoryError extends Error {
  override readonly name = "CmsRepositoryError";

  constructor(
    readonly code: CmsRepositoryErrorCode,
    message: string,
    readonly issues?: Array<{ message: string; path: Array<string | number> }>
  ) {
    super(message);
  }
}

export interface CmsArticleContentInput {
  frontmatter: ArticleFrontmatter;
  markdown: string;
  visibility: CmsVisibility;
}

export interface CmsRevisionWriteContext {
  editSessionId?: string;
  saveReason?: Exclude<CmsRevisionSaveReason, "legacy" | "created">;
  sourceRevisionId?: string;
}

export interface CmsMutationContext {
  channel?: "mcp" | "web";
  client?: string;
  tool?: string;
  idempotency?: {
    requestId: string;
    toolName:
      | "studio_approve_article"
      | "studio_create_draft"
      | "studio_request_changes"
      | "studio_request_review"
      | "studio_revoke_approval"
      | "studio_restore_article_version"
      | "studio_update_draft"
      | "studio_withdraw_review";
  };
}

interface IdempotencyRow {
  article_id: string;
  input_sha256: string;
}

interface AssetIdempotencyRow {
  asset_id: string;
  input_sha256: string;
}

type CmsAssetMcpToolName =
  | "studio_archive_asset"
  | "studio_restore_asset"
  | "studio_update_asset"
  | "studio_upload_asset";

export async function resolveCmsSession(
  db: D1Database,
  accessIdentity: { email: string; subject: string },
  bootstrapAdminEmail: string | undefined,
  now = new Date()
): Promise<CmsSession> {
  const normalizedEmail = accessIdentity.email.trim().toLowerCase();
  let member = await db.prepare(
    "SELECT subject, email, role, active, password_login_ready_at, display_name, public_id FROM cms_members WHERE subject = ?1"
  ).bind(accessIdentity.subject).first<MemberRow>();

  if (!member) {
    const timestamp = now.toISOString();
    const bootstrap = normalizeEmail(bootstrapAdminEmail) === normalizedEmail;

    if (bootstrap) {
      await db.prepare(
        `INSERT INTO cms_member_invitations
          (email, role, active, invited_by_subject, created_at, updated_at)
         VALUES (?1, 'admin', 1, ?2, ?3, ?3)
         ON CONFLICT(email) DO NOTHING`
      ).bind(normalizedEmail, accessIdentity.subject, timestamp).run();
    }

    // Make invitation validation and member creation one database operation.
    // A revoked invitation therefore cannot be consumed from a stale read, and
    // simultaneous first-load requests converge on the same member row.
    await db.prepare(
      `INSERT INTO cms_members
        (subject, email, role, active, created_at, updated_at)
       SELECT ?1, lower(email), role, 1, ?3, ?3
       FROM cms_member_invitations
       WHERE email = ?2 COLLATE NOCASE AND active = 1
       ON CONFLICT DO NOTHING`
    ).bind(accessIdentity.subject, normalizedEmail, timestamp).run();
    member = await db.prepare(
      "SELECT subject, email, role, active, password_login_ready_at, display_name, public_id FROM cms_members WHERE subject = ?1"
    ).bind(accessIdentity.subject).first<MemberRow>();
    if (!member) {
      throw new CmsRepositoryError(
        "member_not_registered",
        "このAccess identityはNoema CMSへ招待されていないか、別のAccess identityに登録されています。"
      );
    }
  }

  return sessionFromMember(member);
}

export async function resolveExistingCmsSession(
  db: D1Database,
  accessIdentity: { email: string; subject: string }
): Promise<CmsSession> {
  const member = await db.prepare(
    "SELECT subject, email, role, active, password_login_ready_at, display_name, public_id FROM cms_members WHERE subject = ?1"
  ).bind(accessIdentity.subject).first<MemberRow>();
  if (!member) {
    throw new CmsRepositoryError(
      "member_not_registered",
      "このAccess identityはNoema CMSへ登録されていません。Studioで招待を受け入れてから再試行してください。"
    );
  }

  return sessionFromMember(member);
}

function sessionFromMember(member: MemberRow): CmsSession {
  const role = parseRole(member.role);
  if (member.active !== 1 || !role || !member.public_id) {
    throw new CmsRepositoryError(
      "member_not_registered",
      "このCMSメンバーは無効です。"
    );
  }

  return {
    capabilities: cmsCapabilitiesFor(role),
    identity: {
      displayName: member.display_name,
      email: member.email,
      publicId: member.public_id,
      role,
      subject: member.subject
    },
    passwordLoginReadyAt: member.password_login_ready_at
  };
}

export async function listCmsArticles(
  db: D1Database,
  identity: CmsIdentity
): Promise<CmsArticleSummary[]> {
  requirePermission(identity.role, "view");
  const result = await db.prepare(
    `${articleListSelect()}
     ORDER BY a.updated_at DESC, a.id ASC
     LIMIT 200`
  ).all<ArticleListRow>();
  return result.results.map(parseArticleSummary);
}

export async function listCmsAssets(
  db: D1Database,
  identity: CmsIdentity
): Promise<CmsAsset[]> {
  requirePermission(identity.role, "view");
  const result = await db.prepare(
    `${assetSelect()}
     ORDER BY a.updated_at DESC, a.id ASC
     LIMIT 500`
  ).all<AssetRow>();
  return result.results.map(parseAsset);
}

export async function registerCmsAsset(
  db: D1Database,
  identity: CmsIdentity,
  input: {
    byteSize: number;
    contentType: string;
    id: string;
    originalName: string;
    r2Key: string;
    alt?: string;
    tags?: string[];
  },
  now = new Date()
): Promise<CmsAsset> {
  requirePermission(identity.role, "edit");
  const metadata = parseAssetMetadata(input.alt ?? "", input.tags ?? []);
  const timestamp = now.toISOString();
  await db.prepare(
    `INSERT INTO cms_assets (
      id, r2_key, original_name, content_type, byte_size, width, height,
      alt, tags_json, status, created_by_subject, updated_by_subject,
      created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, 'active', ?8, ?8, ?9, ?9)
    ON CONFLICT(r2_key) DO NOTHING`
  ).bind(
    input.id,
    input.r2Key,
    input.originalName.slice(0, 200),
    input.contentType,
    input.byteSize,
    metadata.alt,
    JSON.stringify(metadata.tags),
    identity.subject,
    timestamp
  ).run();
  return getCmsAssetByKey(db, input.r2Key);
}

export async function findIdempotentCmsAssetUpload(
  db: D1Database,
  identity: CmsIdentity,
  requestId: string,
  inputSha256: string
): Promise<CmsAsset | null> {
  return findIdempotentCmsAssetMutation(
    db,
    identity,
    "studio_upload_asset",
    requestId,
    inputSha256
  );
}

async function findIdempotentCmsAssetMutation(
  db: D1Database,
  identity: CmsIdentity,
  toolName: CmsAssetMcpToolName,
  requestId: string,
  inputSha256: string
): Promise<CmsAsset | null> {
  requirePermission(identity.role, "edit");
  const row = await db.prepare(
    `SELECT asset_id, input_sha256
     FROM cms_mcp_asset_idempotency
     WHERE actor_subject = ?1
       AND tool_name = ?2
       AND request_id = ?3`
  ).bind(identity.subject, toolName, requestId).first<AssetIdempotencyRow>();
  if (!row) return null;
  if (row.input_sha256 !== inputSha256) throw idempotencyConflict();
  return getCmsAsset(db, row.asset_id);
}

export async function registerIdempotentCmsAssetUpload(
  db: D1Database,
  identity: CmsIdentity,
  input: {
    alt: string;
    byteSize: number;
    contentType: string;
    id: string;
    inputSha256: string;
    originalName: string;
    r2Key: string;
    tags: string[];
  },
  requestId: string,
  client: string | undefined,
  now = new Date()
): Promise<{ asset: CmsAsset; created: boolean }> {
  requirePermission(identity.role, "edit");
  const replay = await findIdempotentCmsAssetUpload(
    db,
    identity,
    requestId,
    input.inputSha256
  );
  if (replay) return { asset: replay, created: false };

  const metadata = parseAssetMetadata(input.alt, input.tags);
  if (!metadata.alt) {
    throw new CmsRepositoryError("invalid_asset", "画像の説明を入力してください。");
  }
  const timestamp = now.toISOString();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO cms_assets (
          id, r2_key, original_name, content_type, byte_size, width, height,
          alt, tags_json, status, created_by_subject, updated_by_subject,
          created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, ?6, ?7, 'active', ?8, ?8, ?9, ?9)`
      ).bind(
        input.id,
        input.r2Key,
        input.originalName.slice(0, 200),
        input.contentType,
        input.byteSize,
        metadata.alt,
        JSON.stringify(metadata.tags),
        identity.subject,
        timestamp
      ),
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         VALUES (?1, NULL, ?2, 'asset.uploaded', ?3, ?4)`
      ).bind(
        crypto.randomUUID(),
        identity.subject,
        JSON.stringify({
          assetId: input.id,
          byteSize: input.byteSize,
          channel: "mcp",
          ...(client ? { client: client.slice(0, 200) } : {}),
          contentType: input.contentType,
          originalName: input.originalName.slice(0, 200),
          requestId,
          tool: "studio_upload_asset"
        }),
        timestamp
      ),
      db.prepare(
        `INSERT INTO cms_mcp_asset_idempotency
          (actor_subject, tool_name, request_id, input_sha256, asset_id, created_at)
         VALUES (?1, 'studio_upload_asset', ?2, ?3, ?4, ?5)`
      ).bind(identity.subject, requestId, input.inputSha256, input.id, timestamp)
    ]);
  } catch (error) {
    if (isAssetIdempotencyConstraint(error)) {
      const concurrentReplay = await findIdempotentCmsAssetUpload(
        db,
        identity,
        requestId,
        input.inputSha256
      );
      if (concurrentReplay) return { asset: concurrentReplay, created: false };
    }
    throw error;
  }

  return { asset: await getCmsAsset(db, input.id), created: true };
}

export async function updateIdempotentCmsAssetMetadata(
  db: D1Database,
  identity: CmsIdentity,
  assetId: string,
  expectedUpdatedAt: string,
  input: { alt: string; tags: string[] },
  requestId: string,
  inputSha256: string,
  client: string | undefined,
  now = new Date()
): Promise<CmsAsset> {
  requirePermission(identity.role, "edit");
  const replay = await findIdempotentCmsAssetMutation(
    db,
    identity,
    "studio_update_asset",
    requestId,
    inputSha256
  );
  if (replay) return replay;

  const metadata = parseAssetMetadata(input.alt, input.tags);
  if (!metadata.alt) {
    throw new CmsRepositoryError("invalid_asset", "画像の説明を入力してください。");
  }
  const expectedUpdatedAtMs = Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAtMs)) {
    throw new CmsRepositoryError("invalid_asset", "画像の更新日時を確認してください。");
  }
  const timestamp = new Date(Math.max(
    now.getTime(),
    expectedUpdatedAtMs + 1
  )).toISOString();
  const auditId = crypto.randomUUID();
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         SELECT ?1, NULL, ?2, 'asset.updated', ?3, ?4
         FROM cms_assets
         WHERE id = ?5 AND status = 'active' AND updated_at = ?6`
      ).bind(
        auditId,
        identity.subject,
        JSON.stringify({
          assetId,
          channel: "mcp",
          ...(client ? { client: client.slice(0, 200) } : {}),
          requestId,
          tool: "studio_update_asset"
        }),
        timestamp,
        assetId,
        expectedUpdatedAt
      ),
      db.prepare(
        `UPDATE cms_assets
         SET alt = ?1, tags_json = ?2, updated_by_subject = ?3, updated_at = ?4
         WHERE id = ?5 AND status = 'active' AND updated_at = ?6`
      ).bind(
        metadata.alt,
        JSON.stringify(metadata.tags),
        identity.subject,
        timestamp,
        assetId,
        expectedUpdatedAt
      ),
      db.prepare(
        `INSERT INTO cms_mcp_asset_idempotency
          (actor_subject, tool_name, request_id, input_sha256, asset_id, created_at)
         SELECT ?1, 'studio_update_asset', ?2, ?3, ?4, ?5
         FROM cms_audit_events
         WHERE id = ?6 AND actor_subject = ?1`
      ).bind(identity.subject, requestId, inputSha256, assetId, timestamp, auditId)
    ]);
  } catch (error) {
    if (isAssetIdempotencyConstraint(error)) {
      const concurrentReplay = await findIdempotentCmsAssetMutation(
        db,
        identity,
        "studio_update_asset",
        requestId,
        inputSha256
      );
      if (concurrentReplay) return concurrentReplay;
    }
    throw error;
  }

  if (results.some((result) => result.meta.changes !== 1)) {
    const concurrentReplay = await findIdempotentCmsAssetMutation(
      db,
      identity,
      "studio_update_asset",
      requestId,
      inputSha256
    );
    if (concurrentReplay) return concurrentReplay;
    const current = await getCmsAsset(db, assetId);
    if (current.status !== "active") throw invalidAssetTransition();
    throw assetConflict();
  }
  return getCmsAsset(db, assetId);
}

export async function updateIdempotentCmsAssetStatus(
  db: D1Database,
  identity: CmsIdentity,
  assetId: string,
  expectedUpdatedAt: string,
  targetStatus: "active" | "archived",
  requestId: string,
  inputSha256: string,
  client: string | undefined,
  now = new Date()
): Promise<CmsAsset> {
  requirePermission(identity.role, "edit");
  const toolName: CmsAssetMcpToolName = targetStatus === "archived"
    ? "studio_archive_asset"
    : "studio_restore_asset";
  const replay = await findIdempotentCmsAssetMutation(
    db,
    identity,
    toolName,
    requestId,
    inputSha256
  );
  if (replay) return replay;

  const expectedUpdatedAtMs = Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAtMs)) {
    throw new CmsRepositoryError("invalid_asset", "画像の更新日時を確認してください。");
  }
  const timestamp = new Date(Math.max(
    now.getTime(),
    expectedUpdatedAtMs + 1
  )).toISOString();
  const sourceStatus = targetStatus === "archived" ? "active" : "archived";
  const auditAction = targetStatus === "archived" ? "asset.archived" : "asset.restored";
  const auditId = crypto.randomUUID();
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         SELECT ?1, NULL, ?2, ?3, ?4, ?5
         FROM cms_assets
         WHERE id = ?6 AND status = ?7 AND updated_at = ?8
           AND (?9 <> 'archived' OR NOT EXISTS (
             SELECT 1 FROM cms_asset_references WHERE asset_id = ?6
           ))`
      ).bind(
        auditId,
        identity.subject,
        auditAction,
        JSON.stringify({
          assetId,
          channel: "mcp",
          ...(client ? { client: client.slice(0, 200) } : {}),
          requestId,
          tool: toolName
        }),
        timestamp,
        assetId,
        sourceStatus,
        expectedUpdatedAt,
        targetStatus
      ),
      db.prepare(
        `UPDATE cms_assets
         SET status = ?1, updated_by_subject = ?2, updated_at = ?3
         WHERE id = ?4 AND status = ?5 AND updated_at = ?6
           AND (?1 <> 'archived' OR NOT EXISTS (
             SELECT 1 FROM cms_asset_references WHERE asset_id = ?4
           ))`
      ).bind(
        targetStatus,
        identity.subject,
        timestamp,
        assetId,
        sourceStatus,
        expectedUpdatedAt
      ),
      db.prepare(
        `INSERT INTO cms_mcp_asset_idempotency
          (actor_subject, tool_name, request_id, input_sha256, asset_id, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6
         FROM cms_audit_events
         WHERE id = ?7 AND actor_subject = ?1`
      ).bind(
        identity.subject,
        toolName,
        requestId,
        inputSha256,
        assetId,
        timestamp,
        auditId
      )
    ]);
  } catch (error) {
    if (isAssetIdempotencyConstraint(error)) {
      const concurrentReplay = await findIdempotentCmsAssetMutation(
        db,
        identity,
        toolName,
        requestId,
        inputSha256
      );
      if (concurrentReplay) return concurrentReplay;
    }
    throw error;
  }

  if (results.some((result) => result.meta.changes !== 1)) {
    const concurrentReplay = await findIdempotentCmsAssetMutation(
      db,
      identity,
      toolName,
      requestId,
      inputSha256
    );
    if (concurrentReplay) return concurrentReplay;
    const current = await getCmsAsset(db, assetId);
    if (current.updatedAt !== expectedUpdatedAt) throw assetConflict();
    if (targetStatus === "archived" && current.referenceCount > 0) {
      throw new CmsRepositoryError(
        "asset_in_use",
        "記事で使用中の画像はアーカイブできません。"
      );
    }
    throw invalidAssetTransition();
  }
  return getCmsAsset(db, assetId);
}

export async function updateCmsAsset(
  db: D1Database,
  identity: CmsIdentity,
  assetId: string,
  input: { alt: string; status: string; tags: string[] },
  now = new Date()
): Promise<CmsAsset> {
  requirePermission(identity.role, "edit");
  const status = cmsAssetStatusSchema.safeParse(input.status);
  if (!status.success) {
    throw new CmsRepositoryError("invalid_asset", "画像情報を確認してください。");
  }
  const metadata = parseAssetMetadata(input.alt, input.tags);
  const result = await db.prepare(
    `UPDATE cms_assets
     SET alt = ?1, tags_json = ?2, status = ?3,
         updated_by_subject = ?4, updated_at = ?5
     WHERE id = ?6
       AND (?3 <> 'archived' OR NOT EXISTS (
         SELECT 1 FROM cms_asset_references WHERE asset_id = ?6
       ))`
  ).bind(
    metadata.alt,
    JSON.stringify(metadata.tags),
    status.data,
    identity.subject,
    now.toISOString(),
    assetId
  ).run();
  if (result.meta.changes !== 1) {
    const exists = await db.prepare("SELECT 1 AS present FROM cms_assets WHERE id = ?1")
      .bind(assetId)
      .first<number>("present");
    if (!exists) throw assetNotFound();
    throw new CmsRepositoryError(
      "asset_in_use",
      "記事で使用中の画像はアーカイブできません。"
    );
  }
  return getCmsAsset(db, assetId);
}

export interface CmsAssetDeletion {
  assetId: string;
  r2Key: string;
}

export async function queueCmsAssetDeletion(
  db: D1Database,
  identity: CmsIdentity,
  assetId: string,
  now = new Date(),
  context: CmsMutationContext = {}
): Promise<CmsAssetDeletion> {
  requirePermission(identity.role, "edit");
  const timestamp = now.toISOString();
  const auditId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO cms_asset_deletions
        (asset_id, r2_key, requested_by_subject, requested_at)
       SELECT id, r2_key, ?1, ?2 FROM cms_assets
       WHERE id = ?3 AND NOT EXISTS (
         SELECT 1 FROM cms_asset_references WHERE asset_id = ?3
       )
       ON CONFLICT(asset_id) DO NOTHING`
    ).bind(identity.subject, timestamp, assetId),
    db.prepare(
      `INSERT INTO cms_audit_events
        (id, article_id, actor_subject, action, metadata_json, created_at)
       SELECT ?1, NULL, ?2, 'asset.deleted', ?3, ?4 FROM cms_assets
       WHERE id = ?5 AND NOT EXISTS (
         SELECT 1 FROM cms_asset_references WHERE asset_id = ?5
       )`
    ).bind(
      auditId,
      identity.subject,
      JSON.stringify(auditMetadata({ assetId }, context)),
      timestamp,
      assetId
    ),
    db.prepare(
      `DELETE FROM cms_assets
       WHERE id = ?1 AND NOT EXISTS (
         SELECT 1 FROM cms_asset_references WHERE asset_id = ?1
       )`
    ).bind(assetId)
  ]);

  if (results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1 && results[2]?.meta.changes === 1) {
    return getPendingCmsAssetDeletion(db, assetId);
  }

  const exists = await db.prepare("SELECT 1 AS present FROM cms_assets WHERE id = ?1")
    .bind(assetId)
    .first<number>("present");
  if (exists) {
    await db.batch([
      db.prepare("DELETE FROM cms_asset_deletions WHERE asset_id = ?1").bind(assetId),
      db.prepare("DELETE FROM cms_audit_events WHERE id = ?1").bind(auditId)
    ]);
    throw new CmsRepositoryError(
      "asset_in_use",
      "記事で使用中の画像は削除できません。記事から画像を外して保存してから削除してください。"
    );
  }
  const pending = await findPendingCmsAssetDeletion(db, assetId);
  if (pending) return pending;
  throw assetNotFound();
}

export async function listPendingCmsAssetDeletions(
  db: D1Database,
  limit = 100
): Promise<CmsAssetDeletion[]> {
  const result = await db.prepare(
    `SELECT asset_id, r2_key FROM cms_asset_deletions
     ORDER BY requested_at ASC LIMIT ?1`
  ).bind(limit).all<{ asset_id: string; r2_key: string }>();
  return result.results.map((row) => ({ assetId: row.asset_id, r2Key: row.r2_key }));
}

export async function completeCmsAssetDeletions(
  db: D1Database,
  deletions: readonly CmsAssetDeletion[]
): Promise<void> {
  if (deletions.length === 0) return;
  await db.batch(deletions.map((deletion) => db.prepare(
    "DELETE FROM cms_asset_deletions WHERE asset_id = ?1 AND r2_key = ?2"
  ).bind(deletion.assetId, deletion.r2Key)));
}

async function findPendingCmsAssetDeletion(
  db: D1Database,
  assetId: string
): Promise<CmsAssetDeletion | null> {
  const row = await db.prepare(
    "SELECT asset_id, r2_key FROM cms_asset_deletions WHERE asset_id = ?1"
  ).bind(assetId).first<{ asset_id: string; r2_key: string }>();
  return row ? { assetId: row.asset_id, r2Key: row.r2_key } : null;
}

async function getPendingCmsAssetDeletion(
  db: D1Database,
  assetId: string
): Promise<CmsAssetDeletion> {
  const pending = await findPendingCmsAssetDeletion(db, assetId);
  if (!pending) throw new CmsRepositoryError(
    "asset_delete_failed",
    "画像の削除を完了できませんでした。もう一度お試しください。"
  );
  return pending;
}

function parseAssetMetadata(alt: string, tags: string[]): { alt: string; tags: string[] } {
  const parsed = cmsAssetMutationSchema.safeParse({ alt, status: "active", tags });
  if (!parsed.success) {
    throw new CmsRepositoryError("invalid_asset", "画像情報を確認してください。");
  }
  return {
    alt: parsed.data.alt.trim(),
    tags: [...new Set(parsed.data.tags.map((tag) => tag.trim()).filter(Boolean))]
  };
}

function cmsArticleAssetReferenceStatements(
  db: D1Database,
  articleId: string,
  frontmatter: ArticleFrontmatter,
  markdown: string,
  timestamp: string,
  revisionGuard?: { lockVersion: number; revisionId: string }
): D1PreparedStatement[] {
  const references = new Map<string, Set<"hero" | "markdown">>();
  for (const match of markdown.matchAll(/\/media\/(articles\/[0-9a-f-]{36}\.(?:gif|jpe?g|png|webp))/giu)) {
    const key = match[1];
    if (!key) continue;
    const locations = references.get(key) ?? new Set<"hero" | "markdown">();
    locations.add("markdown");
    references.set(key, locations);
  }
  const heroKey = frontmatter.heroImage?.src.match(/^\/media\/(articles\/[0-9a-f-]{36}\.(?:gif|jpe?g|png|webp))$/iu)?.[1];
  if (heroKey) {
    const locations = references.get(heroKey) ?? new Set<"hero" | "markdown">();
    locations.add("hero");
    references.set(heroKey, locations);
  }

  const deleteGuardSql = revisionGuard
    ? " AND EXISTS (SELECT 1 FROM cms_articles a WHERE a.id = ?1 AND a.lock_version = ?2 AND a.current_revision_id = ?3)"
    : "";
  const insertGuardSql = revisionGuard
    ? " AND EXISTS (SELECT 1 FROM cms_articles a WHERE a.id = ?1 AND a.lock_version = ?5 AND a.current_revision_id = ?6)"
    : "";
  const guardBindings = revisionGuard
    ? [revisionGuard.lockVersion, revisionGuard.revisionId]
    : [];
  const statements: D1PreparedStatement[] = [db.prepare(
    `DELETE FROM cms_asset_references WHERE article_id = ?1${deleteGuardSql}`
  ).bind(articleId, ...guardBindings)];
  for (const [r2Key, locations] of references) {
    for (const location of locations) {
      statements.push(db.prepare(
        `INSERT INTO cms_asset_references (asset_id, article_id, location, created_at)
         SELECT id, ?1, ?2, ?3 FROM cms_assets
         WHERE r2_key = ?4${insertGuardSql}
         ON CONFLICT(asset_id, article_id, location) DO NOTHING`
      ).bind(articleId, location, timestamp, r2Key, ...guardBindings));
    }
  }
  return statements;
}

export async function getCmsArticle(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string
): Promise<CmsArticleDetail> {
  requirePermission(identity.role, "view");
  const row = await db.prepare(
    `${articleDetailSelect()}
     WHERE a.id = ?1`
  ).bind(articleId).first<ArticleDetailRow>();
  if (!row) throw articleNotFound();
  return parseArticleDetail(row);
}

export async function listCmsReviewComments(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string
): Promise<CmsReviewComment[]> {
  requirePermission(identity.role, "view");
  await getCurrentArticleRow(db, articleId);
  const result = await db.prepare(
    `SELECT
       c.id,
       c.article_id,
       c.revision_id,
       r.revision_number,
       COALESCE(m.email, 'unknown') AS author_email,
       c.target,
       c.body,
       c.created_at,
       c.anchor_start,
       c.anchor_end,
       c.anchor_quote,
       c.anchor_prefix,
       c.anchor_suffix,
       c.status,
       c.resolved_at,
       c.resolved_revision_id,
       rr.revision_number AS resolved_revision_number,
       rm.email AS resolved_by_email
     FROM cms_review_comments c
     JOIN cms_article_revisions r ON r.id = c.revision_id
     LEFT JOIN cms_members m ON m.subject = c.author_subject
     LEFT JOIN cms_members rm ON rm.subject = c.resolved_by_subject
     LEFT JOIN cms_article_revisions rr ON rr.id = c.resolved_revision_id
     WHERE c.article_id = ?1
     ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.created_at ASC, c.id ASC`
  ).bind(articleId).all<ReviewCommentRow>();
  return result.results.map(parseReviewComment);
}

export async function createCmsReviewComment(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string,
  input: { anchor?: CmsReviewCommentAnchor; body: string; target: CmsReviewCommentTarget },
  now = new Date(),
  context: CmsMutationContext = {}
): Promise<CmsReviewComment> {
  requirePermission(identity.role, "comment");
  const current = await getCurrentArticleRow(db, articleId);
  const target = cmsReviewCommentTargetSchema.safeParse(input.target);
  const anchor = input.anchor === undefined
    ? { data: undefined, success: true as const }
    : cmsReviewCommentAnchorSchema.safeParse(input.anchor);
  const body = input.body.trim();
  if (!target.success || !anchor.success || body.length === 0 || body.length > 1_000) {
    throw new CmsRepositoryError("invalid_article", "コメント内容を確認してください。");
  }
  if (anchor.data && target.data !== "body") {
    throw new CmsRepositoryError("invalid_article", "本文の選択範囲は本文コメントにだけ指定できます。");
  }
  if (anchor.data) {
    const revision = await db.prepare(
      `SELECT markdown FROM cms_article_revisions WHERE id = ?1`
    ).bind(current.current_revision_id).first<{ markdown: string }>();
    if (
      !revision ||
      revision.markdown.slice(anchor.data.startOffset, anchor.data.endOffset) !== anchor.data.quote
    ) {
      throw new CmsRepositoryError(
        "invalid_article",
        "選択範囲が現在の本文と一致しません。本文を選び直してください。"
      );
    }
  }
  if (!new Set<CmsReviewStatus>(["in_review", "changes_requested", "approved"]).has(parseReviewStatus(current.review_status))) {
    throw new CmsRepositoryError("invalid_transition", "レビュー中の記事にコメントしてください。");
  }
  const id = crypto.randomUUID();
  const timestamp = now.toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO cms_review_comments
        (id, article_id, revision_id, author_subject, target, body, created_at,
         anchor_start, anchor_end, anchor_quote, anchor_prefix, anchor_suffix)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    ).bind(
      id,
      articleId,
      current.current_revision_id,
      identity.subject,
      target.data,
      body,
      timestamp,
      anchor.data?.startOffset ?? null,
      anchor.data?.endOffset ?? null,
      anchor.data?.quote ?? null,
      anchor.data?.prefix ?? null,
      anchor.data?.suffix ?? null
    ),
    db.prepare(
      `INSERT INTO cms_audit_events
        (id, article_id, actor_subject, action, metadata_json, created_at)
       VALUES (?1, ?2, ?3, 'article.comment', ?4, ?5)`
    ).bind(
      crypto.randomUUID(),
      articleId,
      identity.subject,
      JSON.stringify(auditMetadata({
        commentId: id,
        revisionId: current.current_revision_id,
        target: target.data,
        anchored: Boolean(anchor.data)
      }, context)),
      timestamp
    )
  ]);
  const row = await db.prepare(
    `SELECT
       c.id,
       c.article_id,
       c.revision_id,
       r.revision_number,
       COALESCE(m.email, 'unknown') AS author_email,
       c.target,
       c.body,
       c.created_at,
       c.anchor_start,
       c.anchor_end,
       c.anchor_quote,
       c.anchor_prefix,
       c.anchor_suffix,
       c.status,
       c.resolved_at,
       c.resolved_revision_id,
       rr.revision_number AS resolved_revision_number,
       rm.email AS resolved_by_email
     FROM cms_review_comments c
     JOIN cms_article_revisions r ON r.id = c.revision_id
     LEFT JOIN cms_members m ON m.subject = c.author_subject
     LEFT JOIN cms_members rm ON rm.subject = c.resolved_by_subject
     LEFT JOIN cms_article_revisions rr ON rr.id = c.resolved_revision_id
     WHERE c.id = ?1`
  ).bind(id).first<ReviewCommentRow>();
  if (!row) throw new Error("CMS review comment was not persisted.");
  return parseReviewComment(row);
}

export async function updateCmsReviewCommentStatus(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string,
  commentId: string,
  action: CmsReviewCommentAction,
  now = new Date(),
  context: CmsMutationContext = {}
): Promise<CmsReviewComment> {
  if (action === "resolve") requirePermission(identity.role, "edit");
  else requirePermission(identity.role, "approve");
  const existing = await db.prepare(
    `SELECT status FROM cms_review_comments WHERE id = ?1 AND article_id = ?2`
  ).bind(commentId, articleId).first<{ status: string }>();
  if (!existing) throw new CmsRepositoryError("article_not_found", "レビューコメントが見つかりません。");
  const nextStatus = action === "resolve" ? "resolved" : "open";
  if (existing.status === nextStatus) {
    const comments = await listCmsReviewComments(db, identity, articleId);
    const comment = comments.find((item) => item.id === commentId);
    if (!comment) throw new Error("CMS review comment status was not persisted.");
    return comment;
  }
  const current = await getCurrentArticleRow(db, articleId);
  const reviewStatus = parseReviewStatus(current.review_status);
  if (
    (action === "resolve" && !new Set<CmsReviewStatus>(["draft", "changes_requested"]).has(reviewStatus)) ||
    (action === "reopen" && !new Set<CmsReviewStatus>(["in_review", "changes_requested", "approved"]).has(reviewStatus))
  ) {
    throw invalidTransition();
  }
  const timestamp = now.toISOString();
  await db.batch([
      db.prepare(
        `UPDATE cms_review_comments
         SET status = ?1,
             resolved_at = ?2,
             resolved_by_subject = ?3,
             resolved_revision_id = ?4
         WHERE id = ?5 AND article_id = ?6`
      ).bind(
        nextStatus,
        action === "resolve" ? timestamp : null,
        action === "resolve" ? identity.subject : null,
        action === "resolve" ? current.current_revision_id : null,
        commentId,
        articleId
      ),
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
      ).bind(
        crypto.randomUUID(),
        articleId,
        identity.subject,
        `article.comment_${action}`,
        JSON.stringify(auditMetadata({
          commentId,
          revisionId: current.current_revision_id
        }, context)),
        timestamp
      )
  ]);
  const comments = await listCmsReviewComments(db, identity, articleId);
  const comment = comments.find((item) => item.id === commentId);
  if (!comment) throw new Error("CMS review comment status was not persisted.");
  return comment;
}

export async function listCmsArticleVersions(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string
): Promise<CmsArticleVersionSummary[]> {
  requirePermission(identity.role, "view");
  await getCurrentArticleRow(db, articleId);
  const result = await db.prepare(
    `WITH version_groups AS (
       SELECT
         COALESCE(r.edit_session_id, r.id) AS version_id,
         MIN(r.revision_number) AS first_revision_number,
         MAX(r.revision_number) AS latest_revision_number,
         COUNT(*) AS checkpoint_count,
         MIN(r.created_at) AS created_at,
         MAX(r.created_at) AS updated_at,
         MAX(CASE WHEN r.id = a.current_revision_id THEN 1 ELSE 0 END) AS is_current,
         MAX(CASE WHEN r.id = a.approved_revision_id THEN 1 ELSE 0 END) AS is_approved,
         MAX(CASE WHEN r.id = a.published_revision_id THEN 1 ELSE 0 END) AS is_published
       FROM cms_article_revisions r
       JOIN cms_articles a ON a.id = r.article_id
       WHERE r.article_id = ?1
       GROUP BY COALESCE(r.edit_session_id, r.id)
       ORDER BY latest_revision_number DESC
       LIMIT 50
     )
     SELECT
       g.version_id,
       g.first_revision_number,
       g.latest_revision_number,
       g.checkpoint_count,
       g.created_at,
       g.updated_at,
       g.is_current,
       g.is_approved,
       g.is_published,
       r.id AS latest_revision_id,
       r.save_reason AS reason,
       r.source_revision_id,
       COALESCE(m.email, 'unknown') AS created_by_email
     FROM version_groups g
     JOIN cms_article_revisions r
       ON r.article_id = ?1 AND r.revision_number = g.latest_revision_number
     LEFT JOIN cms_members m ON m.subject = r.created_by_subject
     ORDER BY g.latest_revision_number DESC`
  ).bind(articleId).all<ArticleVersionSummaryRow>();
  return result.results.map(parseArticleVersionSummary);
}

export async function getCmsArticleVersion(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string,
  revisionId: string
): Promise<CmsArticleVersionDetail> {
  requirePermission(identity.role, "view");
  const row = await db.prepare(
    `SELECT
       r.id,
       r.revision_number,
       r.frontmatter_json,
       r.markdown,
       r.created_at,
       r.save_reason AS reason,
       r.source_revision_id,
       r.draft_visibility AS visibility,
       COALESCE(m.email, 'unknown') AS created_by_email,
       m.display_name AS editor_display_name,
       m.public_id AS editor_public_id,
       CASE WHEN r.id = a.current_revision_id THEN 1 ELSE 0 END AS is_current,
       CASE WHEN r.id = a.approved_revision_id THEN 1 ELSE 0 END AS is_approved,
       CASE WHEN r.id = a.published_revision_id THEN 1 ELSE 0 END AS is_published
     FROM cms_article_revisions r
     JOIN cms_articles a ON a.id = r.article_id
     LEFT JOIN cms_members m ON m.subject = r.created_by_subject
     WHERE r.article_id = ?1 AND r.id = ?2`
  ).bind(articleId, revisionId).first<ArticleVersionDetailRow>();
  if (!row) throw articleNotFound();
  return parseArticleVersionDetail(row);
}

export async function listCmsArticleVersionCheckpoints(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string,
  versionId: string,
  beforeRevisionNumber?: number
): Promise<CmsArticleVersionCheckpointPage> {
  requirePermission(identity.role, "view");
  await getCurrentArticleRow(db, articleId);
  const result = await db.prepare(
    `SELECT
       r.id,
       r.revision_number,
       r.created_at,
       r.save_reason AS reason,
       COALESCE(m.email, 'unknown') AS created_by_email,
       CASE WHEN r.id = a.current_revision_id THEN 1 ELSE 0 END AS is_current,
       CASE WHEN r.id = a.approved_revision_id THEN 1 ELSE 0 END AS is_approved,
       CASE WHEN r.id = a.published_revision_id THEN 1 ELSE 0 END AS is_published
     FROM cms_article_revisions r
     JOIN cms_articles a ON a.id = r.article_id
     LEFT JOIN cms_members m ON m.subject = r.created_by_subject
     WHERE r.article_id = ?1
       AND COALESCE(r.edit_session_id, r.id) = ?2
       AND (?3 IS NULL OR r.revision_number < ?3)
     ORDER BY r.revision_number DESC
     LIMIT 101`
  ).bind(articleId, versionId, beforeRevisionNumber ?? null).all<ArticleVersionCheckpointRow>();
  if (result.results.length === 0 && beforeRevisionNumber === undefined) {
    throw articleNotFound();
  }
  const visible = result.results.slice(0, 100);
  return {
    checkpoints: visible.map(parseArticleVersionCheckpoint),
    nextBeforeRevisionNumber: result.results.length > 100
      ? visible.at(-1)?.revision_number ?? null
      : null
  };
}

export async function createCmsArticle(
  db: D1Database,
  identity: CmsIdentity,
  input: CmsArticleContentInput,
  now = new Date(),
  context: CmsMutationContext = {},
  revisionContext: Pick<CmsRevisionWriteContext, "editSessionId"> = {}
): Promise<CmsArticleDetail> {
  requirePermission(identity.role, "edit");
  const requestedContent = parseDraftContent(input);
  const content = withCmsManagedMetadata(requestedContent, now);
  const articleId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const slug = canonicalDraftSlug(content.frontmatter.slug, articleId);
  const frontmatterJson = JSON.stringify(content.frontmatter);
  const checksum = await contentChecksum(requestedContent);
  const contentSha256 = await contentChecksum(content);
  const replayArticleId = await findIdempotentArticle(
    db,
    identity,
    context,
    checksum
  );
  if (replayArticleId) return getCmsArticle(db, identity, replayArticleId);

  try {
    await db.batch([
      ...idempotencyStatements(
        db,
        identity,
        context,
        checksum,
        articleId,
        timestamp
      ),
      db.prepare(
        `INSERT INTO cms_articles (
          id, slug, review_status, publication_status, draft_visibility,
          published_visibility, lock_version, current_revision_id,
          current_revision_number, created_by_subject, updated_by_subject,
          created_at, updated_at
        ) VALUES (
          ?1, ?2, 'draft', 'unpublished', ?3, NULL, 1, ?4, 1, ?5, ?5, ?6, ?6
        )`
      ).bind(
        articleId,
        slug,
        content.visibility,
        revisionId,
        identity.subject,
        timestamp
      ),
      db.prepare(
        `INSERT INTO cms_article_revisions (
          id, article_id, revision_number, frontmatter_json, markdown,
          content_sha256, created_by_subject, created_at, edit_session_id,
          save_reason, draft_visibility
        ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7, ?8, 'created', ?9)`
      ).bind(
        revisionId,
        articleId,
        frontmatterJson,
        content.markdown,
        contentSha256,
        identity.subject,
        timestamp,
        revisionContext.editSessionId ?? null,
        content.visibility
      ),
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         VALUES (?1, ?2, ?3, 'article.created', ?4, ?5)`
      ).bind(
        auditId,
        articleId,
        identity.subject,
        JSON.stringify(auditMetadata(
          { revisionId, visibility: content.visibility },
          context
        )),
        timestamp
      ),
      ...cmsArticleAssetReferenceStatements(
        db,
        articleId,
        content.frontmatter,
        content.markdown,
        timestamp
      )
    ]);
  } catch (error) {
    if (isIdempotencyConstraint(error)) {
      const replay = await findIdempotentArticle(
        db,
        identity,
        context,
        checksum
      );
      if (replay) return getCmsArticle(db, identity, replay);
    }
    if (isUniqueConstraint(error, "cms_articles.slug")) throw slugConflict();
    throw error;
  }

  return getCmsArticle(db, identity, articleId);
}

export async function updateCmsArticle(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string,
  expectedVersion: number,
  input: CmsArticleContentInput,
  now = new Date(),
  context: CmsMutationContext = {},
  revisionContext: CmsRevisionWriteContext = {}
): Promise<CmsArticleDetail> {
  requirePermission(identity.role, "edit");
  const requestedContent = parseDraftContent(input);
  const content = withCmsManagedMetadata(requestedContent, now);
  const checksum = await operationChecksum({
    articleId,
    content: requestedContent,
    expectedVersion,
    ...(revisionContext.sourceRevisionId
      ? { sourceRevisionId: revisionContext.sourceRevisionId }
      : {})
  });
  const replayArticleId = await findIdempotentArticle(
    db,
    identity,
    context,
    checksum
  );
  if (replayArticleId) return getCmsArticle(db, identity, replayArticleId);
  const current = await getCurrentArticleRow(db, articleId);
  if (current.lock_version !== expectedVersion) throw revisionConflict();
  if (new Set<CmsReviewStatus>(["in_review", "approved"]).has(parseReviewStatus(current.review_status))) {
    throw new CmsRepositoryError(
      "article_locked",
      "レビュー中または承認済みの記事は編集できません。レビューを取り下げるか、修正を依頼してください。"
    );
  }

  const revisionId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const nextRevision = current.current_revision_number + 1;
  const nextVersion = expectedVersion + 1;
  const slug = canonicalDraftSlug(content.frontmatter.slug, articleId);
  const contentSha256 = await contentChecksum(content);
  const saveReason = revisionContext.saveReason ?? "autosave";
  if (saveReason === "restored" && !revisionContext.sourceRevisionId) {
    throw new CmsRepositoryError("invalid_article", "復元元の版を指定してください。");
  }
  if (saveReason !== "restored" && revisionContext.sourceRevisionId) {
    throw new CmsRepositoryError("invalid_article", "復元時以外は復元元の版を指定できません。");
  }
  if (revisionContext.sourceRevisionId) {
    const sourceExists = await db.prepare(
      "SELECT 1 AS present FROM cms_article_revisions WHERE article_id = ?1 AND id = ?2"
    ).bind(articleId, revisionContext.sourceRevisionId).first<number>("present");
    if (!sourceExists) {
      throw new CmsRepositoryError("invalid_article", "復元元の版が見つかりません。");
    }
  }

  try {
    const results = await db.batch([
      db.prepare(
        `INSERT INTO cms_article_revisions (
          id, article_id, revision_number, frontmatter_json, markdown,
          content_sha256, created_by_subject, created_at, edit_session_id,
          save_reason, source_revision_id, draft_visibility
        )
        SELECT ?1, id, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
        FROM cms_articles
        WHERE id = ?12 AND lock_version = ?13`
      ).bind(
        revisionId,
        nextRevision,
        JSON.stringify(content.frontmatter),
        content.markdown,
        contentSha256,
        identity.subject,
        timestamp,
        revisionContext.editSessionId ?? null,
        saveReason,
        revisionContext.sourceRevisionId ?? null,
        content.visibility,
        articleId,
        expectedVersion
      ),
      db.prepare(
        `UPDATE cms_articles
         SET slug = ?1,
             draft_visibility = ?2,
             lock_version = ?3,
             current_revision_id = ?4,
             current_revision_number = ?5,
             review_status = 'draft',
             approved_revision_id = NULL,
             review_note = NULL,
             reviewed_at = NULL,
             reviewed_by_subject = NULL,
             updated_by_subject = ?6,
             updated_at = ?7
         WHERE id = ?8 AND lock_version = ?9`
      ).bind(
        slug,
        content.visibility,
        nextVersion,
        revisionId,
        nextRevision,
        identity.subject,
        timestamp,
        articleId,
        expectedVersion
      ),
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         SELECT ?1, id, ?2, 'article.revised', ?3, ?4
         FROM cms_articles
         WHERE id = ?5 AND lock_version = ?6 AND current_revision_id = ?7`
      ).bind(
        auditId,
        identity.subject,
        JSON.stringify(auditMetadata(
          {
            revisionId,
            revisionNumber: nextRevision,
            saveReason,
            sourceRevisionId: revisionContext.sourceRevisionId
          },
          context
        )),
        timestamp,
        articleId,
        nextVersion,
        revisionId
      ),
      ...cmsArticleAssetReferenceStatements(
        db,
        articleId,
        content.frontmatter,
        content.markdown,
        timestamp,
        { lockVersion: nextVersion, revisionId }
      ),
      ...idempotencyStatements(
        db,
        identity,
        context,
        checksum,
        articleId,
        timestamp,
        { lockVersion: nextVersion, revisionId }
      )
    ]);

    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      const replay = await findIdempotentArticle(
        db,
        identity,
        context,
        checksum
      );
      if (replay) return getCmsArticle(db, identity, replay);
      throw revisionConflict();
    }
  } catch (error) {
    if (error instanceof CmsRepositoryError) throw error;
    if (isIdempotencyConstraint(error)) {
      const replay = await findIdempotentArticle(
        db,
        identity,
        context,
        checksum
      );
      if (replay) return getCmsArticle(db, identity, replay);
    }
    if (isUniqueConstraint(error, "cms_articles.slug")) throw slugConflict();
    if (isUniqueConstraint(error, "cms_article_revisions")) {
      throw revisionConflict();
    }
    throw error;
  }

  return getCmsArticle(db, identity, articleId);
}

export async function transitionCmsArticle(
  db: D1Database,
  identity: CmsIdentity,
  articleId: string,
  action: CmsArticleAction,
  expectedVersion: number,
  options: { note?: string; visibility?: CmsVisibility } = {},
  now = new Date(),
  context: CmsMutationContext = {}
): Promise<CmsArticleDetail> {
  const checksum = await transitionChecksum({
    action,
    articleId,
    expectedVersion,
    note: options.note,
    visibility: options.visibility
  });
  const replayArticleId = await findIdempotentArticle(
    db,
    identity,
    context,
    checksum
  );
  if (replayArticleId) return getCmsArticle(db, identity, replayArticleId);
  const current = await getCurrentArticleRow(db, articleId);
  if (current.lock_version !== expectedVersion) throw revisionConflict();
  let openReviewCommentCount: number | null = null;
  if (new Set<CmsArticleAction>(["request_review", "request_changes", "approve"]).has(action)) {
    openReviewCommentCount = await countOpenReviewComments(db, articleId);
    if (action === "request_changes" && openReviewCommentCount === 0 && !options.note?.trim()) {
      throw new CmsRepositoryError(
        "invalid_transition",
        "修正箇所へレビューコメントを追加してから修正を依頼してください。"
      );
    }
    if ((action === "request_review" || action === "approve") && openReviewCommentCount > 0) {
      throw new CmsRepositoryError(
        "invalid_transition",
        `未対応のレビューコメントが${openReviewCommentCount}件あります。対応状況を確認してください。`
      );
    }
  }
  const transitionOptions = action === "request_changes" && openReviewCommentCount !== null && openReviewCommentCount > 0
    ? {
        ...options,
        note: options.note?.trim() || `未対応のレビューコメントが${openReviewCommentCount}件あります。`
      }
    : options;
  const detail = await getCmsArticle(db, identity, articleId);
  const timestamp = now.toISOString();
  const transition = buildTransition(current, detail, identity, action, transitionOptions, timestamp);
  if (action === "request_review" || action === "publish") {
    const outboundIssues = await validateArticleLinkTargets(
      db,
      articleId,
      detail.currentRevision.markdown
    );
    if (outboundIssues.length > 0) {
      throw new CmsRepositoryError(
        "invalid_article",
        action === "publish"
          ? "公開前に記事リンクを確認してください。"
          : "レビュー依頼前に記事リンクを確認してください。",
        outboundIssues
      );
    }
  }
  const articleRouteSlugs = action === "publish" || action === "archive"
    ? await listArticleRouteSlugs(db, articleId, current)
    : [];
  if (action === "publish") {
    const inboundIssues = await validateInboundArticleFragments(
      db,
      articleId,
      articleRouteSlugs,
      detail.currentRevision.markdown
    );
    if (inboundIssues.length > 0) {
      throw new CmsRepositoryError(
        "invalid_article",
        "公開すると参照元の記事内リンクが切れるため、見出しを戻すか参照元を修正してください。",
        inboundIssues
      );
    }
    const redirectOwner = await db.prepare(
      "SELECT article_id FROM cms_article_slug_redirects WHERE old_slug = ?1"
    ).bind(current.slug).first<string>("article_id");
    if (redirectOwner && redirectOwner !== articleId) throw slugConflict();
  }
  if (action === "archive" && current.published_slug) {
    const inbound = await findPublishedInboundArticleLinks(
      db,
      articleId,
      articleRouteSlugs
    );
    if (inbound.length > 0) {
      throw new CmsRepositoryError(
        "invalid_transition",
        `公開中の記事${new Set(inbound.map((reference) => reference.sourceSlug)).size}件から参照されています。参照元を修正して再公開してから公開を終了してください。`,
        inbound.map((reference) => ({
          message: `「${reference.sourceSlug}」の${reference.line}行目から参照されています。`,
          path: ["publishedArticles", reference.sourceSlug, reference.line]
        }))
      );
    }
  }
  const nextVersion = expectedVersion + 1;
  const auditId = crypto.randomUUID();

  let result: D1Result[];
  try {
    result = await db.batch([
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         SELECT ?1, id, ?2, ?3, ?4, ?5
         FROM cms_articles
         WHERE id = ?6 AND lock_version = ?7`
      ).bind(
        auditId,
        identity.subject,
        `article.${action}`,
        JSON.stringify(auditMetadata({
          revisionId: current.current_revision_id,
          visibility: transition.publishedVisibility ?? transition.draftVisibility
        }, context)),
        timestamp,
        articleId,
        expectedVersion
      ),
      db.prepare(
        `UPDATE cms_articles
         SET review_status = ?1,
             publication_status = ?2,
             draft_visibility = ?3,
             published_visibility = ?4,
             published_slug = ?5,
             approved_revision_id = ?6,
             published_revision_id = ?7,
             published_revision_number = ?8,
             review_note = ?9,
             review_requested_at = ?10,
             reviewed_at = ?11,
             reviewed_by_subject = ?12,
             published_at = ?13,
             lock_version = ?14,
             updated_by_subject = ?15,
             updated_at = ?16
         WHERE id = ?17 AND lock_version = ?18`
      ).bind(
        transition.reviewStatus,
        transition.publicationStatus,
        transition.draftVisibility,
        transition.publishedVisibility,
        transition.publishedSlug,
        transition.approvedRevisionId,
        transition.publishedRevisionId,
        transition.publishedRevisionNumber,
        transition.reviewNote,
        transition.reviewRequestedAt,
        transition.reviewedAt,
        transition.reviewedBySubject,
        transition.publishedAt,
        nextVersion,
        identity.subject,
        timestamp,
        articleId,
        expectedVersion
      ),
      ...(action === "publish"
        ? [
            db.prepare(
              "DELETE FROM cms_article_slug_redirects WHERE old_slug = ?1 AND article_id = ?2"
            ).bind(transition.publishedSlug, articleId),
            ...(current.published_slug && current.published_slug !== transition.publishedSlug
              ? [db.prepare(
                  `INSERT INTO cms_article_slug_redirects (old_slug, article_id, created_at)
                   VALUES (?1, ?2, ?3)
                   ON CONFLICT(old_slug) DO UPDATE SET
                     article_id = excluded.article_id,
                     created_at = excluded.created_at
                   WHERE cms_article_slug_redirects.article_id = excluded.article_id`
                ).bind(current.published_slug, articleId, timestamp)]
              : [])
          ]
        : []),
      ...(action === "request_changes" && openReviewCommentCount === 0 && options.note?.trim()
        ? [db.prepare(
            `INSERT INTO cms_review_comments
              (id, article_id, revision_id, author_subject, target, body, created_at)
             VALUES (?1, ?2, ?3, ?4, 'article', ?5, ?6)`
          ).bind(
            crypto.randomUUID(),
            articleId,
            current.current_revision_id,
            identity.subject,
            options.note.trim(),
            timestamp
          )]
        : []),
      ...idempotencyStatementForAudit(
        db,
        identity,
        context,
        checksum,
        auditId,
        timestamp
      )
    ]);
  } catch (error) {
    if (isIdempotencyConstraint(error)) {
      const replay = await findIdempotentArticle(
        db,
        identity,
        context,
        checksum
      );
      if (replay) return getCmsArticle(db, identity, replay);
    }
    if (isUniqueConstraint(error, "cms_articles.published_slug")) {
      throw slugConflict();
    }
    if (isUniqueConstraint(error, "cms_article_slug_redirects.old_slug")) {
      throw slugConflict();
    }
    throw error;
  }

  if (result[0]?.meta.changes !== 1 || result[1]?.meta.changes !== 1) {
    const replay = await findIdempotentArticle(
      db,
      identity,
      context,
      checksum
    );
    if (replay) return getCmsArticle(db, identity, replay);
    throw revisionConflict();
  }
  return getCmsArticle(db, identity, articleId);
}

async function validateArticleLinkTargets(
  db: D1Database,
  sourceArticleId: string,
  markdown: string
): Promise<Array<{ message: string; path: Array<string | number> }>> {
  const issues: Array<{ message: string; path: Array<string | number> }> = [];
  const targetCache = new Map<string, ArticleLinkTargetRow | null>();
  const headingCache = new Map<string, Set<string>>();

  for (const reference of extractArticleLinkReferences(markdown)) {
    let target = targetCache.get(reference.slug);
    if (target === undefined) {
      target = await db.prepare(
        `SELECT a.id, a.slug, a.publication_status, a.published_slug,
                current_revision.markdown AS current_markdown,
                published_revision.markdown AS published_markdown,
                CASE WHEN a.published_slug = ?1 OR EXISTS (
                  SELECT 1 FROM cms_article_slug_redirects redirect
                  WHERE redirect.article_id = a.id AND redirect.old_slug = ?1
                ) THEN 1 ELSE 0 END AS resolves_to_published
         FROM cms_articles a
         JOIN cms_article_revisions current_revision ON current_revision.id = a.current_revision_id
         LEFT JOIN cms_article_revisions published_revision ON published_revision.id = a.published_revision_id
         WHERE a.slug = ?1 OR a.published_slug = ?1 OR EXISTS (
           SELECT 1 FROM cms_article_slug_redirects redirect
           WHERE redirect.article_id = a.id AND redirect.old_slug = ?1
         )
         ORDER BY CASE
           WHEN a.publication_status = 'published' AND a.published_slug = ?1 THEN 0
           WHEN a.publication_status = 'published' AND EXISTS (
             SELECT 1 FROM cms_article_slug_redirects redirect
             WHERE redirect.article_id = a.id AND redirect.old_slug = ?1
           ) THEN 1
           ELSE 2
         END
         LIMIT 1`
      ).bind(reference.slug).first<ArticleLinkTargetRow>();
      targetCache.set(reference.slug, target);
    }
    if (!target) {
      issues.push({
        message: `リンク先の記事「${reference.slug}」がCMSにありません。`,
        path: ["markdown", reference.line]
      });
      continue;
    }
    if (!reference.fragment) continue;

    const resolvesToPublished = target.id !== sourceArticleId &&
      target.publication_status === "published" &&
      target.resolves_to_published === 1 &&
      Boolean(target.published_markdown);
    const targetMarkdown = resolvesToPublished && target.published_markdown
      ? target.published_markdown
      : target.current_markdown;
    const cacheKey = `${target.id}:${resolvesToPublished ? "published" : "current"}`;
    let headings = headingCache.get(cacheKey);
    if (!headings) {
      headings = new Set(extractArticleHeadingSlugs(targetMarkdown));
      headingCache.set(cacheKey, headings);
    }
    if (!headings.has(reference.fragment)) {
      issues.push({
        message: `リンク先の記事「${reference.slug}」に見出し「#${reference.fragment}」がありません。`,
        path: ["markdown", reference.line]
      });
    }
  }

  return issues;
}

async function listArticleRouteSlugs(
  db: D1Database,
  articleId: string,
  current: CurrentArticleRow
): Promise<string[]> {
  const redirects = await db.prepare(
    "SELECT old_slug FROM cms_article_slug_redirects WHERE article_id = ?1"
  ).bind(articleId).all<{ old_slug: string }>();
  return [...new Set([
    current.slug,
    ...(current.published_slug ? [current.published_slug] : []),
    ...redirects.results.map((row) => row.old_slug)
  ])];
}

async function validateInboundArticleFragments(
  db: D1Database,
  articleId: string,
  targetSlugs: string[],
  nextMarkdown: string
): Promise<Array<{ message: string; path: Array<string | number> }>> {
  const headings = new Set(extractArticleHeadingSlugs(nextMarkdown));
  const inbound = await findPublishedInboundArticleLinks(db, articleId, targetSlugs);
  return inbound
    .filter((reference) => reference.fragment && !headings.has(reference.fragment))
    .map((reference) => ({
      message: `「${reference.sourceSlug}」の${reference.line}行目が見出し「#${reference.fragment}」を参照しています。`,
      path: ["publishedArticles", reference.sourceSlug, reference.line]
    }));
}

async function findPublishedInboundArticleLinks(
  db: D1Database,
  articleId: string,
  targetSlugs: string[]
): Promise<Array<ArticleLinkReference & { sourceSlug: string }>> {
  const targets = new Set(targetSlugs);
  if (targets.size === 0) return [];
  const result = await db.prepare(
    `SELECT a.id AS article_id, a.published_slug, r.markdown
     FROM cms_articles a
     JOIN cms_article_revisions r ON r.id = a.published_revision_id
     WHERE a.publication_status = 'published'
       AND a.published_visibility IN ('public', 'unlisted')
       AND a.id <> ?1`
  ).bind(articleId).all<PublishedArticleLinkSourceRow>();

  return result.results.flatMap((source) =>
    extractArticleLinkReferences(source.markdown)
      .filter((reference) => targets.has(reference.slug))
      .map((reference) => ({ ...reference, sourceSlug: source.published_slug }))
  );
}

export async function listCmsMembers(
  db: D1Database,
  identity: CmsIdentity
): Promise<CmsMember[]> {
  requirePermission(identity.role, "manage_members");
  const result = await db.prepare(
    `SELECT
       i.email,
       m.display_name,
       COALESCE(m.role, i.role) AS role,
       COALESCE(m.active, i.active) AS active,
       m.password_login_ready_at,
       CASE WHEN m.subject IS NULL THEN 0 ELSE 1 END AS provisioned,
       CASE WHEN m.updated_at > i.updated_at THEN m.updated_at ELSE i.updated_at END AS updated_at
     FROM cms_member_invitations i
     LEFT JOIN cms_members m ON m.email = i.email COLLATE NOCASE
     ORDER BY i.email COLLATE NOCASE ASC`
  ).all<MemberListRow>();

  return result.results.map((row) => {
    const role = parseRole(row.role);
    if (!role) throw new Error("CMS member role is invalid.");
    return {
      active: row.active === 1,
      displayName: row.display_name,
      email: row.email,
      passwordLoginReadyAt: row.password_login_ready_at,
      provisioned: row.provisioned === 1,
      role,
      updatedAt: row.updated_at
    };
  });
}

export async function updateCmsMemberProfile(
  db: D1Database,
  identity: CmsIdentity,
  displayName: string,
  now = new Date(),
  context: CmsMutationContext = {}
): Promise<CmsSession> {
  const normalizedName = displayName.trim();
  const timestamp = now.toISOString();
  try {
    const results = await db.batch([
      db.prepare(
        `UPDATE cms_members
         SET display_name = ?1, updated_at = ?2
         WHERE subject = ?3 AND active = 1`
      ).bind(normalizedName, timestamp, identity.subject),
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         VALUES (?1, NULL, ?2, 'profile.updated', ?3, ?4)`
      ).bind(
        crypto.randomUUID(),
        identity.subject,
        JSON.stringify(auditMetadata({ displayName: normalizedName }, context)),
        timestamp
      )
    ]);
    if (results[0]?.meta.changes !== 1) {
      throw new CmsRepositoryError("member_not_registered", "このCMSメンバーは無効です。");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("invalid_cms_display_name")) {
      throw new CmsRepositoryError("invalid_display_name", "表示名は1〜80文字の1行で入力してください。");
    }
    throw error;
  }
  return resolveExistingCmsSession(db, identity);
}

export async function upsertCmsMemberInvitation(
  db: D1Database,
  identity: CmsIdentity,
  input: { active: boolean; email: string; role: CmsRole },
  now = new Date(),
  context: CmsMutationContext = {}
): Promise<CmsMember[]> {
  requirePermission(identity.role, "manage_members");
  const timestamp = now.toISOString();
  const email = input.email.trim().toLowerCase();
  const existing = await db.prepare(
    "SELECT email, role, active FROM cms_member_invitations WHERE email = ?1 COLLATE NOCASE"
  ).bind(email).first<InvitationRow>();
  if (
    existing?.active === 1 &&
    existing.role === "admin" &&
    (!input.active || input.role !== "admin")
  ) {
    const otherActiveAdminCount = await db.prepare(
      `SELECT COUNT(*) AS count
       FROM cms_members
       WHERE role = 'admin' AND active = 1 AND email <> ?1 COLLATE NOCASE`
    ).bind(email).first<number>("count");
    if ((otherActiveAdminCount ?? 0) < 1) {
      throw new CmsRepositoryError(
        "last_admin_required",
        "最後の管理者は無効化したり別の役割へ変更したりできません。"
      );
    }
  }
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO cms_member_invitations
          (email, role, active, invited_by_subject, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(email) DO UPDATE SET
           role = excluded.role,
           active = excluded.active,
           invited_by_subject = excluded.invited_by_subject,
           updated_at = excluded.updated_at`
      ).bind(email, input.role, input.active ? 1 : 0, identity.subject, timestamp),
      db.prepare(
        `UPDATE cms_members
         SET role = ?1, active = ?2, updated_at = ?3
         WHERE email = ?4 COLLATE NOCASE`
      ).bind(input.role, input.active ? 1 : 0, timestamp, email),
      db.prepare(
        `INSERT INTO cms_audit_events
          (id, article_id, actor_subject, action, metadata_json, created_at)
         VALUES (?1, NULL, ?2, 'member.updated', ?3, ?4)`
      ).bind(
        crypto.randomUUID(),
        identity.subject,
        JSON.stringify(auditMetadata({ active: input.active, email, role: input.role }, context)),
        timestamp
      )
    ]);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("last_active_cms_admin_required")
    ) {
      throw new CmsRepositoryError(
        "last_admin_required",
        "最後の管理者は無効化したり別の役割へ変更したりできません。"
      );
    }
    throw error;
  }
  return listCmsMembers(db, identity);
}

async function getCurrentArticleRow(
  db: D1Database,
  articleId: string
): Promise<CurrentArticleRow> {
  const row = await db.prepare(
    `SELECT
       a.approved_revision_id,
       a.current_revision_id,
       a.current_revision_number,
       a.draft_visibility,
       a.lock_version,
       a.publication_status,
       a.published_at,
       a.published_revision_id,
       a.published_slug,
       a.review_requested_at,
       a.reviewed_at,
       a.reviewed_by_subject,
       a.review_status,
       a.slug,
       r.created_by_subject AS current_revision_created_by_subject
     FROM cms_articles a
     JOIN cms_article_revisions r ON r.id = a.current_revision_id
     WHERE a.id = ?1`
  ).bind(articleId).first<CurrentArticleRow>();
  if (!row) throw articleNotFound();
  return row;
}

async function countOpenReviewComments(db: D1Database, articleId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM cms_review_comments
     WHERE article_id = ?1 AND status = 'open'`
  ).bind(articleId).first<{ count: number }>();
  return row?.count ?? 0;
}

function articleListSelect(): string {
  return `SELECT ${articleListColumns()}
  FROM cms_articles a
  JOIN cms_article_revisions r ON r.id = a.current_revision_id
  LEFT JOIN cms_members m ON m.subject = a.updated_by_subject`;
}

function articleListColumns(): string {
  return `a.id,
    a.slug,
    a.review_status,
    a.publication_status,
    a.draft_visibility,
    a.lock_version,
    a.current_revision_number,
    a.updated_at,
    COALESCE(m.email, 'unknown') AS updated_by_email,
    json_extract(r.frontmatter_json, '$.title') AS title`;
}

function articleDetailSelect(): string {
  return `SELECT ${articleListColumns()},
    a.approved_revision_id,
    a.created_at,
    a.created_by_subject,
    a.current_revision_id,
    a.published_at,
    a.published_revision_id,
    a.published_revision_number,
    a.published_slug,
    a.published_visibility,
    a.review_note,
    a.updated_by_subject,
    r.created_at AS current_revision_created_at,
    r.created_by_subject AS current_revision_created_by_subject,
    COALESCE(rm.email, 'unknown') AS current_revision_created_by_email,
    rm.display_name AS current_revision_editor_display_name,
    rm.public_id AS current_revision_editor_public_id,
    r.frontmatter_json,
    r.markdown
  FROM cms_articles a
  JOIN cms_article_revisions r ON r.id = a.current_revision_id
  LEFT JOIN cms_members m ON m.subject = a.updated_by_subject
  LEFT JOIN cms_members rm ON rm.subject = r.created_by_subject`;
}

function assetSelect(): string {
  return `SELECT
    a.id,
    a.r2_key,
    a.original_name,
    a.content_type,
    a.byte_size,
    a.width,
    a.height,
    a.alt,
    a.tags_json,
    a.status,
    a.created_at,
    a.updated_at,
    COALESCE(m.email, 'unknown') AS created_by_email,
    (SELECT COUNT(*) FROM cms_asset_references ar WHERE ar.asset_id = a.id) AS reference_count
  FROM cms_assets a
  LEFT JOIN cms_members m ON m.subject = a.created_by_subject`;
}

async function getCmsAsset(db: D1Database, assetId: string): Promise<CmsAsset> {
  const row = await db.prepare(`${assetSelect()} WHERE a.id = ?1`)
    .bind(assetId)
    .first<AssetRow>();
  if (!row) throw assetNotFound();
  return parseAsset(row);
}

async function getCmsAssetByKey(db: D1Database, r2Key: string): Promise<CmsAsset> {
  const row = await db.prepare(`${assetSelect()} WHERE a.r2_key = ?1`)
    .bind(r2Key)
    .first<AssetRow>();
  if (!row) throw assetNotFound();
  return parseAsset(row);
}

function parseAsset(row: AssetRow): CmsAsset {
  const status = cmsAssetStatusSchema.safeParse(row.status);
  let tags: unknown;
  try {
    tags = JSON.parse(row.tags_json) as unknown;
  } catch {
    throw new Error("CMS asset tags are not valid JSON.");
  }
  const parsedTags = z.array(z.string()).safeParse(tags);
  if (!status.success || !parsedTags.success) {
    throw new Error("CMS asset metadata is invalid.");
  }
  return {
    alt: row.alt,
    byteSize: row.byte_size,
    contentType: row.content_type,
    createdAt: row.created_at,
    createdByEmail: row.created_by_email,
    height: row.height,
    id: row.id,
    markdownUrl: `/media/${row.r2_key}`,
    originalName: row.original_name,
    previewUrl: `/api/cms/assets/${row.r2_key}`,
    referenceCount: row.reference_count,
    status: status.data,
    tags: parsedTags.data,
    updatedAt: row.updated_at,
    width: row.width
  };
}

function parseArticleSummary(row: ArticleListRow): CmsArticleSummary {
  const reviewStatus = cmsReviewStatusSchema.safeParse(row.review_status);
  const publicationStatus = cmsPublicationStatusSchema.safeParse(row.publication_status);
  const visibility = cmsVisibilitySchema.safeParse(row.draft_visibility);
  if (!reviewStatus.success || !publicationStatus.success || !visibility.success) {
    throw new Error("CMS article metadata is invalid.");
  }
  return {
    id: row.id,
    lockVersion: row.lock_version,
    publicationStatus: publicationStatus.data,
    revisionNumber: row.current_revision_number,
    reviewStatus: reviewStatus.data,
    slug: row.slug,
    title: row.title,
    updatedAt: row.updated_at,
    updatedByEmail: row.updated_by_email,
    visibility: visibility.data
  };
}

function parseArticleDetail(row: ArticleDetailRow): CmsArticleDetail {
  const summary = parseArticleSummary(row);
  let rawFrontmatter: unknown;
  try {
    rawFrontmatter = JSON.parse(row.frontmatter_json) as unknown;
  } catch {
    throw new Error("CMS revision frontmatter is not valid JSON.");
  }
  const frontmatter = cmsDraftFrontmatterSchema.safeParse(rawFrontmatter);
  const publishedVisibility = row.published_visibility === null
    ? null
    : cmsVisibilitySchema.safeParse(row.published_visibility);
  if (!frontmatter.success || (publishedVisibility !== null && !publishedVisibility.success)) {
    throw new Error("CMS revision data is invalid.");
  }

  return {
    ...summary,
    currentRevision: {
      createdAt: row.current_revision_created_at,
      createdByEmail: row.current_revision_created_by_email,
      editor: row.current_revision_editor_display_name && row.current_revision_editor_public_id
        ? {
            displayName: row.current_revision_editor_display_name,
            publicId: row.current_revision_editor_public_id
          }
        : null,
      frontmatter: frontmatter.data,
      id: row.current_revision_id,
      markdown: row.markdown,
      number: row.current_revision_number
    },
    publishedRevisionNumber: row.published_revision_number,
    publishedSlug: row.published_slug,
    publishedVisibility: publishedVisibility === null ? null : publishedVisibility.data,
    reviewNote: row.review_note
  };
}

function parseArticleVersionSummary(row: ArticleVersionSummaryRow): CmsArticleVersionSummary {
  const reason = cmsRevisionSaveReasonSchema.safeParse(row.reason);
  if (!reason.success) throw new Error("CMS revision history reason is invalid.");
  return {
    checkpointCount: row.checkpoint_count,
    createdAt: row.created_at,
    createdByEmail: row.created_by_email,
    firstRevisionNumber: row.first_revision_number,
    id: row.version_id,
    isApproved: row.is_approved === 1,
    isCurrent: row.is_current === 1,
    isPublished: row.is_published === 1,
    latestRevisionId: row.latest_revision_id,
    latestRevisionNumber: row.latest_revision_number,
    reason: reason.data,
    sourceRevisionId: row.source_revision_id,
    updatedAt: row.updated_at
  };
}

function parseArticleVersionDetail(row: ArticleVersionDetailRow): CmsArticleVersionDetail {
  let rawFrontmatter: unknown;
  try {
    rawFrontmatter = JSON.parse(row.frontmatter_json) as unknown;
  } catch {
    throw new Error("CMS revision frontmatter is not valid JSON.");
  }
  const frontmatter = cmsDraftFrontmatterSchema.safeParse(rawFrontmatter);
  const reason = cmsRevisionSaveReasonSchema.safeParse(row.reason);
  const visibility = row.visibility === null
    ? { data: null, success: true } as const
    : cmsVisibilitySchema.safeParse(row.visibility);
  if (!frontmatter.success || !reason.success || !visibility.success) {
    throw new Error("CMS revision history data is invalid.");
  }
  return {
    isApproved: row.is_approved === 1,
    isCurrent: row.is_current === 1,
    isPublished: row.is_published === 1,
    reason: reason.data,
    revision: {
      createdAt: row.created_at,
      createdByEmail: row.created_by_email,
      editor: row.editor_display_name && row.editor_public_id
        ? { displayName: row.editor_display_name, publicId: row.editor_public_id }
        : null,
      frontmatter: frontmatter.data,
      id: row.id,
      markdown: row.markdown,
      number: row.revision_number
    },
    sourceRevisionId: row.source_revision_id,
    visibility: visibility.data
  };
}

function parseArticleVersionCheckpoint(row: ArticleVersionCheckpointRow): CmsArticleVersionCheckpoint {
  const reason = cmsRevisionSaveReasonSchema.safeParse(row.reason);
  if (!reason.success) throw new Error("CMS revision checkpoint reason is invalid.");
  return {
    createdAt: row.created_at,
    createdByEmail: row.created_by_email,
    id: row.id,
    isApproved: row.is_approved === 1,
    isCurrent: row.is_current === 1,
    isPublished: row.is_published === 1,
    number: row.revision_number,
    reason: reason.data
  };
}

function parseDraftContent(input: CmsArticleContentInput): CmsArticleContentInput {
  const frontmatter = cmsDraftFrontmatterSchema.safeParse(input.frontmatter);
  const visibility = cmsVisibilitySchema.safeParse(input.visibility);
  if (!frontmatter.success || !visibility.success || input.markdown.length > 1_048_576) {
    throw new CmsRepositoryError("invalid_article", "記事データを保存できません。");
  }
  return {
    frontmatter: frontmatter.data,
    markdown: input.markdown,
    visibility: visibility.data
  };
}

function withCmsManagedMetadata(
  content: CmsArticleContentInput,
  now: Date
): CmsArticleContentInput {
  const readableLength = content.markdown
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[[^\]]+\]\([^)]*\)/gu, " ")
    .replace(/[`*_~>#\s]/gu, "")
    .length;
  return {
    ...content,
    frontmatter: {
      ...content.frontmatter,
      estimatedMinutes: Math.min(180, Math.max(1, Math.ceil(readableLength / 500))),
      prerequisites: [],
      publishedAt: undefined,
      updatedAt: now.toISOString().slice(0, 10)
    }
  };
}

function buildTransition(
  current: CurrentArticleRow,
  detail: CmsArticleDetail,
  identity: CmsIdentity,
  action: CmsArticleAction,
  options: { note?: string; visibility?: CmsVisibility },
  timestamp: string
): {
  approvedRevisionId: string | null;
  draftVisibility: CmsVisibility;
  publicationStatus: CmsPublicationStatus;
  publishedAt: string | null;
  publishedRevisionId: string | null;
  publishedRevisionNumber: number | null;
  publishedSlug: string | null;
  publishedVisibility: CmsVisibility | null;
  reviewNote: string | null;
  reviewRequestedAt: string | null;
  reviewedAt: string | null;
  reviewedBySubject: string | null;
  reviewStatus: CmsReviewStatus;
} {
  const reviewStatus = parseReviewStatus(current.review_status);
  const publicationStatus = parsePublicationStatus(current.publication_status);
  const draftVisibility = parseVisibility(current.draft_visibility);
  const base = {
    approvedRevisionId: current.approved_revision_id,
    draftVisibility,
    publicationStatus,
    publishedAt: current.published_at,
    publishedRevisionId: current.published_revision_id,
    publishedRevisionNumber: detail.publishedRevisionNumber,
    publishedSlug: current.published_slug,
    publishedVisibility: detail.publishedVisibility,
    reviewNote: detail.reviewNote,
    reviewRequestedAt: current.review_requested_at,
    reviewedAt: current.reviewed_at,
    reviewedBySubject: current.reviewed_by_subject,
    reviewStatus
  };

  switch (action) {
    case "request_review": {
      requirePermission(identity.role, "edit");
      if (!new Set<CmsReviewStatus>(["draft", "changes_requested"]).has(reviewStatus)) {
        throw invalidTransition();
      }
      const issues = validateCmsArticleForReview({
        frontmatter: detail.currentRevision.frontmatter,
        markdown: detail.currentRevision.markdown
      });
      if (issues.length > 0) {
        throw new CmsRepositoryError(
          "invalid_article",
          "レビュー依頼前に記事の入力を確認してください。",
          issues
        );
      }
      return {
        ...base,
        approvedRevisionId: null,
        reviewNote: options.note ?? null,
        reviewRequestedAt: timestamp,
        reviewStatus: "in_review"
      };
    }
    case "withdraw_review": {
      requirePermission(identity.role, "edit");
      if (reviewStatus !== "in_review") throw invalidTransition();
      return {
        ...base,
        approvedRevisionId: null,
        reviewNote: null,
        reviewedAt: null,
        reviewedBySubject: null,
        reviewStatus: "draft"
      };
    }
    case "approve": {
      requirePermission(identity.role, "approve");
      if (reviewStatus !== "in_review") throw invalidTransition();
      if (
        identity.role !== "admin" &&
        current.current_revision_created_by_subject === identity.subject
      ) {
        throw new CmsRepositoryError(
          "self_approval_forbidden",
          "自分が保存した最新版は別のレビュー担当者が承認してください。"
        );
      }
      return {
        ...base,
        approvedRevisionId: current.current_revision_id,
        reviewNote: options.note ?? null,
        reviewedAt: timestamp,
        reviewedBySubject: identity.subject,
        reviewStatus: "approved"
      };
    }
    case "revoke_approval": {
      requirePermission(identity.role, "approve");
      if (reviewStatus !== "approved") throw invalidTransition();
      return {
        ...base,
        approvedRevisionId: null,
        reviewNote: null,
        reviewedAt: null,
        reviewedBySubject: null,
        reviewStatus: "in_review"
      };
    }
    case "request_changes": {
      requirePermission(identity.role, "approve");
      if (!new Set<CmsReviewStatus>(["in_review", "approved"]).has(reviewStatus)) {
        throw invalidTransition();
      }
      if (!options.note?.trim()) {
        throw new CmsRepositoryError("invalid_transition", "修正を依頼する理由を入力してください。");
      }
      return {
        ...base,
        approvedRevisionId: null,
        reviewNote: options.note ?? null,
        reviewedAt: timestamp,
        reviewedBySubject: identity.subject,
        reviewStatus: "changes_requested"
      };
    }
    case "publish": {
      requirePermission(identity.role, "publish");
      if (
        publicationStatus === "archived" ||
        reviewStatus !== "approved" ||
        current.approved_revision_id !== current.current_revision_id
      ) {
        throw invalidTransition();
      }
      const issues = validateCmsArticleForReview({
        frontmatter: detail.currentRevision.frontmatter,
        markdown: detail.currentRevision.markdown
      });
      if (issues.length > 0) {
        throw new CmsRepositoryError(
          "invalid_article",
          "公開前に記事の入力を確認してください。",
          issues
        );
      }
      const visibility = options.visibility ?? draftVisibility;
      if (visibility === "restricted") {
        throw new CmsRepositoryError(
          "invalid_transition",
          "指定メンバー公開は読者認証の設定後に利用できます。"
        );
      }
      if (visibility === "internal") {
        throw new CmsRepositoryError(
          "invalid_transition",
          "運営メンバー限定の原稿は公開ブログへ公開できません。"
        );
      }
      return {
        ...base,
        draftVisibility: visibility,
        publicationStatus: "published",
        publishedAt: timestamp,
        publishedRevisionId: current.current_revision_id,
        publishedRevisionNumber: current.current_revision_number,
        publishedSlug: current.slug,
        publishedVisibility: visibility
      };
    }
    case "archive": {
      requirePermission(identity.role, "publish");
      if (publicationStatus !== "published") throw invalidTransition();
      return { ...base, publicationStatus: "archived" };
    }
    case "restore": {
      requirePermission(identity.role, "publish");
      if (publicationStatus !== "archived") throw invalidTransition();
      return { ...base, publicationStatus: "unpublished" };
    }
  }

  throw invalidTransition();
}

function parseReviewComment(row: ReviewCommentRow): CmsReviewComment {
  const target = cmsReviewCommentTargetSchema.safeParse(row.target);
  const status = cmsReviewCommentStatusSchema.safeParse(row.status);
  if (!target.success) throw new Error("CMS review comment target is invalid.");
  if (!status.success) throw new Error("CMS review comment status is invalid.");
  const anchor = row.anchor_start === null || row.anchor_end === null || row.anchor_quote === null
    ? null
    : cmsReviewCommentAnchorSchema.parse({
        endOffset: row.anchor_end,
        prefix: row.anchor_prefix ?? "",
        quote: row.anchor_quote,
        startOffset: row.anchor_start,
        suffix: row.anchor_suffix ?? ""
      });
  return {
    anchor,
    articleId: row.article_id,
    authorEmail: row.author_email,
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    resolvedAt: row.resolved_at,
    resolvedByEmail: row.resolved_by_email,
    resolvedRevisionId: row.resolved_revision_id,
    resolvedRevisionNumber: row.resolved_revision_number,
    revisionId: row.revision_id,
    revisionNumber: row.revision_number,
    status: status.data,
    target: target.data
  };
}

function requirePermission(role: CmsRole, permission: Parameters<typeof canCms>[1]): void {
  if (!canCms(role, permission)) {
    throw new CmsRepositoryError("forbidden", "この操作を行う権限がありません。");
  }
}

function parseRole(value: unknown): CmsRole | null {
  const parsed = cmsRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseReviewStatus(value: unknown): CmsReviewStatus {
  const parsed = cmsReviewStatusSchema.safeParse(value);
  if (!parsed.success) throw new Error("CMS review status is invalid.");
  return parsed.data;
}

function parsePublicationStatus(value: unknown): CmsPublicationStatus {
  const parsed = cmsPublicationStatusSchema.safeParse(value);
  if (!parsed.success) throw new Error("CMS publication status is invalid.");
  return parsed.data;
}

function parseVisibility(value: unknown): CmsVisibility {
  const parsed = cmsVisibilitySchema.safeParse(value);
  if (!parsed.success) throw new Error("CMS visibility is invalid.");
  return parsed.data;
}

function canonicalDraftSlug(value: string, articleId: string): string {
  const candidate = value.trim();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate)
    ? candidate
    : `draft-${articleId.slice(0, 12)}`;
}

async function contentChecksum(input: CmsArticleContentInput): Promise<string> {
  return sha256(JSON.stringify({
    frontmatter: input.frontmatter,
    markdown: input.markdown,
    visibility: input.visibility
  }));
}

async function operationChecksum(input: {
  articleId: string;
  content: CmsArticleContentInput;
  expectedVersion: number;
  sourceRevisionId?: string;
}): Promise<string> {
  return sha256(JSON.stringify(input));
}

async function transitionChecksum(input: {
  action: CmsArticleAction;
  articleId: string;
  expectedVersion: number;
  note?: string;
  visibility?: CmsVisibility;
}): Promise<string> {
  return sha256(JSON.stringify({
    action: input.action,
    articleId: input.articleId,
    expectedVersion: input.expectedVersion,
    note: input.note ?? null,
    visibility: input.visibility ?? null
  }));
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function auditMetadata(
  metadata: Record<string, unknown>,
  context: CmsMutationContext
): Record<string, unknown> {
  return {
    ...metadata,
    ...(context.channel ? { channel: context.channel } : {}),
    ...(context.client ? { client: context.client.slice(0, 200) } : {}),
    ...(context.tool ? { tool: context.tool } : {}),
    ...(context.idempotency ? {
      requestId: context.idempotency.requestId,
      tool: context.idempotency.toolName
    } : {})
  };
}

function idempotencyStatements(
  db: D1Database,
  identity: CmsIdentity,
  context: CmsMutationContext,
  checksum: string,
  articleId: string,
  timestamp: string,
  revisionGuard?: { lockVersion: number; revisionId: string }
): D1PreparedStatement[] {
  if (!context.idempotency) return [];
  if (revisionGuard) {
    return [db.prepare(
      `INSERT INTO cms_mcp_idempotency
        (actor_subject, tool_name, request_id, input_sha256, article_id, created_at)
       SELECT ?1, ?2, ?3, ?4, id, ?5
       FROM cms_articles
       WHERE id = ?6 AND lock_version = ?7 AND current_revision_id = ?8`
    ).bind(
      identity.subject,
      context.idempotency.toolName,
      context.idempotency.requestId,
      checksum,
      timestamp,
      articleId,
      revisionGuard.lockVersion,
      revisionGuard.revisionId
    )];
  }
  return [db.prepare(
    `INSERT INTO cms_mcp_idempotency
      (actor_subject, tool_name, request_id, input_sha256, article_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(
    identity.subject,
    context.idempotency.toolName,
    context.idempotency.requestId,
    checksum,
    articleId,
    timestamp
  )];
}

function idempotencyStatementForAudit(
  db: D1Database,
  identity: CmsIdentity,
  context: CmsMutationContext,
  checksum: string,
  auditId: string,
  timestamp: string
): D1PreparedStatement[] {
  if (!context.idempotency) return [];
  return [db.prepare(
    `INSERT INTO cms_mcp_idempotency
      (actor_subject, tool_name, request_id, input_sha256, article_id, created_at)
     SELECT ?1, ?2, ?3, ?4, article_id, ?5
     FROM cms_audit_events
     WHERE id = ?6 AND actor_subject = ?1`
  ).bind(
    identity.subject,
    context.idempotency.toolName,
    context.idempotency.requestId,
    checksum,
    timestamp,
    auditId
  )];
}

async function findIdempotentArticle(
  db: D1Database,
  identity: CmsIdentity,
  context: CmsMutationContext,
  checksum: string
): Promise<string | null> {
  if (!context.idempotency) return null;
  const row = await db.prepare(
    `SELECT article_id, input_sha256
     FROM cms_mcp_idempotency
     WHERE actor_subject = ?1 AND tool_name = ?2 AND request_id = ?3`
  ).bind(
    identity.subject,
    context.idempotency.toolName,
    context.idempotency.requestId
  ).first<IdempotencyRow>();
  if (!row) return null;
  if (row.input_sha256 !== checksum) {
    throw new CmsRepositoryError(
      "idempotency_conflict",
      "同じrequestIdが異なる入力ですでに使用されています。"
    );
  }
  return row.article_id;
}

function idempotencyConflict(): CmsRepositoryError {
  return new CmsRepositoryError(
    "idempotency_conflict",
    "同じrequestIdが異なる入力ですでに使用されています。"
  );
}

function normalizeEmail(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function isUniqueConstraint(error: unknown, field: string): boolean {
  return error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes(field);
}

function isIdempotencyConstraint(error: unknown): boolean {
  return isUniqueConstraint(error, "cms_mcp_idempotency");
}

function isAssetIdempotencyConstraint(error: unknown): boolean {
  return isUniqueConstraint(error, "cms_mcp_asset_idempotency");
}

function articleNotFound(): CmsRepositoryError {
  return new CmsRepositoryError("article_not_found", "記事が見つかりません。");
}

function assetNotFound(): CmsRepositoryError {
  return new CmsRepositoryError("asset_not_found", "画像が見つかりません。");
}

function assetConflict(): CmsRepositoryError {
  return new CmsRepositoryError(
    "asset_conflict",
    "別の編集者が画像情報を更新しました。Asset一覧を読み直してください。"
  );
}

function invalidAssetTransition(): CmsRepositoryError {
  return new CmsRepositoryError(
    "invalid_transition",
    "現在の画像状態ではこの操作を行えません。"
  );
}

function revisionConflict(): CmsRepositoryError {
  return new CmsRepositoryError(
    "revision_conflict",
    "別の編集者が記事を更新しました。最新版を読み込んでください。"
  );
}

function slugConflict(): CmsRepositoryError {
  return new CmsRepositoryError(
    "slug_conflict",
    "同じslugの記事がすでに存在するか、公開中の記事URLとして使われています。"
  );
}

function invalidTransition(): CmsRepositoryError {
  return new CmsRepositoryError(
    "invalid_transition",
    "現在の記事状態ではこの操作を行えません。"
  );
}
