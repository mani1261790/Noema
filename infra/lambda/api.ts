import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  askQuestion,
  assertAdminNotebookCreatable,
  assertAdminContentWritable,
  completeChat,
  createChapterFinalAssessmentAttempt,
  createNotebookColabSession,
  deleteAdminNotebook,
  downloadNotebookIpynb,
  eventBodyTooLarge,
  getAdminNotebookDetail,
  getChapterFinalAssessment,
  getChapterFinalAssessmentAttempt,
  getLearningProgress,
  getNotebookAssessment,
  getAuthUser,
  getQuestionAnswer,
  isAdmin,
  json,
  listCatalog,
  listAdminNotebooks,
  listAdminQuestions,
  listQuestionHistory,
  maybeInlineProcess,
  parseAdminNotebookPatchInput,
  parseAdminNotebookLlmPatchInput,
  parseAdminNotebookPreviewInput,
  parseAdminNotebookPutInput,
  parseAdminPatchInput,
  parseAskQuestionInput,
  parseChatCompleteInput,
  parseChapterLearningProgressPutInput,
  parseLearningProgressPutInput,
  parseNotebookColabSessionInput,
  parsePythonRuntimeInput,
  parsePythonRuntimePreloadInput,
  patchAdminNotebook,
  putAdminNotebook,
  proposeAdminNotebookPatch,
  previewAdminNotebook,
  patchAdminAnswer,
  putChapterLearningProgress,
  preloadPythonRuntime,
  putLearningProgress,
  runPythonRuntime,
  submitChapterFinalAssessmentAttempt,
  submitNotebookAssessmentAttempt,
  upsertNotebookFromEvent
} from "./runtime";

function questionIdFromEvent(event: APIGatewayProxyEventV2): string {
  const fromParams = event.pathParameters?.questionId?.trim();
  if (fromParams) return fromParams;

  const segments = (event.rawPath || "").split("/").filter(Boolean);
  if (segments.length >= 4 && segments[0] === "api" && segments[1] === "questions") {
    return decodeURIComponent(segments[2]);
  }

  return "";
}

function notebookIdFromEvent(event: APIGatewayProxyEventV2): string {
  const fromParams = event.pathParameters?.notebookId?.trim();
  if (fromParams) return fromParams;

  const segments = (event.rawPath || "").split("/").filter(Boolean);
  if (segments.length >= 4 && segments[0] === "api" && segments[1] === "admin" && segments[2] === "notebooks") {
    return decodeURIComponent(segments[3]);
  }

  return "";
}

function publicNotebookIdFromEvent(event: APIGatewayProxyEventV2): string {
  const fromParams = event.pathParameters?.notebookId?.trim();
  if (fromParams) return fromParams;

  const segments = (event.rawPath || "").split("/").filter(Boolean);
  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "notebooks") {
    return decodeURIComponent(segments[2]);
  }

  return "";
}

function assessmentChapterIdFromEvent(event: APIGatewayProxyEventV2): string {
  const fromParams = event.pathParameters?.chapterId?.trim();
  if (fromParams) return fromParams;
  const segments = (event.rawPath || "").split("/").filter(Boolean);
  if (segments.length >= 4 && segments[0] === "api" && segments[1] === "assessments" && segments[2] === "chapters") {
    return decodeURIComponent(segments[3]);
  }
  return "";
}

function assessmentNotebookIdFromEvent(event: APIGatewayProxyEventV2): string {
  const fromParams = event.pathParameters?.notebookId?.trim();
  if (fromParams) return fromParams;
  const segments = (event.rawPath || "").split("/").filter(Boolean);
  if (segments.length >= 4 && segments[0] === "api" && segments[1] === "assessments" && segments[2] === "notebooks") {
    return decodeURIComponent(segments[3]);
  }
  return "";
}

function assessmentAttemptIdFromEvent(event: APIGatewayProxyEventV2): string {
  const fromParams = event.pathParameters?.attemptId?.trim();
  if (fromParams) return fromParams;
  const segments = (event.rawPath || "").split("/").filter(Boolean);
  const attemptsIndex = segments.indexOf("attempts");
  if (attemptsIndex >= 0 && segments[attemptsIndex + 1]) {
    return decodeURIComponent(segments[attemptsIndex + 1]);
  }
  return "";
}

function learningProgressNotebookIdFromEvent(event: APIGatewayProxyEventV2): string {
  const fromParams = event.pathParameters?.notebookId?.trim();
  if (fromParams) return fromParams;

  const segments = (event.rawPath || "").split("/").filter(Boolean);
  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "learning-progress") {
    return decodeURIComponent(segments[2]);
  }

  return "";
}

function learningProgressChapterIdFromEvent(event: APIGatewayProxyEventV2): string {
  const fromParams = event.pathParameters?.chapterId?.trim();
  if (fromParams) return fromParams;

  const segments = (event.rawPath || "").split("/").filter(Boolean);
  if (segments.length >= 4 && segments[0] === "api" && segments[1] === "learning-progress" && segments[2] === "chapters") {
    return decodeURIComponent(segments[3]);
  }

  return "";
}

function routeKey(event: APIGatewayProxyEventV2): string {
  const contextRouteKey = event.requestContext.routeKey;
  // Prefer concrete route keys, but for templated/greedy routes fall back to the raw path.
  if (contextRouteKey && contextRouteKey !== "$default" && !contextRouteKey.includes("{")) {
    return contextRouteKey;
  }

  return `${event.requestContext.http.method} ${event.rawPath}`;
}

function parseJsonBody(event: APIGatewayProxyEventV2): Record<string, any> {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const route = routeKey(event);

  if (route === "GET /health") {
    return json(200, { ok: true, service: "noema-api" });
  }

  if (route === "GET /api/catalog") {
    try {
      const result = await listCatalog();
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: message });
    }
  }

  if (
    route === "GET /api/notebooks/{notebookId}/download" ||
    /^GET \/api\/notebooks\/[^/]+\/download$/.test(route)
  ) {
    const notebookId = publicNotebookIdFromEvent(event);
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    const result = await downloadNotebookIpynb(notebookId);
    if (!result) {
      return json(404, { error: "Notebook not found" });
    }
    return result;
  }

  if (/^GET \/api\/assessments\/notebooks\/[^/]+$/.test(route)) {
    const notebookId = assessmentNotebookIdFromEvent(event);
    const result = await getNotebookAssessment(notebookId);
    if (!result) return json(404, { error: "Assessment not found" });
    return json(200, result);
  }

  if (/^POST \/api\/assessments\/notebooks\/[^/]+\/attempts$/.test(route)) {
    const notebookId = assessmentNotebookIdFromEvent(event);
    const payload = parseJsonBody(event);
    const result = await submitNotebookAssessmentAttempt(notebookId, payload.answers || {});
    if (!result) return json(404, { error: "Assessment not found" });
    return json(200, result);
  }

  if (/^GET \/api\/assessments\/chapters\/[^/]+\/final$/.test(route)) {
    const chapterId = assessmentChapterIdFromEvent(event);
    const result = await getChapterFinalAssessment(chapterId);
    if (!result) return json(404, { error: "Assessment not found" });
    return json(200, result);
  }

  const user = getAuthUser(event);
  if (!user) {
    return json(401, { error: "Unauthorized" });
  }

  if (route === "GET /api/me") {
    return json(200, {
      userId: user.userId,
      email: user.email,
      groups: user.groups,
      isAdmin: isAdmin(user)
    });
  }

  if (route === "POST /api/questions") {
    if (eventBodyTooLarge(event, 12000)) {
      return json(413, { error: "Request body is too large." });
    }
    const payload = parseAskQuestionInput(event);
    if (!payload) {
      return json(400, { error: "Invalid request", details: "notebookId/sectionId/questionText are required" });
    }

    try {
      const result = await askQuestion(payload, user);
      return json(202, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        message === "Notebook not found."
          ? 404
          : message.startsWith("Rate limit exceeded")
            ? 429
            : 500;
      return json(statusCode, { error: message });
    }
  }

  if (route === "POST /api/chat/complete") {
    if (eventBodyTooLarge(event, 12000)) {
      return json(413, { error: "Request body is too large." });
    }
    const payload = parseChatCompleteInput(event);
    if (!payload) {
      return json(400, { error: "Invalid request", details: "notebookId/questionText/provider are required and questionText must be within the allowed limit" });
    }

    try {
      const result = await completeChat(payload, user);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        message === "Notebook not found."
          ? 404
          : message.includes("API key is not configured")
            ? 400
            : message.startsWith("Bedrock daily limit exceeded") || message.startsWith("Rate limit exceeded")
              ? 429
              : 500;
      return json(statusCode, { error: message });
    }
  }

  if (/^POST \/api\/assessments\/chapters\/[^/]+\/final\/attempts$/.test(route)) {
    if (eventBodyTooLarge(event, 25000)) {
      return json(413, { error: "Request body is too large." });
    }
    const chapterId = assessmentChapterIdFromEvent(event);
    const payload = parseJsonBody(event);
    try {
      const result = await createChapterFinalAssessmentAttempt(user, chapterId, payload.answers || {});
      if (!result) return json(404, { error: "Assessment not found" });
      return json(202, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        message.includes("exceeds 2000 characters") || message.includes("must be a string") || message === "Invalid answers payload."
          ? 400
          :
        message === "BEDROCK_REGION is not configured." ||
        message.includes("Bedrock model is not configured") ||
        message === "QA_QUEUE_URL is not configured."
          ? 500
          : 500;
      return json(statusCode, { error: message });
    }
  }

  if (/^GET \/api\/assessments\/chapters\/[^/]+\/final\/attempts\/[^/]+$/.test(route)) {
    const attemptId = assessmentAttemptIdFromEvent(event);
    const result = await getChapterFinalAssessmentAttempt(user, attemptId);
    if (result.kind === "not_found") return json(404, { error: "Attempt not found" });
    if (result.kind === "forbidden") return json(403, { error: "Forbidden" });
    return json(200, result.attempt);
  }

  if (route === "GET /api/questions/history") {
    const notebookId = (event.queryStringParameters?.notebookId || "").trim();
    const sessionId = (event.queryStringParameters?.sessionId || "").trim();
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    try {
      const result = await listQuestionHistory(user, notebookId, sessionId);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: message });
    }
  }

  if (route === "GET /api/learning-progress") {
    try {
      const result = await getLearningProgress(user);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: message });
    }
  }

  if (route === "PUT /api/learning-progress/{notebookId}" || /^PUT \/api\/learning-progress\/[^/]+$/.test(route)) {
    const notebookId = learningProgressNotebookIdFromEvent(event);
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    const payload = parseLearningProgressPutInput(event);
    if (!payload) {
      return json(400, { error: "Invalid request", details: "visits/lastVisitedAt/completed/completedAt are invalid" });
    }

    try {
      const result = await putLearningProgress(user, notebookId, payload);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: message });
    }
  }

  if (/^PUT \/api\/learning-progress\/chapters\/[^/]+$/.test(route)) {
    const chapterId = learningProgressChapterIdFromEvent(event);
    if (!chapterId) {
      return json(400, { error: "chapterId is required" });
    }

    const payload = parseChapterLearningProgressPutInput(event);
    if (!payload) {
      return json(400, { error: "Invalid request", details: "final progress fields are invalid" });
    }

    try {
      const result = await putChapterLearningProgress(user, chapterId, payload);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: message });
    }
  }

  if (route === "GET /api/questions/{questionId}/answer" || /^GET \/api\/questions\/[^/]+\/answer$/.test(route)) {
    const questionId = questionIdFromEvent(event);
    if (!questionId) {
      return json(400, { error: "questionId is required" });
    }

    await maybeInlineProcess(questionId);
    const result = await getQuestionAnswer(questionId, user);

    if (result.kind === "not_found") {
      return json(404, { error: "Not found" });
    }
    if (result.kind === "forbidden") {
      return json(403, { error: "Forbidden" });
    }
    if (result.kind === "pending") {
      return json(202, {
        questionId,
        status: result.status
      });
    }
    if (result.kind === "failed") {
      return json(409, {
        questionId,
        status: result.status,
        error: result.message
      });
    }

    return json(200, {
      questionId,
      status: result.status,
      answerText: result.answer.answerText,
      sourceReferences: result.answer.sourceReferences,
      tokensUsed: result.answer.tokensUsed,
      timestamp: result.answer.timestamp
    });
  }

  if (route === "POST /api/runtime/python") {
    const payload = parsePythonRuntimeInput(event);
    if (!payload) {
      return json(400, { error: "Invalid request", details: "notebookId/code are required." });
    }

    try {
      const result = await runPythonRuntime(payload, user);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: message });
    }
  }

  if (route === "POST /api/runtime/python/preload") {
    const payload = parsePythonRuntimePreloadInput(event);
    if (!payload) {
      return json(400, { error: "Invalid request", details: "notebookId is required." });
    }

    try {
      const result = await preloadPythonRuntime(payload, user);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: message });
    }
  }

  if (
    route === "POST /api/notebooks/{notebookId}/colab-session" ||
    /^POST \/api\/notebooks\/[^/]+\/colab-session$/.test(route)
  ) {
    const notebookId = publicNotebookIdFromEvent(event);
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    const payload = parseNotebookColabSessionInput(event);
    if (!payload) {
      return json(400, { error: "Invalid request", details: "ipynbRaw is required (<= 3MB)." });
    }

    try {
      const result = await createNotebookColabSession(notebookId, payload, user);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        message === "Notebook not found."
          ? 404
          : message === "NOTEBOOK_BUCKET is not configured."
            || message === "COLAB_NOTEBOOK_BASE_URL is not configured."
            ? 500
            : message.includes("Invalid ipynb")
              ? 400
              : 500;
      return json(statusCode, { error: message });
    }
  }

  if (!isAdmin(user)) {
    return json(403, { error: "Forbidden" });
  }

  if (route === "GET /api/admin/questions") {
    const result = await listAdminQuestions();
    return json(200, result);
  }

  if (route === "PATCH /api/admin/questions") {
    const payload = parseAdminPatchInput(event);
    if (!payload) {
      return json(400, { error: "questionId and answerText are required" });
    }

    const ok = await patchAdminAnswer(payload.questionId, payload.answerText);
    if (!ok) {
      return json(404, { error: "Not found" });
    }

    return json(200, { ok: true });
  }

  if (route === "POST /api/admin/notebooks") {
    try {
      assertAdminNotebookCreatable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(409, { error: message });
    }
    try {
      const notebookId = await upsertNotebookFromEvent(event);
      return json(201, { notebookId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        message.includes("required") || message.includes("Invalid") || message.includes("format") ? 400 : 500;
      return json(statusCode, { error: message });
    }
  }

  if (route === "GET /api/admin/notebooks") {
    const result = await listAdminNotebooks();
    return json(200, result);
  }

  if (route === "POST /api/admin/notebooks/preview") {
    const payload = parseAdminNotebookPreviewInput(event);
    if (!payload) {
      return json(400, { error: "ipynbRaw is required (<= 3MB)." });
    }

    try {
      const result = await previewAdminNotebook(payload, user);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("Invalid ipynb") ? 400 : 500;
      return json(status, { error: message });
    }
  }

  if (route === "PATCH /api/admin/notebooks") {
    try {
      assertAdminContentWritable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(409, { error: message });
    }
    const payload = parseAdminNotebookPatchInput(event);
    if (!payload) {
      return json(400, { error: "notebookId and at least one editable field are required" });
    }

    const ok = await patchAdminNotebook(payload);
    if (!ok) {
      return json(404, { error: "Not found" });
    }

    return json(200, { ok: true });
  }

  if (route === "GET /api/admin/notebooks/{notebookId}" || /^GET \/api\/admin\/notebooks\/[^/]+$/.test(route)) {
    const notebookId = notebookIdFromEvent(event);
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    const result = await getAdminNotebookDetail(notebookId);
    if (!result) {
      return json(404, { error: "Not found" });
    }

    return json(200, result);
  }

  if (
    route === "POST /api/admin/notebooks/{notebookId}/llm-patch" ||
    /^POST \/api\/admin\/notebooks\/[^/]+\/llm-patch$/.test(route)
  ) {
    const notebookId = notebookIdFromEvent(event);
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    const payload = parseAdminNotebookLlmPatchInput(event);
    if (!payload) {
      return json(400, { error: "instruction is required (<= 4000 chars)." });
    }

    try {
      const result = await proposeAdminNotebookPatch(notebookId, payload, user);
      return json(200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "Notebook not found." ? 404 : 500;
      return json(status, { error: message });
    }
  }

  if (route === "PUT /api/admin/notebooks/{notebookId}" || /^PUT \/api\/admin\/notebooks\/[^/]+$/.test(route)) {
    try {
      assertAdminContentWritable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(409, { error: message });
    }
    const notebookId = notebookIdFromEvent(event);
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    const payload = parseAdminNotebookPutInput(event);
    if (!payload) {
      return json(400, { error: "Invalid request body" });
    }

    try {
      const ok = await putAdminNotebook(notebookId, payload);
      if (!ok) {
        return json(404, { error: "Not found" });
      }
      return json(200, { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("Invalid ipynb") ? 400 : 500;
      return json(status, { error: message });
    }
  }

  if (route === "DELETE /api/admin/notebooks/{notebookId}" || /^DELETE \/api\/admin\/notebooks\/[^/]+$/.test(route)) {
    try {
      assertAdminContentWritable();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(409, { error: message });
    }
    const notebookId = notebookIdFromEvent(event);
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    const ok = await deleteAdminNotebook(notebookId);
    if (!ok) {
      return json(404, { error: "Not found" });
    }

    return json(200, { ok: true });
  }

  return json(404, {
    error: "Not Found",
    route
  });
};
