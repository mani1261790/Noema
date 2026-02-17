import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const json = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body)
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
  const route = `${event.requestContext.http.method} ${event.requestContext.http.path}`;

  if (route === "GET /health") {
    return json(200, { ok: true, service: "noema-api" });
  }

  if (route === "POST /api/questions") {
    return json(202, {
      message: "Lambda route is provisioned. Connect this handler to app business logic or migrate API routes here.",
      requestId: event.requestContext.requestId
    });
  }

  return json(404, {
    error: "Not Found",
    route
  });
};
