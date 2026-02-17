import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import {
  askQuestion,
  getAuthUser,
  getQuestionAnswer,
  isAdmin,
  json,
  listAdminQuestions,
  listQuestionHistory,
  maybeInlineProcess,
  parseAdminPatchInput,
  parseAskQuestionInput,
  patchAdminAnswer,
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

function routeKey(event: APIGatewayProxyEventV2): string {
  if (event.requestContext.routeKey && event.requestContext.routeKey !== "$default") {
    return event.requestContext.routeKey;
  }

  return `${event.requestContext.http.method} ${event.rawPath}`;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const route = routeKey(event);

  if (route === "GET /health") {
    return json(200, { ok: true, service: "noema-api" });
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

  return json(404, {
    error: "Not Found",
    route
  });
};
