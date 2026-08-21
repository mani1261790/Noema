import {
  canCms,
  cmsPublicationStatusSchema,
  cmsReviewStatusSchema,
  cmsVisibilitySchema,
  type CmsIdentity,
  type CmsSeries,
  type CmsSeriesArticle,
  type CmsSeriesVersion
} from "@noema/cms";
import { CmsRepositoryError } from "./cms-repository";

export interface CmsSeriesContentInput {
  articleIds: string[];
  description: string;
  slug: string;
  title: string;
}

interface SeriesRow {
  article_id: string | null;
  article_publication_status: string | null;
  article_review_status: string | null;
  article_slug: string | null;
  article_title: string | null;
  article_visibility: string | null;
  created_at: string;
  description: string;
  id: string;
  lock_version: number;
  position: number | null;
  revision_number: number;
  slug: string;
  title: string;
  updated_at: string;
  updated_by_email: string;
}

interface VersionRow {
  article_id: string;
  created_at: string;
  created_by_email: string;
  description: string;
  id: string;
  is_current: number;
  position: number;
  restored_from_revision_id: string | null;
  revision_number: number;
  slug: string;
  title: string;
}

const seriesSelect = `SELECT
  s.id,
  s.slug,
  s.title,
  s.description,
  s.lock_version,
  s.current_revision_number AS revision_number,
  s.created_at,
  s.updated_at,
  COALESCE(m.email, 'unknown') AS updated_by_email,
  map.position,
  a.id AS article_id,
  a.slug AS article_slug,
  json_extract(r.frontmatter_json, '$.title') AS article_title,
  a.review_status AS article_review_status,
  a.publication_status AS article_publication_status,
  a.draft_visibility AS article_visibility
FROM cms_series s
LEFT JOIN cms_members m ON m.subject = s.updated_by_subject
LEFT JOIN cms_article_series map ON map.series_id = s.id
LEFT JOIN cms_articles a ON a.id = map.article_id
LEFT JOIN cms_article_revisions r ON r.id = a.current_revision_id`;

export async function listCmsSeries(
  db: D1Database,
  identity: CmsIdentity
): Promise<CmsSeries[]> {
  requireView(identity);
  const result = await db.prepare(`${seriesSelect} ORDER BY s.updated_at DESC, s.id, map.position`).all<SeriesRow>();
  return groupSeriesRows(result.results);
}

export async function createCmsSeries(
  db: D1Database,
  identity: CmsIdentity,
  content: CmsSeriesContentInput
): Promise<CmsSeries> {
  requireEdit(identity);
  await validateSeriesArticles(db, content.articleIds, null);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const statements = [
    db.prepare(`INSERT INTO cms_series (
      id, slug, title, description, lock_version, current_revision_id,
      current_revision_number, published_revision_id, created_by_subject,
      updated_by_subject, created_at, updated_at
    ) VALUES (?1, ?2, ?3, ?4, 1, ?5, 1, ?5, ?6, ?6, ?7, ?7)`)
      .bind(id, content.slug, content.title, content.description, revisionId, identity.subject, now),
    db.prepare(`INSERT INTO cms_series_revisions (
      id, series_id, revision_number, slug, title, description,
      restored_from_revision_id, created_by_subject, created_at
    ) VALUES (?1, ?2, 1, ?3, ?4, ?5, NULL, ?6, ?7)`)
      .bind(revisionId, id, content.slug, content.title, content.description, identity.subject, now),
    ...seriesItemStatements(db, revisionId, id, content.articleIds)
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    throw mapSeriesWriteError(error);
  }
  return getCmsSeries(db, identity, id);
}

export async function updateCmsSeries(
  db: D1Database,
  identity: CmsIdentity,
  id: string,
  expectedVersion: number,
  content: CmsSeriesContentInput,
  restoredFromRevisionId?: string
): Promise<CmsSeries> {
  requireEdit(identity);
  const current = await db.prepare(
    "SELECT lock_version, current_revision_number FROM cms_series WHERE id = ?1"
  ).bind(id).first<{ current_revision_number: number; lock_version: number }>();
  if (!current) throw new CmsRepositoryError("series_not_found", "シリーズが見つかりません。");
  if (current.lock_version !== expectedVersion) {
    throw new CmsRepositoryError("series_conflict", "別の編集者がシリーズを更新しました。最新版を読み込んでください。");
  }
  await validateSeriesArticles(db, content.articleIds, id);
  if (restoredFromRevisionId) {
    const exists = await db.prepare(
      "SELECT 1 AS present FROM cms_series_revisions WHERE id = ?1 AND series_id = ?2"
    ).bind(restoredFromRevisionId, id).first<number>("present");
    if (!exists) throw new CmsRepositoryError("series_not_found", "復元するシリーズ履歴が見つかりません。");
  }

  const now = new Date().toISOString();
  const revisionId = crypto.randomUUID();
  const nextRevision = current.current_revision_number + 1;
  const statements = [
    db.prepare(`INSERT INTO cms_series_revisions (
      id, series_id, revision_number, slug, title, description,
      restored_from_revision_id, created_by_subject, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
      .bind(revisionId, id, nextRevision, content.slug, content.title, content.description, restoredFromRevisionId ?? null, identity.subject, now),
    db.prepare("DELETE FROM cms_article_series WHERE series_id = ?1").bind(id),
    ...seriesItemStatements(db, revisionId, id, content.articleIds),
    db.prepare(`UPDATE cms_series
      SET slug = ?1, title = ?2, description = ?3,
          lock_version = lock_version + 1,
          current_revision_id = ?4,
          current_revision_number = ?5,
          published_revision_id = ?4,
          updated_by_subject = ?6,
          updated_at = ?7
      WHERE id = ?8 AND lock_version = ?9`)
      .bind(content.slug, content.title, content.description, revisionId, nextRevision, identity.subject, now, id, expectedVersion)
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    throw mapSeriesWriteError(error);
  }
  return getCmsSeries(db, identity, id);
}

export async function listCmsSeriesVersions(
  db: D1Database,
  identity: CmsIdentity,
  seriesId: string
): Promise<CmsSeriesVersion[]> {
  requireView(identity);
  const result = await db.prepare(`SELECT
    sr.id,
    sr.revision_number,
    sr.slug,
    sr.title,
    sr.description,
    sr.restored_from_revision_id,
    sr.created_at,
    COALESCE(m.email, 'unknown') AS created_by_email,
    CASE WHEN sr.id = s.current_revision_id THEN 1 ELSE 0 END AS is_current,
    item.article_id,
    item.position
  FROM cms_series_revisions sr
  JOIN cms_series s ON s.id = sr.series_id
  LEFT JOIN cms_members m ON m.subject = sr.created_by_subject
  JOIN cms_series_revision_items item ON item.revision_id = sr.id
  WHERE sr.series_id = ?1
  ORDER BY sr.revision_number DESC, item.position`).bind(seriesId).all<VersionRow>();
  if (result.results.length === 0) {
    const exists = await db.prepare("SELECT 1 AS present FROM cms_series WHERE id = ?1")
      .bind(seriesId).first<number>("present");
    if (!exists) throw new CmsRepositoryError("series_not_found", "シリーズが見つかりません。");
  }
  const versions = new Map<string, CmsSeriesVersion>();
  for (const row of result.results) {
    const current = versions.get(row.id);
    if (current) current.articleIds.push(row.article_id);
    else versions.set(row.id, {
      articleIds: [row.article_id],
      createdAt: row.created_at,
      createdByEmail: row.created_by_email,
      description: row.description,
      id: row.id,
      isCurrent: row.is_current === 1,
      number: row.revision_number,
      restoredFromRevisionId: row.restored_from_revision_id,
      slug: row.slug,
      title: row.title
    });
  }
  return [...versions.values()];
}

async function getCmsSeries(db: D1Database, identity: CmsIdentity, id: string): Promise<CmsSeries> {
  const result = await db.prepare(`${seriesSelect} WHERE s.id = ?1 ORDER BY map.position`).bind(id).all<SeriesRow>();
  const series = groupSeriesRows(result.results)[0];
  if (!series) throw new CmsRepositoryError("series_not_found", "シリーズが見つかりません。");
  return series;
}

function groupSeriesRows(rows: SeriesRow[]): CmsSeries[] {
  const grouped = new Map<string, CmsSeries>();
  for (const row of rows) {
    let series = grouped.get(row.id);
    if (!series) {
      series = {
        articleIds: [],
        articles: [],
        createdAt: row.created_at,
        description: row.description,
        id: row.id,
        lockVersion: row.lock_version,
        revisionNumber: row.revision_number,
        slug: row.slug,
        title: row.title,
        updatedAt: row.updated_at,
        updatedByEmail: row.updated_by_email
      };
      grouped.set(row.id, series);
    }
    if (row.article_id && row.article_slug && row.article_title && row.article_review_status && row.article_publication_status && row.article_visibility) {
      const publicationStatus = cmsPublicationStatusSchema.safeParse(row.article_publication_status);
      const reviewStatus = cmsReviewStatusSchema.safeParse(row.article_review_status);
      const visibility = cmsVisibilitySchema.safeParse(row.article_visibility);
      if (!publicationStatus.success || !reviewStatus.success || !visibility.success) {
        throw new Error("シリーズに含まれる記事の状態がCMS契約と一致しません。");
      }
      const article: CmsSeriesArticle = {
        id: row.article_id,
        publicationStatus: publicationStatus.data,
        reviewStatus: reviewStatus.data,
        slug: row.article_slug,
        title: row.article_title,
        visibility: visibility.data
      };
      series.articleIds.push(article.id);
      series.articles.push(article);
    }
  }
  return [...grouped.values()];
}

function seriesItemStatements(db: D1Database, revisionId: string, seriesId: string, articleIds: string[]) {
  return articleIds.flatMap((articleId, index) => [
    db.prepare("INSERT INTO cms_series_revision_items (revision_id, article_id, position) VALUES (?1, ?2, ?3)")
      .bind(revisionId, articleId, index + 1),
    db.prepare("INSERT INTO cms_article_series (article_id, series_id, revision_id, position) VALUES (?1, ?2, ?3, ?4)")
      .bind(articleId, seriesId, revisionId, index + 1)
  ]);
}

async function validateSeriesArticles(db: D1Database, articleIds: string[], seriesId: string | null): Promise<void> {
  const placeholders = articleIds.map((_, index) => `?${index + 1}`).join(", ");
  const articles = await db.prepare(`SELECT id FROM cms_articles WHERE id IN (${placeholders})`)
    .bind(...articleIds).all<{ id: string }>();
  if (articles.results.length !== articleIds.length) {
    throw new CmsRepositoryError("series_not_found", "シリーズへ追加する記事が見つかりません。");
  }
  const conflict = await db.prepare(`SELECT s.title
    FROM cms_article_series map
    JOIN cms_series s ON s.id = map.series_id
    WHERE map.article_id IN (${placeholders})
      ${seriesId ? `AND map.series_id <> ?${articleIds.length + 1}` : ""}
    LIMIT 1`).bind(...articleIds, ...(seriesId ? [seriesId] : [])).first<{ title: string }>();
  if (conflict) {
    throw new CmsRepositoryError("series_article_conflict", `選択した記事はすでに「${conflict.title}」に含まれています。`);
  }
}

function requireEdit(identity: CmsIdentity): void {
  if (!canCms(identity.role, "edit")) {
    throw new CmsRepositoryError("forbidden", "シリーズを編集する権限がありません。");
  }
}

function requireView(identity: CmsIdentity): void {
  if (!canCms(identity.role, "view")) {
    throw new CmsRepositoryError("forbidden", "シリーズを表示する権限がありません。");
  }
}

function mapSeriesWriteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("cms_series.slug")) {
    return new CmsRepositoryError("series_slug_conflict", "このシリーズslugはすでに使われています。");
  }
  if (message.includes("cms_article_series.article_id")) {
    return new CmsRepositoryError("series_article_conflict", "選択した記事は別のシリーズに含まれています。");
  }
  if (message.includes("cms_series_revisions.series_id") || message.includes("cms_series_revisions.id")) {
    return new CmsRepositoryError("series_conflict", "別の編集者がシリーズを更新しました。最新版を読み込んでください。");
  }
  return error instanceof Error ? error : new Error(message);
}
