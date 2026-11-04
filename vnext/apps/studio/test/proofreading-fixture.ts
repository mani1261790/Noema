import { cmsProofreadingTarget, type CmsProofreading } from "@noema/cms";
import type { ArticleFrontmatter } from "@noema/content";

// Synthetic client attestation for tests only; no skill execution is claimed.
export async function proofreadingFixture(input: { frontmatter: ArticleFrontmatter; markdown: string }): Promise<CmsProofreading> {
  const target = await cmsProofreadingTarget(input);
  return {
    humanWriting: { version: "test", notes: "Test fixture: reviewed reader, specificity and paragraph purpose." },
    yomiyasu: { version: "test", runId: "test-run", finalSha256: target.sha256, mode: "rewrite", checks: ["lint", "diff", "verify"], findingsReviewed: true, notes: "Test fixture: findings reviewed." }
  };
}
