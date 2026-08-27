import type { ImageDimensions } from "@noema/content/image-metadata";
import type { CmsPublicationDatabase } from "./cms-publication-repository";

interface PublishedAssetRow {
  height: number | null;
  width: number | null;
}

interface AssetDimensionRow extends PublishedAssetRow {
  r2_key: string;
}

interface CmsAssetMutationStatement {
  bind(...values: unknown[]): CmsAssetMutationStatement;
  run(): Promise<unknown>;
}

export interface CmsAssetMutationDatabase {
  prepare(query: string): CmsAssetMutationStatement;
}

export interface PublishedArticleAssetMetadata {
  dimensions: ImageDimensions | null;
}

export async function getPublishedArticleAssetMetadata(
  db: CmsPublicationDatabase,
  assetPath: string,
): Promise<PublishedArticleAssetMetadata | null> {
  const key = articleAssetKeyFromReference(assetPath);
  if (!key) return null;
  const row = await db.prepare(
    `SELECT asset.width, asset.height
     FROM cms_assets asset
     WHERE asset.r2_key = ?1
       AND asset.status = 'active'
       AND EXISTS (
         SELECT 1
         FROM cms_articles article
         JOIN cms_article_revisions revision ON revision.id = article.published_revision_id
         WHERE article.publication_status = 'published'
           AND article.published_visibility IN ('public', 'unlisted')
           AND (instr(revision.markdown, ?2) > 0 OR instr(revision.frontmatter_json, ?2) > 0)
       )
     LIMIT 1`,
  ).bind(key, assetPath).first<PublishedAssetRow>();
  if (!row) return null;
  return { dimensions: validDimensions(row) };
}

export async function getCmsArticleAssetDimensions(
  db: CmsPublicationDatabase,
  references: Iterable<string>,
): Promise<Map<string, ImageDimensions>> {
  const referencesByKey = new Map<string, string[]>();
  for (const reference of new Set(references)) {
    const key = articleAssetKeyFromReference(reference);
    if (!key) continue;
    const current = referencesByKey.get(key) ?? [];
    current.push(reference);
    referencesByKey.set(key, current);
  }

  const dimensions = new Map<string, ImageDimensions>();
  const keys = [...referencesByKey.keys()];
  for (let offset = 0; offset < keys.length; offset += 50) {
    const chunk = keys.slice(offset, offset + 50);
    const placeholders = chunk.map((_, index) => `?${index + 1}`).join(", ");
    const rows = await db.prepare(
      `SELECT r2_key, width, height
       FROM cms_assets
       WHERE status = 'active'
         AND r2_key IN (${placeholders})`,
    ).bind(...chunk).all<AssetDimensionRow>();
    for (const row of rows.results) {
      const value = validDimensions(row);
      if (!value) continue;
      for (const reference of referencesByKey.get(row.r2_key) ?? []) {
        dimensions.set(reference, value);
      }
    }
  }
  return dimensions;
}

export async function recordCmsAssetDimensions(
  db: CmsAssetMutationDatabase,
  key: string,
  dimensions: ImageDimensions,
): Promise<void> {
  if (!isArticleAssetKey(key) || !validDimensions(dimensions)) return;
  await db.prepare(
    `UPDATE cms_assets
     SET width = ?1, height = ?2
     WHERE r2_key = ?3
       AND status = 'active'
       AND (width IS NULL OR height IS NULL)`,
  ).bind(dimensions.width, dimensions.height, key).run();
}

export function isArticleAssetKey(key: string): boolean {
  return /^articles\/[0-9a-f-]{36}\.(?:gif|jpe?g|png|webp)$/i.test(key);
}

function articleAssetKeyFromReference(reference: string): string | null {
  let url: URL;
  try {
    url = new URL(reference, "https://noema-learn.uk");
  } catch {
    return null;
  }
  if (url.origin !== "https://noema-learn.uk") return null;
  const key = url.pathname.startsWith("/media/") ? url.pathname.slice("/media/".length) : "";
  return isArticleAssetKey(key) ? key : null;
}

function validDimensions(value: PublishedAssetRow | ImageDimensions): ImageDimensions | null {
  return Number.isInteger(value.width) && Number.isInteger(value.height) &&
      (value.width ?? 0) > 0 && (value.height ?? 0) > 0 &&
      (value.width ?? 0) <= 100_000 && (value.height ?? 0) <= 100_000
    ? { height: value.height as number, width: value.width as number }
    : null;
}
