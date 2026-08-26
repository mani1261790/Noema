import assert from "node:assert/strict";
import test from "node:test";
import { assignWorkerRoute } from "./assign-worker-route.mjs";

function response(result, status = 200) {
  return new Response(JSON.stringify({ errors: [], result, success: status < 400 }), {
    headers: { "content-type": "application/json" },
    status
  });
}

test("updates the gate route to the production Worker", async () => {
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    requests.push({ init, url });
    if (url.endsWith("/zones?name=noema-learn.uk")) return response([{ id: "zone-id" }]);
    if (url.endsWith("/zones/zone-id/workers/routes")) {
      return response([{ id: "route-id", pattern: "noema-learn.uk/*", script: "noema-public-gate" }]);
    }
    return response({ id: "route-id" });
  };

  await assert.doesNotReject(assignWorkerRoute({ apiToken: "test-token", fetchFn }));
  assert.equal(requests[2].init.method, "PUT");
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    pattern: "noema-learn.uk/*",
    script: "noema-learn-production"
  });
  assert.equal(requests[2].init.headers.authorization, "Bearer test-token");
});

test("is idempotent when the route already targets production", async () => {
  let requestCount = 0;
  const fetchFn = async (url) => {
    requestCount += 1;
    if (url.endsWith("/zones?name=noema-learn.uk")) return response([{ id: "zone-id" }]);
    return response([{ id: "route-id", pattern: "noema-learn.uk/*", script: "noema-learn-production" }]);
  };

  await assert.doesNotReject(assignWorkerRoute({ apiToken: "test-token", fetchFn }));
  assert.equal(requestCount, 2);
});

test("refuses to replace a route owned by an unexpected Worker", async () => {
  const fetchFn = async (url) => {
    if (url.endsWith("/zones?name=noema-learn.uk")) return response([{ id: "zone-id" }]);
    return response([{ id: "route-id", pattern: "noema-learn.uk/*", script: "another-worker" }]);
  };

  await assert.rejects(
    assignWorkerRoute({ apiToken: "test-token", fetchFn }),
    /unexpected Worker another-worker/
  );
});
