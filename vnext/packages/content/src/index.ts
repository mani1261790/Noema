import { z } from "zod";

export const articleStatusSchema = z.enum(["draft", "published", "archived"]);
export const articleApproachSchema = z.enum(["experience", "practice", "development", "theory"]);
export const articleTopicSchema = z.enum([
  "conversational-ai",
  "research-organization",
  "generation-creation",
  "development-environment",
  "data-models",
  "mathematics"
]);
export const articleSourceSchema = z.object({
  title: z.string().trim().min(1).max(160),
  url: z.string().url(),
  checkedAt: z.string().date()
});
export const articleImageSchema = z.object({
  src: z.string().trim().min(1),
  alt: z.string().trim().min(1).max(240)
});

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
    topics: z.array(articleTopicSchema).min(1),
    tags: z.array(z.string().trim().min(1)).default([]),
    approach: articleApproachSchema,
    outcome: z.string().trim().min(1).max(180),
    prerequisites: z.array(z.string().trim().min(1)).default([]),
    estimatedMinutes: z.number().int().min(1).max(180),
    heroImage: articleImageSchema.nullable().default(null),
    sources: z.array(articleSourceSchema).default([])
  })
  .superRefine((article, context) => {
    if (article.status === "published" && !article.publishedAt) {
      context.addIssue({
        code: "custom",
        path: ["publishedAt"],
        message: "公開記事には公開日が必要です"
      });
    }
  });

export type ArticleFrontmatter = z.infer<typeof articleFrontmatterSchema>;

export type ArticleSummary = Pick<
  ArticleFrontmatter,
  "title" | "description" | "slug" | "publishedAt" | "updatedAt" | "topics" | "tags" | "approach" | "authors" | "heroImage"
> & {
  excerpt: string;
  href: string;
};

export type ArticlePreview = ArticleFrontmatter & ArticleSummary & {
  previewOnly: true;
};

export const topicLabels = {
  "conversational-ai": "対話AI",
  "research-organization": "情報検索・整理",
  "generation-creation": "生成・制作",
  "development-environment": "開発環境",
  "data-models": "データとモデル",
  mathematics: "数理"
} as const satisfies Record<z.infer<typeof articleTopicSchema>, string>;

export const topicDescriptions = {
  "conversational-ai": "AIとの対話は、何ができて、どこでつまずくのか。身近な使い方から、その仕組みまで見ていきます。",
  "research-organization": "散らばった情報を、どう探し、読み、結びつけるのか。AIと情報整理の関係をひもときます。",
  "generation-creation": "言葉や画像、Webページはどのようにつくられるのか。AIと一緒につくる過程から考えます。",
  "development-environment": "Terminal、Git、エディター。ものをつくる裏側で働く道具と、そのつながりを整理します。",
  "data-models": "AIは何を見て、どのように答えをつくるのか。データとモデルの関係から内側をのぞきます。",
  mathematics: "確率やベクトルは、AIの中でどう使われるのか。数式の意味を、直感と図からたどります。"
} as const satisfies Record<z.infer<typeof articleTopicSchema>, string>;

export const approachLabels = {
  experience: "体験",
  practice: "活用",
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
    topics: ["research-organization"],
    tags: ["NotebookLM", "資料整理"],
    approach: "experience",
    outcome: "自分の資料を使ってNotebookLMへ質問できる",
    prerequisites: [],
    estimatedMinutes: 10,
    heroImage: {
      src: "/images/articles/notebooklm-sources.svg",
      alt: "複数の資料が一つのノートに集まり、質問と回答へつながる関係を示した図"
    },
    sources: [
      {
        title: "NotebookLM ヘルプ",
        url: "https://support.google.com/notebooklm/",
        checkedAt: "2026-07-12"
      }
    ],
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
    topics: ["generation-creation"],
    tags: ["Codex", "Web制作"],
    approach: "practice",
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
    topics: ["development-environment"],
    tags: ["Terminal", "Git"],
    approach: "development",
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
    topics: ["data-models"],
    tags: ["LLM", "言語モデル"],
    approach: "theory",
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
    `approach: ${quote(frontmatter.approach)}`,
    `outcome: ${quote(frontmatter.outcome)}`,
    ...(frontmatter.prerequisites.length ? ["prerequisites:", list(frontmatter.prerequisites)] : ["prerequisites: []"]),
    `estimatedMinutes: ${frontmatter.estimatedMinutes}`,
    ...(frontmatter.heroImage
      ? [
          "heroImage:",
          `  src: ${quote(frontmatter.heroImage.src)}`,
          `  alt: ${quote(frontmatter.heroImage.alt)}`
        ]
      : ["heroImage: null"]),
    ...(frontmatter.sources.length
      ? [
          "sources:",
          ...frontmatter.sources.flatMap((source) => [
            `  - title: ${quote(source.title)}`,
            `    url: ${quote(source.url)}`,
            `    checkedAt: ${quote(source.checkedAt)}`
          ])
        ]
      : ["sources: []"]),
    "---",
    "",
    markdown.trim(),
    ""
  ];
  return lines.join("\n");
}

export async function parseArticle(source: string): Promise<{ frontmatter: ArticleFrontmatter; markdown: string }> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error("Markdownの先頭にYAML frontmatterがありません。");
  }

  let rawFrontmatter: unknown;
  try {
    const { parse: parseYaml } = await import("yaml");
    rawFrontmatter = parseYaml(match[1]);
  } catch {
    throw new Error("YAML frontmatterを読み取れませんでした。");
  }

  const result = articleFrontmatterSchema.safeParse(rawFrontmatter);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const field = firstIssue.path.length ? `${firstIssue.path.join(".")}: ` : "";
    throw new Error(`${field}${firstIssue.message}`);
  }

  return {
    frontmatter: result.data,
    markdown: source.slice(match[0].length).trim()
  };
}
