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
  publishedAt: string;
  revisionNumber: number;
  visibility: Extract<CmsVisibility, "public" | "unlisted">;
}

export interface CmsPublishedArticle extends CmsPublishedArticleSummary {
  markdown: string;
}

interface CmsPublishedArticleRow {
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
  r.revision_number`;

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

function isoDate(value: string, field: string): string {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`CMS ${field} is not a valid ISO date.`);
  }
  return date;
}
