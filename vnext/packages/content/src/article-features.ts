export const articleFeatureLabels = {
  code: "コードあり",
  commands: "コマンド操作",
  calculation: "手計算あり",
  math: "数式あり",
} as const;
export type ArticleFeature = keyof typeof articleFeatureLabels;

const commandLanguage = /^(bash|sh|shell|zsh|powershell|ps1|cmd|console|terminal)$/u;
const codeLanguage = /^(js|javascript|ts|typescript|jsx|tsx|python|py|html|css|sql|java|c|cpp|c\+\+|csharp|cs|go|rust|ruby|rb|php|swift|kotlin|r|vue|svelte)$/u;
const codeContent = /(?:\b(?:def|function|const|let|import|class)\s+\w|<\/?(?:html|div|body)\b)/u;

/** A linear structural scan, not a full Markdown render on every catalog request. */
export function detectArticleFeatures(markdown: string, title = "", description = ""): ArticleFeature[] {
  const features = new Set<ArticleFeature>();
  let fence: { character: string; length: number; language: string } | null = null;
  let blockMath = false;
  for (const line of markdown.split('\n')) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.character && delimiter[1].length >= fence.length && !delimiter[2].trim()) { fence = null; continue; }
      if (!line.trim()) continue;
      if (commandLanguage.test(fence.language)) {
        if (fence.language !== 'console' || /^\s*[$>]\s+\S/u.test(line)) features.add('commands');
      } else if (codeLanguage.test(fence.language) || (!fence.language && codeContent.test(line))) features.add('code');
      continue;
    }
    if (delimiter) {
      fence = {character:delimiter[1][0],length:delimiter[1].length,language:delimiter[2].trim().split(/\s/u)[0].toLowerCase()};
      continue;
    }
    if (/^(?: {4}|\t)/u.test(line)) {
      if (codeContent.test(line)) features.add('code');
      continue;
    }
    // Math-like text inside inline code is documentation, not an equation.
    if (!line.includes('$') && !line.includes('\\')) continue;
    const prose = line.replace(/(`+)[\s\S]*?\1/gu, '');
    if (/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$]*[=^_\\][^$]*\$/u.test(prose)) features.add('math');
    if (blockMath && /\$\$|\\\]/u.test(prose)) { features.add('math'); blockMath = false; }
    else if (/^\s*(?:\$\$|\\\[)\s*$/u.test(prose)) blockMath = true;
  }
  if (/手計算|手で計算|計算を手で追/u.test(`${title} ${description}`) && markdown.trim()) features.add("calculation");
  return (Object.keys(articleFeatureLabels) as ArticleFeature[]).filter((feature) => features.has(feature));
}

export function visibleArticleFeatures(features: readonly ArticleFeature[] = []): ArticleFeature[] {
  return features.filter((feature) => feature !== "math" || !features.includes("calculation")).slice(0, 2);
}
