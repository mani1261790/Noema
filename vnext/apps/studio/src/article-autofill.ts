import type { ArticleFrontmatter } from "@noema/content";

type Topic = ArticleFrontmatter["topics"][number];

export interface ArticleAutofillSuggestion {
  approach: ArticleFrontmatter["approach"];
  description: string;
  estimatedMinutes: number;
  outcome: string;
  slug: string;
  tags: string[];
  title: string;
  topics: ArticleFrontmatter["topics"];
}

const topicKeywords: Record<Topic, string[]> = {
  "conversational-ai": ["chatgpt", "チャット", "対話", "会話", "プロンプト", "prompt"],
  "research-organization": ["検索", "調査", "リサーチ", "整理", "rag", "検索拡張", "文献"],
  "generation-creation": ["生成", "画像", "文章", "制作", "デザイン", "動画", "音声"],
  "development-environment": ["git", "github", "terminal", "ターミナル", "コード", "実装", "開発", "api", "react", "typescript", "python", "cloudflare"],
  "data-models": ["llm", "モデル", "データ", "学習", "推論", "トークン", "embedding", "埋め込み"],
  mathematics: ["数式", "数学", "確率", "統計", "ベクトル", "行列", "微分", "最適化"]
};

const approachKeywords: Record<ArticleFrontmatter["approach"], string[]> = {
  development: ["実装", "コード", "開発", "api", "git", "github", "react", "typescript", "python", "terminal", "cloudflare"],
  theory: ["理論", "原理", "仕組み", "数式", "確率", "モデル", "学習", "推論", "なぜ"],
  practice: ["使い方", "手順", "方法", "活用", "設定", "作り方", "導入", "運用"],
  experience: ["体験", "試す", "入門", "はじめ", "触って", "やってみる"]
};

const tagKeywords: Array<[string, RegExp]> = [
  ["LLM", /\bllm\b|大規模言語モデル/iu],
  ["ChatGPT", /chatgpt/iu],
  ["RAG", /\brag\b|検索拡張生成/iu],
  ["プロンプト", /prompt|プロンプト/iu],
  ["Git", /\bgit\b/iu],
  ["GitHub", /github/iu],
  ["Cloudflare", /cloudflare/iu],
  ["React", /\breact\b/iu],
  ["TypeScript", /typescript/iu],
  ["Python", /\bpython\b/iu],
  ["API", /\bapi\b/iu],
  ["Markdown", /markdown|マークダウン/iu],
  ["画像生成", /画像生成/iu],
  ["データ分析", /データ分析|analytics/iu]
];

function cleanInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_~>#]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const shortened = value.slice(0, max - 1).replace(/[、,。.!！?？]?[^、,。.!！?？]{0,20}$/u, "");
  return `${shortened || value.slice(0, max - 1)}…`;
}

function readableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/^\s*\d+[.)]\s+/gmu, "")
    .split(/\n\s*\n/gu)
    .map(cleanInlineMarkdown)
    .filter(Boolean)
    .join("\n\n");
}

function firstHeading(markdown: string): string {
  const heading = markdown.match(/^\s{0,3}#{2,6}\s+(.+)$/mu)?.[1] ?? "";
  return truncate(cleanInlineMarkdown(heading), 100);
}

function firstParagraph(markdown: string): string {
  const paragraph = readableText(markdown)
    .split(/\n\s*\n/gu)
    .find((candidate) => candidate.length >= 20) ?? "";
  return truncate(paragraph, 180);
}

function scoreKeywords(text: string, keywords: string[]): number {
  const normalized = text.toLocaleLowerCase("ja-JP");
  return keywords.reduce((score, keyword) => score + (normalized.includes(keyword) ? 1 : 0), 0);
}

function inferTopics(text: string): ArticleFrontmatter["topics"] {
  const scores = (Object.entries(topicKeywords) as Array<[Topic, string[]]>)
    .map(([topic, keywords]) => ({ topic, score: scoreKeywords(text, keywords) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);
  return (scores.length > 0 ? scores.slice(0, 3).map(({ topic }) => topic) : ["conversational-ai"]);
}

function inferApproach(text: string): ArticleFrontmatter["approach"] {
  return (Object.entries(approachKeywords) as Array<[ArticleFrontmatter["approach"], string[]]>)
    .map(([approach, keywords], index) => ({ approach, index, score: scoreKeywords(text, keywords) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.approach ?? "experience";
}

function stableSuffix(value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6).padStart(6, "0");
}

function inferSlug(title: string, body: string, updatedAt: string): string {
  const ascii = title
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/-+$/u, "");
  if (ascii.length >= 4) return ascii;
  return `article-${updatedAt.replaceAll("-", "")}-${stableSuffix(`${title}\n${body}`)}`;
}

export function suggestArticleMetadata({
  body,
  currentTitle,
  updatedAt
}: {
  body: string;
  currentTitle: string;
  updatedAt: string;
}): ArticleAutofillSuggestion {
  const title = truncate(currentTitle.trim() || firstHeading(body), 100);
  const description = firstParagraph(body);
  const text = `${title}\n${readableText(body)}`;
  const tags = tagKeywords.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag).slice(0, 8);
  const estimatedMinutes = Math.min(180, Math.max(1, Math.ceil(cleanInlineMarkdown(text).length / 500)));

  return {
    approach: inferApproach(text),
    description,
    estimatedMinutes,
    outcome: truncate(
      title ? `「${title}」の要点を理解し、自分の言葉で説明できる` : "記事の要点を理解し、自分の言葉で説明できる",
      180
    ),
    slug: inferSlug(title, body, updatedAt),
    tags,
    title,
    topics: inferTopics(text)
  };
}
