import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  askQuestion,
  deleteAdminNotebook,
  getAdminNotebookDetail,
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
  parseAdminNotebookPutInput,
  parseAdminPatchInput,
  parseAskQuestionInput,
  parsePythonRuntimeInput,
  parsePythonRuntimePreloadInput,
  patchAdminNotebook,
  putAdminNotebook,
  proposeAdminNotebookPatch,
  patchAdminAnswer,
  preloadPythonRuntime,
  runPythonRuntime,
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

function routeKey(event: APIGatewayProxyEventV2): string {
  const contextRouteKey = event.requestContext.routeKey;
  // Prefer concrete route keys, but for templated/greedy routes fall back to the raw path.
  if (contextRouteKey && contextRouteKey !== "$default" && !contextRouteKey.includes("{")) {
    return contextRouteKey;
  }

  return `${event.requestContext.http.method} ${event.rawPath}`;
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

  const user = getAuthUser(event);
  if (!user) {
    return json(401, { error: "Unauthorized" });
  }

  if (route === "POST /api/questions") {
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

  if (route === "GET /api/questions/history") {
    const notebookId = (event.queryStringParameters?.notebookId || "").trim();
    if (!notebookId) {
      return json(400, { error: "notebookId is required" });
    }

    try {
      const result = await listQuestionHistory(user, notebookId);
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

  if (route === "PATCH /api/admin/notebooks") {
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
