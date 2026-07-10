import { z } from "zod";

export const articleStatusSchema = z.enum(["draft", "published", "archived"]);
export const articleDifficultySchema = z.enum(["intro", "basic", "advanced"]);

export const articleFrontmatterSchema = z.object({
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
  difficulty: articleDifficultySchema,
  estimatedMinutes: z.number().int().min(1).max(180),
  heroImage: z.string().trim().nullable().default(null),
  sources: z.array(z.string().url()).default([])
});

export type ArticleFrontmatter = z.infer<typeof articleFrontmatterSchema>;

export type ArticlePreview = ArticleFrontmatter & {
  excerpt: string;
  href: string;
  previewOnly: true;
};

export const topicLabels = {
  "artificial-intelligence": "人工知能",
  "data-science": "データサイエンス",
  algorithms: "アルゴリズム",
  networks: "ネットワーク",
  security: "セキュリティ",
  hardware: "ハードウェア",
  "control-engineering": "制御工学"
} as const;

export const previewArticles: ArticlePreview[] = [
  {
    title: "なぜフィードバックで機械は安定するのか",
    description: "身近な温度調節を手がかりに、フィードバック制御の考え方を直感から理解します。",
    excerpt: "制御の基本を、身近な例と図から解き明かします。",
    slug: "why-feedback-stabilizes-machines",
    status: "draft",
    publishedAt: "2026-07-10",
    updatedAt: "2026-07-10",
    authors: ["Noema編集部"],
    topics: ["control-engineering"],
    tags: ["フィードバック", "制御"],
    difficulty: "intro",
    estimatedMinutes: 12,
    heroImage: null,
    sources: [],
    href: "/preview/article",
    previewOnly: true
  },
  {
    title: "AIはどこまで「理解」しているのか",
    description: "言葉の意味とパターンの違いから、AIの理解を考えます。",
    excerpt: "言葉の意味とパターンの違いを、やさしく整理します。",
    slug: "how-ai-understands",
    status: "draft",
    publishedAt: "2026-07-09",
    updatedAt: "2026-07-09",
    authors: ["Noema編集部"],
    topics: ["artificial-intelligence"],
    tags: ["AI", "言語モデル"],
    difficulty: "intro",
    estimatedMinutes: 10,
    heroImage: null,
    sources: [],
    href: "/preview/article",
    previewOnly: true
  },
  {
    title: "センサーが世界を数字に変えるまで",
    description: "現実の変化がデータになるまでの仕組みを追います。",
    excerpt: "計測のしくみと、データになるまでの流れを追います。",
    slug: "how-sensors-digitize-the-world",
    status: "draft",
    publishedAt: "2026-07-08",
    updatedAt: "2026-07-08",
    authors: ["Noema編集部"],
    topics: ["hardware"],
    tags: ["センサー", "計測"],
    difficulty: "intro",
    estimatedMinutes: 8,
    heroImage: null,
    sources: [],
    href: "/preview/article",
    previewOnly: true
  }
];

export const previewArticleMarkdown = `
## まず、身近な例から

エアコンやお風呂の追いだきなど、多くの機械は「ちょうどよい状態」を自動で保っています。たとえば、部屋の温度を26℃に設定すると、暑ければ冷やし、冷えすぎれば冷やす力を弱めます。

この繰り返しの調整こそが、フィードバックの基本的な考え方です。

## フィードバックとは何か

フィードバックとは、出力の結果を観測し、その情報をもとに入力を調整するしくみです。

> **ここが大切**
>
> フィードバックは過去の結果から未来を予測する「学習」ではなく、今の誤差を使って今すぐ調整するしくみです。

## なぜ安定するのか

目標との差を何度も測り、その差が小さくなる方向へ操作を調整することで、外乱があっても状態を目標へ戻せます。

## まとめ

フィードバックは、観測・比較・調整を繰り返して、対象を望ましい状態へ近づける考え方です。
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
    `difficulty: ${quote(frontmatter.difficulty)}`,
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
