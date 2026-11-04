import { z } from "zod";
import type { ArticleFrontmatter } from "@noema/content";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
export const cmsProofreadingSchema = z.object({
  humanWriting: z.object({
    version: z.string().trim().min(1).max(100),
    notes: z.string().trim().min(1).max(2000)
  }).strict(),
  yomiyasu: z.object({
    version: z.string().trim().min(1).max(100),
    runId: z.string().trim().min(1).max(200),
    finalSha256: sha256Schema,
    mode: z.enum(["rewrite", "compose"]),
    checks: z.array(z.enum(["lint", "diff", "materials", "verify"])).min(3).max(4),
    findingsReviewed: z.literal(true),
    notes: z.string().trim().min(1).max(2000)
  }).strict()
}).strict().superRefine((value, ctx) => {
  const checks = value.yomiyasu.checks;
  for (const check of ["lint", "verify", value.yomiyasu.mode === "rewrite" ? "diff" : "materials"] as const) {
    if (!checks.includes(check)) ctx.addIssue({ code: "custom", path: ["yomiyasu", "checks"], message: `${check}の実行記録が必要です。` });
  }
});
export type CmsProofreading = z.infer<typeof cmsProofreadingSchema>;

/** Stable, readable UTF-8 input for both skills. Excludes server-managed dates and reading time. */
export function cmsProofreadingText(input: { frontmatter: ArticleFrontmatter; markdown: string }): string {
  const f = input.frontmatter;
  return [
    `# ${f.title}`, f.description, `## 記事の狙い\n${f.outcome}`,
    `## 分類\n${JSON.stringify({ slug: f.slug, authors: f.authors, topics: f.topics, tags: f.tags, approach: f.approach, heroImage: f.heroImage })}`,
    `## アイキャッチの説明\n${f.heroImage?.alt ?? ""}`,
    `## 本文\n${input.markdown}`,
    `## 参考資料の登録内容\n${f.sources.map(source => JSON.stringify(source)).join("\n")}`
  ].join("\n\n") + "\n";
}

export async function cmsProofreadingTarget(input: { frontmatter: ArticleFrontmatter; markdown: string }) {
  const text = cmsProofreadingText(input);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return { text, sha256 };
}
