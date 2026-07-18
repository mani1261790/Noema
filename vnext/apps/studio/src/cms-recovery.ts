import type { ArticleFrontmatter } from "@noema/content";
import type { CmsArticleDetail, CmsVisibility } from "@noema/cms";
import type { StudioDraftCmsArticle } from "./draft-storage";

export interface CmsRecoveryResolution {
  conflict: boolean;
  saveState: "conflict" | "dirty" | "saved";
  serverFingerprint: string;
}

function contentFingerprint(
  frontmatter: ArticleFrontmatter,
  body: string,
  visibility: CmsVisibility
): string {
  return JSON.stringify({ body, frontmatter, visibility });
}

export function resolveCmsRecoveryState(input: {
  article: CmsArticleDetail;
  localBody: string;
  localFrontmatter: ArticleFrontmatter;
  localVisibility: CmsVisibility;
  reference: StudioDraftCmsArticle;
}): CmsRecoveryResolution {
  const serverFingerprint = contentFingerprint(
    { ...input.article.currentRevision.frontmatter, status: "draft" },
    input.article.currentRevision.markdown,
    input.article.visibility
  );
  const localFingerprint = contentFingerprint(
    { ...input.localFrontmatter, status: "draft" },
    input.localBody,
    input.localVisibility
  );
  const contentChanged = localFingerprint !== serverFingerprint;
  const conflict = contentChanged && input.reference.lockVersion !== input.article.lockVersion;
  return {
    conflict,
    saveState: conflict ? "conflict" : contentChanged ? "dirty" : "saved",
    serverFingerprint
  };
}
