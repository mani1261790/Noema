import type { CmsPublicationDatabase } from "./cms-publication-repository";

export async function isAssetReferencedByPublishedArticle(
  db: CmsPublicationDatabase,
  assetPath: string
): Promise<boolean> {
  const row = await db.prepare(
    `SELECT 1 AS found
     FROM cms_articles a
     JOIN cms_article_revisions r ON r.id = a.published_revision_id
     WHERE a.publication_status = 'published'
       AND a.published_visibility IN ('public', 'unlisted')
       AND (instr(r.markdown, ?1) > 0 OR instr(r.frontmatter_json, ?1) > 0)
     LIMIT 1`
  ).bind(assetPath).first<{ found: number }>();
  return row?.found === 1;
}

export function isArticleAssetKey(key: string): boolean {
  return /^articles\/[0-9a-f-]{36}\.(?:gif|jpe?g|png|webp)$/i.test(key);
}
