import { cmsDraftFrontmatterSchema, cmsVisibilitySchema, type CmsVisibility } from "@noema/cms";
import { articleFrontmatterSchema, type ArticleFrontmatter, type ArticleSummary } from "@noema/content";
import { toArticleSummary } from "./articles";

export type CmsPublicationAccess = "direct" | "listing";

/**
 * The public reader only needs this narrow database port. A separate
 * Workers-only typecheck verifies that the generated D1 binding satisfies it,
 * while Astro's browser scripts remain on the standard DOM type library.
 */
export interface CmsPublicationStatement {
  all<T = unknown>(): Promise<{ results: T[] }>;
  bind(...values: unknown[]): CmsPublicationStatement;
  first<T = unknown>(): Promise<T | null>;
}

export interface CmsPublicationDatabase {
  prepare(query: string): CmsPublicationStatement;
}

export interface CmsPublishedArticleSummary {
  data: ArticleFrontmatter;
  editor?: CmsPublishedEditor | null;
  publishedAt: string;
  revisionNumber: number;
  visibility: Extract<CmsVisibility, "public" | "unlisted">;
}

export interface CmsPublishedEditor {
  displayName: string;
  href: string;
  publicId: string;
}

export interface CmsPublishedEditorProfile extends CmsPublishedEditor {
  articles: ArticleSummary[];
}

export interface CmsPublishedArticle extends CmsPublishedArticleSummary {
  markdown: string;
}

export interface CmsPublishedSeriesContext {
  currentIndex: number;
  description: string;
  id: string;
  items: ArticleSummary[];
  slug: string;
  title: string;
}

interface CmsPublishedArticleRow {
  editor_display_name?: string | null;
  editor_public_id?: string | null;
  frontmatter_json: string;
  markdown?: string;
  published_at: string;
  published_slug: string;
  published_visibility: string;
  revision_created_at: string;
  revision_number: number;
}

const publishedSummaryColumns = `r.frontmatter_json,
  a.published_at,
  a.published_slug,
  a.published_visibility,
  r.created_at AS revision_created_at,
  r.revision_number,
  m.display_name AS editor_display_name,
  m.public_id AS editor_public_id`;

export function isCmsPublicationVisible(
  visibility: CmsVisibility,
  access: CmsPublicationAccess,
): visibility is Extract<CmsVisibility, "public" | "unlisted"> {
  return visibility === "public" || (access === "direct" && visibility === "unlisted");
}

export function parseCmsPublishedArticleRow(
  row: CmsPublishedArticleRow,
  access: CmsPublicationAccess,
): CmsPublishedArticleSummary | CmsPublishedArticle {
  let rawFrontmatter: unknown;
  try {
    rawFrontmatter = JSON.parse(row.frontmatter_json) as unknown;
  } catch {
    throw new Error("CMS published revision frontmatter is not valid JSON.");
  }

  const draft = cmsDraftFrontmatterSchema.safeParse(rawFrontmatter);
  const visibility = cmsVisibilitySchema.safeParse(row.published_visibility);
  if (!draft.success || !visibility.success || !isCmsPublicationVisible(visibility.data, access)) {
    throw new Error("CMS published revision metadata is invalid for this audience.");
  }

  const publishedAt = isoDate(row.published_at, "published_at");
  const updatedAt = isoDate(row.revision_created_at, "revision_created_at");
  const data = articleFrontmatterSchema.safeParse({
    ...draft.data,
    status: "published",
    publishedAt,
    updatedAt,
  });
  if (!data.success) {
    throw new Error("CMS published revision does not satisfy the article contract.");
  }
  if (data.data.slug !== row.published_slug) {
    throw new Error("CMS published slug does not match the pinned revision.");
  }

  const summary: CmsPublishedArticleSummary = {
    data: data.data,
    editor: row.editor_display_name && row.editor_public_id
      ? {
          displayName: row.editor_display_name,
          href: `/editors/${row.editor_public_id}`,
          publicId: row.editor_public_id,
        }
      : null,
    publishedAt: row.published_at,
    revisionNumber: row.revision_number,
    visibility: visibility.data,
  };
  return typeof row.markdown === "string" ? { ...summary, markdown: row.markdown } : summary;
}

export async function listCmsPublicArticleSummaries(
  db: CmsPublicationDatabase,
): Promise<ArticleSummary[]> {
  const result = await db.prepare(
    `SELECT ${publishedSummaryColumns}
     FROM cms_articles a
     JOIN cms_article_revisions r ON r.id = a.published_revision_id
     LEFT JOIN cms_members m ON m.subject = r.created_by_subject
     WHERE a.publication_status = 'published'
       AND a.published_visibility = 'public'
     ORDER BY a.published_at DESC, a.id ASC`,
  ).all<CmsPublishedArticleRow>();

  return result.results.map((row) =>
    toArticleSummary(parseCmsPublishedArticleRow(row, "listing").data),
  );
}

export async function getCmsPublishedArticleBySlug(
  db: CmsPublicationDatabase,
  slug: string,
): Promise<CmsPublishedArticle | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;

  const row = await db.prepare(
    `SELECT ${publishedSummaryColumns},
       r.markdown
     FROM cms_articles a
     JOIN cms_article_revisions r ON r.id = a.published_revision_id
     LEFT JOIN cms_members m ON m.subject = r.created_by_subject
     WHERE a.publication_status = 'published'
       AND a.published_visibility IN ('public', 'unlisted')
       AND a.published_slug = ?1
     LIMIT 1`,
  ).bind(slug).first<CmsPublishedArticleRow>();

  if (!row) return null;
  const article = parseCmsPublishedArticleRow(row, "direct");
  if (!("markdown" in article)) {
    throw new Error("CMS published revision is missing its Markdown body.");
  }
  return article;
}

export async function getCmsPublishedSeriesByArticleSlug(
  db: CmsPublicationDatabase,
  articleSlug: string,
): Promise<CmsPublishedSeriesContext | null> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(articleSlug)) return null;
  const series = await db.prepare(
    `SELECT s.id, sr.slug, sr.title, sr.description
     FROM cms_articles current_article
     JOIN cms_article_series map ON map.article_id = current_article.id
     JOIN cms_series s ON s.id = map.series_id
     JOIN cms_series_revisions sr ON sr.id = s.published_revision_id
     WHERE current_article.publication_status = 'published'
       AND current_article.published_visibility = 'public'
       AND current_article.published_slug = ?1
       AND map.revision_id = s.published_revision_id
     LIMIT 1`,
  ).bind(articleSlug).first<{ description: string; id: string; slug: string; title: string }>();
  if (!series) return null;

  const result = await db.prepare(
    `SELECT ${publishedSummaryColumns}
     FROM cms_series s
     JOIN cms_series_revision_items item ON item.revision_id = s.published_revision_id
     JOIN cms_articles a ON a.id = item.article_id
     JOIN cms_article_revisions r ON r.id = a.published_revision_id
     LEFT JOIN cms_members m ON m.subject = r.created_by_subject
     WHERE s.id = ?1
       AND a.publication_status = 'published'
       AND a.published_visibility = 'public'
     ORDER BY item.position`,
  ).bind(series.id).all<CmsPublishedArticleRow>();
  const items = result.results.map((row) =>
    toArticleSummary(parseCmsPublishedArticleRow(row, "listing").data),
  );
  const currentIndex = items.findIndex((item) => item.slug === articleSlug);
  if (currentIndex < 0) return null;
  return { ...series, currentIndex, items };
}

export async function getCmsPublishedEditorProfile(
  db: CmsPublicationDatabase,
  publicId: string,
): Promise<CmsPublishedEditorProfile | null> {
  if (!/^[a-f0-9]{32}$/.test(publicId)) return null;
  const editor = await db.prepare(
    `SELECT subject, display_name, public_id
     FROM cms_members
     WHERE public_id = ?1
       AND display_name IS NOT NULL
     LIMIT 1`,
  ).bind(publicId).first<{ display_name: string; public_id: string; subject: string }>();
  if (!editor) return null;

  const result = await db.prepare(
    `SELECT ${publishedSummaryColumns}
     FROM cms_articles a
     JOIN cms_article_revisions r ON r.id = a.published_revision_id
     LEFT JOIN cms_members m ON m.subject = r.created_by_subject
     WHERE a.publication_status = 'published'
       AND a.published_visibility = 'public'
       AND r.created_by_subject = ?1
     ORDER BY a.published_at DESC, a.id ASC`,
  ).bind(editor.subject).all<CmsPublishedArticleRow>();

  return {
    articles: result.results.map((row) => toArticleSummary(parseCmsPublishedArticleRow(row, "listing").data)),
    displayName: editor.display_name,
    href: `/editors/${editor.public_id}`,
    publicId: editor.public_id,
  };
}

export async function listCmsPublishedEditors(
  db: CmsPublicationDatabase,
): Promise<CmsPublishedEditor[]> {
  const result = await db.prepare(
    `SELECT DISTINCT m.display_name, m.public_id
     FROM cms_articles a
     JOIN cms_article_revisions r ON r.id = a.published_revision_id
     JOIN cms_members m ON m.subject = r.created_by_subject
     WHERE a.publication_status = 'published'
       AND a.published_visibility = 'public'
       AND m.display_name IS NOT NULL
       AND m.public_id IS NOT NULL
     ORDER BY m.display_name COLLATE NOCASE, m.public_id`,
  ).all<{ display_name: string; public_id: string }>();
  return result.results.map((editor) => ({
    displayName: editor.display_name,
    href: `/editors/${editor.public_id}`,
    publicId: editor.public_id,
  }));
}

function isoDate(value: string, field: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`CMS ${field} is not a valid ISO date.`);
  }
  return date;
}
