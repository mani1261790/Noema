const CLOUDFLARE_API_BASE = "https://api.cloudflare.com/client/v4";

async function cloudflareRequest(fetchFn, apiToken, path, init = {}) {
  const response = await fetchFn(`${CLOUDFLARE_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    const detail = Array.isArray(payload.errors)
      ? payload.errors.map((error) => error.message).filter(Boolean).join("; ")
      : "unknown Cloudflare API error";
    throw new Error(`Cloudflare route update failed (${response.status}): ${detail}`);
  }
  return payload.result;
}

export async function assignWorkerRoute({
  apiToken,
  fetchFn = fetch,
  pattern = "noema-learn.uk/*",
  previousScript = "noema-public-gate",
  targetScript = "noema-learn-production",
  zoneName = "noema-learn.uk"
}) {
  if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is required.");
  const zones = await cloudflareRequest(
    fetchFn,
    apiToken,
    `/zones?name=${encodeURIComponent(zoneName)}`
  );
  if (!Array.isArray(zones) || zones.length !== 1 || typeof zones[0]?.id !== "string") {
    throw new Error(`Expected exactly one accessible Cloudflare zone for ${zoneName}.`);
  }

  const zoneId = zones[0].id;
  const routes = await cloudflareRequest(fetchFn, apiToken, `/zones/${zoneId}/workers/routes`);
  if (!Array.isArray(routes)) throw new Error("Cloudflare route list was not an array.");
  const existing = routes.find((route) => route.pattern === pattern);
  if (existing?.script === targetScript) return { action: "unchanged", routeId: existing.id };
  if (existing && existing.script !== previousScript) {
    throw new Error(
      `Refusing to replace ${pattern}: it belongs to unexpected Worker ${existing.script ?? "(none)"}.`
    );
  }

  const body = JSON.stringify({ pattern, script: targetScript });
  if (existing) {
    await cloudflareRequest(
      fetchFn,
      apiToken,
      `/zones/${zoneId}/workers/routes/${existing.id}`,
      { body, method: "PUT" }
    );
    return { action: "updated", routeId: existing.id };
  }

  const created = await cloudflareRequest(
    fetchFn,
    apiToken,
    `/zones/${zoneId}/workers/routes`,
    { body, method: "POST" }
  );
  return { action: "created", routeId: created.id };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await assignWorkerRoute({ apiToken: process.env.CLOUDFLARE_API_TOKEN });
  console.log(`Production Worker route ${result.action}.`);
}
