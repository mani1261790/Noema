import {
  canCms,
  cmsCapabilitiesFor,
  cmsAssetMutationSchema,
  cmsAssetStatusSchema,
  cmsDraftFrontmatterSchema,
  cmsPublicationStatusSchema,
  cmsReviewStatusSchema,
  cmsRoleSchema,
  cmsVisibilitySchema,
  validateCmsArticleForReview,
  type CmsArticleAction,
  type CmsAsset,
  type CmsArticleDetail,
  type CmsArticleSummary,
  type CmsIdentity,
  type CmsMember,
  type CmsPublicationStatus,
  type CmsReviewStatus,
  type CmsRole,
  type CmsSession,
  type CmsVisibility
} from "@noema/cms";
import type { ArticleFrontmatter } from "@noema/content";
import { z } from "zod";

interface MemberRow {
  active: number;
  email: string;
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

interface MemberListRow {
  active: number;
  email: string;
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
  | "article_not_found"
  | "asset_conflict"
  | "asset_in_use"
  | "asset_not_found"
  | "cms_not_configured"
  | "forbidden"
  | "idempotency_conflict"
  | "invalid_article"
  | "invalid_asset"
  | "invalid_transition"
  | "last_admin_required"
  | "member_not_registered"
  | "revision_conflict"
  | "self_approval_forbidden"
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

export interface CmsMutationContext {
  channel?: "mcp" | "web";
  client?: string;
  idempotency?: {
    requestId: string;
    toolName:
      | "studio_create_draft"
      | "studio_request_changes"
      | "studio_request_review"
      | "studio_update_draft";
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

export async function resolveCmsSession(
  db: D1Database,
  accessIdentity: { email: string; subject: string },
  bootstrapAdminEmail: string | undefined,
  now = new Date()
): Promise<CmsSession> {
  const normalizedEmail = accessIdentity.email.trim().toLowerCase();
  let member = await db.prepare(
    "SELECT subject, email, role, active FROM cms_members WHERE subject = ?1"
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
      "SELECT subject, email, role, active FROM cms_members WHERE subject = ?1"
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
    "SELECT subject, email, role, active FROM cms_members WHERE subject = ?1"
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
  if (member.active !== 1 || !role) {
    throw new CmsRepositoryError(
      "member_not_registered",
      "このCMSメンバーは無効です。"
    );
  }

  return {
    capabilities: cmsCapabilitiesFor(role),
    identity: {
      email: member.email,
      role,
      subject: member.subject
    }
  };
}

export async function listCmsArticles(
  db: D1Database,
  identity: CmsIdentity
): Promise<CmsArticleSummary[]> {
  requirePermission(identity.role, "edit");
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
  requirePermission(identity.role, "edit");
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
  toolName: "studio_update_asset" | "studio_upload_asset",
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
    if (current.status !== "active") throw invalidTransition();
    throw assetConflict();
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
  requirePermission(identity.role, "edit");
  const row = await db.prepare(
    `${articleDetailSelect()}
     WHERE a.id = ?1`
  ).bind(articleId).first<ArticleDetailRow>();
  if (!row) throw articleNotFound();
  return parseArticleDetail(row);
}

export async function createCmsArticle(
  db: D1Database,
  identity: CmsIdentity,
  input: CmsArticleContentInput,
  now = new Date(),
  context: CmsMutationContext = {}
): Promise<CmsArticleDetail> {
  requirePermission(identity.role, "edit");
  const content = parseDraftContent(input);
  const articleId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const slug = canonicalDraftSlug(content.frontmatter.slug, articleId);
  const frontmatterJson = JSON.stringify(content.frontmatter);
  const checksum = await contentChecksum(content);
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
          content_sha256, created_by_subject, created_at
        ) VALUES (?1, ?2, 1, ?3, ?4, ?5, ?6, ?7)`
      ).bind(
        revisionId,
        articleId,
        frontmatterJson,
        content.markdown,
        checksum,
        identity.subject,
        timestamp
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
  context: CmsMutationContext = {}
): Promise<CmsArticleDetail> {
  requirePermission(identity.role, "edit");
  const content = parseDraftContent(input);
  const checksum = await operationChecksum({
    articleId,
    content,
    expectedVersion
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

  const revisionId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const timestamp = now.toISOString();
  const nextRevision = current.current_revision_number + 1;
  const nextVersion = expectedVersion + 1;
  const slug = canonicalDraftSlug(content.frontmatter.slug, articleId);
  const contentSha256 = await contentChecksum(content);

  try {
    const results = await db.batch([
      db.prepare(
        `INSERT INTO cms_article_revisions (
          id, article_id, revision_number, frontmatter_json, markdown,
          content_sha256, created_by_subject, created_at
        )
        SELECT ?1, id, ?2, ?3, ?4, ?5, ?6, ?7
        FROM cms_articles
        WHERE id = ?8 AND lock_version = ?9`
      ).bind(
        revisionId,
        nextRevision,
        JSON.stringify(content.frontmatter),
        content.markdown,
        contentSha256,
        identity.subject,
        timestamp,
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
          { revisionId, revisionNumber: nextRevision },
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
  const detail = await getCmsArticle(db, identity, articleId);
  const timestamp = now.toISOString();
  const nextVersion = expectedVersion + 1;
  const auditId = crypto.randomUUID();
  const transition = buildTransition(current, detail, identity, action, options, timestamp);

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

export async function listCmsMembers(
  db: D1Database,
  identity: CmsIdentity
): Promise<CmsMember[]> {
  requirePermission(identity.role, "manage_members");
  const result = await db.prepare(
    `SELECT
       i.email,
       COALESCE(m.role, i.role) AS role,
       COALESCE(m.active, i.active) AS active,
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
      email: row.email,
      provisioned: row.provisioned === 1,
      role,
      updatedAt: row.updated_at
    };
  });
}

export async function upsertCmsMemberInvitation(
  db: D1Database,
  identity: CmsIdentity,
  input: { active: boolean; email: string; role: CmsRole },
  now = new Date()
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
        JSON.stringify({ active: input.active, email, role: input.role }),
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
    case "request_changes": {
      requirePermission(identity.role, "approve");
      if (!new Set<CmsReviewStatus>(["in_review", "approved"]).has(reviewStatus)) {
        throw invalidTransition();
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

function auditMetadata(
  metadata: Record<string, unknown>,
  context: CmsMutationContext
): Record<string, unknown> {
  return {
    ...metadata,
    ...(context.channel ? { channel: context.channel } : {}),
    ...(context.client ? { client: context.client.slice(0, 200) } : {}),
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
