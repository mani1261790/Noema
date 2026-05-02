import { getCatalog, type ChapterSummary, type NotebookSummary } from "@/lib/notebooks";
import { loadAssessmentJson } from "@/lib/assessment-storage";

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

const NOEMA_CHAPTER_IDS = new Set([
  "python",
  "machine-learning",
  "deep-learning",
  "reinforcement-learning",
  "llm",
  "deep-generative-models",
  "world-models"
]);

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

export async function getNotebookCheckAssessment(notebookId: string): Promise<NotebookCheckAssessment | null> {
  const catalog = await getCatalog();
  const found = findNotebook(catalog, notebookId);
  if (!found || !NOEMA_CHAPTER_IDS.has(found.chapter.id)) return null;

  const raw = await loadAssessmentJson("notebook-checks", notebookId);
  return raw ? validateNotebookCheck(raw, found.notebook) : null;
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

  const raw = await loadAssessmentJson("chapter-finals", chapterId);
  return raw ? validateChapterFinal(raw, chapter) : null;
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
