import { promises as fs } from "fs";
import path from "path";
import { getCatalog, type ChapterSummary, type NotebookSummary } from "@/lib/notebooks";

export type AssessmentChoice = {
  id: string;
  text: string;
};

export type NotebookCheckQuestion = {
  id: string;
  prompt: string;
  choices: AssessmentChoice[];
  correctChoiceId: string;
  explanation: string;
  learningObjective?: string;
};

export type NotebookCheckAssessment = {
  schemaVersion: 1;
  notebookId: string;
  title: string;
  passScore: 5;
  questions: NotebookCheckQuestion[];
};

export type ChapterFinalQuestionType = "multiple_choice" | "short_text" | "coding" | "concept";

export type ChapterFinalRubricPoint = {
  id: string;
  description: string;
  points: number;
  keywords?: string[];
};

export type ChapterFinalQuestion = {
  id: string;
  type: ChapterFinalQuestionType;
  prompt: string;
  choices?: AssessmentChoice[];
  correctChoiceId?: string;
  rubricPoints?: ChapterFinalRubricPoint[];
  maxPoints: number;
  explanation?: string;
};

export type ChapterFinalAssessment = {
  schemaVersion: 1;
  chapterId: string;
  title: string;
  passRatio: 0.9;
  questions: ChapterFinalQuestion[];
};

export type NotebookCheckPublicAssessment = Omit<NotebookCheckAssessment, "questions"> & {
  questions: Array<Omit<NotebookCheckQuestion, "correctChoiceId">>;
};

export type ChapterFinalPublicAssessment = ChapterFinalAssessment;

export type NotebookCheckAttemptResult = {
  notebookId: string;
  score: number;
  total: number;
  passed: boolean;
  results: Array<{
    questionId: string;
    selectedChoiceId: string;
    correct: boolean;
    explanation: string;
    correctChoiceId: string;
  }>;
};

export type ChapterFinalAttemptResult = {
  chapterId: string;
  score: number;
  maxScore: number;
  ratio: number;
  passed: boolean;
  gradingProvider?: "local" | "openai" | "gemini";
  modelId?: string;
  results: Array<{
    questionId: string;
    score: number;
    maxPoints: number;
    feedback: string;
  }>;
};

export type ChapterFinalLlmTarget = {
  provider?: "openai" | "gemini";
  modelId?: string;
  apiKey?: string;
};

export const CHAPTER_FINAL_ANSWER_MAX_CHARS = 2000;
export const CHAPTER_FINAL_REQUEST_BODY_MAX_CHARS = 25000;

const ASSESSMENT_ROOT = path.join(process.cwd(), "content", "assessments");
const NOTEBOOK_CHECK_DIR = path.join(ASSESSMENT_ROOT, "notebook-checks");
const CHAPTER_FINAL_DIR = path.join(ASSESSMENT_ROOT, "chapter-finals");
const NOEMA_CHAPTER_IDS = new Set([
  "python",
  "machine-learning",
  "deep-learning",
  "reinforcement-learning",
  "llm",
  "deep-generative-models",
  "world-models"
]);

function slugLabel(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
}

function findNotebook(catalog: { chapters: ChapterSummary[] }, notebookId: string) {
  for (const chapter of catalog.chapters) {
    const notebook = chapter.notebooks.find((item) => item.id === notebookId);
    if (notebook) return { chapter, notebook };
  }
  return null;
}

function publicNotebookCheck(assessment: NotebookCheckAssessment): NotebookCheckPublicAssessment {
  return {
    ...assessment,
    questions: assessment.questions.map(({ correctChoiceId: _correctChoiceId, ...question }) => question)
  };
}

function normalizeTextWithinLimit(value: unknown, maxChars: number): string {
  return String(value || "").trim().slice(0, maxChars);
}

export function sanitizeChapterFinalAnswers(answers: Record<string, unknown>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  if (!answers || typeof answers !== "object") return sanitized;
  for (const [questionId, value] of Object.entries(answers)) {
    sanitized[String(questionId)] = normalizeTextWithinLimit(value, CHAPTER_FINAL_ANSWER_MAX_CHARS);
  }
  return sanitized;
}

export function validateChapterFinalAnswers(answers: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  if (!answers || typeof answers !== "object") {
    return { ok: false, error: "Invalid answers" };
  }
  for (const [questionId, value] of Object.entries(answers)) {
    if (typeof value !== "string") {
      return { ok: false, error: `Answer for ${questionId} must be a string` };
    }
    if (value.length > CHAPTER_FINAL_ANSWER_MAX_CHARS) {
      return {
        ok: false,
        error: `Answer for ${questionId} exceeds ${CHAPTER_FINAL_ANSWER_MAX_CHARS} characters`
      };
    }
  }
  return { ok: true };
}

function validateNotebookCheck(raw: unknown, notebook: NotebookSummary): NotebookCheckAssessment | null {
  const value = raw && typeof raw === "object" ? (raw as Partial<NotebookCheckAssessment>) : {};
  const questions = Array.isArray(value.questions) ? value.questions : [];
  if (questions.length !== 5) return null;

  const normalizedQuestions = questions.map((question, index) => {
    const item = question && typeof question === "object" ? (question as Partial<NotebookCheckQuestion>) : {};
    const choices = Array.isArray(item.choices) ? item.choices : [];
    const normalizedChoices = choices
      .map((choice) => {
        const candidate = choice && typeof choice === "object" ? (choice as Partial<AssessmentChoice>) : {};
        return {
          id: String(candidate.id || "").trim(),
          text: String(candidate.text || "").trim()
        };
      })
      .filter((choice) => choice.id && choice.text);
    const correctChoiceId = String(item.correctChoiceId || "").trim();
    if (!item.prompt || normalizedChoices.length < 2 || !normalizedChoices.some((choice) => choice.id === correctChoiceId)) return null;
    return {
      id: String(item.id || `q${index + 1}`),
      prompt: String(item.prompt),
      choices: normalizedChoices,
      correctChoiceId,
      explanation: String(item.explanation || ""),
      learningObjective: item.learningObjective ? String(item.learningObjective) : undefined
    };
  });

  if (normalizedQuestions.some((question) => !question)) return null;
  return {
    schemaVersion: 1,
    notebookId: notebook.id,
    title: String(value.title || `${notebook.title} 確認問題`),
    passScore: 5,
    questions: normalizedQuestions as NotebookCheckQuestion[]
  };
}

function fallbackNotebookCheck(notebook: NotebookSummary): NotebookCheckAssessment {
  const title = notebook.title;
  const topic = slugLabel(notebook.id) || title;
  const tags = notebook.tags && notebook.tags.length ? notebook.tags.join(", ") : topic;
  const distractor = "本文と関係のない用語だけを暗記すること";
  return {
    schemaVersion: 1,
    notebookId: notebook.id,
    title: `${title} 確認問題`,
    passScore: 5,
    questions: [
      {
        id: "q1",
        prompt: `「${title}」で最も重視すべき学習姿勢はどれですか。`,
        choices: [
          { id: "a", text: "本文の目的、前提、コード例の関係を確認しながら読む" },
          { id: "b", text: distractor },
          { id: "c", text: "出力結果だけを見て本文の説明は飛ばす" },
          { id: "d", text: "実行順序や変数の意味を無視する" }
        ],
        correctChoiceId: "a",
        explanation: "Noemaの確認問題では、本文・コード・出力のつながりを理解しているかを合格条件にします。",
        learningObjective: "学習姿勢"
      },
      {
        id: "q2",
        prompt: `このノートの主題として最も近いものはどれですか。`,
        choices: [
          { id: "a", text: `${tags} に関する概念や実装の基礎を確認すること` },
          { id: "b", text: "Webデザインの配色だけを比較すること" },
          { id: "c", text: "ログイン機能の仕様だけを覚えること" },
          { id: "d", text: "教材一覧の並び順だけを暗記すること" }
        ],
        correctChoiceId: "a",
        explanation: "ノートのタグとタイトルに対応する概念・実装を理解することが中心です。",
        learningObjective: "主題理解"
      },
      {
        id: "q3",
        prompt: "コードセルを読むときの確認として最も適切なものはどれですか。",
        choices: [
          { id: "a", text: "入力、処理、出力が何を表しているかを対応づける" },
          { id: "b", text: "変数名をすべて別名に変えてから読む" },
          { id: "c", text: "エラーが出ても本文と照合しない" },
          { id: "d", text: "ライブラリ名だけを丸暗記する" }
        ],
        correctChoiceId: "a",
        explanation: "Noemaのノートはコードを実行して終わりではなく、入力から出力までの意味を追う教材です。",
        learningObjective: "コード読解"
      },
      {
        id: "q4",
        prompt: "理解確認として最も良い行動はどれですか。",
        choices: [
          { id: "a", text: "重要な式・関数・出力を自分の言葉で説明してみる" },
          { id: "b", text: "正解だけを見て次へ進む" },
          { id: "c", text: "本文中の注意書きを読み飛ばす" },
          { id: "d", text: "ノートのタイトルだけで内容を判断する" }
        ],
        correctChoiceId: "a",
        explanation: "自分の言葉で説明できるかは、概念理解と実装理解の両方を確認できます。",
        learningObjective: "自己説明"
      },
      {
        id: "q5",
        prompt: "この確認問題で合格にする条件として正しいものはどれですか。",
        choices: [
          { id: "a", text: "5問すべてに正解する" },
          { id: "b", text: "1問だけ正解する" },
          { id: "c", text: "回答せずにページ末尾までスクロールする" },
          { id: "d", text: "一度不合格になると再挑戦できない" }
        ],
        correctChoiceId: "a",
        explanation: "各ノートの確認問題は5問全問正解で合格です。不合格でも何度でも再挑戦できます。",
        learningObjective: "合格条件"
      }
    ]
  };
}

export async function getNotebookCheckAssessment(notebookId: string): Promise<NotebookCheckAssessment | null> {
  const catalog = await getCatalog();
  const found = findNotebook(catalog, notebookId);
  if (!found || !NOEMA_CHAPTER_IDS.has(found.chapter.id)) return null;

  const filePath = path.join(NOTEBOOK_CHECK_DIR, `${notebookId}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return validateNotebookCheck(raw, found.notebook) || fallbackNotebookCheck(found.notebook);
  } catch {
    return fallbackNotebookCheck(found.notebook);
  }
}

export async function getPublicNotebookCheckAssessment(notebookId: string): Promise<NotebookCheckPublicAssessment | null> {
  const assessment = await getNotebookCheckAssessment(notebookId);
  return assessment ? publicNotebookCheck(assessment) : null;
}

export function gradeNotebookCheck(
  assessment: NotebookCheckAssessment,
  answers: Record<string, string>
): NotebookCheckAttemptResult {
  const results = assessment.questions.map((question) => {
    const selectedChoiceId = String(answers[question.id] || "").trim();
    const correct = selectedChoiceId === question.correctChoiceId;
    return {
      questionId: question.id,
      selectedChoiceId,
      correct,
      explanation: question.explanation,
      correctChoiceId: question.correctChoiceId
    };
  });
  const score = results.reduce((sum, result) => sum + (result.correct ? 1 : 0), 0);
  return {
    notebookId: assessment.notebookId,
    score,
    total: assessment.questions.length,
    passed: score >= assessment.passScore,
    results
  };
}

function fallbackChapterFinal(chapter: ChapterSummary): ChapterFinalAssessment {
  const notebookTitles = chapter.notebooks.map((notebook) => notebook.title).slice(0, 6).join("、");
  return {
    schemaVersion: 1,
    chapterId: chapter.id,
    title: `${chapter.title} 最終問題`,
    passRatio: 0.9,
    questions: [
      {
        id: "q1",
        type: "short_text" as const,
        prompt: `${chapter.title} セクションで扱った内容を、主要トピックを3つ以上含めて説明してください。対象ノート例: ${notebookTitles}`,
        maxPoints: 10,
        rubricPoints: [
          { id: "scope", description: "セクション内の複数ノートに触れている", points: 4, keywords: chapter.notebooks.map((notebook) => notebook.title) },
          { id: "concept", description: "概念や実装の目的を説明している", points: 3, keywords: ["目的", "概念", "実装", "モデル", "データ", "学習"] },
          { id: "connection", description: "トピック間の関係を説明している", points: 3, keywords: ["関係", "比較", "つながり", "違い", "流れ"] }
        ]
      },
      ...chapter.notebooks.slice(0, 9).map((notebook, index) => ({
        id: `q${index + 2}`,
        type: "concept" as const,
        prompt: `「${notebook.title}」の内容が、${chapter.title} 全体の理解にどう役立つか説明してください。`,
        maxPoints: 10,
        rubricPoints: [
          { id: "notebook", description: "対象ノートの主題に触れている", points: 4, keywords: [notebook.title, ...(notebook.tags || [])] },
          { id: "reason", description: "なぜ重要かを説明している", points: 3, keywords: ["重要", "理由", "役割", "必要"] },
          { id: "example", description: "コード、データ、式、具体例のいずれかに触れている", points: 3, keywords: ["コード", "データ", "式", "例", "出力", "実装"] }
        ]
      }))
    ].slice(0, 10)
  };
}

function validateChapterFinal(raw: unknown, chapter: ChapterSummary): ChapterFinalAssessment | null {
  const value = raw && typeof raw === "object" ? (raw as Partial<ChapterFinalAssessment>) : {};
  const questions = Array.isArray(value.questions) ? value.questions : [];
  if (questions.length < 1) return null;
  const normalizedQuestions = questions.slice(0, 12).map((question, index) => {
    const item = question && typeof question === "object" ? (question as Partial<ChapterFinalQuestion>) : {};
    const type = item.type || "short_text";
    if (!["multiple_choice", "short_text", "coding", "concept"].includes(type)) return null;
    const maxPoints = Math.max(1, Number(item.maxPoints || 10));
    return {
      id: String(item.id || `q${index + 1}`),
      type,
      prompt: String(item.prompt || ""),
      choices: Array.isArray(item.choices) ? item.choices : undefined,
      correctChoiceId: item.correctChoiceId ? String(item.correctChoiceId) : undefined,
      rubricPoints: Array.isArray(item.rubricPoints) ? item.rubricPoints : undefined,
      maxPoints,
      explanation: item.explanation ? String(item.explanation) : undefined
    };
  });
  if (normalizedQuestions.some((question) => !question || !question.prompt)) return null;
  return {
    schemaVersion: 1,
    chapterId: chapter.id,
    title: String(value.title || `${chapter.title} 最終問題`),
    passRatio: 0.9,
    questions: normalizedQuestions as ChapterFinalQuestion[]
  };
}

export async function getChapterFinalAssessment(chapterId: string): Promise<ChapterFinalAssessment | null> {
  const catalog = await getCatalog();
  const chapter = catalog.chapters.find((item) => item.id === chapterId);
  if (!chapter || !NOEMA_CHAPTER_IDS.has(chapter.id)) return null;

  const filePath = path.join(CHAPTER_FINAL_DIR, `${chapterId}.json`);
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return validateChapterFinal(raw, chapter) || fallbackChapterFinal(chapter);
  } catch {
    return fallbackChapterFinal(chapter);
  }
}

function scoreRubricQuestion(question: ChapterFinalQuestion, answer: string) {
  const text = String(answer || "").toLowerCase();
  const points = Array.isArray(question.rubricPoints) ? question.rubricPoints : [];
  let score = 0;
  const feedback: string[] = [];
  for (const point of points) {
    const keywords = Array.isArray(point.keywords) ? point.keywords : [];
    const matched = keywords.length === 0 || keywords.some((keyword) => text.includes(String(keyword).toLowerCase()));
    if (matched && text.trim().length >= 20) {
      score += Number(point.points || 0);
      feedback.push(`OK: ${point.description}`);
    } else {
      feedback.push(`要改善: ${point.description}`);
    }
  }
  if (!points.length && text.trim().length >= 40) {
    score = question.maxPoints;
    feedback.push("十分な長さの回答です。");
  }
  return {
    score: Math.min(question.maxPoints, score),
    feedback: feedback.join(" / ") || "ルーブリックに基づいて採点しました。"
  };
}

export function gradeChapterFinal(
  assessment: ChapterFinalAssessment,
  answers: Record<string, string>
): ChapterFinalAttemptResult {
  const sanitizedAnswers = sanitizeChapterFinalAnswers(answers);
  const results = assessment.questions.map((question) => {
    const answer = String(sanitizedAnswers[question.id] || "");
    if (question.type === "multiple_choice") {
      const correct = answer.trim() === String(question.correctChoiceId || "").trim();
      return {
        questionId: question.id,
        score: correct ? question.maxPoints : 0,
        maxPoints: question.maxPoints,
        feedback: correct ? question.explanation || "正解です。" : question.explanation || "選択肢を見直してください。"
      };
    }
    const rubric = scoreRubricQuestion(question, answer);
    return {
      questionId: question.id,
      score: rubric.score,
      maxPoints: question.maxPoints,
      feedback: rubric.feedback
    };
  });
  const score = results.reduce((sum, result) => sum + result.score, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxPoints, 0);
  const ratio = maxScore > 0 ? score / maxScore : 0;
  return {
    chapterId: assessment.chapterId,
    score,
    maxScore,
    ratio,
    passed: ratio >= assessment.passRatio,
    gradingProvider: "local",
    results
  };
}

function extractOpenAIText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = payload as Record<string, unknown>;
  if (typeof data.output_text === "string") return data.output_text.trim();
  if (Array.isArray(data.output)) {
    const chunks: string[] = [];
    for (const item of data.output) {
      if (!item || typeof item !== "object") continue;
      const message = item as Record<string, unknown>;
      if (!Array.isArray(message.content)) continue;
      for (const contentItem of message.content) {
        if (!contentItem || typeof contentItem !== "object") continue;
        const content = contentItem as Record<string, unknown>;
        if (typeof content.text === "string" && content.text.trim()) chunks.push(content.text.trim());
      }
    }
    if (chunks.length) return chunks.join("\n");
  }
  return "";
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}

function buildLlmGradingPrompt(assessment: ChapterFinalAssessment, answers: Record<string, string>): string {
  const sanitizedAnswers = sanitizeChapterFinalAnswers(answers);
  const questions = assessment.questions.map((question) => ({
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    maxPoints: question.maxPoints,
    rubricPoints: question.rubricPoints || [],
    answer: String(sanitizedAnswers[question.id] || "")
  }));
  return [
    "You are grading Japanese learning assessment answers for Noema.",
    "Grade strictly against the rubric points. Award points only when the answer clearly satisfies the point.",
    "For coding answers, judge whether the submitted code or explanation would satisfy the requested behavior; do not execute code.",
    "Return JSON only. No markdown fences.",
    'Required schema: {"results":[{"questionId":"q1","score":0,"maxPoints":10,"feedback":"短い日本語フィードバック"}]}',
    "Rules:",
    "- score must be an integer from 0 to maxPoints.",
    "- feedback must mention missing rubric points when any points are lost.",
    "- Do not add questions not present in the input.",
    "",
    JSON.stringify({ chapterId: assessment.chapterId, passRatio: assessment.passRatio, questions }, null, 2)
  ].join("\n");
}

async function callOpenAIForGrading(prompt: string, target: Required<Pick<ChapterFinalLlmTarget, "modelId" | "apiKey">>) {
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${target.apiKey}`
    },
    body: JSON.stringify({
      model: target.modelId,
      input: prompt,
      max_output_tokens: 1400,
      temperature: 0
    })
  });
  if (!response.ok) {
    throw new Error(`OpenAI grading failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  return extractOpenAIText(await response.json());
}

async function callGeminiForGrading(prompt: string, target: Required<Pick<ChapterFinalLlmTarget, "modelId" | "apiKey">>) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(target.modelId)}:generateContent?key=${encodeURIComponent(target.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1400 }
      })
    }
  );
  if (!response.ok) {
    throw new Error(`Gemini grading failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const payload = (await response.json()) as Record<string, unknown>;
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const first = candidates[0] as Record<string, unknown> | undefined;
  const content = first && typeof first.content === "object" ? (first.content as Record<string, unknown>) : null;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];
  return parts
    .map((part) => (part && typeof part === "object" ? String((part as Record<string, unknown>).text || "") : ""))
    .join("\n")
    .trim();
}

export async function gradeChapterFinalWithLlm(
  assessment: ChapterFinalAssessment,
  answers: Record<string, string>,
  target: ChapterFinalLlmTarget
): Promise<ChapterFinalAttemptResult> {
  const provider = target.provider;
  const apiKey = String(target.apiKey || "").trim();
  if (provider !== "openai" && provider !== "gemini") {
    return gradeChapterFinal(assessment, answers);
  }
  if (!apiKey) {
    return gradeChapterFinal(assessment, answers);
  }

  const modelId =
    String(target.modelId || "").trim() ||
    (provider === "openai" ? "gpt-5-nano" : "gemini-2.5-flash");
  const prompt = buildLlmGradingPrompt(assessment, answers);
  let raw = "";
  try {
    raw =
      provider === "openai"
        ? await callOpenAIForGrading(prompt, { modelId, apiKey })
        : await callGeminiForGrading(prompt, { modelId, apiKey });
  } catch {
    return gradeChapterFinal(assessment, answers);
  }
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    return gradeChapterFinal(assessment, answers);
  }
  const rawResults = Array.isArray(parsed.results) ? parsed.results : [];

  const results = assessment.questions.map((question) => {
    const item = rawResults.find((candidate) => {
      return candidate && typeof candidate === "object" && String((candidate as Record<string, unknown>).questionId || "") === question.id;
    }) as Record<string, unknown> | undefined;
    const rawScore = Number(item?.score);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(question.maxPoints, Math.round(rawScore))) : 0;
    const feedback = String(item?.feedback || "").trim() || "LLMルーブリック採点を行いました。";
    return { questionId: question.id, score, maxPoints: question.maxPoints, feedback };
  });

  const score = results.reduce((sum, result) => sum + result.score, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxPoints, 0);
  const ratio = maxScore > 0 ? score / maxScore : 0;
  return {
    chapterId: assessment.chapterId,
    score,
    maxScore,
    ratio,
    passed: ratio >= assessment.passRatio,
    gradingProvider: provider,
    modelId,
    results
  };
}
