import MarkdownIt from "markdown-it";

const markdownParser = new MarkdownIt({ html: false });

export const articleFeatureLabels = {
  code: "コードあり",
  commands: "コマンド操作",
  calculation: "手計算あり",
  math: "数式あり",
} as const;
export type ArticleFeature = keyof typeof articleFeatureLabels;

/** Derived from the published body; never a judgement of the reader's ability. */
export function detectArticleFeatures(markdown: string, title = "", description = ""): ArticleFeature[] {
  const tokens = markdownParser.parse(markdown, {});
  const features = new Set<ArticleFeature>();
  const prose: string[] = [];
  for (const token of tokens) {
    if (token.type === "fence" || token.type === "code_block") {
      const language = token.info.trim().split(/\s/u)[0].toLowerCase();
      if (/^(bash|sh|shell|zsh|powershell|ps1|cmd|console|terminal)$/u.test(language)) {
        // A console output block alone is not an instruction to run a command.
        if (language !== "console" || /^\s*[$>]\s+\S/mu.test(token.content)) features.add("commands");
      } else if (/^(js|javascript|ts|typescript|jsx|tsx|python|py|html|css|sql|java|c|cpp|c\+\+|csharp|cs|go|rust|ruby|rb|php|swift|kotlin|r|vue|svelte)$/u.test(language)
        || (!language && /(?:\b(?:def|function|const|let|import|class)\s+\w|<\/?(?:html|div|body)\b)/u.test(token.content))) {
        features.add("code");
      }
    } else if (token.type === "inline") {
      // Preserve LaTeX escapes while excluding inline code examples.
      prose.push(token.content.replace(/(`+)[\s\S]*?\1/gu, ""));
    }
  }
  const text = prose.join("\n");
  if (/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^\n$]*[=^_\\][^\n$]*\$/u.test(text)) features.add("math");
  if (/手計算|手で計算|計算を手で追/u.test(`${title} ${description}`) && markdown.trim()) features.add("calculation");
  return (Object.keys(articleFeatureLabels) as ArticleFeature[]).filter((feature) => features.has(feature));
}

export function visibleArticleFeatures(features: readonly ArticleFeature[] = []): ArticleFeature[] {
  return features.filter((feature) => feature !== "math" || !features.includes("calculation")).slice(0, 2);
}
