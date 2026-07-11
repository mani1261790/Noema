import { z } from "zod";

export const articleStatusSchema = z.enum(["draft", "published", "archived"]);
export const articleStageSchema = z.enum(["experience", "practice", "advanced"]);
export const articleTrackSchema = z.enum(["common", "development", "theory"]);

export const articleFrontmatterSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(180),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slugは半角英数字とハイフンで入力してください"),
    status: articleStatusSchema.default("draft"),
    publishedAt: z.string().date().optional(),
    updatedAt: z.string().date(),
    authors: z.array(z.string().trim().min(1)).min(1),
    topics: z.array(z.string().trim().min(1)).min(1),
    tags: z.array(z.string().trim().min(1)).default([]),
    stage: articleStageSchema,
    track: articleTrackSchema,
    outcome: z.string().trim().min(1).max(180),
    prerequisites: z.array(z.string().trim().min(1)).default([]),
    estimatedMinutes: z.number().int().min(1).max(180),
    heroImage: z.string().trim().nullable().default(null),
    sources: z.array(z.string().url()).default([])
  })
  .superRefine((article, context) => {
    if (article.stage === "advanced" && article.track === "common") {
      context.addIssue({
        code: "custom",
        path: ["track"],
        message: "専門記事は開発または理論の分野を選んでください"
      });
    }
    if (article.stage !== "advanced" && article.track !== "common") {
      context.addIssue({
        code: "custom",
        path: ["track"],
        message: "体験・活用記事の専門分野は共通にしてください"
      });
    }
  });

export type ArticleFrontmatter = z.infer<typeof articleFrontmatterSchema>;

export type ArticlePreview = ArticleFrontmatter & {
  excerpt: string;
  href: string;
  previewOnly: true;
};

export const topicLabels = {
  "ai-tools": "AIを使う",
  "ai-making": "AIとつくる",
  "knowledge-work": "知識と作業環境",
  "development-foundations": "開発の基礎",
  "ai-mechanisms": "AIの仕組み",
  "math-theory": "数理と理論"
} as const;

export const stageLabels = {
  experience: "体験",
  practice: "活用",
  advanced: "専門"
} as const;

export const trackLabels = {
  common: "共通",
  development: "開発",
  theory: "理論"
} as const;

export const previewArticles: ArticlePreview[] = [
  {
    title: "NotebookLMで自分専用の資料案内役をつくる",
    description: "手元の資料を読み込ませ、知りたいことを質問する最初の体験を案内します。",
    excerpt: "自分の資料だけをもとに質問できる体験から、AIの使いどころを見つけます。",
    slug: "first-notebooklm-guide",
    status: "draft",
    publishedAt: "2026-07-10",
    updatedAt: "2026-07-10",
    authors: ["Noema編集部"],
    topics: ["ai-tools"],
    tags: ["NotebookLM", "資料整理"],
    stage: "experience",
    track: "common",
    outcome: "自分の資料を使ってNotebookLMへ質問できる",
    prerequisites: [],
    estimatedMinutes: 10,
    heroImage: null,
    sources: [],
    href: "/preview/article",
    previewOnly: true
  },
  {
    title: "Codexに小さなWebページを頼んでみる",
    description: "開発経験がなくても、対話しながら小さなページを形にする流れを体験します。",
    excerpt: "TerminalやGitの前に、Codexと一緒につくる感覚をつかみます。",
    slug: "first-codex-web-page",
    status: "draft",
    publishedAt: "2026-07-09",
    updatedAt: "2026-07-09",
    authors: ["Noema編集部"],
    topics: ["ai-making"],
    tags: ["Codex", "Web制作"],
    stage: "practice",
    track: "common",
    outcome: "Codexとの対話で小さなWebページを形にできる",
    prerequisites: ["パソコンでファイルを保存できる"],
    estimatedMinutes: 15,
    heroImage: null,
    sources: [],
    href: "/preview/article",
    previewOnly: true
  },
  {
    title: "TerminalとGitは何をしているのか",
    description: "コマンドを暗記する前に、開発環境で起きていることを全体像から理解します。",
    excerpt: "AIと開発するときに避けて通れない道具を、役割から整理します。",
    slug: "terminal-and-git-overview",
    status: "draft",
    publishedAt: "2026-07-08",
    updatedAt: "2026-07-08",
    authors: ["Noema編集部"],
    topics: ["development-foundations"],
    tags: ["Terminal", "Git"],
    stage: "advanced",
    track: "development",
    outcome: "TerminalとGitの役割を説明し、基本操作へ進める",
    prerequisites: ["AIツールを一度でも使ったことがある"],
    estimatedMinutes: 18,
    heroImage: null,
    sources: [],
    href: "/preview/article",
    previewOnly: true
  },
  {
    title: "LLMはなぜ次の言葉を予測できるのか",
    description: "文章をつくるAIの内側で何が起きているかを、数式の前に直感からたどります。",
    excerpt: "確率、文脈、学習という三つの視点から、言語モデルの仕組みへ進みます。",
    slug: "how-llms-predict-words",
    status: "draft",
    publishedAt: "2026-07-07",
    updatedAt: "2026-07-07",
    authors: ["Noema編集部"],
    topics: ["ai-mechanisms"],
    tags: ["LLM", "言語モデル"],
    stage: "advanced",
    track: "theory",
    outcome: "LLMが文章を生成する基本的な考え方を説明できる",
    prerequisites: ["AIチャットを使ったことがある"],
    estimatedMinutes: 20,
    heroImage: null,
    sources: [],
    href: "/preview/article",
    previewOnly: true
  }
];

export const previewArticleMarkdown = `
## この記事で試すこと

手元にある短い資料をNotebookLMへ追加し、その資料について質問する流れを確認します。

## 資料を用意する

最初は、内容を自分で把握している資料を一つ選びます。回答が資料に沿っているかを、自分で確かめられるからです。

## 質問して確かめる

要約だけでなく、「どこに書かれているか」「分からない言葉をどう説明できるか」まで質問します。

## 次に進む

気になった使い方があれば、日々の調査や作業でも試してみましょう。
`;

export function serializeArticle(frontmatter: ArticleFrontmatter, markdown: string): string {
  const quote = (value: string) => JSON.stringify(value);
  const list = (values: string[]) => values.map((value) => `  - ${quote(value)}`).join("\n");
  const lines = [
    "---",
    `title: ${quote(frontmatter.title)}`,
    `description: ${quote(frontmatter.description)}`,
    `slug: ${quote(frontmatter.slug)}`,
    `status: ${quote(frontmatter.status)}`,
    ...(frontmatter.publishedAt ? [`publishedAt: ${quote(frontmatter.publishedAt)}`] : []),
    `updatedAt: ${quote(frontmatter.updatedAt)}`,
    "authors:",
    list(frontmatter.authors),
    "topics:",
    list(frontmatter.topics),
    ...(frontmatter.tags.length ? ["tags:", list(frontmatter.tags)] : ["tags: []"]),
    `stage: ${quote(frontmatter.stage)}`,
    `track: ${quote(frontmatter.track)}`,
    `outcome: ${quote(frontmatter.outcome)}`,
    ...(frontmatter.prerequisites.length ? ["prerequisites:", list(frontmatter.prerequisites)] : ["prerequisites: []"]),
    `estimatedMinutes: ${frontmatter.estimatedMinutes}`,
    `heroImage: ${frontmatter.heroImage ? quote(frontmatter.heroImage) : "null"}`,
    ...(frontmatter.sources.length ? ["sources:", list(frontmatter.sources)] : ["sources: []"]),
    "---",
    "",
    markdown.trim(),
    ""
  ];
  return lines.join("\n");
}
