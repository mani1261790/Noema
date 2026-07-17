import GithubSlugger from "github-slugger";
import MarkdownIt from "markdown-it";

const headingParser = new MarkdownIt({ html: false });

export type ArticleHeading = {
  id: string;
  text: string;
};

export type ArticleAssistantAnswer = {
  answer: string;
  references: ArticleHeading[];
};

export function extractArticleHeadings(markdown: string): ArticleHeading[] {
  const slugger = new GithubSlugger();
  const headings: ArticleHeading[] = [];

  const tokens = headingParser.parse(markdown, {});
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const text = (tokens[index + 1]?.children ?? [])
      .filter((child) => child.type === "text" || child.type === "code_inline")
      .map((child) => child.content)
      .join("")
      .trim();
    if (!text) continue;
    const id = slugger.slug(text);
    if (token.tag === "h2") headings.push({ id, text });
  }

  return headings;
}

export function createAnswerSchema(headings: ArticleHeading[]) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: {
        type: "string",
        description: "記事本文だけを根拠にした、日本語の簡潔な回答"
      },
      referenceIds: {
        type: "array",
        description: "回答の根拠として読み返せる記事内見出しのID。根拠がない場合は空配列",
        items: headings.length > 0 ? { type: "string", enum: headings.map(({ id }) => id) } : { type: "string", enum: [""] },
        maxItems: 3
      }
    },
    required: ["answer", "referenceIds"]
  } as const;
}

export function parseAssistantAnswer(outputText: string, headings: ArticleHeading[]): ArticleAssistantAnswer | null {
  try {
    const value: unknown = JSON.parse(outputText);
    if (!value || typeof value !== "object") return null;

    const answer = (value as { answer?: unknown }).answer;
    const referenceIds = (value as { referenceIds?: unknown }).referenceIds;
    if (typeof answer !== "string" || !answer.trim() || !Array.isArray(referenceIds)) return null;

    const headingMap = new Map(headings.map((heading) => [heading.id, heading]));
    const references = referenceIds
      .filter((id): id is string => typeof id === "string")
      .map((id) => headingMap.get(id))
      .filter((heading): heading is ArticleHeading => Boolean(heading));

    return { answer: answer.trim(), references };
  } catch {
    return null;
  }
}
