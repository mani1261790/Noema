import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { previewArticles, previewArticleMarkdown } from "@noema/content";
import { createAnswerSchema, extractArticleHeadings, parseAssistantAnswer } from "../../lib/article-assistant";

export const prerender = false;

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type ChatBody = {
  slug?: unknown;
  question?: unknown;
  history?: unknown;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function readOutputText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return "";
  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "message") return [];
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content
        .filter((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "output_text")
        .map((part) => String((part as { text?: unknown }).text ?? ""));
    })
    .join("\n")
    .trim();
}

function normalizeHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-6)
    .map((turn) => {
      if (!turn || typeof turn !== "object") return null;
      const role = (turn as { role?: unknown }).role;
      const content = (turn as { content?: unknown }).content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
      return { role, content: content.trim().slice(0, 3000) } satisfies ConversationTurn;
    })
    .filter((turn): turn is ConversationTurn => Boolean(turn?.content));
}

export const POST: APIRoute = async ({ request, url }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return json({ error: "許可されていない送信元です。" }, 403);

  const apiKey = request.headers.get("x-openai-api-key")?.trim() ?? "";
  if (apiKey.length < 20) return json({ error: "OpenAI APIキーを入力してください。" }, 401);

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return json({ error: "リクエストの形式が正しくありません。" }, 400);
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  const previewArticle = previewArticles.find((item) => item.slug === slug);
  const publishedArticle = previewArticle
    ? null
    : (await getCollection("articles", ({ data }) => data.status === "published"))
        .find((item) => item.data.slug === slug);
  const article = previewArticle ?? publishedArticle?.data;
  const articleMarkdown = previewArticle ? previewArticleMarkdown : publishedArticle?.body;
  if (!article || !articleMarkdown) return json({ error: "記事が見つかりません。" }, 404);
  if (!question) return json({ error: "質問を入力してください。" }, 400);

  const history = normalizeHistory(body.history);
  const headings = extractArticleHeadings(articleMarkdown);
  const conversation = history.map((turn) => `${turn.role === "user" ? "読者" : "回答"}: ${turn.content}`).join("\n\n");
  const instructions = [
    "あなたはNoemaの記事アシスタントです。",
    "以下の記事本文だけを根拠に、日本語で非技術者にもわかるように答えてください。",
    "記事にない事実は記事由来であるかのように断定しないでください。",
    "推測が必要な場合は推測だと明示してください。",
    "回答の根拠にした箇所は、指定された記事内見出しIDだけで示してください。",
    "記事だけでは答えられない場合は、その旨を簡潔に伝え、referenceIdsを空にしてください。",
    "個別の医療・法律・金融判断は行わないでください。",
    "",
    `記事タイトル: ${article.title}`,
    `記事概要: ${article.description}`,
    "記事本文:",
    articleMarkdown.slice(0, 18_000)
  ].join("\n");

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        reasoning: { effort: "low" },
        instructions,
        input: [conversation, `読者の質問: ${question}`].filter(Boolean).join("\n\n"),
        max_output_tokens: 800,
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "article_grounded_answer",
            strict: true,
            schema: createAnswerSchema(headings)
          }
        }
      })
    });

    if (!upstream.ok) {
      if (upstream.status === 401) return json({ error: "OpenAI APIキーを確認してください。" }, 401);
      if (upstream.status === 429) return json({ error: "OpenAI APIの利用上限に達しました。しばらくしてから再試行してください。" }, 429);
      return json({ error: "OpenAI APIから回答を取得できませんでした。" }, 502);
    }

    const payload: unknown = await upstream.json();
    const outputText = readOutputText(payload);
    const result = parseAssistantAnswer(outputText, headings);
    if (!result) return json({ error: "回答の本文を取得できませんでした。" }, 502);
    return json(result);
  } catch {
    return json({ error: "OpenAI APIへ接続できませんでした。" }, 502);
  }
};
